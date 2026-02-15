const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Coupon = require('../models/Coupon');
const AppError = require('../utils/AppError');
const {
  razorpayInstance,
  RAZORPAY_PLANS,
  ONE_TIME_PLANS,
  verifyPaymentSignature,
  planIdToTier,
  getIntervalFromPlanId,
} = require('../config/razorpay');
const { isTierAtLeast, GRACE_PERIOD_DAYS } = require('../config/plans');

class SubscriptionService {
  /**
   * Get user's current subscription
   */
  async getUserSubscription(userId) {
    let subscription = await Subscription.findOne({ user: userId });
    
    // Create free subscription if none exists
    if (!subscription) {
      subscription = await Subscription.create({
        user: userId,
        plan: 'free',
        status: 'active',
      });
    }
    
    return subscription;
  }

  /**
   * Create Razorpay order for subscription
   * @param {string} userId - User ID
   * @param {string} planId - Plan ID
   * @param {string} couponCode - Optional coupon code
   */
  async createSubscriptionOrder(userId, planId, couponCode = null) {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const planDetails = RAZORPAY_PLANS[planId];
    if (!planDetails) {
      throw new AppError(`Invalid plan selected: ${planId}`, 400);
    }

    let finalAmount = planDetails.amount;
    let discountApplied = 0;
    let couponData = null;
    const tier = planIdToTier(planId);

    // Prevent downgrades via direct purchase — user should cancel first
    const currentSub = await Subscription.findOne({ user: userId, status: 'active' });
    if (currentSub && currentSub.plan !== 'free') {
      if (isTierAtLeast(currentSub.plan, tier) && currentSub.plan !== tier) {
        throw new AppError(
          `You are already on the ${currentSub.plan} plan. Cancel your current subscription first to switch to a lower plan.`,
          400
        );
      }
    }

    // Apply coupon if provided
    if (couponCode) {
      const couponResult = await Coupon.validateAndGet(couponCode, userId, tier, finalAmount);
      
      if (!couponResult.valid) {
        throw new AppError(couponResult.reason, 400);
      }
      
      discountApplied = couponResult.discount;
      finalAmount = couponResult.finalAmount;
      couponData = {
        code: couponResult.coupon.code,
        discountType: couponResult.coupon.discountType,
        discountValue: couponResult.coupon.discountValue,
        discountApplied,
      };
    }

    // Create a shorter receipt ID (max 40 chars for Razorpay)
    const shortUserId = userId.toString().slice(-8); // Last 8 chars of user ID
    const timestamp = Date.now().toString().slice(-10); // Last 10 digits
    const receipt = `rcpt_${shortUserId}_${timestamp}`; // Format: rcpt_XXXXXXXX_XXXXXXXXXX (28 chars)

    try {
      // Create Razorpay order
      const order = await razorpayInstance.orders.create({
        amount: finalAmount,
        currency: planDetails.currency,
        receipt,
        notes: {
          userId: userId.toString(),
          planId,
          userEmail: user.email,
          originalAmount: planDetails.amount.toString(),
          discountApplied: discountApplied.toString(),
          couponCode: couponCode || '',
        },
      });

      return {
        orderId: order.id,
        amount: order.amount,
        originalAmount: planDetails.amount,
        discountApplied,
        currency: order.currency,
        planId,
        planDetails,
        coupon: couponData,
      };
    } catch (razorpayError) {
      console.error('Razorpay API error:', razorpayError);
      const errorMessage = razorpayError.error?.description || razorpayError.message || 'Unknown error';
      throw new AppError(`Razorpay error: ${errorMessage}`, 500);
    }
  }

  /**
   * Verify payment and activate subscription
   */
  async verifyAndActivateSubscription(userId, paymentData) {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId } = paymentData;

    // Verify signature
    const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) {
      throw new AppError('Invalid payment signature', 400);
    }

    // Fetch payment details from Razorpay
    const payment = await razorpayInstance.payments.fetch(razorpay_payment_id);
    
    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      throw new AppError('Payment not successful', 400);
    }

    const planDetails = RAZORPAY_PLANS[planId] || ONE_TIME_PLANS[planId];
    const tier = planIdToTier(planId);
    const interval = getIntervalFromPlanId(planId);

    // Calculate period dates
    const currentPeriodStart = new Date();
    let currentPeriodEnd;
    
    if (interval === 'monthly') {
      currentPeriodEnd = new Date(currentPeriodStart);
      currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
    } else if (interval === 'yearly') {
      currentPeriodEnd = new Date(currentPeriodStart);
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
    } else {
      // Lifetime
      currentPeriodEnd = new Date('2099-12-31');
    }

    // Update or create subscription
    let subscription = await Subscription.findOne({ user: userId });
    
    if (subscription) {
      subscription.plan = tier;
      subscription.status = 'active';
      subscription.razorpay_subscription_id = razorpay_payment_id;
      subscription.razorpay_plan_id = planId;
      subscription.currentPeriodStart = currentPeriodStart;
      subscription.currentPeriodEnd = currentPeriodEnd;
      subscription.amount = payment.amount;
      subscription.currency = payment.currency;
      subscription.interval = interval;
      subscription.lastPaymentDate = new Date();
      subscription.cancelAtPeriodEnd = false;
      
      if (interval !== 'lifetime') {
        subscription.nextBillingDate = currentPeriodEnd;
      }
      
      await subscription.save();
    } else {
      subscription = await Subscription.create({
        user: userId,
        plan: tier,
        status: 'active',
        razorpay_subscription_id: razorpay_payment_id,
        razorpay_plan_id: planId,
        currentPeriodStart,
        currentPeriodEnd,
        amount: payment.amount,
        currency: payment.currency,
        interval,
        lastPaymentDate: new Date(),
        nextBillingDate: interval !== 'lifetime' ? currentPeriodEnd : null,
      });
    }

    // Update user's subscription tier
    await User.findByIdAndUpdate(userId, { subscriptionTier: tier });

    // Create payment record with coupon info
    const couponCode = payment.notes?.couponCode || null;
    const originalAmount = payment.notes?.originalAmount ? parseInt(payment.notes.originalAmount) : payment.amount;
    const discountApplied = payment.notes?.discountApplied ? parseInt(payment.notes.discountApplied) : 0;
    
    const paymentRecord = await Payment.create({
      user: userId,
      subscription: subscription._id,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      amount: payment.amount,
      currency: payment.currency,
      status: 'captured',
      method: payment.method,
      description: `Subscription payment for ${tier} plan`,
      couponCode,
      originalAmount,
      discountApplied,
    });

    // Record coupon usage if a coupon was used
    if (couponCode) {
      try {
        const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
        if (coupon) {
          await coupon.apply(userId, subscription._id, discountApplied);
        }
      } catch (error) {
        console.error('Error recording coupon usage:', error);
      }
    }

    // Auto-generate invoice in background
    setImmediate(async () => {
      try {
        const invoiceService = require('./invoice.service');
        await invoiceService.generateAndEmailInvoice(paymentRecord._id);
        console.log('Invoice generated and emailed for payment:', paymentRecord._id);
      } catch (error) {
        console.error('Error generating invoice:', error);
      }
    });

    return subscription;
  }

  /**
   * Cancel subscription at period end.
   * The user keeps full access until currentPeriodEnd.
   * A cron job (see jobs/subscriptionExpiry.js) handles the actual downgrade.
   */
  async cancelSubscription(userId) {
    const subscription = await Subscription.findOne({ user: userId });
    
    if (!subscription) {
      throw new AppError('No active subscription found', 404);
    }

    if (subscription.plan === 'free') {
      throw new AppError('Cannot cancel free plan', 400);
    }

    if (subscription.cancelAtPeriodEnd) {
      throw new AppError('Subscription is already scheduled for cancellation', 400);
    }

    // Mark for cancellation — do NOT change status or tier yet
    subscription.cancelAtPeriodEnd = true;
    await subscription.save();

    return subscription;
  }

  /**
   * Reactivate a subscription that was scheduled for cancellation.
   * Only works if the billing period hasn't expired yet.
   */
  async reactivateSubscription(userId) {
    const subscription = await Subscription.findOne({ user: userId });
    
    if (!subscription) {
      throw new AppError('No subscription found', 404);
    }

    if (!subscription.cancelAtPeriodEnd) {
      throw new AppError('Subscription is not pending cancellation', 400);
    }

    // Cannot reactivate if the period already expired
    if (subscription.currentPeriodEnd && new Date() > new Date(subscription.currentPeriodEnd)) {
      throw new AppError('Subscription period has already expired. Please purchase a new plan.', 400);
    }

    subscription.cancelAtPeriodEnd = false;
    // Status should already be 'active'; ensure it is
    subscription.status = 'active';
    await subscription.save();

    return subscription;
  }

  /**
   * Get payment history
   */
  async getPaymentHistory(userId, limit = 10) {
    const payments = await Payment.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('subscription', 'plan');
    
    return payments;
  }

  /**
   * Check if user can access feature based on subscription
   */
  async checkFeatureAccess(userId, feature) {
    const subscription = await this.getUserSubscription(userId);
    return subscription.canAccessFeature(feature);
  }

  /**
   * Get all available plans
   */
  getAvailablePlans() {
    return {
      plans: RAZORPAY_PLANS,
      oneTimePlans: ONE_TIME_PLANS,
    };
  }
}

module.exports = new SubscriptionService();
