/**
 * Task-Event Model Adapter
 * 
 * Provides bidirectional mapping between legacy StudyTask and modern StudyEvent models.
 * Enables gradual migration without breaking existing APIs or frontend contracts.
 * 
 * Architecture Pattern: Adapter + Strategy
 * Thread Safety: Safe (no shared state)
 * Performance: O(1) conversion, lazy loading
 * 
 * @tier Production Migration
 * @priority HIGH
 */

const StudyTask = require('../models/StudyTask.ENHANCED');
const StudyEvent = require('../models/StudyEvent');
const logger = require('../utils/logger');

class TaskEventAdapter {
  /**
   * Convert legacy StudyTask to modern StudyEvent format (read-only projection)
   * Does NOT create DB record - returns event-like object for API responses
   * 
   * @param {Object} task - StudyTask document
   * @returns {Object} Event-like object with startTime/endTime
   */
  taskToEventProjection(task) {
    if (!task) {
      logger.warn('[TaskEventAdapter] taskToEventProjection called with null task');
      return null;
    }

    try {
      const startTime = task.timeSlotStart || task.scheduledDate;
      const endTime = task.timeSlotEnd || (startTime && task.duration 
        ? new Date(new Date(startTime).getTime() + task.duration * 60 * 1000)
        : null);

      return {
        id: task._id?.toString(),
        taskId: task._id,
        planId: task.planId,
        userId: task.userId,
        title: task.title,
        description: task.description,
        topic: task.topic,
        
        // Time bounds (modern format)
        startTime: startTime,
        endTime: endTime,
        
        // Scheduling metadata
        priority: task.priority,
        difficulty: task.difficulty,
        priorityScore: this._calculatePriorityScore(task),
        energyTag: this._mapEnergyTag(task),
        type: this._mapTaskType(task),
        
        // Status tracking
        status: task.status,
        completedAt: task.completedAt,
        
        // Resources
        resources: task.resources || [],
        
        // Metadata flags
        aiGenerated: task.schedulingMetadata?.isAutoScheduled || false,
        deepWork: task.duration >= 90,
        estimatedEffort: this._mapDifficultyToEffort(task.difficulty),
        
        // Legacy compatibility
        _legacy: true,
        _sourceModel: 'StudyTask',
        scheduledDate: task.scheduledDate,
        duration: task.duration
      };
    } catch (error) {
      logger.error(`[TaskEventAdapter] Error converting task ${task._id}: ${error.message}`);
      return null;
    }
  }

  /**
   * Convert modern StudyEvent to legacy StudyTask format (read-only projection)
   * For backward compatibility with legacy APIs
   * 
   * @param {Object} event - StudyEvent document
   * @returns {Object} Task-like object with scheduledDate/duration
   */
  eventToTaskProjection(event) {
    if (!event) {
      logger.warn('[TaskEventAdapter] eventToTaskProjection called with null event');
      return null;
    }

    try {
      const duration = event.startTime && event.endTime
        ? Math.round((new Date(event.endTime) - new Date(event.startTime)) / (60 * 1000))
        : 60; // default

      return {
        id: event._id?.toString(),
        eventId: event._id,
        planId: event.planId,
        userId: event.userId,
        title: event.title,
        description: event.description,
        topic: event.topic,
        
        // Legacy time format
        scheduledDate: event.startTime,
        scheduledTime: this._extractTimeString(event.startTime),
        duration: duration,
        
        // Common fields
        priority: event.priority,
        difficulty: event.difficulty,
        status: event.status,
        completedAt: event.completedAt,
        resources: event.resources || [],
        
        // Metadata
        schedulingMetadata: {
          isAutoScheduled: event.aiGenerated || false,
          lastScheduledAt: event.createdAt
        },
        
        // Modern compatibility
        _modern: true,
        _sourceModel: 'StudyEvent',
        timeSlotStart: event.startTime,
        timeSlotEnd: event.endTime
      };
    } catch (error) {
      logger.error(`[TaskEventAdapter] Error converting event ${event._id}: ${error.message}`);
      return null;
    }
  }

  /**
   * Sync event completion back to linked task
   * Used when event is marked complete to update original task
   * 
   * @param {Object} event - Completed StudyEvent
   * @param {Object} task - Linked StudyTask (optional, will fetch if not provided)
   * @returns {Promise<Object>} Updated task
   */
  async syncEventCompletionToTask(event, task = null) {
    if (!event || !event.taskId) {
      logger.warn('[TaskEventAdapter] syncEventCompletionToTask called without taskId');
      return null;
    }

    try {
      const targetTask = task || await StudyTask.findById(event.taskId);
      if (!targetTask) {
        logger.warn(`[TaskEventAdapter] Task ${event.taskId} not found for sync`);
        return null;
      }

      // Sync completion status
      if (event.status === 'completed' && targetTask.status !== 'completed') {
        targetTask.status = 'completed';
        targetTask.completedAt = event.completedAt || new Date();
        
        if (event.completionNotes) {
          targetTask.completionNotes = event.completionNotes;
        }
        
        // Calculate actual duration
        if (event.actualStartTime && event.actualEndTime) {
          const actualDuration = Math.round(
            (new Date(event.actualEndTime) - new Date(event.actualStartTime)) / (60 * 1000)
          );
          targetTask.actualDuration = actualDuration;
        }

        await targetTask.save();
        logger.info(`[TaskEventAdapter] Synced event ${event._id} completion to task ${targetTask._id}`);
      }

      return targetTask;
    } catch (error) {
      logger.error(`[TaskEventAdapter] Sync failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Sync task completion back to linked events
   * Used when task is marked complete via legacy API
   * 
   * @param {Object} task - Completed StudyTask
   * @returns {Promise<Array>} Updated events
   */
  async syncTaskCompletionToEvents(task) {
    if (!task) return [];

    try {
      const linkedEvents = await StudyEvent.find({
        taskId: task._id,
        status: { $ne: 'completed' }
      });

      if (linkedEvents.length === 0) {
        logger.debug(`[TaskEventAdapter] No linked events for task ${task._id}`);
        return [];
      }

      const updated = [];
      for (const event of linkedEvents) {
        if (task.status === 'completed') {
          event.status = 'completed';
          event.completedAt = task.completedAt || new Date();
          
          if (task.completionNotes) {
            event.completionNotes = task.completionNotes;
          }

          await event.save();
          updated.push(event);
        }
      }

      logger.info(`[TaskEventAdapter] Synced task ${task._id} completion to ${updated.length} events`);
      return updated;
    } catch (error) {
      logger.error(`[TaskEventAdapter] Sync failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Determine which model to use for a given plan
   * Strategy: Check plan metadata or default to modern (StudyEvent)
   * 
   * @param {string} planId - Plan ID
   * @returns {Promise<string>} 'task' or 'event'
   */
  async getPreferredModel(planId) {
    try {
      const StudyPlan = require('../models/StudyPlan');
      const plan = await StudyPlan.findById(planId).lean();
      
      if (!plan) {
        logger.warn(`[TaskEventAdapter] Plan ${planId} not found, defaulting to event model`);
        return 'event';
      }

      // Check if plan explicitly prefers legacy task model
      if (plan.useLegacyTaskModel === true) {
        return 'task';
      }

      // Check creation date (plans created before 2026 use tasks)
      const cutoffDate = new Date('2026-01-01');
      if (plan.createdAt < cutoffDate) {
        logger.debug(`[TaskEventAdapter] Plan ${planId} created before 2026, using task model`);
        return 'task';
      }

      // Default to modern event model
      return 'event';
    } catch (error) {
      logger.error(`[TaskEventAdapter] Error determining model: ${error.message}`);
      return 'event'; // Safe default
    }
  }

  /**
   * Get unified schedule (tasks + events) for a plan
   * Returns normalized array with both sources
   * 
   * @param {string} planId - Plan ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Unified schedule items
   */
  async getUnifiedSchedule(planId, options = {}) {
    const { startDate, endDate, status } = options;
    
    try {
      const query = { planId, isDeleted: false };
      if (status) query.status = status;

      // Fetch both models in parallel
      const [tasks, events] = await Promise.all([
        StudyTask.find(query).lean(),
        StudyEvent.find({ planId, ...( status ? { status } : {}) }).lean()
      ]);

      // Convert tasks to event format
      const taskEvents = tasks
        .filter(t => t.timeSlotStart) // Only scheduled tasks
        .map(t => this.taskToEventProjection(t))
        .filter(Boolean);

      // Filter events to avoid duplicates (events with taskId)
      const pureEvents = events.filter(e => !e.taskId);

      // Combine and sort
      const unified = [...taskEvents, ...pureEvents];
      
      // Apply date filters
      let filtered = unified;
      if (startDate || endDate) {
        filtered = unified.filter(item => {
          const itemStart = new Date(item.startTime);
          if (startDate && itemStart < new Date(startDate)) return false;
          if (endDate && itemStart > new Date(endDate)) return false;
          return true;
        });
      }

      // Sort by startTime
      filtered.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

      logger.info(`[TaskEventAdapter] Unified schedule: ${taskEvents.length} tasks + ${pureEvents.length} events = ${filtered.length} items`);
      return filtered;
    } catch (error) {
      logger.error(`[TaskEventAdapter] Error getting unified schedule: ${error.message}`);
      throw error;
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  _calculatePriorityScore(task) {
    const priorityMap = { low: 25, medium: 50, high: 75, urgent: 100 };
    const difficultyBonus = { easy: 0, medium: 10, hard: 20 };
    
    const base = priorityMap[task.priority] || 50;
    const bonus = difficultyBonus[task.difficulty] || 0;
    const examBonus = task.examProximityScore || 0;
    
    return Math.min(100, base + bonus + (examBonus * 0.2));
  }

  _mapEnergyTag(task) {
    if (task.duration >= 90) return 'deep_work';
    if (task.duration >= 60) return 'high';
    if (task.duration >= 30) return 'medium';
    return 'low';
  }

  _mapTaskType(task) {
    if (task.duration >= 90) return 'deep_work';
    if (task.topic && task.topic.toLowerCase().includes('practice')) return 'practice';
    if (task.topic && task.topic.toLowerCase().includes('review')) return 'review';
    if (task.topic && task.topic.toLowerCase().includes('exam')) return 'exam_prep';
    return 'deep_work';
  }

  _mapDifficultyToEffort(difficulty) {
    const map = { easy: 3, medium: 6, hard: 9 };
    return map[difficulty] || 5;
  }

  _extractTimeString(dateTime) {
    if (!dateTime) return null;
    const d = new Date(dateTime);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
}

module.exports = new TaskEventAdapter();
