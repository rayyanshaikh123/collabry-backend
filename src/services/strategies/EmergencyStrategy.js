/**
 * EmergencyStrategy - Crisis Compression Mode
 * 
 * Hyper-intensive scheduling for critical exam proximity scenarios.
 * Applies syllabus compression, hyper time blocks, and aggressive prioritization.
 * 
 * Key Characteristics:
 * - Syllabus compression: Prunes low-priority topics (difficulty=easy, priority=low)
 * - Hyper time blocks: 90-120 minute intensive study sessions
 * - Extreme intensity: 2.0x multiplier (overrides exam phase config)
 * - Task density: 6-8 tasks/day (overrides cognitive load limits)
 * - Zero tolerance for missed tasks: Immediate redistribution
 * 
 * Activation Triggers:
 * - Exam within 7 days AND completion rate < 60%
 * - Exam within 14 days AND completion rate < 40%
 * - Massive backlog (>20 pending tasks) within 2 weeks of exam
 * 
 * Warning: This is a "fire drill" mode. Should only be used in crisis scenarios.
 */

const AdaptiveStrategy = require('./AdaptiveStrategy');
const StudyPlan = require('../../models/StudyPlan');
const StudyTask = require('../../models/StudyTask.ENHANCED');

class EmergencyStrategy extends AdaptiveStrategy {
  constructor() {
    super();
    this.name = 'Emergency Mode';
    this.description = 'Crisis compression with hyper time blocks, syllabus pruning, and aggressive scheduling';
    
    // Emergency mode constants
    this.INTENSITY_MULTIPLIER = 2.0;
    this.HYPER_BLOCK_MIN_DURATION = 90;
    this.HYPER_BLOCK_MAX_DURATION = 120;
    this.MAX_TASKS_PER_DAY = 8;
    this.COMPRESSION_THRESHOLD = 0.6; // Keep top 60% of topics
  }

  /**
   * Execute emergency scheduling strategy
   * Extends AdaptiveStrategy with compression and hyper blocks
   */
  async execute(planId, userId, context = {}) {
    const startTime = Date.now();
    
    try {
      // Fetch and hydrate plan (CRITICAL: ensures required fields exist)
      const { hydrateStudyPlan, validateHydratedPlan, persistHydration } = require('./planHydrator');
      const rawPlan = await StudyPlan.findById(planId).populate('userId');
      const plan = hydrateStudyPlan(rawPlan);
      validateHydratedPlan(plan);
      
      // Persist hydration if modifications were made
      await persistHydration(plan);
      
      // Validate plan and emergency requirements
      await this.validatePlan(plan);

      console.log(`[EmergencyStrategy] ⚠️ CRISIS MODE ACTIVATED for plan ${planId}`);

      // Use plan's dailyStudyHours (guaranteed to exist after hydration)
      const dailyHours = plan.dailyStudyHours;

      // Step 1: Compress syllabus (prune low-priority topics)
      const compressionResult = await this._compressSyllabus(planId, plan);
      console.log(`[EmergencyStrategy] Syllabus compression: ${compressionResult.prunedCount} tasks pruned`);

      // Step 2: Convert remaining tasks to hyper time blocks
      const hyperBlockResult = await this._generateHyperBlocks(planId, plan);
      console.log(`[EmergencyStrategy] Generated ${hyperBlockResult.hyperBlocksCreated} hyper blocks`);

      // Step 3: Apply scheduling - use adaptive if exam exists, otherwise basic FFD
      let adaptiveResult;
      if (plan.examDate) {
        // Have exam date - use full adaptive scheduling with emergency intensity
        adaptiveResult = await super.execute(planId, userId, {
          ...context,
          availableHours: dailyHours * this.INTENSITY_MULTIPLIER,
          emergencyMode: true,
          cognitiveLoadOverride: this.MAX_TASKS_PER_DAY
        });
      } else {
        // No exam date - use basic scheduling with emergency intensity
        console.log(`[EmergencyStrategy] No exam date - using emergency FFD scheduling`);
        const SchedulingService = require('../scheduling.service');
        adaptiveResult = await SchedulingService.autoSchedulePlan(userId, planId, {
          dailyHoursOverride: dailyHours * this.INTENSITY_MULTIPLIER,
          maxTasksPerDay: this.MAX_TASKS_PER_DAY
        });
      }

      // Step 4: Force reschedule ALL missed tasks (zero tolerance)
      const missedTasks = await StudyTask.find({
        planId: plan._id,
        status: { $in: ['pending', 'rescheduled'] },
        scheduledDate: { $lt: new Date() },
        isDeleted: false
      });

      if (missedTasks.length > 0) {
        console.log(`[EmergencyStrategy] Emergency redistribution: ${missedTasks.length} missed tasks`);
        const AdaptiveSchedulingService = require('../adaptiveScheduling.service');
        await AdaptiveSchedulingService.redistributeMissedTasks(userId, planId, {
          emergencyMode: true,
          dailyHoursLimit: dailyHours * this.INTENSITY_MULTIPLIER
        });
      }

      // Calculate execution metrics
      const executionTimeMs = Date.now() - startTime;

      // Log successful execution with emergency flag
      await this.logExecution(planId, 'emergency_scheduling', true, {
        emergencyMode: true,
        intensityMultiplier: this.INTENSITY_MULTIPLIER,
        tasksPruned: compressionResult.prunedCount,
        hyperBlocksCreated: hyperBlockResult.hyperBlocksCreated,
        missedTasksRescheduled: missedTasks.length,
        executionTimeMs
      });

      return {
        success: true,
        strategy: this.name,
        mode: 'emergency',
        warning: '⚠️ Emergency mode activated - intensive study schedule applied',
        compression: compressionResult,
        hyperBlocks: hyperBlockResult,
        adaptiveScheduling: adaptiveResult,
        metadata: {
          intensityMultiplier: this.INTENSITY_MULTIPLIER,
          taskDensityPerDay: this.MAX_TASKS_PER_DAY,
          hyperBlockDuration: `${this.HYPER_BLOCK_MIN_DURATION}-${this.HYPER_BLOCK_MAX_DURATION} min`,
          cognitiveLoadOverride: true,
          executionTimeMs
        }
      };

    } catch (error) {
      // Log failed execution
      await this.logExecution(planId, 'emergency_scheduling', false, {
        error: error.message,
        executionTimeMs: Date.now() - startTime
      });

      throw new Error(`EmergencyStrategy execution failed: ${error.message}`);
    }
  }

  /**
   * Emergency mode validation - more flexible than AdaptiveStrategy
   * Can work without exam date if there's a crisis (massive backlog)
   */
  async validatePlan(plan) {
    // Only call base validation, not AdaptiveStrategy's validation
    const BaseStrategy = require('./BaseStrategy');
    await BaseStrategy.prototype.validatePlan.call(this, plan);

    const completionRate = plan.totalTasks > 0 
      ? plan.completedTasks / plan.totalTasks 
      : 0;

    // Check for exam-based crisis
    if (plan.examDate) {
      const daysToExam = this.getDaysToExam(plan.examDate);

      // Emergency mode valid if exam is imminent
      if (daysToExam > 14) {
        // Check if there's a backlog crisis that overrides exam timing
        const backlog = await StudyTask.countDocuments({
          planId: plan._id,
          status: { $in: ['pending', 'rescheduled'] },
          scheduledDate: { $lt: new Date() },
          isDeleted: false
        });

        if (backlog < 20 && completionRate > 0.4) {
          throw new Error('EmergencyStrategy requires exam within 14 days OR massive backlog (20+ tasks). Use Balanced/Adaptive strategy instead.');
        }
      }

      // Warn if emergency mode may not be necessary
      if (daysToExam > 7 && completionRate > 0.6) {
        console.warn(`[EmergencyStrategy] Plan ${plan._id} may not need emergency mode (${Math.round(completionRate * 100)}% complete, ${daysToExam} days remaining)`);
      }
    } else {
      // No exam date - check for backlog crisis
      const backlog = await StudyTask.countDocuments({
        planId: plan._id,
        status: { $in: ['pending', 'rescheduled'] },
        scheduledDate: { $lt: new Date() },
        isDeleted: false
      });

      if (backlog < 15 && completionRate > 0.5) {
        throw new Error('EmergencyStrategy without exam date requires significant backlog (15+ missed tasks) and/or low completion rate (<50%).');
      }

      console.log(`[EmergencyStrategy] Activating crisis mode for backlog scenario: ${backlog} missed tasks, ${Math.round(completionRate * 100)}% completion`);
    }

    return true;
  }

  /**
   * Compress syllabus by pruning low-priority tasks
   * Strategy: Keep high-priority, high-difficulty tasks; mark others as skipped
   * 
   * @param {String} planId - Plan ID
   * @param {Object} plan - Plan document
   * @returns {Object} Compression result
   */
  async _compressSyllabus(planId, plan) {
    try {
      // Fetch all pending tasks
      const tasks = await StudyTask.find({
        planId: plan._id,
        status: 'pending',
        isDeleted: false
      });

      if (tasks.length === 0) {
        return { prunedCount: 0, retainedCount: 0 };
      }

      // Sort by priority - use examProximityScore if available, otherwise priority + difficulty
      tasks.sort((a, b) => {
        if (plan.examDate && a.examProximityScore !== undefined && b.examProximityScore !== undefined) {
          // Have exam date - use exam proximity
          if (b.examProximityScore !== a.examProximityScore) {
            return b.examProximityScore - a.examProximityScore;
          }
        }
        
        // Fallback to priority + difficulty
        const priorityMap = { high: 3, medium: 2, low: 1 };
        const difficultyMap = { hard: 3, medium: 2, easy: 1 };
        
        const scoreA = (priorityMap[a.priority] || 1) * 2 + (difficultyMap[a.difficulty] || 1);
        const scoreB = (priorityMap[b.priority] || 1) * 2 + (difficultyMap[b.difficulty] || 1);
        
        return scoreB - scoreA;
      });

      // Calculate compression threshold
      const retainCount = Math.ceil(tasks.length * this.COMPRESSION_THRESHOLD);
      const tasksToPrune = tasks.slice(retainCount);

      // Mark low-priority tasks as skipped
      let prunedCount = 0;
      for (const task of tasksToPrune) {
        // Only prune easy/medium difficulty + low/medium priority
        const shouldPrune = (
          (task.difficulty === 'easy' || task.difficulty === 'medium') &&
          (task.priority === 'low' || task.priority === 'medium')
        );

        if (shouldPrune) {
          task.status = 'skipped';
          task.rescheduledReason = 'Emergency mode syllabus compression';
          
          // Ensure reschedulingHistory exists (for legacy tasks)
          if (!Array.isArray(task.reschedulingHistory)) {
            task.reschedulingHistory = [];
          }
          
          task.reschedulingHistory.push({
            timestamp: new Date(),
            reason: 'emergency_compression',
            oldSlot: task.timeSlotStart,
            newSlot: null,
            triggeredBy: 'EmergencyStrategy'
          });
          await task.save();
          prunedCount++;
        }
      }

      console.log(`[EmergencyStrategy] Syllabus compression: ${prunedCount}/${tasks.length} tasks pruned`);

      return {
        prunedCount,
        retainedCount: tasks.length - prunedCount,
        compressionRatio: this.COMPRESSION_THRESHOLD
      };

    } catch (error) {
      console.error('[EmergencyStrategy] Syllabus compression failed:', error);
      return { prunedCount: 0, retainedCount: 0, error: error.message };
    }
  }

  /**
   * Generate hyper time blocks (90-120 min intensive sessions)
   * Merges small tasks into larger study blocks
   * 
   * @param {String} planId - Plan ID
   * @param {Object} plan - Plan document
   * @returns {Object} Hyper block result
   */
  async _generateHyperBlocks(planId, plan) {
    try {
      // Fetch all pending tasks
      const tasks = await StudyTask.find({
        planId: plan._id,
        status: 'pending',
        isDeleted: false
      }).sort({ 
        scheduledDate: 1,
        examProximityScore: -1
      });

      if (tasks.length === 0) {
        return { hyperBlocksCreated: 0, tasksModified: 0 };
      }

      let hyperBlocksCreated = 0;
      let tasksModified = 0;

      // Group tasks by date
      const tasksByDate = tasks.reduce((acc, task) => {
        const dateKey = task.scheduledDate.toISOString().split('T')[0];
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(task);
        return acc;
      }, {});

      // For each date, merge small tasks into hyper blocks
      for (const [dateKey, dateTasks] of Object.entries(tasksByDate)) {
        let currentBlockDuration = 0;
        let currentBlockTasks = [];

        for (const task of dateTasks) {
          // Add task to current block
          currentBlockDuration += task.duration;
          currentBlockTasks.push(task);

          // If block reaches hyper threshold, finalize it
          if (currentBlockDuration >= this.HYPER_BLOCK_MIN_DURATION) {
            // Cap at max duration
            const finalDuration = Math.min(currentBlockDuration, this.HYPER_BLOCK_MAX_DURATION);
            
            // Update first task to be the hyper block
            const hyperBlockTask = currentBlockTasks[0];
            hyperBlockTask.duration = finalDuration;
            hyperBlockTask.title = `🔥 HYPER BLOCK: ${currentBlockTasks.map(t => t.topic || t.title).join(' + ')}`;
            hyperBlockTask.priority = 'urgent';
            await hyperBlockTask.save();

            // Mark other tasks in block as merged (skip them)
            for (let i = 1; i < currentBlockTasks.length; i++) {
              const mergedTask = currentBlockTasks[i];
              mergedTask.status = 'skipped';
              mergedTask.rescheduledReason = `Merged into hyper block: ${hyperBlockTask._id}`;
              await mergedTask.save();
            }

            hyperBlocksCreated++;
            tasksModified += currentBlockTasks.length;

            // Reset block
            currentBlockDuration = 0;
            currentBlockTasks = [];
          }
        }

        // Handle remaining tasks (< HYPER_BLOCK_MIN_DURATION)
        if (currentBlockTasks.length > 0) {
          // If only 1 task and it's short, extend it to minimum hyper block
          if (currentBlockTasks.length === 1 && currentBlockDuration < this.HYPER_BLOCK_MIN_DURATION) {
            const task = currentBlockTasks[0];
            task.duration = this.HYPER_BLOCK_MIN_DURATION;
            task.title = `🔥 EXTENDED BLOCK: ${task.title}`;
            await task.save();
            hyperBlocksCreated++;
            tasksModified++;
          }
        }
      }

      console.log(`[EmergencyStrategy] Hyper blocks: ${hyperBlocksCreated} created, ${tasksModified} tasks modified`);

      return {
        hyperBlocksCreated,
        tasksModified,
        averageDuration: this.HYPER_BLOCK_MIN_DURATION + (this.HYPER_BLOCK_MAX_DURATION - this.HYPER_BLOCK_MIN_DURATION) / 2
      };

    } catch (error) {
      console.error('[EmergencyStrategy] Hyper block generation failed:', error);
      return { hyperBlocksCreated: 0, tasksModified: 0, error: error.message };
    }
  }
}

module.exports = EmergencyStrategy;
