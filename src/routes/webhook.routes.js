const express = require('express');
const router = express.Router();
const { handleRazorpayWebhook } = require('../controllers/webhook.controller');

/**
 * Razorpay Webhook Endpoint
 * @route POST /api/webhooks/razorpay
 * @desc Handle Razorpay webhook events
 * @access Public (verified via signature)
 */
router.post('/razorpay', express.raw({ type: 'application/json' }), handleRazorpayWebhook);

module.exports = router;
