/**
 * Runtime Safety Guards - Defensive Programming Layer
 * 
 * Provides safe property access and initialization for schema fields
 * that may be undefined on legacy documents.
 * 
 * @tier Production Hardening
 * @priority CRITICAL
 */

const logger = require('../utils/logger');

class RuntimeGuards {
  /**
   * Safely initialize schedulingMetadata if it doesn't exist
   * @param {Object} document - Mongoose document (task or plan)
   * @returns {Object} document with guaranteed schedulingMetadata
   */
  ensureSchedulingMetadata(document) {
    if (!document) {
      logger.warn('[RuntimeGuards] ensureschedulingMetadata called with null/undefined document');
      return document;
    }

    if (!document.schedulingMetadata) {
      document.schedulingMetadata = {};
      logger.debug(`[RuntimeGuards] Initialized schedulingMetadata for ${document._id || 'unsaved doc'}`);
    }

    return document;
  }

  /**
   * Safely initialize behaviorMetadata if it doesn't exist
   * @param {Object} document - Mongoose document (task)
   * @returns {Object} document with guaranteed behaviorMetadata
   */
  ensureBehaviorMetadata(document) {
    if (!document) return document;

    if (!document.behaviorMetadata) {
      document.behaviorMetadata = {
        userEfficiencyFactor: 1.0
      };
      logger.debug(`[RuntimeGuards] Initialized behaviorMetadata for ${document._id || 'unsaved doc'}`);
    }

    return document;
  }

  /**
   * Safely initialize reschedulingHistory array if it doesn't exist
   * @param {Object} document - Mongoose document (task)
   * @returns {Object} document with guaranteed reschedulingHistory
   */
  ensureReschedulingHistory(document) {
    if (!document) return document;

    if (!Array.isArray(document.reschedulingHistory)) {
      document.reschedulingHistory = [];
      logger.debug(`[RuntimeGuards] Initialized reschedulingHistory for ${document._id || 'unsaved doc'}`);
    }

    return document;
  }

  /**
   * Safely initialize adaptiveMetadata if it doesn't exist
   * @param {Object} document - Mongoose document (plan)
   * @returns {Object} document with guaranteed adaptiveMetadata
   */
  ensureAdaptiveMetadata(document) {
    if (!document) return document;

    if (!document.adaptiveMetadata) {
      document.adaptiveMetadata = {
        missedTasksRedistributed: 0,
        avgReschedulesPerWeek: 0,
        lastAutoSchedule: null
      };
      logger.debug(`[RuntimeGuards] Initialized adaptiveMetadata for ${document._id || 'unsaved doc'}`);
    }

    return document;
  }

  /**
   * Safely initialize examPhaseConfig if it doesn't exist
   * @param {Object} document - Mongoose document (plan)
   * @returns {Object} document with guaranteed examPhaseConfig
   */
  ensureExamPhaseConfig(document) {
    if (!document) return document;

    if (!document.examPhaseConfig) {
      document.examPhaseConfig = {
        intensityMultiplier: 1.0,
        taskDensityPerDay: 3,
        lastPhaseUpdate: null
      };
      logger.debug(`[RuntimeGuards] Initialized examPhaseConfig for ${document._id || 'unsaved doc'}`);
    }

    return document;
  }

  /**
   * Comprehensive guard for task documents
   * Ensures all optional fields exist before operations
   * @param {Object} task - StudyTask document
   * @returns {Object} fully guarded task
   */
  guardTask(task) {
    if (!task) return task;

    this.ensureSchedulingMetadata(task);
    this.ensureBehaviorMetadata(task);
    this.ensureReschedulingHistory(task);

    return task;
  }

  /**
   * Comprehensive guard for plan documents
   * Ensures all optional fields exist before operations
   * @param {Object} plan - StudyPlan document
   * @returns {Object} fully guarded plan
   */
  guardPlan(plan) {
    if (!plan) return plan;

    this.ensureAdaptiveMetadata(plan);
    this.ensureExamPhaseConfig(plan);

    return plan;
  }

  /**
   * Safe property setter with initialization
   * @param {Object} document - Target document
   * @param {string} path - Dot-notation path (e.g., 'schedulingMetadata.isAutoScheduled')
   * @param {*} value - Value to set
   * @returns {boolean} success status
   */
  safeSet(document, path, value) {
    if (!document || !path) {
      logger.warn('[RuntimeGuards] safeSet called with invalid args');
      return false;
    }

    try {
      const parts = path.split('.');
      
      // Initialize parent objects if they don't exist
      let current = document;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current[part] || typeof current[part] !== 'object') {
          current[part] = {};
          logger.debug(`[RuntimeGuards] Initialized intermediate object: ${parts.slice(0, i + 1).join('.')}`);
        }
        current = current[part];
      }

      // Set the final value
      const finalKey = parts[parts.length - 1];
      current[finalKey] = value;
      
      return true;
    } catch (error) {
      logger.error(`[RuntimeGuards] safeSet failed for path ${path}:`, error);
      return false;
    }
  }

  /**
   * Safe array push with initialization
   * @param {Object} document - Target document
   * @param {string} arrayPath - Path to array field
   * @param {*} value - Value to push
   * @returns {boolean} success status
   */
  safePush(document, arrayPath, value) {
    if (!document || !arrayPath) {
      logger.warn('[RuntimeGuards] safePush called with invalid args');
      return false;
    }

    try {
      const parts = arrayPath.split('.');
      let current = document;

      // Navigate to parent
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }

      // Ensure array exists
      const arrayKey = parts[parts.length - 1];
      if (!Array.isArray(current[arrayKey])) {
        current[arrayKey] = [];
        logger.debug(`[RuntimeGuards] Initialized array: ${arrayPath}`);
      }

      current[arrayKey].push(value);
      return true;
    } catch (error) {
      logger.error(`[RuntimeGuards] safePush failed for path ${arrayPath}:`, error);
      return false;
    }
  }

  /**
   * Validate that all required scheduler fields exist on task
   * @param {Object} task - StudyTask document
   * @returns {{valid: boolean, missing: Array<string>}}
   */
  validateTaskForScheduling(task) {
    if (!task) {
      return { valid: false, missing: ['task is null'] };
    }

    const requiredFields = [
      'planId',
      'userId',
      'duration',
      'priority',
      'difficulty',
      'scheduledDate'
    ];

    const missing = requiredFields.filter(field => !task[field]);

    return {
      valid: missing.length === 0,
      missing
    };
  }

  /**
   * Validate that all required fields exist on plan for scheduling
   * @param {Object} plan - StudyPlan document
   * @returns {{valid: boolean, missing: Array<string>}}
   */
  validatePlanForScheduling(plan) {
    if (!plan) {
      return { valid: false, missing: ['plan is null'] };
    }

    const requiredFields = [
      'userId',
      'startDate',
      'endDate',
      'dailyStudyHours'
    ];

    const missing = requiredFields.filter(field => !plan[field]);

    return {
      valid: missing.length === 0,
      missing
    };
  }
}

module.exports = new RuntimeGuards();
