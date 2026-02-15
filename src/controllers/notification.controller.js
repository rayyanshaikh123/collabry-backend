const notificationService = require('../services/notification.service');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Get all notifications for current user
 * @route GET /api/notifications
 */
exports.getNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { isRead, type, priority, limit, skip } = req.query;

  const result = await notificationService.getUserNotifications(userId, {
    isRead: isRead === 'true' ? true : isRead === 'false' ? false : undefined,
    type,
    priority,
    limit: limit ? parseInt(limit) : 50,
    skip: skip ? parseInt(skip) : 0,
  });

  res.status(200).json({
    success: true,
    data: result.notifications,
    meta: {
      total: result.total,
      unreadCount: result.unreadCount,
    },
  });
});

/**
 * Get unread count
 * @route GET /api/notifications/unread-count
 */
exports.getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const count = await notificationService.getUnreadCount(userId);

  res.status(200).json({
    success: true,
    data: { count },
  });
});

/**
 * Mark notification as read
 * @route PATCH /api/notifications/:id/read
 */
exports.markAsRead = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const notificationId = req.params.id;

  const notification = await notificationService.markAsRead(notificationId, userId);

  res.status(200).json({
    success: true,
    data: notification,
    message: 'Notification marked as read',
  });
});

/**
 * Mark all notifications as read
 * @route PATCH /api/notifications/read-all
 */
exports.markAllAsRead = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  await notificationService.markAllAsRead(userId);

  res.status(200).json({
    success: true,
    message: 'All notifications marked as read',
  });
});

/**
 * Delete a notification
 * @route DELETE /api/notifications/:id
 */
exports.deleteNotification = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const notificationId = req.params.id;

  await notificationService.deleteNotification(notificationId, userId);

  res.status(200).json({
    success: true,
    message: 'Notification deleted',
  });
});

/**
 * Delete all read notifications
 * @route DELETE /api/notifications/read
 */
exports.deleteAllRead = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await notificationService.deleteAllRead(userId);

  res.status(200).json({
    success: true,
    message: `Deleted ${result.deletedCount} notifications`,
  });
});

/**
 * Test notification (development only)
 * @route POST /api/notifications/test
 */
exports.createTestNotification = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { type = 'system_announcement' } = req.body;

  let notification;

  switch (type) {
    case 'task_due_soon':
      notification = await notificationService.notifyTaskDueSoon(userId, {
        id: 'test-task-id',
        title: 'Complete JavaScript Module',
      });
      break;
    case 'streak_milestone':
      notification = await notificationService.notifyStreakMilestone(userId, 7);
      break;
    case 'board_invitation':
      notification = await notificationService.notifyBoardInvitation(
        userId,
        { id: 'test-board-id', title: 'Study Group Board' },
        { name: 'Test User' }
      );
      break;
    case 'daily_motivation':
      notification = await notificationService.notifyDailyMotivation(userId);
      break;
    default:
      notification = await notificationService.createNotification({
        userId,
        type: 'system_announcement',
        title: '🎉 Test Notification',
        message: 'This is a test notification!',
        priority: 'medium',
      });
  }

  res.status(201).json({
    success: true,
    data: notification,
    message: 'Test notification created',
  });
});
