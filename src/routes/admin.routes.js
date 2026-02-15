const express = require('express');
const adminController = require('../controllers/admin.controller');
const reportController = require('../controllers/report.controller');
const deepReportsController = require('../controllers/deepReports.controller');
const auditLogController = require('../controllers/auditLog.controller');
const adminNotificationController = require('../controllers/adminNotification.controller');
const adminSubscriptionController = require('../controllers/adminSubscription.controller');
const { protect } = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/role.middleware');

const router = express.Router();

// Middleware for all admin routes
const adminAuth = [protect, authorizeRoles('admin')];

/**
 * @route   GET /api/admin/dashboard
 * @desc    Get admin dashboard
 * @access  Private/Admin only
 */
router.get('/dashboard', ...adminAuth, adminController.getDashboard);

/**
 * @route   GET /api/admin/users
 * @desc    Get all users
 * @access  Private/Admin only
 */
router.get('/users', ...adminAuth, adminController.getAllUsers);

/**
 * @route   GET /api/admin/users/:id
 * @desc    Get single user
 * @access  Private/Admin only
 */
router.get('/users/:id', ...adminAuth, adminController.getUser);

/**
 * @route   POST /api/admin/users
 * @desc    Create new user
 * @access  Private/Admin only
 */
router.post('/users', ...adminAuth, adminController.createUser);

/**
 * @route   PUT /api/admin/users/:id
 * @desc    Update user
 * @access  Private/Admin only
 */
router.put('/users/:id', ...adminAuth, adminController.updateUser);

/**
 * @route   DELETE /api/admin/users/:id
 * @desc    Delete user
 * @access  Private/Admin only
 */
router.delete('/users/:id', ...adminAuth, adminController.deleteUser);

/**
 * @route   PATCH /api/admin/users/bulk-status
 * @desc    Bulk enable/disable users
 * @access  Private/Admin only
 */
router.patch('/users/bulk-status', ...adminAuth, adminController.bulkUpdateUserStatus);

/**
 * @route   DELETE /api/admin/users/bulk
 * @desc    Bulk delete users
 * @access  Private/Admin only
 */
router.delete('/users/bulk', ...adminAuth, adminController.bulkDeleteUsers);

// ============================================================================
// BOARD MANAGEMENT ROUTES (Admin only)
// ============================================================================

/**
 * @route   GET /api/admin/boards/stats
 * @desc    Get board statistics
 * @access  Private/Admin only
 */
router.get('/boards/stats', ...adminAuth, adminController.getBoardStats);

/**
 * @route   GET /api/admin/boards
 * @desc    Get all boards
 * @access  Private/Admin only
 */
router.get('/boards', ...adminAuth, adminController.getAllBoards);

/**
 * @route   GET /api/admin/boards/:id/analytics
 * @desc    Get board analytics
 * @access  Private/Admin only
 */
router.get('/boards/:id/analytics', ...adminAuth, adminController.getBoardAnalytics);

/**
 * @route   PUT /api/admin/boards/:id/suspend
 * @desc    Suspend a board
 * @access  Private/Admin only
 */
router.put('/boards/:id/suspend', ...adminAuth, adminController.suspendBoard);

/**
 * @route   DELETE /api/admin/boards/:id/force
 * @desc    Force delete a board
 * @access  Private/Admin only
 */
router.delete('/boards/:id/force', ...adminAuth, adminController.forceDeleteBoard);

// ============================================================================
// PLATFORM SETTINGS ROUTES (Admin only)
// ============================================================================

/**
 * @route   GET /api/admin/settings
 * @desc    Get platform settings
 * @access  Private/Admin only
 */
router.get('/settings', ...adminAuth, adminController.getSettings);

/**
 * @route   PUT /api/admin/settings
 * @desc    Update platform settings
 * @access  Private/Admin only
 */
router.put('/settings', ...adminAuth, adminController.updateSettings);

// ============================================================================
// REPORT/MODERATION ROUTES (Admin only)
// ============================================================================

/**
 * @route   GET /api/admin/reports/stats
 * @desc    Get report statistics
 * @access  Private/Admin only
 */
router.get('/reports/stats', ...adminAuth, reportController.getReportStats);

/**
 * @route   GET /api/admin/reports
 * @desc    Get all reports
 * @access  Private/Admin only
 */
router.get('/reports', ...adminAuth, reportController.getReports);

/**
 * @route   GET /api/admin/reports/:id
 * @desc    Get single report
 * @access  Private/Admin only
 */
router.get('/reports/:id', ...adminAuth, reportController.getReport);

/**
 * @route   PUT /api/admin/reports/:id/review
 * @desc    Mark report as reviewing
 * @access  Private/Admin only
 */
router.put('/reports/:id/review', ...adminAuth, reportController.reviewReport);

/**
 * @route   PUT /api/admin/reports/:id/resolve
 * @desc    Resolve a report
 * @access  Private/Admin only
 */
router.put('/reports/:id/resolve', ...adminAuth, reportController.resolveReport);

/**
 * @route   PUT /api/admin/reports/:id/dismiss
 * @desc    Dismiss a report
 * @access  Private/Admin only
 */
router.put('/reports/:id/dismiss', ...adminAuth, reportController.dismissReport);

/**
 * @route   DELETE /api/admin/reports/bulk
 * @desc    Bulk delete reports
 * @access  Private/Admin only
 */
router.delete('/reports/bulk', ...adminAuth, reportController.bulkDeleteReports);

// ============================================================================
// DEEP REPORTS / ANALYTICS ROUTES (Admin only)
// ============================================================================

router.get('/deep-reports/user-growth', ...adminAuth, deepReportsController.getUserGrowthReport);
router.get('/deep-reports/engagement', ...adminAuth, deepReportsController.getEngagementReport);
router.get('/deep-reports/ai-usage', ...adminAuth, deepReportsController.getAIUsageReport);
router.get('/deep-reports/boards', ...adminAuth, deepReportsController.getBoardsReport);
router.get('/deep-reports/revenue', ...adminAuth, deepReportsController.getRevenueReport);

// ============================================================================
// AUDIT LOG ROUTES (Admin only)
// ============================================================================

router.get('/audit-logs', ...adminAuth, auditLogController.getAuditLogs);
router.get('/audit-logs/stats', ...adminAuth, auditLogController.getAuditLogStats);

// ============================================================================
// ADMIN NOTIFICATIONS / ANNOUNCEMENTS (Admin only)
// ============================================================================

router.post('/notifications/broadcast', ...adminAuth, adminNotificationController.broadcastNotification);
router.get('/notifications/history', ...adminAuth, adminNotificationController.getAnnouncementHistory);

// ============================================================================
// SUBSCRIPTION & PAYMENT MANAGEMENT (Admin only)
// ============================================================================

router.get('/subscriptions', ...adminAuth, adminSubscriptionController.getAllSubscriptions);
router.get('/subscriptions/stats', ...adminAuth, adminSubscriptionController.getSubscriptionStats);
router.get('/payments', ...adminAuth, adminSubscriptionController.getAllPayments);

// ============================================================================
// EXPORT ROUTES (Admin only)
// ============================================================================

router.get('/export/users', ...adminAuth, adminController.getAllUsers);
router.get('/export/audit-logs', ...adminAuth, auditLogController.getAuditLogs);

module.exports = router;
