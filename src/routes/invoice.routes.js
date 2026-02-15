const express = require('express');
const router = express.Router();
const {
  generateInvoice,
  emailInvoice,
  getMyInvoices,
  downloadInvoice,
} = require('../controllers/invoice.controller');
const { protect } = require('../middlewares/auth.middleware');

// All routes require authentication
router.use(protect);

// @route   GET /api/invoices/my-invoices
// @desc    Get all user's invoices
router.get('/my-invoices', getMyInvoices);

// @route   POST /api/invoices/generate/:paymentId
// @desc    Generate invoice for a payment
router.post('/generate/:paymentId', generateInvoice);

// @route   POST /api/invoices/email/:paymentId
// @desc    Email invoice to user
router.post('/email/:paymentId', emailInvoice);

// @route   GET /api/invoices/download/:paymentId
// @desc    Download invoice PDF
router.get('/download/:paymentId', downloadInvoice);

module.exports = router;
