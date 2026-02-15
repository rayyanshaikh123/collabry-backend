/**
 * Single source of truth for all subscription plan configuration.
 * Every module (middleware, models, services) should import from here.
 *
 * TIER HIERARCHY: free < basic < pro < enterprise
 *
 * RULE: Every limit listed here MUST be enforced in code.
 * Do NOT add cosmetic/unenforceable features (e.g. "priority support").
 */

const TIER_ORDER = ['free', 'basic', 'pro', 'enterprise'];

/**
 * Feature limits per plan.
 * -1 means unlimited.
 *
 * ENFORCED BY:
 *   aiQuestionsPerDay  → checkAIUsageLimit middleware
 *   boards             → checkBoardLimit middleware
 *   notebooks          → checkNotebookLimit middleware
 *   groupMembers       → group.service.js addMember/joinGroupWithCode
 *   storageGB          → checkStorageLimit middleware + storageUsed tracking
 *   fileUploadsPerDay  → checkFileUploadLimit middleware
 */
const PLAN_LIMITS = {
  free: {
    aiQuestionsPerDay: 10,
    boards: 1,
    notebooks: 3,
    groupMembers: 5,
    storageGB: 0.1, // 100 MB
    fileUploadsPerDay: 5,
  },
  basic: {
    aiQuestionsPerDay: 100,
    boards: 5,
    notebooks: 20,
    groupMembers: 20,
    storageGB: 5,
    fileUploadsPerDay: 50,
  },
  pro: {
    aiQuestionsPerDay: -1, // unlimited
    boards: -1,
    notebooks: -1,
    groupMembers: 50,
    storageGB: 50,
    fileUploadsPerDay: -1,
  },
  enterprise: {
    aiQuestionsPerDay: -1,
    boards: -1,
    notebooks: -1,
    groupMembers: -1,
    storageGB: 500,
    fileUploadsPerDay: -1,
  },
};

/**
 * Razorpay subscription plan IDs & pricing.
 * Amounts are in paise (₹1 = 100 paise).
 */
const RAZORPAY_PLANS = {
  basic_monthly: {
    tier: 'basic',
    name: 'Basic Plan - Monthly',
    amount: 900, // ₹9
    currency: 'INR',
    interval: 'monthly',
    period: 1,
    description: '100 AI questions/day, 5 boards, 20 notebooks, 5GB storage',
  },
  basic_yearly: {
    tier: 'basic',
    name: 'Basic Plan - Yearly',
    amount: 9900, // ₹99
    currency: 'INR',
    interval: 'yearly',
    period: 1,
    description: 'Basic plan — save 8% with yearly billing',
  },
  pro_monthly: {
    tier: 'pro',
    name: 'Pro Plan - Monthly',
    amount: 2900, // ₹29
    currency: 'INR',
    interval: 'monthly',
    period: 1,
    description: 'Unlimited AI & boards, 50GB storage, 50 group members',
  },
  pro_yearly: {
    tier: 'pro',
    name: 'Pro Plan - Yearly',
    amount: 31900, // ₹319
    currency: 'INR',
    interval: 'yearly',
    period: 1,
    description: 'Pro plan — save 8% with yearly billing',
  },
};

/**
 * One-time payment plans (enterprise/lifetime).
 */
const ONE_TIME_PLANS = {
  enterprise: {
    tier: 'enterprise',
    amount: 9999900, // ₹99,999
    currency: 'INR',
    description: 'Enterprise Plan - Lifetime Access',
  },
};

/**
 * Grace period (in days) after subscription expiry before downgrade.
 */
const GRACE_PERIOD_DAYS = 3;

/**
 * Helper: get limits for a plan tier (defaults to free).
 */
const getLimitsForTier = (tier) => {
  return PLAN_LIMITS[tier] || PLAN_LIMITS.free;
};

/**
 * Helper: check if tierA >= tierB in the hierarchy.
 */
const isTierAtLeast = (tierA, minTier) => {
  const a = TIER_ORDER.indexOf(tierA);
  const b = TIER_ORDER.indexOf(minTier);
  if (a === -1 || b === -1) return false;
  return a >= b;
};

/**
 * Helper: check if a limit value means unlimited.
 */
const isUnlimited = (value) => value === -1;

module.exports = {
  TIER_ORDER,
  PLAN_LIMITS,
  RAZORPAY_PLANS,
  ONE_TIME_PLANS,
  GRACE_PERIOD_DAYS,
  getLimitsForTier,
  isTierAtLeast,
  isUnlimited,
};
