const Subscription = require('../models/Subscription');
const AppError = require('../utils/AppError');
const { PLAN_LIMITS, getLimitsForTier, isTierAtLeast, TIER_ORDER } = require('../config/plans');

/**
 * Check if user's subscription allows access to a feature
 * @param {string} feature - Feature name to check
 * @param {string} minTier - Minimum tier required (optional)
 */
const checkFeatureAccess = (feature, minTier = null) => {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;
      
      // Get user's subscription
      let subscription = await Subscription.findOne({ user: userId });
      
      // Create free subscription if none exists
      if (!subscription) {
        subscription = await Subscription.create({
          user: userId,
          plan: 'free',
          status: 'active',
        });
      }

      // Check if subscription is active
      if (subscription.status !== 'active' || !subscription.isActive) {
        return res.status(403).json({
          success: false,
          error: 'Your subscription has expired. Please renew to continue.',
          code: 'SUBSCRIPTION_EXPIRED',
        });
      }

      const userTier = subscription.plan;
      const limits = getLimitsForTier(userTier);

      // Check minimum tier requirement
      if (minTier) {
        if (!isTierAtLeast(userTier, minTier)) {
          return res.status(403).json({
            success: false,
            error: `This feature requires ${minTier} plan or higher`,
            code: 'INSUFFICIENT_TIER',
            requiredTier: minTier,
            currentTier: userTier,
          });
        }
      }

      // Check specific feature limit
      if (feature && limits[feature] !== undefined) {
        const featureLimit = limits[feature];
        
        // -1 means unlimited
        if (featureLimit === -1) {
          req.featureLimit = -1;
        } else if (featureLimit === 0 || featureLimit === false) {
          return res.status(403).json({
            success: false,
            error: `This feature is not available in your current plan`,
            code: 'FEATURE_NOT_AVAILABLE',
            upgradeTo: getMinimumTierForFeature(feature),
          });
        } else {
          req.featureLimit = featureLimit;
        }
      }

      // Attach subscription and limits to request
      req.subscription = subscription;
      req.subscriptionLimits = limits;
      
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Check if user has specific feature enabled
 * @param {string} featureName
 */
const requireFeature = (featureName) => {
  return checkFeatureAccess(featureName);
};

/**
 * Require minimum subscription tier
 * @param {string} minTier - 'basic', 'pro', or 'enterprise'
 */
const requireTier = (minTier) => {
  return checkFeatureAccess(null, minTier);
};

/**
 * Get minimum tier that has access to a feature
 * @param {string} feature
 * @returns {string}
 */
function getMinimumTierForFeature(feature) {
  for (const tier of TIER_ORDER) {
    const limits = PLAN_LIMITS[tier];
    if (limits[feature] && limits[feature] !== 0 && limits[feature] !== false) {
      return tier;
    }
  }
  
  return 'enterprise';
}

/**
 * Attach subscription info to request without blocking
 */
const attachSubscription = async (req, res, next) => {
  try {
    if (req.user && req.user.id) {
      let subscription = await Subscription.findOne({ user: req.user.id });
      
      if (!subscription) {
        subscription = await Subscription.create({
          user: req.user.id,
          plan: 'free',
          status: 'active',
        });
      }
      
      req.subscription = subscription;
      req.subscriptionLimits = getLimitsForTier(subscription.plan);
    }
  } catch (error) {
    console.error('Error attaching subscription:', error);
  }
  
  next();
};

module.exports = {
  checkFeatureAccess,
  requireFeature,
  requireTier,
  attachSubscription,
};
