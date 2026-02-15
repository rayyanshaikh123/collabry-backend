const express = require('express');
const notificationController = require('../controllers/notification.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

// All routes require authentication
router.use(protect);

// Get all notifications
router.get('/', notificationController.getNotifications);

// Get unread count
router.get('/unread-count', notificationController.getUnreadCount);

// Mark all as read
router.patch('/read-all', notificationController.markAllAsRead);

// Delete all read
router.delete('/read', notificationController.deleteAllRead);

// Test notification (development)
router.post('/test', notificationController.createTestNotification);

// Mark single notification as read
router.patch('/:id/read', notificationController.markAsRead);

// Delete single notification
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;
