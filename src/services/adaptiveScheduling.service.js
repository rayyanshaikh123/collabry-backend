/**
 * Adaptive Scheduling Service
 * 
 * Automatically redistributes workload when tasks are missed or rescheduled.
 * Uses priority-weighted load balancing with cognitive load limits.
 * 
 * @tier Tier-2 (Adaptive Rescheduling Engine)
 * @performance Batch operations, efficient queries with indexes
 */

const mongoose = require('mongoose');
const StudyTask = require('../models/StudyTask.ENHANCED');
const StudyPlan = require('../models/StudyPlan');
const UserBehaviorProfile = require('../models/UserBehaviorProfile');
const SchedulingLog = require('../models/SchedulingLog');
const eventEmitter = require('../utils/eventEmitter');
const logger = require('../utils/logger');
const examStrategyService = require('./examStrategy.service');

class AdaptiveSchedulingService {
  /**
   * Main entry point: Redistribute missed/overdue tasks
   * 
   * @param {ObjectId} userId
   * @param {ObjectId} planId
   * @param {Object} options - { reason: string, maxTasksToReschedule: number }
   * @returns {Promise<Object>} { rescheduled: number, allocations: Array, skipped: Array }
   */
  async redistributeMissedTasks(userId, planId, options = {}) {
    const startTime = Date.now();
    const { reason = 'missed_task', maxTasksToReschedule = 50 } = options;
    
    try {
      logger.info(`[AdaptiveScheduling] Starting redistribution for user=${userId}, plan=${planId}`);
      
      // Step 1: Get missed tasks
      const missedTasks = await StudyTask.find({
        userId,
        planId,
        status: { $in: ['pending', 'rescheduled'] },
        timeSlotStart: { $lt: new Date() }
      })
      .limit(maxTasksToReschedule)
      .lean();
      
      if (missedTasks.length === 0) {
        logger.info(`[AdaptiveScheduling] No missed tasks found`);
        return { rescheduled: 0, allocations: [], skipped: [] };
      }
      
      logger.info(`[AdaptiveScheduling] Found ${missedTasks.length} missed tasks`);
      
      // Step 2: Get plan details
      const plan = await StudyPlan.findById(planId);
      if (!plan) {
        throw new Error('Plan not found');
      }
      
      // Step 3: Check for exam mode
      let examStrategy = null;
      if (plan.examMode && plan.examDate) {
        examStrategy = await examStrategyService.getStrategy(plan);
        logger.info(`[AdaptiveScheduling] Exam mode active: phase=${examStrategy.phase}`);
      }
      
      // Step 4: Get user behavior profile
      const behaviorProfile = await UserBehaviorProfile.findOne({ userId });
      
      // Step 5: Generate available future slots
      const availableSlots = await this._generateFutureSlots(
        userId,
        plan,
        behaviorProfile
      );
      
      if (availableSlots.length === 0) {
        logger.warn(`[AdaptiveScheduling] No available slots found`);
        return { 
          rescheduled: 0, 
          allocations: [], 
          skipped: missedTasks.map(t => ({
            taskId: t._id,
            reason: 'no_available_slots'
          }))
        };
      }
      
      logger.info(`[AdaptiveScheduling] Generated ${availableSlots.length} available slots`);
      
      // Step 6: Calculate priority scores
      const prioritizedTasks = this._calculatePriorities(missedTasks, examStrategy);
      
      // Step 7: Allocate tasks using cognitive load balancing
      const { allocations, skipped } = this._allocateTasks(
        prioritizedTasks,
        availableSlots,
        plan.dailyStudyHours || 4
      );
      
      if (allocations.length === 0) {
        logger.warn(`[AdaptiveScheduling] No tasks could be allocated`);
        return { rescheduled: 0, allocations: [], skipped };
      }
      
      logger.info(`[AdaptiveScheduling] Allocated ${allocations.length} tasks, skipped ${skipped.length}`);
      
      // Step 8: Batch update MongoDB
      // First, ensure all tasks have schedulingMetadata initialized (for legacy tasks)
      const taskIds = allocations.map(a => a.taskId);
      await StudyTask.updateMany(
        { 
          _id: { $in: taskIds },
          schedulingMetadata: { $exists: false }
        },
        {
          $set: { schedulingMetadata: {} }
        }
      );
      
      // Now perform the actual updates
      const bulkOps = allocations.map(({ taskId, newSlot, priorityScore }) => {
        const oldTask = missedTasks.find(t => t._id.equals(taskId));
        
        return {
          updateOne: {
            filter: { _id: taskId },
            update: {
              $set: {
                timeSlotStart: newSlot.start,
                timeSlotEnd: newSlot.end,
                status: 'pending',
                'schedulingMetadata.isRescheduled': true,
                'schedulingMetadata.lastScheduledAt': new Date()
              },
              $push: {
                reschedulingHistory: {
                  timestamp: new Date(),
                  reason,
                  oldSlot: oldTask.timeSlotStart,
                  newSlot: newSlot.start,
                  triggeredBy: 'system'
                }
              },
              $inc: { rescheduledCount: 1 }
            }
          }
        };
      });
      
      await StudyTask.bulkWrite(bulkOps);
      
      // Step 9: Update plan metadata
      await plan.updateOne({
        $inc: { 
          'adaptationCount': 1,
          'adaptiveMetadata.missedTasksRedistributed': allocations.length
        },
        $set: { 
          'lastAdaptedAt': new Date(),
          'adaptiveMetadata.lastAutoSchedule': new Date()
        }
      });
      
      // Step 10: Emit events for notifications
      eventEmitter.emit('tasks.rescheduled', { 
        userId, 
        planId,
        tasks: allocations.map(a => a.taskId),
        reason
      });
      
      // Step 11: Log for analytics
      const executionTimeMs = Date.now() - startTime;
      await SchedulingLog.create({
        userId,
        planId,
        action: 'adaptive_reschedule',
        success: true,
        details: { 
          tasksRescheduled: allocations.length,
          tasksSkipped: skipped.length,
          reason
        },
        executionTimeMs
      });
      
      logger.info(`[AdaptiveScheduling] Completed in ${executionTimeMs}ms`);
      
      return { 
        rescheduled: allocations.length, 
        allocations,
        skipped
      };
      
    } catch (error) {
      logger.error(`[AdaptiveScheduling] Error: ${error.message}`, error);
      
      await SchedulingLog.create({
        userId,
        planId,
        action: 'adaptive_reschedule',
        success: false,
        errorMessage: error.message,
        executionTimeMs: Date.now() - startTime
      });
      
      throw error;
    }
  }
  
  /**
   * Calculate priority scores for task ordering
   * 
   * Score = examProximity (40%) + difficulty (30%) + age (20%) + efficiency (10%)
   * 
   * @param {Array} tasks - Array of task objects
   * @param {Object} examStrategy - Exam strategy config or null
   * @returns {Array} Sorted array of { task, priorityScore }
   */
  _calculatePriorities(tasks, examStrategy) {
    return tasks.map(task => {
      let score = 0;
      
      // 1. Exam proximity (0-40 points)
      if (examStrategy && task.examProximityScore) {
        score += task.examProximityScore * 0.4;
      } else {
        score += 20; // Neutral score
      }
      
      // 2. Difficulty (0-30 points)
      const difficultyMap = { easy: 10, medium: 20, hard: 30 };
      score += difficultyMap[task.difficulty] || 15;
      
      // 3. Age - how long overdue (0-20 points)
      const daysOverdue = Math.floor(
        (Date.now() - new Date(task.timeSlotStart)) / (1000 * 60 * 60 * 24)
      );
      score += Math.min(daysOverdue * 2, 20);
      
      // 4. User efficiency factor (0-10 points)
      const efficiencyFactor = task.behaviorMetadata?.userEfficiencyFactor || 1.0;
      score += efficiencyFactor * 10;
      
      // Priority boost
      if (task.priority === 'urgent') score += 15;
      else if (task.priority === 'high') score += 10;
      
      return { task, priorityScore: score };
    }).sort((a, b) => b.priorityScore - a.priorityScore);
  }
  
  /**
   * Allocate tasks to slots with cognitive load limits
   * 
   * Rules:
   * - Max 4 tasks per day (cognitive overload prevention)
   * - Max 2 "hard" tasks per day
   * - Prefer user's optimal time slots (from behavior profile)
   * - Leave 10% buffer for unexpected tasks
   * 
   * @param {Array} prioritizedTasks - Sorted tasks with scores
   * @param {Array} availableSlots - Available time slots
   * @param {number} dailyHoursLimit - Daily study hours limit
   * @returns {Object} { allocations: Array, skipped: Array }
   */
  _allocateTasks(prioritizedTasks, availableSlots, dailyHoursLimit) {
    const allocations = [];
    const skipped = [];
    const dailyTaskCount = {};
    const dailyHardTaskCount = {};
    const dailyMinutesUsed = {};
    
    for (const { task, priorityScore } of prioritizedTasks) {
      let allocated = false;
      
      // Try preferred time slots first (from behavior)
      const preferredSlots = availableSlots.filter(slot => 
        slot.optimalForUser === true && !slot.isBooked
      );
      
      const slotsToTry = [...preferredSlots, ...availableSlots.filter(s => !s.isBooked)];
      
      for (const slot of slotsToTry) {
        const dateKey = slot.date.toISOString().split('T')[0];
        
        // Check daily limits
        const taskCount = dailyTaskCount[dateKey] || 0;
        const hardTaskCount = dailyHardTaskCount[dateKey] || 0;
        const minutesUsed = dailyMinutesUsed[dateKey] || 0;
        
        const dailyLimitMinutes = dailyHoursLimit * 60 * 0.9; // 10% buffer
        
        // Cognitive load limits
        if (taskCount >= 4) continue; // Max 4 tasks/day
        if (task.difficulty === 'hard' && hardTaskCount >= 2) continue; // Max 2 hard/day
        if (minutesUsed + task.duration > dailyLimitMinutes) continue; // Over daily limit
        if (slot.isBooked) continue; // Slot taken
        
        // Check if slot is big enough
        if (slot.durationMinutes < task.duration) continue;
        
        // ALLOCATE
        allocations.push({
          taskId: task._id,
          newSlot: { start: slot.start, end: new Date(slot.start.getTime() + task.duration * 60000) },
          priorityScore,
          slotDate: dateKey
        });
        
        slot.isBooked = true;
        dailyTaskCount[dateKey] = taskCount + 1;
        dailyHardTaskCount[dateKey] = task.difficulty === 'hard' ? hardTaskCount + 1 : hardTaskCount;
        dailyMinutesUsed[dateKey] = minutesUsed + task.duration;
        
        allocated = true;
        break;
      }
      
      if (!allocated) {
        skipped.push({
          taskId: task._id,
          reason: 'no_suitable_slot',
          priorityScore
        });
        logger.warn(`[AdaptiveScheduling] Could not reschedule task ${task._id}`);
      }
    }
    
    return { allocations, skipped };
  }
  
  /**
   * Generate available time slots for rescheduling
   * 
   * @param {ObjectId} userId
   * @param {Object} plan - StudyPlan object
   * @param {Object} behaviorProfile - UserBehaviorProfile or null
   * @returns {Promise<Array>} Array of slot objects
   */
  async _generateFutureSlots(userId, plan, behaviorProfile) {
    const slots = [];
    const now = new Date();
    const endDate = new Date(plan.endDate);
    
    // Look ahead up to plan end date or 30 days (whichever is sooner)
    const lookAheadDays = Math.min(
      Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)),
      30
    );
    
    // Get existing tasks to avoid conflicts
    const existingTasks = await StudyTask.find({
      userId,
      timeSlotStart: { 
        $gte: now,
        $lte: new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000)
      },
      status: { $in: ['pending', 'in-progress'] }
    }).lean();
    
    // Time slot configurations
    const timeSlotConfig = {
      morning: { start: 8, end: 12 },    // 8 AM - 12 PM
      afternoon: { start: 13, end: 17 },  // 1 PM - 5 PM
      evening: { start: 18, end: 22 },    // 6 PM - 10 PM
      night: { start: 22, end: 24 }       // 10 PM - 12 AM
    };
    
    // Use plan preferences or defaults
    const preferredTimeSlots = plan.preferredTimeSlots?.length > 0 
      ? plan.preferredTimeSlots 
      : ['morning', 'afternoon', 'evening'];
    
    // Generate slots for each day
    for (let day = 0; day < lookAheadDays; day++) {
      const currentDate = new Date(now);
      currentDate.setDate(currentDate.getDate() + day);
      currentDate.setHours(0, 0, 0, 0);
      
      for (const timeSlotName of preferredTimeSlots) {
        const slotConfig = timeSlotConfig[timeSlotName];
        if (!slotConfig) continue;
        
        // Create 30-minute slots
        for (let hour = slotConfig.start; hour < slotConfig.end; hour++) {
          for (let minutes of [0, 30]) {
            const slotStart = new Date(currentDate);
            slotStart.setHours(hour, minutes, 0, 0);
            
            const slotEnd = new Date(slotStart);
            slotEnd.setMinutes(slotEnd.getMinutes() + 30);
            
            // Skip past slots
            if (slotStart < now) continue;
            
            // Check if slot is free
            const hasConflict = existingTasks.some(task => {
              const taskStart = new Date(task.timeSlotStart);
              const taskEnd = new Date(task.timeSlotEnd);
              return slotStart < taskEnd && slotEnd > taskStart;
            });
            
            if (hasConflict) continue;
            
            // Check if this is optimal for user
            let optimalForUser = false;
            if (behaviorProfile && behaviorProfile.isReliable()) {
              const optimalSlot = behaviorProfile.getOptimalSlot();
              optimalForUser = (timeSlotName === optimalSlot);
            }
            
            slots.push({
              start: slotStart,
              end: slotEnd,
              date: currentDate,
              timeSlot: timeSlotName,
              durationMinutes: 30,
              optimalForUser,
              isBooked: false
            });
          }
        }
      }
    }
    
    return slots;
  }
}

module.exports = new AdaptiveSchedulingService();
