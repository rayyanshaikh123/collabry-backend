const Message = require('../models/Message');
const Friendship = require('../models/Friendship');
const Group = require('../models/Group');

class ChatService {
  // Send message
  async sendMessage(userId, data) {
    const { conversationType, content, messageType, attachments, replyTo, recipientId, groupId } = data;

    const messageData = {
      sender: userId,
      conversationType,
      content,
      messageType: messageType || 'text',
      attachments: attachments || [],
      replyTo,
    };

    // Validate based on conversation type
    if (conversationType === 'direct') {
      if (!recipientId) {
        throw new Error('Recipient ID is required for direct messages');
      }

      // Check if users are friends
      const areFriends = await this.areFriends(userId, recipientId);
      if (!areFriends) {
        throw new Error('Can only send direct messages to friends');
      }

      // Store both user IDs in sorted order for consistency
      messageData.participants = [userId, recipientId].sort();
    } else if (conversationType === 'group') {
      if (!groupId) {
        throw new Error('Group ID is required for group messages');
      }

      // Check if user is a member
      const group = await Group.findById(groupId);
      if (!group) {
        throw new Error('Group not found');
      }

      console.log('🔍 [chat.service] Membership check:');
      console.log('  - userId from socket:', userId);
      console.log('  - userId type:', typeof userId);
      console.log('  - group members:', group.members.map(m => ({ 
        userId: m.user.toString(), 
        type: typeof m.user 
      })));

      const isMember = group.members.some((m) => m.user.toString() === userId.toString());
      console.log('  - isMember result:', isMember);
      
      if (!isMember) {
        throw new Error('Not a member of this group');
      }

      messageData.group = groupId;
    }

    const message = await Message.create(messageData);
    return await message.populate('sender', 'name email avatar');
  }

  // Get messages for a conversation
  async getMessages(userId, conversationType, params) {
    const { limit = 50, before } = params;
    let query = { conversationType, isDeleted: false };

    if (conversationType === 'direct') {
      const { recipientId } = params;
      if (!recipientId) {
        throw new Error('Recipient ID is required');
      }

      // Check if friends
      const areFriends = await this.areFriends(userId, recipientId);
      if (!areFriends) {
        throw new Error('Can only view messages with friends');
      }

      query.participants = { $all: [userId, recipientId] };
    } else if (conversationType === 'group') {
      const { groupId } = params;
      if (!groupId) {
        throw new Error('Group ID is required');
      }

      // Check membership
      const group = await Group.findById(groupId);
      if (!group) {
        throw new Error('Group not found');
      }

      const isMember = group.members.some((m) => m.user.toString() === userId.toString());
      if (!isMember) {
        throw new Error('Not a member of this group');
      }

      query.group = groupId;
    }

    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .populate('sender', 'name email avatar')
      .populate('replyTo')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    return messages.reverse();
  }

  // Get conversations list (for direct messages)
  async getConversations(userId) {
    // Get all friendships
    const friendships = await Friendship.find({
      $or: [{ user1: userId }, { user2: userId }],
      status: 'active',
    })
      .populate('user1', 'name email avatar')
      .populate('user2', 'name email avatar');

    // Get last message for each friend
    const conversations = await Promise.all(
      friendships.map(async (friendship) => {
        const friendId = friendship.user1._id.toString() === userId.toString() ? friendship.user2._id : friendship.user1._id;
        const friend = friendship.user1._id.toString() === userId.toString() ? friendship.user2 : friendship.user1;

        const lastMessage = await Message.findOne({
          conversationType: 'direct',
          participants: { $all: [userId, friendId] },
          isDeleted: false,
        })
          .populate('sender', 'name email avatar')
          .sort({ createdAt: -1 });

        // Get unread count
        const unreadCount = await Message.countDocuments({
          conversationType: 'direct',
          participants: { $all: [userId, friendId] },
          sender: friendId,
          isDeleted: false,
          'readBy.user': { $ne: userId },
        });

        return {
          friend,
          lastMessage,
          unreadCount,
        };
      })
    );

    // Sort by last message time
    return conversations.sort((a, b) => {
      if (!a.lastMessage) return 1;
      if (!b.lastMessage) return -1;
      return new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt);
    });
  }

  // Mark messages as read
  async markAsRead(userId, messageIds) {
    const messages = await Message.find({
      _id: { $in: messageIds },
      sender: { $ne: userId },
    });

    for (const message of messages) {
      const alreadyRead = message.readBy.some((r) => r.user.toString() === userId.toString());
      if (!alreadyRead) {
        message.readBy.push({ user: userId });
        await message.save();
      }
    }

    return { message: 'Messages marked as read' };
  }

  // Edit message
  async editMessage(messageId, userId, content) {
    const message = await Message.findById(messageId);

    if (!message) {
      throw new Error('Message not found');
    }

    if (message.sender.toString() !== userId.toString()) {
      throw new Error('Can only edit your own messages');
    }

    if (message.isDeleted) {
      throw new Error('Cannot edit deleted message');
    }

    message.content = content;
    message.isEdited = true;
    message.editedAt = new Date();

    await message.save();

    return await message.populate('sender', 'name email avatar');
  }

  // Delete message
  async deleteMessage(messageId, userId) {
    const message = await Message.findById(messageId);

    if (!message) {
      throw new Error('Message not found');
    }

    if (message.sender.toString() !== userId.toString()) {
      throw new Error('Can only delete your own messages');
    }

    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();

    return { message: 'Message deleted successfully' };
  }

  // Helper: Check if users are friends
  async areFriends(userId1, userId2) {
    const [user1, user2] =
      userId1.toString() < userId2.toString() ? [userId1, userId2] : [userId2, userId1];

    const friendship = await Friendship.findOne({
      user1,
      user2,
      status: 'active',
    });

    return !!friendship;
  }
}

module.exports = new ChatService();
