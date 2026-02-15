const reportService = require('../services/report.service');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const notificationService = require('../services/notification.service');
const { getIO } = require('../socket');
const { emitNotificationToUser } = require('../socket/notificationNamespace');

/**
 * @desc    Create a new report
 * @route   POST /api/reports
 * @access  Private
 */
exports.createReport = asyncHandler(async (req, res) => {
  const report = await reportService.createReport(req.user.id, req.body);

  // Send notification to all admins
  try {
    const User = require('../models/User');
    const admins = await User.find({ role: 'admin' }).select('_id');

    for (const admin of admins) {
      const notification = await notificationService.notifyNewReport(
        admin._id,
        report
      );

      const io = getIO();
      emitNotificationToUser(io, admin._id, notification);
    }
  } catch (err) {
    console.error('Failed to send report notifications to admins:', err);
  }

  res.status(201).json({
    success: true,
    message: 'Report submitted successfully',
    data: report
  });
});

/**
 * @desc    Get all reports (Admin only)
 * @route   GET /api/admin/reports
 * @access  Private/Admin
 */
exports.getReports = asyncHandler(async (req, res) => {
  const options = {
    status: req.query.status,
    contentType: req.query.contentType,
    priority: req.query.priority,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20,
    sortBy: req.query.sortBy || 'createdAt',
    sortOrder: req.query.sortOrder || 'desc'
  };

  const result = await reportService.getReports(options);

  res.json({
    success: true,
    data: result.reports,
    pagination: result.pagination
  });
});

/**
 * @desc    Get single report
 * @route   GET /api/admin/reports/:id
 * @access  Private/Admin
 */
exports.getReport = asyncHandler(async (req, res) => {
  const report = await reportService.getReportById(req.params.id);

  res.json({
    success: true,
    data: report
  });
});

/**
 * @desc    Review a report
 * @route   PUT /api/admin/reports/:id/review
 * @access  Private/Admin
 */
exports.reviewReport = asyncHandler(async (req, res) => {
  const report = await reportService.reviewReport(
    req.params.id,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'Report marked as reviewing',
    data: report
  });
});

/**
 * @desc    Resolve a report
 * @route   PUT /api/admin/reports/:id/resolve
 * @access  Private/Admin
 */
exports.resolveReport = asyncHandler(async (req, res) => {
  const report = await reportService.resolveReport(
    req.params.id,
    req.user.id,
    req.body
  );

  // Notify the reporter about resolution
  try {
    const action = req.body.action || 'reviewed';
    const notification = await notificationService.notifyContentFlagged(
      report.reportedBy,
      report.contentType,
      action
    );

    const io = getIO();
    emitNotificationToUser(io, report.reportedBy, notification);
  } catch (err) {
    console.error('Failed to send resolution notification:', err);
  }

  res.json({
    success: true,
    message: 'Report resolved successfully',
    data: report
  });
});

/**
 * @desc    Dismiss a report
 * @route   PUT /api/admin/reports/:id/dismiss
 * @access  Private/Admin
 */
exports.dismissReport = asyncHandler(async (req, res) => {
  const report = await reportService.dismissReport(
    req.params.id,
    req.user.id,
    req.body.reason
  );

  res.json({
    success: true,
    message: 'Report dismissed',
    data: report
  });
});

/**
 * @desc    Get report statistics
 * @route   GET /api/admin/reports/stats
 * @access  Private/Admin
 */
exports.getReportStats = asyncHandler(async (req, res) => {
  const stats = await reportService.getReportStats();

  res.json({
    success: true,
    data: stats
  });
});

/**
 * @desc    Bulk delete reports
 * @route   DELETE /api/admin/reports/bulk
 * @access  Private/Admin
 */
exports.bulkDeleteReports = asyncHandler(async (req, res) => {
  const { reportIds } = req.body;

  if (!reportIds || !Array.isArray(reportIds) || reportIds.length === 0) {
    throw new AppError('Please provide report IDs to delete', 400);
  }

  const result = await reportService.bulkDeleteReports(reportIds);

  res.json({
    success: true,
    message: `${result.deletedCount} reports deleted`,
    data: result
  });
});
