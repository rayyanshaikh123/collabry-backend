const asyncHandler = require('../utils/asyncHandler');
const invoiceService = require('../services/invoice.service');
const Payment = require('../models/Payment');
const path = require('path');
const fs = require('fs');

/**
 * @desc    Generate invoice for a payment
 * @route   POST /api/invoices/generate/:paymentId
 * @access  Private
 */
const generateInvoice = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;

  // Verify payment belongs to user
  const payment = await Payment.findById(paymentId);
  if (!payment) {
    return res.status(404).json({
      success: false,
      error: 'Payment not found',
    });
  }

  if (payment.user.toString() !== req.user.id) {
    return res.status(403).json({
      success: false,
      error: 'Not authorized to access this payment',
    });
  }

  const invoice = await invoiceService.generateInvoice(paymentId);

  res.status(200).json({
    success: true,
    data: invoice,
  });
});

/**
 * @desc    Email invoice to user
 * @route   POST /api/invoices/email/:paymentId
 * @access  Private
 */
const emailInvoice = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;

  // Verify payment belongs to user
  const payment = await Payment.findById(paymentId);
  if (!payment) {
    return res.status(404).json({
      success: false,
      error: 'Payment not found',
    });
  }

  if (payment.user.toString() !== req.user.id) {
    return res.status(403).json({
      success: false,
      error: 'Not authorized to access this payment',
    });
  }

  await invoiceService.emailInvoice(paymentId);

  res.status(200).json({
    success: true,
    message: 'Invoice emailed successfully',
  });
});

/**
 * @desc    Get all invoices for current user
 * @route   GET /api/invoices/my-invoices
 * @access  Private
 */
const getMyInvoices = asyncHandler(async (req, res) => {
  const invoices = await invoiceService.getUserInvoices(req.user.id);

  res.status(200).json({
    success: true,
    data: invoices,
  });
});

/**
 * @desc    Download invoice PDF
 * @route   GET /api/invoices/download/:paymentId
 * @access  Private
 */
const downloadInvoice = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;

  // Verify payment belongs to user
  const payment = await Payment.findById(paymentId);
  if (!payment) {
    return res.status(404).json({
      success: false,
      error: 'Payment not found',
    });
  }

  if (payment.user.toString() !== req.user.id) {
    return res.status(403).json({
      success: false,
      error: 'Not authorized to access this payment',
    });
  }

  if (!payment.invoiceUrl) {
    return res.status(404).json({
      success: false,
      error: 'Invoice not generated yet',
    });
  }

  const invoicesDir = path.resolve(__dirname, '../..', 'invoices');
  const filePath = path.resolve(__dirname, '../..', payment.invoiceUrl);

  // Prevent path traversal — resolved path must stay within the invoices directory
  if (!filePath.startsWith(invoicesDir)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid invoice path',
    });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: 'Invoice file not found',
    });
  }

  res.download(filePath, `invoice-${payment.invoiceId}.pdf`);
});

module.exports = {
  generateInvoice,
  emailInvoice,
  getMyInvoices,
  downloadInvoice,
};
