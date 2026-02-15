/**
 * Unified Schedule Controller
 * 
 * Provides REST endpoints for accessing tasks and events through a unified interface.
 * Maintains backward compatibility while exposing modern event-based scheduling.
 * 
 * @tier API Layer
 */

const modelAdapter = require('../services/modelAdapter.service');
const StudyPlan = require('../models/StudyPlan');
const AppError = require('../utils/AppError');

class UnifiedScheduleController {
  /**
   * Get unified schedule (tasks + events) for a plan
   * GET /api/study-planner/plans/:id/schedule
   * 
   * Query params:
   * - startDate (optional): Filter by start date
   * - endDate (optional): Filter by end date
   * - status (optional): Filter by status
   * - format (optional): 'unified' (default) | 'tasks' | 'events'
   */
  async getUnifiedSchedule(req, res, next) {
    try {
      const { id: planId } = req.params;
      const userId = req.user.id;
      const { startDate, endDate, status, format = 'unified' } = req.query;

      // Verify plan ownership
      const plan = await StudyPlan.findOne({ _id: planId, userId });
      if (!plan) {
        throw new AppError('Plan not found', 404);
      }

      const options = {
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        status
      };

      let schedule;
      
      switch (format) {
        case 'unified':
          schedule = await modelAdapter.getUnifiedSchedule(planId, options);
          break;
        
        case 'tasks':
          // Legacy format only
          const StudyTask = require('../models/StudyTask.ENHANCED');
          const tasks = await StudyTask.find({
            planId,
            isDeleted: false,
            ...(status && { status }),
            ...(startDate && { scheduledDate: { $gte: new Date(startDate) } })
          }).sort({ scheduledDate: 1 });
          schedule = tasks.map(t => modelAdapter.taskToEventProjection(t));
          break;
        
        case 'events':
          // Modern format only
          const StudyEvent = require('../models/StudyEvent');
          schedule = await StudyEvent.find({
            planId,
            ...(status && { status }),
            ...(startDate && { startTime: { $gte: new Date(startDate) } })
          }).sort({ startTime: 1 }).lean();
          break;
        
        default:
          throw new AppError('Invalid format parameter', 400);
      }

      res.json({
        success: true,
        count: schedule.length,
        data: schedule,
        metadata: {
          format,
          planId,
          dateRange: {
            start: startDate,
            end: endDate
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Sync completion between models
   * POST /api/study-planner/sync-completion
   * 
   * Body:
   * - taskId or eventId
   * - status: 'completed'
   * - completionNotes (optional)
   */
  async syncCompletion(req, res, next) {
    try {
      const userId = req.user.id;
      const { taskId, eventId, status, completionNotes } = req.body;

      if (status !== 'completed') {
        throw new AppError('Only completion sync is supported', 400);
      }

      let result;

      if (taskId) {
        const StudyTask = require('../models/StudyTask.ENHANCED');
        const task = await StudyTask.findOne({ _id: taskId, userId });
        
        if (!task) {
          throw new AppError('Task not found', 404);
        }

        task.status = 'completed';
        task.completedAt = new Date();
        if (completionNotes) {
          task.completionNotes = completionNotes;
        }
        await task.save();

        // Sync to linked events
        const synced = await modelAdapter.syncTaskCompletionToEvents(task);
        
        result = {
          task: task,
          syncedEvents: synced.length
        };
      } else if (eventId) {
        const StudyEvent = require('../models/StudyEvent');
        const event = await StudyEvent.findOne({ _id: eventId, userId });
        
        if (!event) {
          throw new AppError('Event not found', 404);
        }

        event.status = 'completed';
        event.completedAt = new Date();
        if (completionNotes) {
          event.completionNotes = completionNotes;
        }
        await event.save();

        // Sync to linked task
        const syncedTask = await modelAdapter.syncEventCompletionToTask(event);
        
        result = {
          event: event,
          syncedTask: syncedTask ? syncedTask._id : null
        };
      } else {
        throw new AppError('Either taskId or eventId required', 400);
      }

      res.json({
        success: true,
        message: 'Completion synced successfully',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get model preference for a plan
   * GET /api/study-planner/plans/:id/model-preference
   */
  async getModelPreference(req, res, next) {
    try {
      const { id: planId } = req.params;
      const userId = req.user.id;

      const plan = await StudyPlan.findOne({ _id: planId, userId });
      if (!plan) {
        throw new AppError('Plan not found', 404);
      }

      const preferredModel = await modelAdapter.getPreferredModel(planId);

      res.json({
        success: true,
        data: {
          planId,
          preferredModel,
          recommendation: preferredModel === 'event' 
            ? 'Using modern event-based scheduling'
            : 'Using legacy task-based scheduling for compatibility'
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UnifiedScheduleController();
