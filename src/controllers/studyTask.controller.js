const studyTaskService = require('../services/studyTask.service');
const notificationService = require('../services/notification.service');
const { GamificationService } = require('../services/gamification.service');
const { getIO } = require('../socket');
const { emitNotificationToUser } = require('../socket/notificationNamespace');

class StudyTaskController {
  /**
   * Create task
   * POST /api/study-planner/tasks
   */
  async createTask(req, res, next) {
    try {
      const userId = req.user.id;
      const task = await studyTaskService.createTask(userId, req.body);

      res.status(201).json({
        success: true,
        data: task,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create bulk tasks
   * POST /api/study-planner/tasks/bulk
   */
  async createBulkTasks(req, res, next) {
    try {
      const userId = req.user.id;
      const { planId, tasks } = req.body;

      console.log(`[StudyTask] Creating ${tasks?.length || 0} tasks for plan ${planId}, user ${userId}`);

      if (!planId) {
        throw new Error('Plan ID is required');
      }

      if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
        throw new Error('Tasks array is required and must not be empty');
      }

      const createdTasks = await studyTaskService.createBulkTasks(
        userId,
        planId,
        tasks
      );

      console.log(`[StudyTask] Successfully created ${createdTasks.length} tasks`);

      res.status(201).json({
        success: true,
        count: createdTasks.length,
        data: createdTasks,
      });
    } catch (error) {
      console.error('[StudyTask] Error creating bulk tasks:', error.message);
      next(error);
    }
  }

  /**
   * Get tasks for a plan
   * GET /api/study-planner/plans/:planId/tasks
   */
  async getPlanTasks(req, res, next) {
    try {
      const userId = req.user.id;
      const { planId } = req.params;
      const { status, date, priority } = req.query;

      const tasks = await studyTaskService.getPlanTasks(planId, userId, {
        status,
        date,
        priority,
      });

      res.json({
        success: true,
        count: tasks.length,
        data: tasks,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all user tasks
   * GET /api/study-planner/tasks
   */
  async getUserTasks(req, res, next) {
    try {
      const userId = req.user.id;
      const { status, date, startDate, endDate } = req.query;

      const filters = { status, date };
      if (startDate && endDate) {
        filters.dateRange = { start: startDate, end: endDate };
      }

      const tasks = await studyTaskService.getUserTasks(userId, filters);

      res.json({
        success: true,
        count: tasks.length,
        data: tasks,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get today's tasks
   * GET /api/study-planner/tasks/today
   */
  async getTodayTasks(req, res, next) {
    try {
      const userId = req.user.id;
      console.log('[getTodayTasks] userId:', userId);
      
      const tasks = await studyTaskService.getTodayTasks(userId);
      
      console.log('[getTodayTasks] Found tasks:', tasks.length);

      res.json({
        success: true,
        count: tasks.length,
        data: tasks,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get upcoming tasks
   * GET /api/study-planner/tasks/upcoming
   */
  async getUpcomingTasks(req, res, next) {
    try {
      const userId = req.user.id;
      const days = parseInt(req.query.days) || 7;
      const tasks = await studyTaskService.getUpcomingTasks(userId, days);

      res.json({
        success: true,
        count: tasks.length,
        data: tasks,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get overdue tasks
   * GET /api/study-planner/tasks/overdue
   */
  async getOverdueTasks(req, res, next) {
    try {
      const userId = req.user.id;
      const tasks = await studyTaskService.getOverdueTasks(userId);

      res.json({
        success: true,
        count: tasks.length,
        data: tasks,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get task by ID
   * GET /api/study-planner/tasks/:id
   */
  async getTaskById(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;

      const task = await studyTaskService.getTaskById(id, userId, isAdmin);

      res.json({
        success: true,
        data: task,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update task
   * PUT /api/study-planner/tasks/:id
   */
  async updateTask(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;

      const task = await studyTaskService.updateTask(
        id,
        userId,
        req.body,
        isAdmin
      );

      res.json({
        success: true,
        data: task,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark task as completed
   * POST /api/study-planner/tasks/:id/complete
   */
  async completeTask(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const completionData = req.body;

      const task = await studyTaskService.completeTask(
        id,
        userId,
        completionData
      );

      // Award XP for task completion
      let gamificationResult = null;
      try {
        gamificationResult = await GamificationService.awardTaskCompletionXP(userId, {
          priority: task.priority,
        });
        
        // If leveled up, create a notification
        if (gamificationResult.leveledUp) {
          const notification = await notificationService.createNotification({
            userId,
            type: 'achievement_unlocked',
            title: '🎉 Level Up!',
            message: `Congratulations! You reached Level ${gamificationResult.newLevel}!`,
            priority: 'high',
            actionUrl: '/profile',
            actionText: 'View Profile',
          });

          if (notification) {
            try {
              const io = getIO();
              emitNotificationToUser(io, userId, notification);
            } catch (err) {
              console.error('Failed to emit level up notification:', err);
            }
          }
        }

        // If new badges unlocked
        if (gamificationResult.newBadges && gamificationResult.newBadges.length > 0) {
          for (const badge of gamificationResult.newBadges) {
            const notification = await notificationService.createNotification({
              userId,
              type: 'achievement_unlocked',
              title: `🏆 Badge Unlocked: ${badge.name}!`,
              message: badge.description,
              priority: 'medium',
              actionUrl: '/profile',
              actionText: 'View Badges',
            });

            if (notification) {
              try {
                const io = getIO();
                emitNotificationToUser(io, userId, notification);
              } catch (err) {
                console.error('Failed to emit badge notification:', err);
              }
            }
          }
        }
      } catch (gamError) {
        console.error('Error awarding gamification rewards:', gamError);
        // Don't fail the task completion if gamification fails
      }

      res.json({
        success: true,
        data: task,
        gamification: gamificationResult,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reschedule task
   * POST /api/study-planner/tasks/:id/reschedule
   */
  async rescheduleTask(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { newDate, reason } = req.body;

      const task = await studyTaskService.rescheduleTask(
        id,
        userId,
        newDate,
        reason
      );

      res.json({
        success: true,
        data: task,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete task
   * DELETE /api/study-planner/tasks/:id
   */
  async deleteTask(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;

      const result = await studyTaskService.deleteTask(id, userId, isAdmin);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  // ============================================================================
  // TIER-2/3: ADAPTIVE SCHEDULING
  // ============================================================================

  /**
   * Trigger adaptive rescheduling
   * POST /api/study-planner/scheduling/adaptive-reschedule
   */
  async adaptiveReschedule(req, res, next) {
    try {
      const userId = req.user.id;
      const { planId, reason = 'manual_trigger' } = req.body;

      if (!planId) {
        return res.status(400).json({
          success: false,
          message: 'Plan ID is required'
        });
      }

      const adaptiveSchedulingService = require('../services/adaptiveScheduling.service');
      const result = await adaptiveSchedulingService.redistributeMissedTasks(
        userId,
        planId,
        { reason }
      );

      res.json({
        success: true,
        message: `Rescheduled ${result.rescheduled} tasks`,
        data: result
      });

    } catch (error) {
      console.error('[StudyTask] Error in adaptive rescheduling:', error);
      next(error);
    }
  }

  /**
   * Link task to notebook
   * PATCH /api/study-planner/tasks/:id/link-notebook
   */
  async linkNotebook(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { notebookId, artifactType, artifactCategory } = req.body;

      if (!notebookId) {
        return res.status(400).json({
          success: false,
          message: 'Notebook ID is required'
        });
      }

      const StudyTask = require('../models/StudyTask.ENHANCED');
      const task = await StudyTask.findOne({ _id: id, userId });

      if (!task) {
        return res.status(404).json({
          success: false,
          message: 'Task not found'
        });
      }

      // Update task with linked notebook
      task.linkedNotebookId = notebookId;

      if (artifactType) {
        task.linkedArtifact = {
          type: artifactType,
          category: artifactCategory || 'general'
        };
      }

      await task.save();

      res.json({
        success: true,
        message: 'Task linked to notebook successfully',
        data: task
      });

    } catch (error) {
      console.error('[StudyTask] Error linking notebook:', error);
      next(error);
    }
  }
}

module.exports = new StudyTaskController();
