const StudyPlan = require('../models/StudyPlan');
const StudyTask = require('../models/StudyTask');
const AppError = require('../utils/AppError');

class StudyPlanService {
  /**
   * Create a new study plan
   */
  async createPlan(userId, planData) {
    const plan = await StudyPlan.create({
      userId,
      ...planData,
    });

    try {
      const notificationService = require('./notification.service');
      await notificationService.createNotification({
        userId,
        type: 'plan_created',
        title: '✅ New Learning Journey',
        message: `Your study plan "${plan.title}" has been created successfully.`,
        priority: 'medium',
        actionLink: '/planner',
        metadata: { planId: plan._id },
        deduplicationKey: `plan-created-${plan._id}`
      });
    } catch (e) {
      console.warn('Failed to send plan creation notification', e.message);
    }

    return plan;
  }

  /**
   * Get all plans for a user
   */
  async getUserPlans(userId, filters = {}) {
    const query = { userId, isArchived: false };

    // Add filters
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.planType) {
      query.planType = filters.planType;
    }

    console.log('[studyPlanService.getUserPlans] query:', JSON.stringify(query));

    const plans = await StudyPlan.find(query)
      .sort({ createdAt: -1 })
      .lean();

    console.log('[studyPlanService.getUserPlans] Found:', plans.length, 'plans');
    if (plans.length > 0) {
      console.log('[studyPlanService.getUserPlans] First plan userId:', plans[0].userId);
    }

    return plans;
  }

  /**
   * Get plan by ID
   */
  async getPlanById(planId, userId, isAdmin = false) {
    const query = { _id: planId, isArchived: false };
    if (!isAdmin) {
      query.userId = userId;
    }

    const plan = await StudyPlan.findOne(query)
      .populate({
        path: 'tasks',
        match: { isDeleted: false },
        options: { sort: { scheduledDate: 1, order: 1 } },
      })
      .lean();

    if (!plan) {
      throw new AppError('Study plan not found', 404);
    }

    return plan;
  }

  /**
   * Update plan
   */
  async updatePlan(planId, userId, updates, isAdmin = false) {
    const query = { _id: planId, isArchived: false };
    if (!isAdmin) {
      query.userId = userId;
    }

    const plan = await StudyPlan.findOne(query);
    if (!plan) {
      throw new AppError('Study plan not found', 404);
    }

    // Allowed updates (including academic timetable for scheduler constraints)
    const allowedUpdates = [
      'title',
      'description',
      'subject',
      'topics',
      'endDate',
      'dailyStudyHours',
      'preferredTimeSlots',
      'difficulty',
      'status',
      'weeklyTimetableBlocks',
    ];

    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        plan[field] = updates[field];
      }
    });

    await plan.save();
    return plan;
  }

  /**
   * Delete/archive plan
   */
  async deletePlan(planId, userId, isAdmin = false) {
    const query = { _id: planId };
    if (!isAdmin) {
      query.userId = userId;
    }

    const plan = await StudyPlan.findOne(query);
    if (!plan) {
      throw new AppError('Study plan not found', 404);
    }

    // Soft delete
    plan.isArchived = true;
    await plan.save();

    // Also soft delete all tasks
    await StudyTask.updateMany(
      { planId: plan._id },
      { isDeleted: true }
    );

    return { message: 'Plan archived successfully' };
  }

  /**
   * Get plan analytics/statistics
   */
  async getPlanAnalytics(planId, userId, isAdmin = false) {
    const query = { _id: planId };
    if (!isAdmin) {
      query.userId = userId;
    }

    const plan = await StudyPlan.findOne(query);
    if (!plan) {
      throw new AppError('Study plan not found', 404);
    }

    // Get task statistics
    const tasks = await StudyTask.find({
      planId: plan._id,
      isDeleted: false,
    });

    const stats = {
      totalTasks: tasks.length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      pendingTasks: tasks.filter(t => t.status === 'pending').length,
      inProgressTasks: tasks.filter(t => t.status === 'in-progress').length,
      skippedTasks: tasks.filter(t => t.status === 'skipped').length,
      overdueTasks: tasks.filter(t => {
        if (t.status === 'completed') return false;
        return new Date() > new Date(t.scheduledDate);
      }).length,
      completionPercentage: plan.completionPercentage,
      currentStreak: plan.currentStreak,
      longestStreak: plan.longestStreak,
      totalStudyHours: plan.totalStudyHours,
      averageTaskDuration: tasks
        .filter(t => t.actualDuration)
        .reduce((sum, t) => sum + t.actualDuration, 0) / tasks.filter(t => t.actualDuration).length || 0,
    };

    return stats;
  }

  /**
   * Get user's overall study statistics
   */
  async getUserAnalytics(userId) {
    const plans = await StudyPlan.find({ userId, isArchived: false });
    const tasks = await StudyTask.find({ userId, isDeleted: false });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTasks = tasks.filter(t => {
      const taskDate = new Date(t.scheduledDate);
      taskDate.setHours(0, 0, 0, 0);
      return taskDate.getTime() === today.getTime();
    });

    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - today.getDay());
    const thisWeekTasks = tasks.filter(t => {
      const taskDate = new Date(t.scheduledDate);
      return taskDate >= thisWeekStart && taskDate <= today;
    });

    return {
      totalPlans: plans.length,
      activePlans: plans.filter(p => p.status === 'active').length,
      completedPlans: plans.filter(p => p.status === 'completed').length,
      totalTasks: tasks.length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      todayTasks: todayTasks.length,
      todayCompleted: todayTasks.filter(t => t.status === 'completed').length,
      weekTasks: thisWeekTasks.length,
      weekCompleted: thisWeekTasks.filter(t => t.status === 'completed').length,
      totalStudyHours: plans.reduce((sum, p) => sum + p.totalStudyHours, 0),
      longestStreak: Math.max(...plans.map(p => p.longestStreak), 0),
      currentStreak: plans[0]?.currentStreak || 0,
    };
  }

  /**
   * Recover missed sessions
   * Reschedules past due, uncompleted tasks to future slots
   */
  async recoverMissed(userId, planId) {
    // Basic implementation: Find overdue tasks and reschedule
    // For now returning mock data to fix crash
    const plan = await StudyPlan.findOne({ _id: planId, userId });
    if (!plan) throw new AppError('Plan not found', 404);
    
    // Logic: Count missed tasks
    const missed = await StudyTask.countDocuments({
      planId,
      status: { $ne: 'completed' },
      scheduledDate: { $lt: new Date() }
    });
    
    // Future: Use SlotEngine to find new slots
    // For now return harmless success
    return {
      rescheduled: 0, 
      totalMissed: missed
    };
  }
}

module.exports = new StudyPlanService();
