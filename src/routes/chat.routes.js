const express = require('express');
const chatController = require('../controllers/chat.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

// All routes require authentication
router.use(protect);

// Messages
router.post('/messages', chatController.sendMessage);
router.get('/messages', chatController.getMessages);
router.get('/messages/:type', chatController.getMessages);
router.put('/messages/:messageId', chatController.editMessage);
router.delete('/messages/:messageId', chatController.deleteMessage);

// Conversations
router.get('/conversations', chatController.getConversations);

// Mark as read
router.post('/messages/read', chatController.markAsRead);

module.exports = router;
