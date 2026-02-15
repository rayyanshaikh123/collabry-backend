const asyncHandler = require('../utils/asyncHandler');
const subscriptionService = require('../services/subscription.service');
const { verifyWebhookSignature } = require('../config/razorpay');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const WebhookEvent = require('../models/WebhookEvent');

/**
 * @desc    Handle Razorpay webhooks
 * @route   POST /api/webhooks/razorpay
 * @access  Public (but verified via signature)
 */
const handleRazorpayWebhook = asyncHandler(async (req, res) => {
  // Get webhook signature from headers
  const webhookSignature = req.headers['x-razorpay-signature'];
  
  if (!webhookSignature) {
    return res.status(400).json({
      success: false,
      error: 'Missing webhook signature',
    });
  }

  // Get raw body as string
  const rawBody = req.body.toString();
  
  // Verify webhook signature (function reads RAZORPAY_WEBHOOK_SECRET from env internally)
  const isValid = verifyWebhookSignature(rawBody, webhookSignature);

  if (!isValid) {
    console.error('Invalid webhook signature');
    return res.status(400).json({
      success: false,
      error: 'Invalid signature',
    });
  }

  // Parse the body
  const webhookBody = JSON.parse(rawBody);
  const event = webhookBody.event;
  const payload = webhookBody.payload;

  // Build a unique event ID for idempotency
  const entityId =
    payload?.payment?.entity?.id ||
    payload?.subscription?.entity?.id ||
    webhookBody.id ||
    webhookSignature.slice(0, 32);
  const eventId = `${event}:${entityId}`;

  // Check if we already processed this event
  try {
    await WebhookEvent.create({ eventId, event });
  } catch (err) {
    if (err.code === 11000) {
      // Duplicate — already processed
      console.log(`[webhook] Duplicate event skipped: ${eventId}`);
      return res.status(200).json({ success: true, duplicate: true });
    }
    throw err;
  }

  console.log(`Received webhook: ${event}`);

  try {
    switch (event) {
      case 'payment.captured':
        await handlePaymentCaptured(payload.payment.entity);
        break;

      case 'payment.failed':
        await handlePaymentFailed(payload.payment.entity);
        break;

      case 'subscription.activated':
        await handleSubscriptionActivated(payload.subscription.entity);
        break;

      case 'subscription.charged':
        await handleSubscriptionCharged(payload.subscription.entity, payload.payment?.entity);
        break;

      case 'subscription.cancelled':
        await handleSubscriptionCancelled(payload.subscription.entity);
        break;

      case 'subscription.completed':
        await handleSubscriptionCompleted(payload.subscription.entity);
        break;

      case 'subscription.paused':
        await handleSubscriptionPaused(payload.subscription.entity);
        break;

      case 'subscription.resumed':
        await handleSubscriptionResumed(payload.subscription.entity);
        break;

      default:
        console.log(`Unhandled webhook event: ${event}`);
    }

    // Always return 200 to acknowledge receipt
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    // Return 500 so Razorpay retries the webhook
    res.status(500).json({ success: false, error: 'Internal processing error' });
  }
});

/**
 * Handle payment.captured event
 */
async function handlePaymentCaptured(payment) {
  console.log('Processing payment.captured:', payment.id);

  // Update payment record if it exists
  await Payment.findOneAndUpdate(
    { razorpay_payment_id: payment.id },
    {
      status: 'captured',
      capturedAt: new Date(payment.created_at * 1000),
    }
  );
}

/**
 * Handle payment.failed event
 */
async function handlePaymentFailed(payment) {
  console.log('Processing payment.failed:', payment.id);

  // Update payment record
  await Payment.findOneAndUpdate(
    { razorpay_payment_id: payment.id },
    {
      status: 'failed',
      failureReason: payment.error_description || 'Payment failed',
    }
  );
}

/**
 * Handle subscription.activated event
 */
async function handleSubscriptionActivated(subscription) {
  console.log('Processing subscription.activated:', subscription.id);

  // Update subscription status
  await Subscription.findOneAndUpdate(
    { razorpay_subscription_id: subscription.id },
    {
      status: 'active',
      currentPeriodStart: new Date(subscription.current_start * 1000),
      currentPeriodEnd: new Date(subscription.current_end * 1000),
      nextBillingDate: subscription.charge_at ? new Date(subscription.charge_at * 1000) : null,
    }
  );
}

/**
 * Handle subscription.charged event (recurring payment)
 */
async function handleSubscriptionCharged(subscription, payment) {
  console.log('Processing subscription.charged:', subscription.id);

  const dbSubscription = await Subscription.findOne({ 
    razorpay_subscription_id: subscription.id 
  });

  if (dbSubscription && payment) {
    // Create payment record for recurring charge
    await Payment.create({
      user: dbSubscription.user,
      subscription: dbSubscription._id,
      razorpay_payment_id: payment.id,
      razorpay_order_id: payment.order_id,
      amount: payment.amount,
      currency: payment.currency,
      status: 'captured',
      method: payment.method,
      description: `Recurring payment for ${dbSubscription.plan} plan`,
    });

    // Update subscription
    await Subscription.findByIdAndUpdate(dbSubscription._id, {
      lastPaymentDate: new Date(),
      currentPeriodStart: new Date(subscription.current_start * 1000),
      currentPeriodEnd: new Date(subscription.current_end * 1000),
      nextBillingDate: subscription.charge_at ? new Date(subscription.charge_at * 1000) : null,
    });
  }
}

/**
 * Handle subscription.cancelled event
 */
async function handleSubscriptionCancelled(subscription) {
  console.log('Processing subscription.cancelled:', subscription.id);

  const dbSubscription = await Subscription.findOne({ 
    razorpay_subscription_id: subscription.id 
  });

  if (dbSubscription) {
    // Mark for cancellation — the cron job handles the actual downgrade at period end
    await Subscription.findByIdAndUpdate(dbSubscription._id, {
      cancelAtPeriodEnd: true,
      cancelledAt: new Date(),
    });
  }
}

/**
 * Handle subscription.completed event (subscription ended)
 */
async function handleSubscriptionCompleted(subscription) {
  console.log('Processing subscription.completed:', subscription.id);

  await Subscription.findOneAndUpdate(
    { razorpay_subscription_id: subscription.id },
    {
      status: 'completed',
    }
  );
}

/**
 * Handle subscription.paused event
 */
async function handleSubscriptionPaused(subscription) {
  console.log('Processing subscription.paused:', subscription.id);

  await Subscription.findOneAndUpdate(
    { razorpay_subscription_id: subscription.id },
    {
      status: 'paused',
    }
  );
}

/**
 * Handle subscription.resumed event
 */
async function handleSubscriptionResumed(subscription) {
  console.log('Processing subscription.resumed:', subscription.id);

  await Subscription.findOneAndUpdate(
    { razorpay_subscription_id: subscription.id },
    {
      status: 'active',
    }
  );
}

module.exports = {
  handleRazorpayWebhook,
};
