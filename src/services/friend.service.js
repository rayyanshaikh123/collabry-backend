const FriendRequest = require('../models/FriendRequest');
const Friendship = require('../models/Friendship');
const User = require('../models/User');

class FriendService {
  // Send friend request
  async sendFriendRequest(fromUserId, toUserId, message = '') {
    if (fromUserId === toUserId) {
      throw new Error('Cannot send friend request to yourself');
    }

    // Check if users exist
    const [fromUser, toUser] = await Promise.all([
      User.findById(fromUserId),
      User.findById(toUserId),
    ]);

    if (!fromUser || !toUser) {
      throw new Error('User not found');
    }

    // Check if already friends
    const existingFriendship = await this.areFriends(fromUserId, toUserId);
    if (existingFriendship) {
      throw new Error('Already friends with this user');
    }

    // Check for existing request
    const existingRequest = await FriendRequest.findOne({
      $or: [
        { from: fromUserId, to: toUserId },
        { from: toUserId, to: fromUserId },
      ],
      status: 'pending',
    });

    if (existingRequest) {
      throw new Error('Friend request already exists');
    }

    // Create new request
    const request = await FriendRequest.create({
      from: fromUserId,
      to: toUserId,
      message,
    });

    return await request.populate([
      { path: 'from', select: 'name email avatar' },
      { path: 'to', select: 'name email avatar' },
    ]);
  }

  // Accept friend request
  async acceptFriendRequest(requestId, userId) {
    const request = await FriendRequest.findById(requestId);

    if (!request) {
      throw new Error('Friend request not found');
    }

    if (request.to.toString() !== userId.toString()) {
      throw new Error('Not authorized to accept this request');
    }

    if (request.status !== 'pending') {
      throw new Error('Friend request already processed');
    }

    // Update request status
    request.status = 'accepted';
    await request.save();

    // Create friendship (ensure user1 < user2 for consistent ordering)
    const [user1, user2] =
      request.from.toString() < request.to.toString()
        ? [request.from, request.to]
        : [request.to, request.from];

    const friendship = await Friendship.create({
      user1,
      user2,
    });

    return { request, friendship };
  }

  // Reject friend request
  async rejectFriendRequest(requestId, userId) {
    const request = await FriendRequest.findById(requestId);

    if (!request) {
      throw new Error('Friend request not found');
    }

    if (request.to.toString() !== userId.toString()) {
      throw new Error('Not authorized to reject this request');
    }

    if (request.status !== 'pending') {
      throw new Error('Friend request already processed');
    }

    request.status = 'rejected';
    await request.save();

    return request;
  }

  // Cancel sent friend request
  async cancelFriendRequest(requestId, userId) {
    const request = await FriendRequest.findById(requestId);

    if (!request) {
      throw new Error('Friend request not found');
    }

    if (request.from.toString() !== userId.toString()) {
      throw new Error('Not authorized to cancel this request');
    }

    if (request.status !== 'pending') {
      throw new Error('Friend request already processed');
    }

    await request.deleteOne();

    return { message: 'Friend request cancelled' };
  }

  // Get pending friend requests (received)
  async getPendingRequests(userId) {
    const requests = await FriendRequest.find({
      to: userId,
      status: 'pending',
    })
      .populate('from', 'name email avatar')
      .sort({ createdAt: -1 });

    return requests;
  }

  // Get sent friend requests
  async getSentRequests(userId) {
    const requests = await FriendRequest.find({
      from: userId,
      status: 'pending',
    })
      .populate('to', 'name email avatar')
      .sort({ createdAt: -1 });

    return requests;
  }

  // Get friends list
  async getFriends(userId) {
    const friendships = await Friendship.find({
      $or: [{ user1: userId }, { user2: userId }],
      status: 'active',
    })
      .populate('user1', 'name email avatar')
      .populate('user2', 'name email avatar')
      .sort({ createdAt: -1 });

    // Map to friend objects
    const friends = friendships.map((friendship) => {
      const friend =
        friendship.user1._id.toString() === userId.toString()
          ? friendship.user2
          : friendship.user1;

      return {
        _id: friendship._id,
        user: friend,
        since: friendship.createdAt,
      };
    });

    return friends;
  }

  // Remove friend
  async removeFriend(friendshipId, userId) {
    const friendship = await Friendship.findById(friendshipId);

    if (!friendship) {
      throw new Error('Friendship not found');
    }

    // Check if user is part of this friendship
    if (
      friendship.user1.toString() !== userId.toString() &&
      friendship.user2.toString() !== userId.toString()
    ) {
      throw new Error('Not authorized to remove this friend');
    }

    await friendship.deleteOne();

    return { message: 'Friend removed successfully' };
  }

  // Check if users are friends
  async areFriends(userId1, userId2) {
    const [user1, user2] =
      userId1.toString() < userId2.toString()
        ? [userId1, userId2]
        : [userId2, userId1];

    const friendship = await Friendship.findOne({
      user1,
      user2,
      status: 'active',
    });

    return !!friendship;
  }

  // Search users (excluding already friends and self)
  async searchUsers(userId, query) {
    // Get current friends
    const friendships = await Friendship.find({
      $or: [{ user1: userId }, { user2: userId }],
      status: 'active',
    });

    const friendIds = friendships.map((f) =>
      f.user1.toString() === userId.toString() ? f.user2 : f.user1
    );

    // Get pending requests
    const pendingRequests = await FriendRequest.find({
      $or: [{ from: userId }, { to: userId }],
      status: 'pending',
    });

    const pendingUserIds = pendingRequests.map((r) =>
      r.from.toString() === userId.toString() ? r.to.toString() : r.from.toString()
    );

    // Search users
    const users = await User.find({
      _id: { $ne: userId, $nin: [...friendIds, ...pendingUserIds] },
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
      ],
    })
      .select('name email avatar')
      .limit(20);

    return users;
  }

  // Block friend
  async blockFriend(friendshipId, userId) {
    const friendship = await Friendship.findById(friendshipId);

    if (!friendship) {
      throw new Error('Friendship not found');
    }

    // Check if user is part of this friendship
    if (
      friendship.user1.toString() !== userId.toString() &&
      friendship.user2.toString() !== userId.toString()
    ) {
      throw new Error('Not authorized to block this friend');
    }

    friendship.status = 'blocked';
    friendship.blockedBy = userId;
    await friendship.save();

    return friendship;
  }

  // Unblock friend
  async unblockFriend(friendshipId, userId) {
    const friendship = await Friendship.findById(friendshipId);

    if (!friendship) {
      throw new Error('Friendship not found');
    }

    if (friendship.blockedBy?.toString() !== userId.toString()) {
      throw new Error('Not authorized to unblock this friend');
    }

    friendship.status = 'active';
    friendship.blockedBy = undefined;
    await friendship.save();

    return friendship;
  }
}

module.exports = new FriendService();
