/**
 * BalancedStrategy - Default Scheduling Mode
 * 
 * Provides standard First-Fit-Decreasing (FFD) bin-packing scheduling.
 * This is the default user experience for non-exam, non-crisis scenarios.
 * 
 * Key Characteristics:
 * - Uses existing SchedulingService.autoSchedulePlan()
 * - No intensity multipliers or priority weighting
 * - Respects user's preferred time slots
 * - Standard cognitive load limits (4 tasks/day)
 * 
 * Use Cases:
 * - New plans without exam dates
 * - Completion rate > 70%, no backlog
 * - User learning at their own pace
 */

const BaseStrategy = require('./BaseStrategy');
const StudyPlan = require('../../models/StudyPlan');
const StudyTask = require('../../models/StudyTask.ENHANCED');

class BalancedStrategy extends BaseStrategy {
  constructor() {
    super(
      'Balanced Mode',
      'Standard scheduling with optimal time-block distribution and cognitive load protection'
    );
  }

  /**
   * Execute balanced scheduling strategy
   * Wrapper around existing SchedulingService for consistency
   */
  async execute(planId, userId, context = {}) {
    const startTime = Date.now();
    
    try {
      // Fetch and hydrate plan (CRITICAL: ensures required fields exist)
      const { hydrateStudyPlan, validateHydratedPlan, persistHydration } = require('./planHydrator');
      const rawPlan = await StudyPlan.findById(planId);
      const plan = hydrateStudyPlan(rawPlan);
      validateHydratedPlan(plan);
      
      // Persist hydration if modifications were made
      await persistHydration(plan);
      
      // Validate plan
      await this.validatePlan(plan);

      // Import SchedulingService (lazy load to avoid circular dependencies)
      const SchedulingService = require('../scheduling.service');

      // Execute standard FFD scheduling
      console.log(`[BalancedStrategy] Executing standard scheduling for plan ${planId}`);
      const result = await SchedulingService.autoSchedulePlan(userId, planId);

      // Log successful execution
      await this.logExecution(planId, 'auto_schedule', true, {
        tasksScheduled: result.tasksScheduled || 0,
        conflictsDetected: result.conflictsDetected || 0,
        executionTimeMs: Date.now() - startTime
      });

      return {
        success: true,
        strategy: this.name,
        mode: 'balanced',
        result,
        metadata: {
          intensityMultiplier: 1.0,
          cognitiveLoadLimit: 4,
          executionTimeMs: Date.now() - startTime
        }
      };

    } catch (error) {
      // Log failed execution
      await this.logExecution(planId, 'auto_schedule', false, {
        error: error.message,
        executionTimeMs: Date.now() - startTime
      });

      throw new Error(`BalancedStrategy execution failed: ${error.message}`);
    }
  }

  /**
   * Balanced mode has minimal plan requirements
   */
  async validatePlan(plan) {
    await super.validatePlan(plan);

    // Check if plan has tasks
    const taskCount = await StudyTask.countDocuments({ 
      planId: plan._id,
      isDeleted: false 
    });

    if (taskCount === 0) {
      throw new Error('Plan must have at least one task to schedule');
    }

    return true;
  }
}

module.exports = BalancedStrategy;
