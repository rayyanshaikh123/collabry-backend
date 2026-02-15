const asyncHandler = require('express-async-handler');
const Notification = require('../models/Notification');
const User = require('../models/User');
const notificationService = require('../services/notification.service');
const AppError = require('../utils/AppError');

/**
 * @desc    Send announcement to all users (or filtered set)
 * @route   POST /api/admin/notifications/broadcast
 * @access  Private/Admin
 */
const broadcastNotification = asyncHandler(async (req, res) => {
  const { title, message, priority = 'medium', targetRole, targetTier } = req.body;

  if (!title || !message) {
    throw new AppError('Title and message are required', 400);
  }

  // Build user filter
  const userFilter = { isActive: true };
  if (targetRole) userFilter.role = targetRole;
  if (targetTier) userFilter.subscriptionTier = targetTier;

  const users = await User.find(userFilter).select('_id').lean();

  if (users.length === 0) {
    throw new AppError('No users match the target criteria', 400);
  }

  const notifications = users.map((u) => ({
    userId: u._id,
    type: 'system_announcement',
    title,
    message,
    priority,
    metadata: { sentBy: req.user._id, broadcastId: Date.now().toString(36) },
  }));

  const result = await notificationService.createBulkNotifications(notifications);

  res.status(201).json({
    success: true,
    message: `Announcement sent to ${result.length} user(s)`,
    data: { recipientCount: result.length },
  });
});

/**
 * @desc    Get recent admin-sent announcements
 * @route   GET /api/admin/notifications/history
 * @access  Private/Admin
 */
const getAnnouncementHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Get distinct broadcastIds for system_announcement type
  const pipeline = [
    { $match: { type: 'system_announcement', 'metadata.broadcastId': { $exists: true } } },
    {
      $group: {
        _id: '$metadata.broadcastId',
        title: { $first: '$title' },
        message: { $first: '$message' },
        priority: { $first: '$priority' },
        sentAt: { $first: '$createdAt' },
        recipientCount: { $sum: 1 },
        readCount: { $sum: { $cond: ['$isRead', 1, 0] } },
      },
    },
    { $sort: { sentAt: -1 } },
    { $skip: skip },
    { $limit: parseInt(limit) },
  ];

  const totalPipeline = [
    { $match: { type: 'system_announcement', 'metadata.broadcastId': { $exists: true } } },
    { $group: { _id: '$metadata.broadcastId' } },
    { $count: 'total' },
  ];

  const [announcements, totalResult] = await Promise.all([
    Notification.aggregate(pipeline),
    Notification.aggregate(totalPipeline),
  ]);

  const total = totalResult[0]?.total || 0;

  res.status(200).json({
    success: true,
    data: {
      announcements,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    },
  });
});

module.exports = { broadcastNotification, getAnnouncementHistory };
