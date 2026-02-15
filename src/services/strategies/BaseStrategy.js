/**
 * BaseStrategy - Abstract Strategy Pattern for Planner Modes
 * 
 * This abstract class defines the contract for all scheduling strategies.
 * Each strategy implements different constraint-based scheduling logic.
 * 
 * Strategy Pattern Benefits:
 * - Encapsulates scheduling algorithms
 * - Allows runtime strategy switching
 * - Maintains Open/Closed Principle (open for extension, closed for modification)
 * 
 * Usage:
 *   const strategy = StrategyFactory.getStrategy(mode);
 *   const result = await strategy.execute(planId, userId, context);
 */

class BaseStrategy {
  constructor(name, description) {
    if (this.constructor === BaseStrategy) {
      throw new Error('BaseStrategy is an abstract class and cannot be instantiated directly');
    }
    this.name = name;
    this.description = description;
  }

  /**
   * Execute the scheduling strategy
   * @param {String} planId - Study plan ID
   * @param {String} userId - User ID
   * @param {Object} context - Execution context
   * @param {Date} context.examDate - Exam date (if exam mode)
   * @param {Number} context.availableHours - Daily available hours
   * @param {Array} context.preferredSlots - Preferred time slots
   * @param {Object} context.behaviorProfile - User behavior profile
   * @returns {Promise<Object>} Scheduling result
   */
  async execute(planId, userId, context = {}) {
    throw new Error(`execute() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Validate plan compatibility with strategy
   * @param {Object} plan - Study plan document (MUST be hydrated first)
   * @returns {Boolean} True if plan is compatible
   */
  async validatePlan(plan) {
    if (!plan) {
      throw new Error('Plan is required');
    }

    if (!plan.userId) {
      throw new Error('Plan must have a userId');
    }

    if (plan.status !== 'active') {
      throw new Error('Plan must be active to apply scheduling strategy');
    }

    // CRITICAL: Validate required scheduling fields
    // Note: Plan should be hydrated before reaching this point
    // This is a safety check to catch hydration failures
    if (plan.dailyStudyHours === undefined || plan.dailyStudyHours === null) {
      throw new Error(
        `Hydration failure: Plan ${plan._id} is missing 'dailyStudyHours' after hydration. ` +
        `This is a critical system error. Plan may be corrupted beyond repair.`
      );
    }

    if (typeof plan.dailyStudyHours !== 'number' || plan.dailyStudyHours <= 0) {
      throw new Error(
        `Invalid configuration: Plan ${plan._id} has invalid dailyStudyHours: ${plan.dailyStudyHours}. ` +
        `Must be a positive number.`
      );
    }

    return true;
  }

  /**
   * Log strategy execution for audit trail
   * @param {String} planId - Study plan ID
   * @param {String} action - Action performed
   * @param {Boolean} success - Success status
   * @param {Object} details - Additional details
   */
  async logExecution(planId, action, success, details = {}) {
    const SchedulingLog = require('../../models/SchedulingLog');
    
    try {
      await SchedulingLog.create({
        planId,
        action: `${this.name}: ${action}`,
        success,
        details: {
          strategy: this.name,
          ...details
        },
        executionTimeMs: details.executionTimeMs || 0
      });
    } catch (error) {
      console.error('Failed to log strategy execution:', error);
      // Don't throw - logging failure shouldn't break strategy execution
    }
  }

  /**
   * Get strategy metadata
   * @returns {Object} Strategy metadata
   */
  getMetadata() {
    return {
      name: this.name,
      description: this.description,
      className: this.constructor.name
    };
  }
}

module.exports = BaseStrategy;
