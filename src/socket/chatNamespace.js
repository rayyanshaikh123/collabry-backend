const Message = require('../models/Message');
const chatService = require('../services/chat.service');

let io;

const initializeChatNamespace = (socketIO) => {
  io = socketIO;
  const chatNamespace = io.of('/chat');

  chatNamespace.use(async (socket, next) => {
    try {
      const userId = socket.handshake.auth.userId;
      const userEmail = socket.handshake.auth.userEmail;

      if (!userId || !userEmail) {
        return next(new Error('Authentication required'));
      }

      socket.userId = userId;
      socket.userEmail = userEmail;
      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  });

  chatNamespace.on('connection', (socket) => {
    console.log(`💬 Chat socket connected: ${socket.userEmail} (${socket.id})`);

    // Join user's personal room
    socket.join(`user:${socket.userId}`);

    // Join conversation (direct or group)
    socket.on('join:conversation', ({ conversationType, conversationId }) => {
      const roomName = `${conversationType}:${conversationId}`;
      socket.join(roomName);
      console.log(`✅ ${socket.userEmail} joined ${roomName}`);
    });

    // Leave conversation
    socket.on('leave:conversation', ({ conversationType, conversationId }) => {
      const roomName = `${conversationType}:${conversationId}`;
      socket.leave(roomName);
      console.log(`❌ ${socket.userEmail} left ${roomName}`);
    });

    // Send message
    socket.on('message:send', async (data, callback) => {
      console.log(`📤 Message send request from ${socket.userEmail}:`, data);
      
      try {
        const message = await chatService.sendMessage(socket.userId, data);
        console.log(`✅ Message created:`, message._id);

        // Determine room name
        let roomName;
        if (data.conversationType === 'direct') {
          // Create consistent room name for direct messages by sorting IDs
          const userIds = [socket.userId.toString(), data.recipientId.toString()].sort();
          roomName = `direct:${userIds[0]}:${userIds[1]}`;
          
          // Also emit to recipient's personal room for notifications
          chatNamespace.to(`user:${data.recipientId}`).emit('message:new', message);
          // Emit to sender's personal room for notifications
          chatNamespace.to(`user:${socket.userId}`).emit('message:new', message);
        } else if (data.conversationType === 'group') {
          roomName = `group:${data.groupId}`;
          console.log(`📢 Broadcasting to room: ${roomName}`);
        }

        // Broadcast to room
        if (roomName) {
          chatNamespace.to(roomName).emit('message:new', message);
          console.log(`✅ Message broadcasted to ${roomName}`);
        }

        // Emit to sender confirmation
        socket.emit('message:sent', message);

        if (callback && typeof callback === 'function') {
          callback({ success: true, message });
        }
      } catch (error) {
        console.error('❌ Error sending message:', error);
        if (callback && typeof callback === 'function') {
          callback({ error: error.message });
        }
      }
    });

    // Typing indicator
    socket.on('typing:start', ({ conversationType, conversationId }) => {
      const roomName = `${conversationType}:${conversationId}`;
      socket.to(roomName).emit('user:typing', {
        userId: socket.userId,
        userEmail: socket.userEmail,
      });
    });

    socket.on('typing:stop', ({ conversationType, conversationId }) => {
      const roomName = `${conversationType}:${conversationId}`;
      socket.to(roomName).emit('user:stopped-typing', {
        userId: socket.userId,
      });
    });

    // Mark messages as read
    socket.on('messages:mark-read', async ({ messageIds }, callback) => {
      try {
        await chatService.markAsRead(socket.userId, messageIds);

        // Notify senders that messages were read
        const messages = await Message.find({ _id: { $in: messageIds } }).populate('sender');
        const senderIds = [...new Set(messages.map((m) => m.sender._id.toString()))];

        senderIds.forEach((senderId) => {
          if (senderId !== socket.userId.toString()) {
            chatNamespace.to(`user:${senderId}`).emit('messages:read', {
              messageIds,
              readBy: socket.userId,
            });
          }
        });

        if (callback && typeof callback === 'function') {
          callback({ success: true });
        }
      } catch (error) {
        console.error('Error marking messages as read:', error);
        if (callback && typeof callback === 'function') {
          callback({ error: error.message });
        }
      }
    });

    // Edit message
    socket.on('message:edit', async ({ messageId, content }, callback) => {
      try {
        const message = await chatService.editMessage(messageId, socket.userId, content);

        // Determine room name
        let roomName;
        if (message.conversationType === 'direct') {
          const recipientId = message.participants.find(
            (p) => p.toString() !== socket.userId.toString()
          );
          roomName = `direct:${recipientId}`;
          chatNamespace.to(`user:${recipientId}`).emit('message:edited', message);
        } else if (message.conversationType === 'group') {
          roomName = `group:${message.group}`;
        }

        // Broadcast to room
        if (roomName) {
          chatNamespace.to(roomName).emit('message:edited', message);
        }

        if (callback && typeof callback === 'function') {
          callback({ success: true, message });
        }
      } catch (error) {
        console.error('Error editing message:', error);
        if (callback && typeof callback === 'function') {
          callback({ error: error.message });
        }
      }
    });

    // Delete message
    socket.on('message:delete', async ({ messageId }, callback) => {
      try {
        const message = await Message.findById(messageId);
        if (!message) {
          throw new Error('Message not found');
        }

        await chatService.deleteMessage(messageId, socket.userId);

        // Determine room name
        let roomName;
        if (message.conversationType === 'direct') {
          const recipientId = message.participants.find(
            (p) => p.toString() !== socket.userId.toString()
          );
          roomName = `direct:${recipientId}`;
          chatNamespace.to(`user:${recipientId}`).emit('message:deleted', { messageId });
        } else if (message.conversationType === 'group') {
          roomName = `group:${message.group}`;
        }

        // Broadcast to room
        if (roomName) {
          chatNamespace.to(roomName).emit('message:deleted', { messageId });
        }

        if (callback && typeof callback === 'function') {
          callback({ success: true });
        }
      } catch (error) {
        console.error('Error deleting message:', error);
        if (callback && typeof callback === 'function') {
          callback({ error: error.message });
        }
      }
    });

    socket.on('disconnect', () => {
      console.log(`💬 Chat socket disconnected: ${socket.userEmail}`);
    });
  });

  console.log('💬 Chat namespace initialized');
};

module.exports = { initializeChatNamespace };
