const asyncHandler = require('../utils/asyncHandler');
const chatService = require('../services/chat.service');

class ChatController {
  // Send message
  sendMessage = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const message = await chatService.sendMessage(userId, req.body);

    res.status(201).json({ message });
  });

  // Get messages
  getMessages = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { type } = req.params; // direct or group
    const conversationType = type || req.query.conversationType;
    const params = req.query;

    if (!conversationType) {
      return res.status(400).json({ message: 'Conversation type is required' });
    }

    const messages = await chatService.getMessages(userId, conversationType, params);

    res.json({ messages, count: messages.length });
  });

  // Get conversations
  getConversations = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const conversations = await chatService.getConversations(userId);

    res.json({ conversations, count: conversations.length });
  });

  // Mark messages as read
  markAsRead = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { messageIds } = req.body;

    const result = await chatService.markAsRead(userId, messageIds);

    res.json(result);
  });

  // Edit message
  editMessage = asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user._id;
    const { content } = req.body;

    const message = await chatService.editMessage(messageId, userId, content);

    res.json({ message });
  });

  // Delete message
  deleteMessage = asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user._id;

    const result = await chatService.deleteMessage(messageId, userId);

    res.json(result);
  });
}

module.exports = new ChatController();
