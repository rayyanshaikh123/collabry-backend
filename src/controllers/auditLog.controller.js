const asyncHandler = require('express-async-handler');
const AuthAuditLog = require('../models/AuthAuditLog');

/**
 * @desc    Get audit logs with filters and pagination
 * @route   GET /api/admin/audit-logs
 * @access  Private/Admin
 */
const getAuditLogs = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 50,
    event,
    userId,
    email,
    success,
    startDate,
    endDate,
    search,
  } = req.query;

  const query = {};

  if (event) query.event = event;
  if (userId) query.userId = userId;
  if (email) query.email = { $regex: email, $options: 'i' };
  if (success !== undefined && success !== '') query.success = success === 'true';
  if (search) {
    query.$or = [
      { email: { $regex: search, $options: 'i' } },
      { event: { $regex: search, $options: 'i' } },
      { ipAddress: { $regex: search, $options: 'i' } },
    ];
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const total = await AuthAuditLog.countDocuments(query);

  const logs = await AuthAuditLog.find(query)
    .populate('userId', 'name email avatar')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .lean();

  res.status(200).json({
    success: true,
    data: {
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    },
  });
});

/**
 * @desc    Get audit log statistics
 * @route   GET /api/admin/audit-logs/stats
 * @access  Private/Admin
 */
const getAuditLogStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const last24h = new Date(now - 24 * 60 * 60 * 1000);
  const last7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const [eventCounts, last24hCount, failedLogins, recentSecurity] = await Promise.all([
    AuthAuditLog.aggregate([
      { $match: { createdAt: { $gte: last7d } } },
      { $group: { _id: '$event', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    AuthAuditLog.countDocuments({ createdAt: { $gte: last24h } }),
    AuthAuditLog.countDocuments({
      event: 'login_failed',
      createdAt: { $gte: last24h },
    }),
    AuthAuditLog.find({
      event: { $in: ['token_theft_detected', 'account_locked', 'password_reset_request'] },
      createdAt: { $gte: last7d },
    })
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);

  res.status(200).json({
    success: true,
    data: {
      eventCounts: eventCounts.reduce((acc, e) => { acc[e._id] = e.count; return acc; }, {}),
      last24hCount,
      failedLogins,
      recentSecurityEvents: recentSecurity,
    },
  });
});

module.exports = { getAuditLogs, getAuditLogStats };
