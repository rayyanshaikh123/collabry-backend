const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');
const { protect } = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/role.middleware');
const { body, param, validationResult } = require('express-validator');

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array().map(err => ({
        field: err.param,
        message: err.msg
      }))
    });
  }
  next();
};

// Validation rules
const validateReportCreation = [
  body('contentType')
    .notEmpty().withMessage('Content type is required')
    .isIn(['board', 'user', 'element', 'chat', 'other']).withMessage('Invalid content type'),
  body('contentId')
    .notEmpty().withMessage('Content ID is required'),
  body('reason')
    .notEmpty().withMessage('Reason is required')
    .isIn(['spam', 'inappropriate', 'abuse', 'harassment', 'copyright', 'other']).withMessage('Invalid reason'),
  body('description')
    .notEmpty().withMessage('Description is required')
    .isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters'),
  validate
];

const validateReportAction = [
  body('action')
    .optional()
    .isIn(['none', 'warning', 'content_removed', 'user_suspended', 'user_banned']).withMessage('Invalid action'),
  body('reviewNotes')
    .optional()
    .isLength({ max: 2000 }).withMessage('Review notes cannot exceed 2000 characters'),
  validate
];

// Admin middleware
const adminAuth = [protect, authorizeRoles('admin')];

// Public route - Create report (any authenticated user can report)
router.post('/', protect, validateReportCreation, reportController.createReport);

// Admin routes - All require admin role
router.get('/stats', ...adminAuth, reportController.getReportStats);
router.get('/', ...adminAuth, reportController.getReports);
router.get('/:id', ...adminAuth, reportController.getReport);
router.put('/:id/review', ...adminAuth, validateReportAction, reportController.reviewReport);
router.put('/:id/resolve', ...adminAuth, validateReportAction, reportController.resolveReport);
router.put('/:id/dismiss', ...adminAuth, reportController.dismissReport);
router.delete('/bulk', ...adminAuth, reportController.bulkDeleteReports);

module.exports = router;
