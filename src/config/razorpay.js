const Razorpay = require('razorpay');
const crypto = require('crypto');
const { RAZORPAY_PLANS, ONE_TIME_PLANS } = require('./plans');

// Initialize Razorpay instance
const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Verify Razorpay payment signature
 * @param {string} razorpay_order_id
 * @param {string} razorpay_payment_id
 * @param {string} razorpay_signature
 * @returns {boolean}
 */
const verifyPaymentSignature = (razorpay_order_id, razorpay_payment_id, razorpay_signature) => {
  const text = razorpay_order_id + '|' + razorpay_payment_id;
  const generated_signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(text)
    .digest('hex');
  
  return generated_signature === razorpay_signature;
};

/**
 * Verify Razorpay webhook signature
 * @param {string} body - Raw request body
 * @param {string} signature - X-Razorpay-Signature header
 * @returns {boolean}
 */
const verifyWebhookSignature = (body, signature) => {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');
  
  return expectedSignature === signature;
};

/**
 * Get plan details by ID
 * @param {string} planId
 * @returns {object}
 */
const getPlanDetails = (planId) => {
  return RAZORPAY_PLANS[planId] || null;
};

/**
 * Convert plan name to tier
 * @param {string} planId - e.g., 'basic_monthly', 'pro_yearly'
 * @returns {string} - 'free', 'basic', 'pro', 'enterprise'
 */
const planIdToTier = (planId) => {
  if (planId.startsWith('basic')) return 'basic';
  if (planId.startsWith('pro')) return 'pro';
  if (planId.startsWith('enterprise')) return 'enterprise';
  return 'free';
};

/**
 * Get interval from plan ID
 * @param {string} planId
 * @returns {string} - 'monthly' | 'yearly' | 'lifetime'
 */
const getIntervalFromPlanId = (planId) => {
  if (planId.includes('yearly')) return 'yearly';
  if (planId.includes('lifetime') || planId === 'enterprise') return 'lifetime';
  return 'monthly';
};

module.exports = {
  razorpayInstance,
  RAZORPAY_PLANS,
  ONE_TIME_PLANS,
  verifyPaymentSignature,
  verifyWebhookSignature,
  getPlanDetails,
  planIdToTier,
  getIntervalFromPlanId,
};
