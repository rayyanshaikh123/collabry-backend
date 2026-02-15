/**
 * BACKEND: SchedulingService for Smart Calendar
 * File: backend/src/services/scheduling.service.js
 * 
 * Purpose: Intelligent task scheduling respecting dailyStudyHours, preferred time slots
 * Algorithm: First-Fit-Decreasing bin-packing (FFD)
 * 
 * This service handles:
 * 1. Auto-scheduling a plan's tasks into available time slots
 * 2. Detecting conflicts between tasks
 * 3. Suggesting available time slots
 * 4. Rescheduling tasks with conflict detection
 * 5. Resolving conflicts automatically or with user guidance
 * 6. Handling missed tasks (redistributing workload)
 */

const StudyTask = require('../models/StudyTask');
const StudyPlan = require('../models/StudyPlan');
const TimeBlockConflict = require('../models/TimeBlockConflict');
const SchedulingLog = require('../models/SchedulingLog');
const logger = require('../utils/logger');

class SchedulingService {
  /**
   * AUTO-SCHEDULE PLAN: Main entry point
   * 
   * Flow:
   * 1. Validate plan exists and user owns it
   * 2. Get all tasks for this plan
   * 3. Generate available time slots (respecting dailyStudyHours)
   * 4. Allocate tasks to slots (FFD algorithm)
   * 5. Detect conflicts
   * 6. Log actions and return results
   * 
   * @param {string} userId - User ID
   * @param {string} planId - Plan ID
   * @returns {Promise<{success: boolean, allocated: Object, conflicts: Array, stats: Object}>}
   */
  async autoSchedulePlan(userId, planId) {
    const startTime = Date.now();
    
    try {
      // 1. Validate inputs
      const plan = await StudyPlan.findById(planId);
      if (!plan) {
        throw new Error(`Plan ${planId} not found`);
      }
      if (plan.userId.toString() !== userId.toString()) {
        throw new Error('User does not own this plan');
      }
      
      // 2. Get all pending tasks
      const tasks = await StudyTask.find({
        planId: planId,
        status: { $in: ['pending', 'rescheduled'] },
        isDeleted: false,
      });
      
      if (tasks.length === 0) {
        logger.info(`[AutoSchedule] No pending tasks for plan ${planId}`);
        return {
          success: true,
          allocated: {},
          conflicts: [],
          stats: {
            totalTasks: 0,
            allocatedTasks: 0,
            conflictsDetected: 0,
            executionTimeMs: Date.now() - startTime,
          },
        };
      }
      
      // 3. Generate available time slots
      const slots = this._generateTimeSlots(
        plan.startDate,
        plan.endDate,
        plan.dailyStudyHours || 4,
        plan.preferredTimeSlots || []
      );
      
      logger.info(`[AutoSchedule] Generated ${slots.length} time slots for plan ${planId}`);
      
      // 4. Allocate tasks to slots (FFD algorithm)
      const allocation = this._allocateTasksToSlots(tasks, slots);
      
      logger.info(`[AutoSchedule] Allocated ${allocation.size} tasks to slots`);
      
      // 5. Update database with time slot times
      const updatedTasks = [];
      for (const [taskId, slotInfo] of allocation.entries()) {
        const task = tasks.find(t => t._id.toString() === taskId);
        if (task) {
          task.timeSlotStart = slotInfo.start;
          task.timeSlotEnd = slotInfo.end;
          
          // Initialize schedulingMetadata if it doesn't exist (for legacy tasks)
          if (!task.schedulingMetadata) {
            task.schedulingMetadata = {};
          }
          
          task.schedulingMetadata.isAutoScheduled = true;
          task.schedulingMetadata.lastScheduledAt = new Date();
          
          // Also update scheduledDate for backward compatibility
          task.scheduledDate = slotInfo.start;
          
          await task.save();
          updatedTasks.push(task);
        }
      }
      
      // 6. Detect conflicts
      const conflicts = await this.detectAllConflicts(userId, planId);
      
      logger.info(`[AutoSchedule] Detected ${conflicts.length} conflicts`);
      
      // 7. Log action
      await SchedulingLog.create({
        userId: userId,
        planId: planId,
        action: 'auto_schedule',
        taskIds: updatedTasks.map(t => t._id),
        details: {
          tasksScheduled: updatedTasks.length,
          slotsGenerated: slots.length,
          dailyStudyHours: plan.dailyStudyHours,
        },
        success: true,
      });
      
      return {
        success: true,
        allocated: Object.fromEntries(allocation),
        conflicts: conflicts.map(c => ({
          taskId1: c.task1Id,
          taskId2: c.task2Id,
          overlapMinutes: c.overlappingMinutes,
        })),
        stats: {
          totalTasks: tasks.length,
          allocatedTasks: allocation.size,
          conflictsDetected: conflicts.length,
          executionTimeMs: Date.now() - startTime,
        },
      };
    } catch (error) {
      logger.error(`[AutoSchedule] Error: ${error.message}`);
      
      // Log failure
      await SchedulingLog.create({
        userId: userId,
        planId: planId,
        action: 'auto_schedule',
        details: { error: error.message },
        success: false,
      }).catch(e => logger.error(`Failed to log scheduling error: ${e.message}`));
      
      throw error;
    }
  }

  /**
   * GENERATE TIME SLOTS
   * 
   * Creates a grid of 30-minute time slots across plan duration,
   * respecting dailyStudyHours and preferredTimeSlots.
   * 
   * Example:
   * - Plan: Feb 1-7 (7 days)
   * - dailyStudyHours: 4
   * - Returns: 7 days × 8 slots/day (4 hours / 30 min) = 56 slots
   * 
   * @param {Date} startDate - Plan start date
   * @param {Date} endDate - Plan end date
   * @param {number} dailyMinutes - Total minutes per day (e.g., 4 hours = 240 min)
   * @param {Array} preferredSlots - Preferred time blocks (e.g., [{start: "08:00", end: "12:00"}])
   * @returns {Array} Array of {start: Date, end: Date, available: boolean, taskId: null}
   */
  _generateTimeSlots(startDate, endDate, dailyHours, preferredSlots = []) {
    const slots = [];
    const dailyMinutes = dailyHours * 60;
    const slotDuration = 30; // minutes
    const slotsPerDay = dailyMinutes / slotDuration;
    
    // Default preferred time slots if none provided
    const defaultPreferred = [
      { start: '08:00', end: '12:00' }, // Morning
      { start: '14:00', end: '18:00' }, // Afternoon
    ];
    const prefs = preferredSlots.length > 0 ? preferredSlots : defaultPreferred;
    
    // Iterate through each day
    let current = new Date(startDate);
    current.setHours(0, 0, 0, 0);
    
    while (current <= endDate) {
      let slotsAddedToday = 0;
      
      // For each preferred time block
      for (const pref of prefs) {
        if (slotsAddedToday >= slotsPerDay) break;
        
        // Parse start/end times (e.g., "08:00" -> hour 8, minute 0)
        const [startHour, startMin] = pref.start.split(':').map(Number);
        const [endHour, endMin] = pref.end.split(':').map(Number);
        
        let slotStart = new Date(current);
        slotStart.setHours(startHour, startMin, 0, 0);
        
        let slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration);
        
        // Keep creating slots until we hit end time or daily quota
        while (slotEnd.getHours() < endHour || (slotEnd.getHours() === endHour && slotEnd.getMinutes() <= endMin)) {
          if (slotsAddedToday >= slotsPerDay) break;
          
          slots.push({
            start: new Date(slotStart),
            end: new Date(slotEnd),
            available: true,
            taskId: null,
          });
          
          slotsAddedToday++;
          slotStart = new Date(slotEnd);
          slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration);
        }
      }
      
      // Move to next day
      current.setDate(current.getDate() + 1);
    }
    
    return slots;
  }

  /**
   * ALLOCATE TASKS TO SLOTS
   * 
   * Uses First-Fit-Decreasing (FFD) algorithm:
   * 1. Sort tasks by duration (longest first)
   * 2. For each task, find first available contiguous slot group
   * 3. Mark slots as used
   * 
   * This is better than naive spreading because:
   * - Longer tasks have better selection of slots
   * - Higher utilization of available time
   * 
   * @param {Array} tasks - Array of StudyTask documents
   * @param {Array} slots - Array of time slots
   * @returns {Map<taskId, {start, end}>} Task ID -> slot info
   */
  _allocateTasksToSlots(tasks, slots) {
    const allocation = new Map();
    
    // Step 1: Sort tasks by duration (longest first)
    const sortedTasks = [...tasks].sort((a, b) => {
      const durationA = a.duration || 60;
      const durationB = b.duration || 60;
      return durationB - durationA;
    });
    
    // Step 2: For each task, find contiguous slots
    for (const task of sortedTasks) {
      const taskDuration = task.duration || 60; // default 60 min
      const requiredSlots = Math.ceil(taskDuration / 30);
      
      // Find first fit: first group of contiguous available slots
      for (let i = 0; i <= slots.length - requiredSlots; i++) {
        const candidateSlots = slots.slice(i, i + requiredSlots);
        
        // Check if all slots are available
        const allAvailable = candidateSlots.every(s => s.available && !s.taskId);
        
        if (allAvailable) {
          // Mark slots as used
          const slotStart = candidateSlots[0].start;
          const slotEnd = candidateSlots[candidateSlots.length - 1].end;
          
          allocation.set(task._id.toString(), {
            start: slotStart,
            end: slotEnd,
          });
          
          // Mark these slots as unavailable
          candidateSlots.forEach(s => {
            s.available = false;
            s.taskId = task._id.toString();
          });
          
          break; // Move to next task
        }
      }
    }
    
    return allocation;
  }

  /**
   * DETECT ALL CONFLICTS
   * 
   * Finds all overlapping time blocks for this user's plan.
   * O(n²) complexity but acceptable for typical <500 tasks.
   * 
   * @param {string} userId - User ID
   * @param {string} planId - Plan ID
   * @returns {Promise<Array>} Array of TimeBlockConflict documents
   */
  async detectAllConflicts(userId, planId) {
    const conflicts = [];
    
    // Get all active tasks (not completed/skipped)
    const tasks = await StudyTask.find({
      planId: planId,
      status: { $nin: ['completed', 'skipped'] },
      isDeleted: false,
      timeSlotStart: { $exists: true },
    });
    
    // Compare each pair of tasks
    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        const task1 = tasks[i];
        const task2 = tasks[j];
        
        const overlap = this._checkOverlap(task1, task2);
        
        if (overlap.hasOverlap) {
          // Update conflict flags
          // Initialize schedulingMetadata if it doesn't exist (for legacy tasks)
          if (!task1.schedulingMetadata) {
            task1.schedulingMetadata = {};
          }
          if (!task2.schedulingMetadata) {
            task2.schedulingMetadata = {};
          }
          
          task1.schedulingMetadata.conflictFlag = true;
          task1.schedulingMetadata.conflictCount = (task1.schedulingMetadata.conflictCount || 0) + 1;
          await task1.save();
          
          task2.schedulingMetadata.conflictFlag = true;
          task2.schedulingMetadata.conflictCount = (task2.schedulingMetadata.conflictCount || 0) + 1;
          await task2.save();
          
          // Create or update conflict record
          let conflictDoc = await TimeBlockConflict.findOne({
            $or: [
              { task1Id: task1._id, task2Id: task2._id },
              { task1Id: task2._id, task2Id: task1._id },
            ],
            planId: planId,
          });
          
          if (!conflictDoc) {
            conflictDoc = new TimeBlockConflict({
              userId: userId,
              planId: planId,
              task1Id: task1._id,
              task2Id: task2._id,
              conflictType: overlap.type,
              overlappingMinutes: overlap.overlapMinutes,
              overlapStartTime: overlap.overlapStart,
              overlapEndTime: overlap.overlapEnd,
              detectedBy: 'auto_schedule',
            });
            
            conflictDoc.updateSeverity();
            await conflictDoc.save();
          } else {
            // Update existing conflict record
            conflictDoc.overlappingMinutes = overlap.overlapMinutes;
            conflictDoc.conflictType = overlap.type;
            conflictDoc.overlapStartTime = overlap.overlapStart;
            conflictDoc.overlapEndTime = overlap.overlapEnd;
            await conflictDoc.save();
          }
          
          conflicts.push(conflictDoc);
        }
      }
    }
    
    return conflicts;
  }

  /**
   * CHECK OVERLAP BETWEEN TWO TASKS
   * 
   * @param {StudyTask} task1
   * @param {StudyTask} task2
   * @returns {Object} {hasOverlap, type, overlapMinutes, overlapStart, overlapEnd}
   */
  _checkOverlap(task1, task2) {
    const start1 = new Date(task1.timeSlotStart);
    const end1 = new Date(task1.timeSlotEnd || new Date(start1.getTime() + task1.duration * 60 * 1000));
    
    const start2 = new Date(task2.timeSlotStart);
    const end2 = new Date(task2.timeSlotEnd || new Date(start2.getTime() + task2.duration * 60 * 1000));
    
    // Check for overlap
    const hasOverlap = start1 < end2 && start2 < end1;
    
    if (!hasOverlap) {
      return { hasOverlap: false };
    }
    
    // Calculate overlap details
    const overlapStart = new Date(Math.max(start1, start2));
    const overlapEnd = new Date(Math.min(end1, end2));
    const overlapMinutes = Math.round((overlapEnd - overlapStart) / (1000 * 60));
    
    // Determine conflict type
    let type = 'partial_overlap';
    if (start1.getTime() === start2.getTime() && end1.getTime() === end2.getTime()) {
      type = 'direct_overlap';
    } else if (overlapMinutes < 5) {
      type = 'edge_case'; // Near-boundary collision
    }
    
    return {
      hasOverlap: true,
      type: type,
      overlapMinutes: Math.max(overlapMinutes, 1),
      overlapStart: overlapStart,
      overlapEnd: overlapEnd,
    };
  }

  /**
   * SUGGEST TIME SLOT
   * 
   * Finds available time slots for a task, avoiding conflicts.
   * Prioritizes preferred times (morning > afternoon > evening).
   * 
   * @param {string} userId - User ID
   * @param {string} taskId - Task ID
   * @returns {Promise<Array>} Array of suggested {start, end, score} objects
   */
  async suggestTimeSlot(userId, taskId) {
    const task = await StudyTask.findById(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    const plan = await StudyPlan.findById(task.planId);
    const duration = task.duration || 60;
    
    // Generate candidate slots
    const slot = this._generateTimeSlots(
      plan.startDate,
      plan.endDate,
      plan.dailyStudyHours || 4,
      plan.preferredTimeSlots || []
    );
    
    // Get all other tasks to check for conflicts
    const otherTasks = await StudyTask.find({
      planId: task.planId,
      _id: { $ne: taskId },
      status: { $nin: ['completed', 'skipped'] },
      isDeleted: false,
    });
    
    const suggestions = [];
    
    for (const candidateSlot of slots) {
      // Check if this slot conflicts with other tasks
      let hasConflict = false;
      
      for (const otherTask of otherTasks) {
        if (!otherTask.timeSlotStart) continue;
        
        const overlap = this._checkOverlap(
          { timeSlotStart: candidateSlot.start, timeSlotEnd: candidateSlot.end, duration },
          otherTask
        );
        
        if (overlap.hasOverlap) {
          hasConflict = true;
          break;
        }
      }
      
      if (!hasConflict) {
        // Score this slot (prefer morning, then afternoon, then evening)
        const hour = candidateSlot.start.getHours();
        let score = 0;
        if (hour >= 8 && hour < 12) score = 10; // Morning (best)
        else if (hour >= 14 && hour < 18) score = 8; // Afternoon
        else if (hour >= 18 && hour < 21) score = 6; // Evening
        else score = 4; // Night
        
        suggestions.push({
          start: candidateSlot.start,
          end: candidateSlot.end,
          score: score,
        });
      }
    }
    
    // Sort by score descending
    suggestions.sort((a, b) => b.score - a.score);
    
    return suggestions.slice(0, 5); // Return top 5
  }

  /**
   * RESCHEDULE TASK
   * 
   * Moves a task to a new time slot with conflict checking.
   * 
   * @param {string} userId - User ID
   * @param {string} taskId - Task ID
   * @param {Date} newStartTime - New start time
   * @param {string} reason - Why is it being rescheduled?
   * @returns {Promise<StudyTask>}
   */
  async rescheduleTask(userId, taskId, newStartTime, reason = '') {
    const task = await StudyTask.findById(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    // Check for conflicts at new time
    const newEnd = new Date(newStartTime.getTime() + task.duration * 60 * 1000);
    
    const conflictingTasks = await StudyTask.find({
      planId: task.planId,
      _id: { $ne: taskId },
      status: { $nin: ['completed', 'skipped'] },
      isDeleted: false,
      timeSlotStart: { $exists: true },
      timeSlotStart: { $lt: newEnd },
      timeSlotEnd: { $gt: newStartTime },
    });
    
    if (conflictingTasks.length > 0) {
      throw new Error(
        `Cannot reschedule: conflicts with ${conflictingTasks.length} task(s)`
      );
    }
    
    // Update task
    task.timeSlotStart = newStartTime;
    task.timeSlotEnd = newEnd;
    task.scheduledDate = newStartTime;
    task.reschedule(newStartTime, reason);
    
    // Initialize schedulingMetadata if it doesn't exist (for legacy tasks)
    if (!task.schedulingMetadata) {
      task.schedulingMetadata = {};
    }
    
    task.schedulingMetadata.conflictFlag = false;
    task.schedulingMetadata.lastScheduledAt = new Date();
    
    await task.save();
    
    // Log action
    await SchedulingLog.create({
      userId: userId,
      planId: task.planId,
      action: 'reschedule_task',
      taskIds: [taskId],
      details: { reason, newStart: newStartTime },
      success: true,
    });
    
    return task;
  }

  /**
   * RESOLVE CONFLICT
   * 
   * Automatically attempts to resolve a conflict by moving one task.
   * 
   * @param {string} userId - User ID
   * @param {string} conflictId - TimeBlockConflict ID
   * @returns {Promise<Object>} {success, message, movedTask}
   */
  async resolveConflict(userId, conflictId) {
    const conflict = await TimeBlockConflict.findById(conflictId);
    if (!conflict) {
      throw new Error(`Conflict ${conflictId} not found`);
    }
    
    // Get both tasks
    const task1 = await StudyTask.findById(conflict.task1Id);
    const task2 = await StudyTask.findById(conflict.task2Id);
    
    // Try to reschedule task2 (lower priority)
    const suggestions = await this.suggestTimeSlot(userId, task2._id);
    
    if (suggestions.length === 0) {
      conflict.resolutionAttemptCount += 1;
      await conflict.save();
      
      return {
        success: false,
        message: 'No available time slots for rescheduling',
      };
    }
    
    // Use best suggestion
    const newSlot = suggestions[0];
    
    try {
      await this.rescheduleTask(
        userId,
        task2._id,
        newSlot.start,
        'auto_resolved_conflict'
      );
      
      conflict.markAutoResolved(
        'rescheduled_lower_priority_task',
        [task2._id],
        `Moved task to ${newSlot.start.toISOString()}`
      );
      await conflict.save();
      
      return {
        success: true,
        message: 'Conflict resolved by rescheduling task 2',
        movedTask: task2._id,
        newSlot: newSlot,
      };
    } catch (error) {
      conflict.resolutionAttemptCount += 1;
      await conflict.save();
      
      return {
        success: false,
        message: `Rescheduling failed: ${error.message}`,
      };
    }
  }

  /**
   * HANDLE MISSED TASK
   * 
   * When user skips a task, redistribute its workload to other days.
   * 
   * @param {string} userId - User ID
   * @param {string} taskId - Task ID
   * @returns {Promise<Array>} Array of affected tasks
   */
  async handleMissedTask(userId, taskId) {
    const task = await StudyTask.findById(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    // Mark as missed
    task.status = 'skipped';
    await task.save();
    
    // Clear time slot (make available for other tasks)
    task.timeSlotStart = null;
    task.timeSlotEnd = null;
    await task.save();
    
    // Re-run auto-scheduling to redistribute workload
    const results = await this.autoSchedulePlan(userId, task.planId);
    
    // Log action
    await SchedulingLog.create({
      userId: userId,
      planId: task.planId,
      action: 'handle_missed_task',
      taskIds: [taskId],
      details: { redistributedTasks: results.stats.allocatedTasks },
      success: true,
    });
    
    return results;
  }
}

module.exports = new SchedulingService();
