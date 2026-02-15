const asyncHandler = require('../utils/asyncHandler');
const subscriptionService = require('../services/subscription.service');

/**
 * @desc    Get current user's subscription
 * @route   GET /api/subscriptions/current
 * @access  Private
 */
const getCurrentSubscription = asyncHandler(async (req, res) => {
  const subscription = await subscriptionService.getUserSubscription(req.user.id);
  
  res.status(200).json({
    success: true,
    data: subscription,
  });
});

/**
 * @desc    Get available plans
 * @route   GET /api/subscriptions/plans
 * @access  Public
 */
const getPlans = asyncHandler(async (req, res) => {
  const plans = subscriptionService.getAvailablePlans();
  
  res.status(200).json({
    success: true,
    data: plans,
  });
});

/**
 * @desc    Create subscription order
 * @route   POST /api/subscriptions/create-order
 * @access  Private
 */
const createOrder = asyncHandler(async (req, res) => {
  const { planId, couponCode } = req.body;
  
  if (!planId) {
    return res.status(400).json({
      success: false,
      error: 'Plan ID is required',
    });
  }

  const orderData = await subscriptionService.createSubscriptionOrder(req.user.id, planId, couponCode);
  
  res.status(200).json({
    success: true,
    data: orderData,
  });
});

/**
 * @desc    Verify payment and activate subscription
 * @route   POST /api/subscriptions/verify-payment
 * @access  Private
 */
const verifyPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId } = req.body;
  
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !planId) {
    return res.status(400).json({
      success: false,
      error: 'Missing required payment parameters',
    });
  }

  const subscription = await subscriptionService.verifyAndActivateSubscription(req.user.id, {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    planId,
  });
  
  // Get updated user with new subscription tier
  const User = require('../models/User');
  const updatedUser = await User.findById(req.user.id);
  
  res.status(200).json({
    success: true,
    message: 'Subscription activated successfully',
    data: {
      subscription,
      user: updatedUser.toJSON(),
    },
  });
});

/**
 * @desc    Cancel subscription
 * @route   POST /api/subscriptions/cancel
 * @access  Private
 */
const cancelSubscription = asyncHandler(async (req, res) => {
  const subscription = await subscriptionService.cancelSubscription(req.user.id);
  
  res.status(200).json({
    success: true,
    message: 'Subscription will be cancelled at the end of the billing period',
    data: subscription,
  });
});

/**
 * @desc    Reactivate cancelled subscription
 * @route   POST /api/subscriptions/reactivate
 * @access  Private
 */
const reactivateSubscription = asyncHandler(async (req, res) => {
  const subscription = await subscriptionService.reactivateSubscription(req.user.id);
  
  res.status(200).json({
    success: true,
    message: 'Subscription reactivated successfully',
    data: subscription,
  });
});

/**
 * @desc    Get payment history
 * @route   GET /api/subscriptions/payment-history
 * @access  Private
 */
const getPaymentHistory = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const payments = await subscriptionService.getPaymentHistory(req.user.id, limit);
  
  res.status(200).json({
    success: true,
    data: payments,
  });
});

/**
 * @desc    Check feature access
 * @route   GET /api/subscriptions/feature-access/:feature
 * @access  Private
 */
const checkFeatureAccess = asyncHandler(async (req, res) => {
  const { feature } = req.params;
  const hasAccess = await subscriptionService.checkFeatureAccess(req.user.id, feature);
  
  res.status(200).json({
    success: true,
    data: {
      feature,
      hasAccess,
    },
  });
});

module.exports = {
  getCurrentSubscription,
  getPlans,
  createOrder,
  verifyPayment,
  cancelSubscription,
  reactivateSubscription,
  getPaymentHistory,
  checkFeatureAccess,
};
