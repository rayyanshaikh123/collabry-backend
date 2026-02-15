/**
 * Plan Hydrator - Planner Integrity Layer
 * 
 * Ensures StudyPlan documents ALWAYS have required scheduling fields
 * before strategy execution. Handles legacy plans, AI-generated plans,
 * and partially hydrated documents.
 * 
 * CRITICAL: All strategies MUST use this before execution.
 */

const logger = require('../../utils/logger');

/**
 * Default planner configuration
 * These values MUST exist for strategy execution
 */
const PLANNER_DEFAULTS = {
  dailyStudyHours: 4,           // Reasonable default for study time
  maxSessionLength: 90,         // 90-minute sessions (cognitive limit)
  breakDuration: 15,            // 15-minute breaks
  preferredTimeSlots: [],       // Empty array (no preferences)
  difficulty: 'intermediate',   // Middle ground
  status: 'active',             // Plans should be active by default
  examMode: false,              // Not in exam mode unless explicitly set
};

/**
 * Hydrate a StudyPlan document with required defaults
 * 
 * @param {Object} plan - Raw StudyPlan document from DB
 * @returns {Object} Fully hydrated plan with all required fields
 * @throws {Error} If plan is null/undefined or missing critical fields
 */
function hydrateStudyPlan(plan) {
  if (!plan) {
    throw new Error('Cannot hydrate null or undefined plan');
  }

  if (!plan._id) {
    throw new Error('Plan must have an _id field (not a valid document)');
  }

  if (!plan.userId) {
    throw new Error('Plan must have a userId field (data integrity violation)');
  }

  // Track if hydration modified the plan (for logging)
  let modified = false;
  const changes = [];

  // Apply defaults for missing fields
  Object.keys(PLANNER_DEFAULTS).forEach(key => {
    if (plan[key] === undefined || plan[key] === null) {
      plan[key] = PLANNER_DEFAULTS[key];
      modified = true;
      changes.push(key);
    }
  });

  // Special handling for nested config structures (if they exist)
  if (plan.config) {
    if (plan.config.dailyStudyHours !== undefined && plan.dailyStudyHours === undefined) {
      plan.dailyStudyHours = plan.config.dailyStudyHours;
      modified = true;
      changes.push('dailyStudyHours (from config)');
    }
  }

  // Log hydration for debugging (only if modifications were made)
  if (modified) {
    logger.warn(
      `[PlanHydrator] Plan ${plan._id} was missing required fields. ` +
      `Applied defaults: ${changes.join(', ')}. ` +
      `This indicates a legacy or corrupted plan.`
    );
  }

  return plan;
}

/**
 * Validate that a plan has all required scheduling fields
 * Used to verify hydration worked correctly
 * 
 * @param {Object} plan - Hydrated plan
 * @throws {Error} If required fields are still missing
 */
function validateHydratedPlan(plan) {
  const requiredFields = [
    'dailyStudyHours',
    'status',
    'userId',
    '_id'
  ];

  const missingFields = requiredFields.filter(
    field => plan[field] === undefined || plan[field] === null
  );

  if (missingFields.length > 0) {
    throw new Error(
      `Plan hydration failed: Missing required fields after hydration: ${missingFields.join(', ')}. ` +
      `Plan ID: ${plan._id}. This is a critical data integrity failure.`
    );
  }

  // Validate field types
  if (typeof plan.dailyStudyHours !== 'number' || plan.dailyStudyHours <= 0) {
    throw new Error(
      `Plan ${plan._id} has invalid dailyStudyHours: ${plan.dailyStudyHours}. ` +
      `Must be a positive number.`
    );
  }

  return true;
}

/**
 * Get normalized planner config from a plan
 * Standardizes access to planner configuration across strategies
 * 
 * @param {Object} plan - Hydrated plan
 * @returns {Object} Normalized planner config
 */
function getPlannerConfig(plan) {
  return {
    dailyStudyHours: plan.dailyStudyHours,
    maxSessionLength: plan.maxSessionLength || PLANNER_DEFAULTS.maxSessionLength,
    breakDuration: plan.breakDuration || PLANNER_DEFAULTS.breakDuration,
    preferredTimeSlots: plan.preferredTimeSlots || [],
    difficulty: plan.difficulty || PLANNER_DEFAULTS.difficulty,
    examMode: plan.examMode || false,
    examDate: plan.examDate || null,
  };
}

/**
 * Persist hydration changes to database
 * Updates plan with defaults if they were missing
 * 
 * @param {Object} plan - Mongoose document (must have .save())
 * @returns {Promise<Object>} Updated plan
 */
async function persistHydration(plan) {
  if (!plan.save || typeof plan.save !== 'function') {
    logger.error('[PlanHydrator] Cannot persist: plan is not a Mongoose document');
    return plan;
  }

  try {
    const updated = await plan.save();
    logger.info(`[PlanHydrator] Persisted hydrated plan ${plan._id} to database`);
    return updated;
  } catch (error) {
    logger.error(`[PlanHydrator] Failed to persist plan ${plan._id}:`, error);
    // Don't throw - hydration in memory is sufficient for execution
    return plan;
  }
}

module.exports = {
  hydrateStudyPlan,
  validateHydratedPlan,
  getPlannerConfig,
  persistHydration,
  PLANNER_DEFAULTS,
};
