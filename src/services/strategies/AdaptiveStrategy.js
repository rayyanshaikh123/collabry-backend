/**
 * AdaptiveStrategy - Exam-Driven Scheduling Mode
 * 
 * Integrates ExamStrategyService + AdaptiveSchedulingService for intelligent
 * constraint-based scheduling with exam proximity awareness.
 * 
 * Key Characteristics:
 * - 4-phase exam system (Concept → Practice → Revision → Light Review)
 * - Dynamic intensity multipliers (1.0x → 1.5x)
 * - Priority scoring: examProximity(40%) + difficulty(30%) + age(20%) + efficiency(10%)
 * - Cognitive load balancing (max 4 tasks/day, max 2 hard/day)
 * - Automatic missed task redistribution
 * 
 * Use Cases:
 * - Plan has examDate and examMode=true
 * - Backlog > 10 tasks OR completion rate < 70%
 * - Exam within 30 days
 */

const BaseStrategy = require('./BaseStrategy');
const StudyPlan = require('../../models/StudyPlan');
const StudyTask = require('../../models/StudyTask.ENHANCED');

class AdaptiveStrategy extends BaseStrategy {
  constructor() {
    super(
      'Adaptive Mode',
      'Exam-driven scheduling with dynamic intensity, priority scoring, and cognitive load protection'
    );
  }

  /**
   * Execute adaptive scheduling strategy
   * Combines exam strategy + adaptive rescheduling
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
      
      // Validate plan and exam requirements
      await this.validatePlan(plan);

      // Import services (lazy load)
      const ExamStrategyService = require('../examStrategy.service');
      const AdaptiveSchedulingService = require('../adaptiveScheduling.service');

      console.log(`[AdaptiveStrategy] Executing adaptive scheduling for plan ${planId}`);

      // Step 1: Determine current exam phase
      const phaseData = await ExamStrategyService.determinePhase(plan.examDate);
      const examPhase = phaseData.phase;
      const phaseConfig = phaseData.config;

      console.log(`[AdaptiveStrategy] Current exam phase: ${examPhase}`, phaseConfig);

      // Step 2: Update plan with phase configuration
      if (phaseConfig && plan.currentExamPhase !== examPhase) {
        await plan.updateOne({
          $set: {
            currentExamPhase: examPhase,
            'examPhaseConfig.intensityMultiplier': phaseConfig.intensityMultiplier,
            'examPhaseConfig.taskDensityPerDay': phaseConfig.taskDensityPerDay,
            'examPhaseConfig.lastPhaseUpdate': new Date()
          }
        });
        console.log(`[AdaptiveStrategy] Updated plan phase: ${examPhase}`);
      }

      // Step 3: Check for missed tasks that need redistribution
      const missedTaskCount = await StudyTask.countDocuments({
        planId: plan._id,
        status: { $in: ['pending', 'rescheduled'] },
        scheduledDate: { $lt: new Date() },
        isDeleted: false
      });

      let redistributionResult = null;
      if (missedTaskCount > 0) {
        console.log(`[AdaptiveStrategy] Found ${missedTaskCount} missed tasks - triggering redistribution`);
        
        // Use plan's dailyStudyHours (guaranteed to exist after hydration)
        const dailyHours = context.availableHours || plan.dailyStudyHours;
        
        // Step 4: Redistribute missed tasks with exam strategy context
        redistributionResult = await AdaptiveSchedulingService.redistributeMissedTasks(
          userId,
          planId,
          {
            examStrategy: phaseConfig,
            dailyHoursLimit: dailyHours,
            behaviorProfile: context.behaviorProfile
          }
        );
      }

      // Step 5: Schedule remaining unscheduled tasks with standard FFD
      const SchedulingService = require('../scheduling.service');
      const unscheduledCount = await StudyTask.countDocuments({
        planId: plan._id,
        timeSlotStart: null,
        status: 'pending',
        isDeleted: false
      });

      let schedulingResult = null;
      if (unscheduledCount > 0) {
        console.log(`[AdaptiveStrategy] Scheduling ${unscheduledCount} unscheduled tasks`);
        schedulingResult = await SchedulingService.autoSchedulePlan(userId, planId);
      }

      // Calculate execution metrics
      const executionTimeMs = Date.now() - startTime;

      // Log successful execution
      await this.logExecution(planId, 'adaptive_scheduling', true, {
        examPhase,
        intensityMultiplier: phaseConfig.intensityMultiplier,
        taskDensity: phaseConfig.taskDensityPerDay,
        missedTasksRedistributed: redistributionResult?.tasksRescheduled || 0,
        newTasksScheduled: schedulingResult?.tasksScheduled || 0,
        conflictsDetected: (redistributionResult?.conflictsDetected || 0) + (schedulingResult?.conflictsDetected || 0),
        executionTimeMs
      });

      return {
        success: true,
        strategy: this.name,
        mode: 'adaptive',
        examPhase,
        phaseConfig,
        redistribution: redistributionResult,
        scheduling: schedulingResult,
        metadata: {
          intensityMultiplier: phaseConfig.intensityMultiplier,
          taskDensityPerDay: phaseConfig.taskDensityPerDay,
          cognitiveLoadLimit: 4,
          maxHardTasksPerDay: 2,
          executionTimeMs
        }
      };

    } catch (error) {
      // Log failed execution
      await this.logExecution(planId, 'adaptive_scheduling', false, {
        error: error.message,
        executionTimeMs: Date.now() - startTime
      });

      throw new Error(`AdaptiveStrategy execution failed: ${error.message}`);
    }
  }

  /**
   * Adaptive mode requires exam date
   */
  async validatePlan(plan) {
    await super.validatePlan(plan);

    if (!plan.examDate) {
      throw new Error('AdaptiveStrategy requires plan to have an examDate');
    }

    if (!plan.examMode) {
      console.warn(`[AdaptiveStrategy] Plan ${plan._id} has examDate but examMode=false. Enabling examMode.`);
      plan.examMode = true;
      await plan.save();
    }

    // Check if exam is in the future
    const daysToExam = (plan.examDate - new Date()) / (1000 * 60 * 60 * 24);
    if (daysToExam < 0) {
      throw new Error('Exam date has passed. Cannot apply adaptive scheduling.');
    }

    // Note: dailyStudyHours validation is handled by BaseStrategy.validatePlan
    // and guaranteed by plan hydration layer

    return true;
  }

  /**
   * Calculate days remaining until exam
   * @param {Date} examDate - Exam date
   * @returns {Number} Days remaining (can be negative if past)
   */
  getDaysToExam(examDate) {
    return Math.ceil((examDate - new Date()) / (1000 * 60 * 60 * 24));
  }
}

module.exports = AdaptiveStrategy;
