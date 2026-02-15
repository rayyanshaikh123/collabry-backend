const StudyTask = require('../models/StudyTask');
const StudyPlan = require('../models/StudyPlan');
const AppError = require('../utils/AppError');

class StudyTaskService {
  /**
   * Create a new task
   */
  async createTask(userId, taskData) {
    // Verify plan exists and belongs to user
    const plan = await StudyPlan.findOne({
      _id: taskData.planId,
      userId,
      isArchived: false,
    });

    if (!plan) {
      throw new AppError('Study plan not found', 404);
    }

    const task = await StudyTask.create({
      userId,
      ...taskData,
    });

    // Update plan task count
    plan.totalTasks += 1;
    await plan.save();

    return task;
  }

  /**
   * Create multiple tasks (bulk)
   */
  async createBulkTasks(userId, planId, tasksData) {
    const plan = await StudyPlan.findOne({
      _id: planId,
      userId,
      isArchived: false,
    });

    if (!plan) {
      throw new AppError('Study plan not found', 404);
    }

    const tasks = tasksData.map((taskData, index) => ({
      userId,
      planId,
      ...taskData,
      order: taskData.order !== undefined ? taskData.order : index,
    }));

    const createdTasks = await StudyTask.insertMany(tasks);

    // Update plan task count
    plan.totalTasks += createdTasks.length;
    await plan.save();

    return createdTasks;
  }

  /**
   * Get tasks for a plan
   */
  async getPlanTasks(planId, userId, filters = {}) {
    const query = { planId, userId, isDeleted: false };

    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.date) {
      const date = new Date(filters.date);
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      query.scheduledDate = { $gte: date, $lt: nextDay };
    }
    if (filters.priority) {
      query.priority = filters.priority;
    }

    const tasks = await StudyTask.find(query)
      .sort({ scheduledDate: 1, order: 1 })
      .lean();

    return tasks;
  }

  /**
   * Get user's tasks (across all plans)
   */
  async getUserTasks(userId, filters = {}) {
    const query = { userId, isDeleted: false };

    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.date) {
      const date = new Date(filters.date);
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      query.scheduledDate = { $gte: date, $lt: nextDay };
    }
    if (filters.dateRange) {
      query.scheduledDate = {
        $gte: new Date(filters.dateRange.start),
        $lte: new Date(filters.dateRange.end),
      };
    }

    const tasks = await StudyTask.find(query)
      .populate('planId', 'title subject')
      .sort({ scheduledDate: 1, priority: -1 })
      .lean();

    return tasks;
  }

  /**
   * Get task by ID
   */
  async getTaskById(taskId, userId, isAdmin = false) {
    const query = { _id: taskId, isDeleted: false };
    if (!isAdmin) {
      query.userId = userId;
    }

    const task = await StudyTask.findOne(query)
      .populate('planId', 'title subject')
      .lean();

    if (!task) {
      throw new AppError('Task not found', 404);
    }

    return task;
  }

  /**
   * Update task
   */
  async updateTask(taskId, userId, updates, isAdmin = false) {
    const query = { _id: taskId, isDeleted: false };
    if (!isAdmin) {
      query.userId = userId;
    }

    const task = await StudyTask.findOne(query);
    if (!task) {
      throw new AppError('Task not found', 404);
    }

    const allowedUpdates = [
      'title',
      'description',
      'topic',
      'resources',
      'scheduledDate',
      'scheduledTime',
      'duration',
      'priority',
      'difficulty',
      'status',
      'completionNotes',
      'difficultyRating',
      'understandingLevel',
    ];

    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        task[field] = updates[field];
      }
    });

    await task.save();
    return task;
  }

  /**
   * Mark task as completed
   */
  async completeTask(taskId, userId, completionData = {}) {
    const task = await StudyTask.findOne({
      _id: taskId,
      userId,
      isDeleted: false,
    });

    if (!task) {
      throw new AppError('Task not found', 404);
    }

    task.markCompleted(completionData.notes, completionData.actualDuration);
    
    if (completionData.difficultyRating) {
      task.difficultyRating = completionData.difficultyRating;
    }
    if (completionData.understandingLevel) {
      task.understandingLevel = completionData.understandingLevel;
    }

    await task.save();

    // Update plan progress
    const plan = await StudyPlan.findById(task.planId);
    if (plan) {
      plan.completedTasks += 1;
      if (completionData.actualDuration) {
        plan.totalStudyHours += completionData.actualDuration / 60;
      }
      plan.updateProgress();
      
      // Check for streak (completed task today)
      const today = new Date();
      const taskDate = new Date(task.scheduledDate);
      if (today.toDateString() === taskDate.toDateString()) {
        plan.updateStreak(true);
      }
      
      await plan.save();

      // Trigger Notifications
      try {
        const notificationService = require('./notification.service');
        
        // 1. Plan Completion
        if (plan.completedTasks >= plan.totalTasks && plan.totalTasks > 0) {
          await notificationService.notifyPlanCompleted(userId, plan);
        }
        
        // 2. Streak Milestone (Every 5 days or specific milestones)
        if (plan.currentStreak > 0 && (plan.currentStreak % 5 === 0 || [3, 7, 14, 30].includes(plan.currentStreak))) {
          await notificationService.notifyStreakMilestone(userId, plan.currentStreak);
        }
      } catch (e) {
        console.warn('Failed to send task completion notifications:', e.message);
      }
    }

    return task;
  }

  /**
   * Reschedule task
   */
  async rescheduleTask(taskId, userId, newDate, reason) {
    const task = await StudyTask.findOne({
      _id: taskId,
      userId,
      isDeleted: false,
    });

    if (!task) {
      throw new AppError('Task not found', 404);
    }

    task.reschedule(newDate, reason);
    await task.save();

    // Update plan missed tasks count
    const plan = await StudyPlan.findById(task.planId);
    if (plan) {
      plan.missedTasks += 1;
      await plan.save();
    }

    return task;
  }

  /**
   * Delete task
   */
  async deleteTask(taskId, userId, isAdmin = false) {
    const query = { _id: taskId };
    if (!isAdmin) {
      query.userId = userId;
    }

    const task = await StudyTask.findOne(query);
    if (!task) {
      throw new AppError('Task not found', 404);
    }

    // Soft delete
    task.isDeleted = true;
    await task.save();

    // Update plan task count
    const plan = await StudyPlan.findById(task.planId);
    if (plan) {
      plan.totalTasks -= 1;
      if (task.status === 'completed') {
        plan.completedTasks -= 1;
      }
      plan.updateProgress();
      await plan.save();
    }

    return { message: 'Task deleted successfully' };
  }

  /**
   * Get today's tasks
   */
  async getTodayTasks(userId) {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    console.log('[studyTaskService.getTodayTasks] userId:', userId);
    console.log('[studyTaskService.getTodayTasks] Current time:', now);
    console.log('[studyTaskService.getTodayTasks] today (UTC):', today.toISOString());
    console.log('[studyTaskService.getTodayTasks] tomorrow (UTC):', tomorrow.toISOString());
    
    const query = {
      userId,
      isDeleted: false,
      scheduledDate: { $gte: today, $lt: tomorrow },
    };
    console.log('[studyTaskService.getTodayTasks] Query:', JSON.stringify(query));

    const tasks = await StudyTask.find(query)
      .populate('planId', 'title subject')
      .sort({ priority: -1, scheduledTime: 1 })
      .lean();

    console.log('[studyTaskService.getTodayTasks] Found:', tasks.length, 'tasks');
    if (tasks.length > 0) {
      console.log('[studyTaskService.getTodayTasks] First task scheduledDate:', tasks[0].scheduledDate);
    }

    return tasks;
  }

  /**
   * Get upcoming tasks (next 7 days)
   */
  async getUpcomingTasks(userId, days = 7) {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const futureDate = new Date(today);
    futureDate.setUTCDate(futureDate.getUTCDate() + days);

    const tasks = await StudyTask.find({
      userId,
      isDeleted: false,
      status: { $in: ['pending', 'in-progress'] },
      scheduledDate: { $gte: today, $lte: futureDate },
    })
      .populate('planId', 'title subject')
      .sort({ scheduledDate: 1, priority: -1 })
      .lean();

    return tasks;
  }

  /**
   * Get overdue tasks
   */
  async getOverdueTasks(userId) {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));

    const tasks = await StudyTask.find({
      userId,
      isDeleted: false,
      status: { $in: ['pending', 'in-progress'] },
      scheduledDate: { $lt: today },
    })
      .populate('planId', 'title subject')
      .sort({ scheduledDate: 1 })
      .lean();

    return tasks;
  }
}

module.exports = new StudyTaskService();
