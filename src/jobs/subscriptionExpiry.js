const cron = require('node-cron');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const Board = require('../models/Board');
const { GRACE_PERIOD_DAYS, PLAN_LIMITS } = require('../config/plans');

let task = null;

/**
 * Auto-archive excess boards when a user downgrades.
 * Keeps the N most-recently-active boards and archives the rest.
 */
async function enforceDowngradeLimits(userId, newPlan) {
  const limits = PLAN_LIMITS[newPlan] || PLAN_LIMITS.free;
  if (limits.boards === -1) return; // unlimited — nothing to do

  const activeBoards = await Board.find({
    owner: userId,
    deletedAt: null,
    isArchived: false,
  }).sort({ lastActivity: -1 });

  if (activeBoards.length <= limits.boards) return; // within limit

  // Archive everything beyond the allowed count (keep most recent)
  const boardsToArchive = activeBoards.slice(limits.boards);
  const idsToArchive = boardsToArchive.map(b => b._id);

  await Board.updateMany(
    { _id: { $in: idsToArchive } },
    { $set: { isArchived: true } }
  );

  console.log(
    `[subscriptionExpiry] Auto-archived ${idsToArchive.length} excess board(s) for user ${userId} ` +
      `(plan: ${newPlan}, limit: ${limits.boards}).`
  );
}

/**
 * Downgrade expired subscriptions.
 *
 * Runs every hour. Finds subscriptions where:
 *  1. cancelAtPeriodEnd === true  AND  currentPeriodEnd + grace period has passed
 *  2. status === 'active' AND currentPeriodEnd + grace period has passed (payment lapsed)
 *
 * Sets plan → 'free', status → 'expired', and updates User.subscriptionTier.
 * Then auto-archives excess boards so the user can't keep using more than the free limit.
 */
async function processExpiredSubscriptions() {
  const graceCutoff = new Date();
  graceCutoff.setDate(graceCutoff.getDate() - GRACE_PERIOD_DAYS);

  try {
    // Find subscriptions that are past their period end + grace window
    const expiredSubs = await Subscription.find({
      plan: { $ne: 'free' },
      status: { $in: ['active', 'trialing'] },
      currentPeriodEnd: { $lt: graceCutoff },
      $or: [
        { cancelAtPeriodEnd: true },
        // Also catch non-renewed subs (payment didn't come through)
        { cancelAtPeriodEnd: { $ne: true } },
      ],
    });

    if (expiredSubs.length === 0) return;

    console.log(`[subscriptionExpiry] Found ${expiredSubs.length} expired subscription(s) to downgrade.`);

    for (const sub of expiredSubs) {
      try {
        const oldPlan = sub.plan;
        sub.plan = 'free';
        sub.status = 'expired';
        sub.cancelAtPeriodEnd = false;
        await sub.save();

        await User.findByIdAndUpdate(sub.user, { subscriptionTier: 'free' });

        // Auto-archive excess boards that exceed the free plan limit
        await enforceDowngradeLimits(sub.user, 'free');

        console.log(
          `[subscriptionExpiry] Downgraded user ${sub.user} from ${oldPlan} → free ` +
            `(periodEnd: ${sub.currentPeriodEnd?.toISOString()}).`
        );
      } catch (err) {
        console.error(`[subscriptionExpiry] Error downgrading subscription ${sub._id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[subscriptionExpiry] Error running expiry check:', err.message);
  }
}

/**
 * Start the cron job — runs every hour at minute 0.
 */
function startSubscriptionExpiryJob() {
  // Run once on startup to catch anything missed while server was down
  processExpiredSubscriptions();

  // Then schedule hourly
  task = cron.schedule('0 * * * *', processExpiredSubscriptions, {
    scheduled: true,
    timezone: 'UTC',
  });

  console.log('[subscriptionExpiry] Cron job started (hourly).');
}

/**
 * Stop the cron job gracefully.
 */
function stopSubscriptionExpiryJob() {
  if (task) {
    task.stop();
    task = null;
    console.log('[subscriptionExpiry] Cron job stopped.');
  }
}

module.exports = {
  startSubscriptionExpiryJob,
  stopSubscriptionExpiryJob,
  processExpiredSubscriptions, // exported for testing
};
