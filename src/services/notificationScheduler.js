const cron = require('node-cron');
const StudyTask = require('../models/StudyTask');
const notificationService = require('../services/notification.service');
const { getIO } = require('../socket');
const { emitNotificationToUser } = require('../socket/notificationNamespace');

/**
 * Notification Scheduler
 * Cron jobs for automated notifications
 */

/**
 * Check for tasks due soon (next hour)
 * Runs every 15 minutes
 */
const checkTasksDueSoon = cron.schedule('*/15 * * * *', async () => {
  try {
    console.log('📋 Checking for tasks due soon...');

    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    // Find tasks due in the next hour that haven't been completed
    const tasks = await StudyTask.find({
      scheduledDate: {
        $gte: now,
        $lte: oneHourFromNow,
      },
      status: { $nin: ['completed', 'skipped'] },
    }).populate('userId', 'name email');

    console.log(`Found ${tasks.length} tasks due soon`);

    for (const task of tasks) {
      // Check if notification already sent (you might want to add a flag to prevent duplicates)
      const notification = await notificationService.notifyTaskDueSoon(
        task.userId._id || task.userId,
        task
      );

      // Emit real-time notification
      try {
        const io = getIO();
        emitNotificationToUser(io, task.userId._id || task.userId, notification);
      } catch (err) {
        console.error('Failed to emit real-time notification:', err);
      }
    }
  } catch (error) {
    console.error('Error checking tasks due soon:', error);
  }
});

/**
 * Check for overdue tasks
 * Runs every hour
 */
const checkOverdueTasks = cron.schedule('0 * * * *', async () => {
  try {
    console.log('⚠️ Checking for overdue tasks...');

    const now = new Date();
    now.setHours(0, 0, 0, 0); // Start of today

    // Find tasks that are overdue
    const tasks = await StudyTask.find({
      scheduledDate: { $lt: now },
      status: { $nin: ['completed', 'skipped'] },
    }).populate('userId', 'name email');

    console.log(`Found ${tasks.length} overdue tasks`);

    for (const task of tasks) {
      const notification = await notificationService.notifyTaskOverdue(
        task.userId._id || task.userId,
        task
      );

      // Emit real-time notification
      try {
        const io = getIO();
        emitNotificationToUser(io, task.userId._id || task.userId, notification);
      } catch (err) {
        console.error('Failed to emit real-time notification:', err);
      }
    }
  } catch (error) {
    console.error('Error checking overdue tasks:', error);
  }
});

/**
 * Send daily plan reminders
 * Runs every day at 8 AM
 */
const sendDailyPlanReminders = cron.schedule('0 8 * * *', async () => {
  try {
    console.log('🌅 Sending daily plan reminders...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get all tasks scheduled for today
    const tasks = await StudyTask.find({
      scheduledDate: {
        $gte: today,
        $lt: tomorrow,
      },
      status: { $nin: ['completed', 'skipped'] },
    }).populate('userId', 'name email');

    // Group by user
    const tasksByUser = tasks.reduce((acc, task) => {
      const userId = task.userId._id?.toString() || task.userId.toString();
      if (!acc[userId]) {
        acc[userId] = [];
      }
      acc[userId].push(task);
      return acc;
    }, {});

    // Send notification to each user
    for (const [userId, userTasks] of Object.entries(tasksByUser)) {
      const notification = await notificationService.notifyDailyPlanReminder(
        userId,
        userTasks.length
      );

      // Emit real-time notification
      try {
        const io = getIO();
        emitNotificationToUser(io, userId, notification);
      } catch (err) {
        console.error('Failed to emit real-time notification:', err);
      }
    }

    console.log(`Sent reminders to ${Object.keys(tasksByUser).length} users`);
  } catch (error) {
    console.error('Error sending daily reminders:', error);
  }
});

/**
 * Send daily motivation quotes
 * Runs every day at 9 AM
 */
const sendDailyMotivation = cron.schedule('0 9 * * *', async () => {
  try {
    console.log('💡 Sending daily motivation...');

    // Get all active users (you might want to query only active users)
    const User = require('../models/User');
    const users = await User.find({ isActive: true }).select('_id');

    for (const user of users) {
      const notification = await notificationService.notifyDailyMotivation(user._id);

      // Emit real-time notification
      try {
        const io = getIO();
        emitNotificationToUser(io, user._id, notification);
      } catch (err) {
        // Silent fail for motivation quotes
      }
    }

    console.log(`Sent motivation to ${users.length} users`);
  } catch (error) {
    console.error('Error sending daily motivation:', error);
  }
});

// ============================================================================
// TIER-2/3: ADVANCED AUTOMATION
// ============================================================================

/**
 * Nightly behavior analysis - Learn user patterns
 * Runs every night at 2 AM
 */
const runBehaviorAnalysis = cron.schedule('0 2 * * *', async () => {
  try {
    console.log('🧠 Running nightly behavior analysis...');
    
    const behaviorService = require('./behaviorLearning.service');
    const result = await behaviorService.batchAnalyze();
    
    console.log(`✓ Behavior analysis complete: ${result.analyzed}/${result.total} users, ${result.reliable} reliable profiles`);
  } catch (error) {
    console.error('Error running behavior analysis:', error);
  }
});

/**
 * Heatmap precomputation - Update daily study stats
 * Runs every night at 3 AM
 */
const updateHeatmapData = cron.schedule('0 3 * * *', async () => {
  try {
    console.log('📊 Updating heatmap data...');
    
    const DailyStudyStats = require('../models/DailyStudyStats');
    const StudyTask = require('../models/StudyTask.ENHANCED');
    const FocusSession = require('../models/FocusSession');
    const User = require('../models/User');
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    // Get all active users
    const users = await User.find({}).select('_id');
    
    for (const user of users) {
      // Aggregate user's data from yesterday
      const tasksCompleted = await StudyTask.countDocuments({
        userId: user._id,
        status: 'completed',
        completedAt: {
          $gte: yesterday,
          $lt: new Date(yesterday.getTime() + 24 * 60 * 60 * 1000)
        }
      });
      
      const tasksMissed = await StudyTask.countDocuments({
        userId: user._id,
        status: { $in: ['pending', 'rescheduled'] },
        timeSlotStart: {
          $gte: yesterday,
          $lt: new Date(yesterday.getTime() + 24 * 60 * 60 * 1000)
        }
      });
      
      const focusSessions = await FocusSession.find({
        userId: user._id,
        sessionStatus: 'completed',
        startTime: {
          $gte: yesterday,
          $lt: new Date(yesterday.getTime() + 24 * 60 * 60 * 1000)
        }
      });
      
      const totalMinutes = focusSessions.reduce((sum, s) => sum + (s.actualDurationMinutes || 0), 0);
      
      // Upsert daily stats
      await DailyStudyStats.upsertStats(
        user._id,
        yesterday,
        {
          totalStudyMinutes: totalMinutes,
          tasksCompleted,
          tasksMissed,
          focusSessionsCount: focusSessions.length
        }
      );
    }
    
    console.log(`✓ Heatmap data updated for ${users.length} users`);
  } catch (error) {
    console.error('Error updating heatmap data:', error);
  }
});

/**
 * Check exam phase transitions
 * Runs daily at midnight
 */
const checkExamPhases = cron.schedule('0 0 * * *', async () => {
  try {
    console.log('🎯 Checking exam phase transitions...');
    
    const StudyPlan = require('../models/StudyPlan');
    const examStrategyService = require('./examStrategy.service');
    
    // Get all plans in exam mode
    const examPlans = await StudyPlan.find({
      examMode: true,
      examDate: { $gte: new Date() }, // Future exams only
      status: 'active'
    });
    
    let transitionCount = 0;
    
    for (const plan of examPlans) {
      const strategy = await examStrategyService.getStrategy(plan);
      if (strategy.phaseChanged) {
        transitionCount++;
      }
    }
    
    console.log(`✓ Exam phase check complete: ${transitionCount} transitions detected`);
  } catch (error) {
    console.error('Error checking exam phases:', error);
  }
});

/**
 * Auto-trigger adaptive rescheduling
 * Runs every 15 minutes (aligned with task reminders)
 */
const autoAdaptiveReschedule = cron.schedule('*/15 * * * *', async () => {
  try {
    console.log('⚡ Checking for auto-rescheduling triggers...');
    
    const StudyPlan = require('../models/StudyPlan');
    const adaptiveSchedulingService = require('./adaptiveScheduling.service');
    
    // Get plans with recent adaptations enabled
    const plans = await StudyPlan.find({
      status: 'active',
      'adaptiveMetadata.lastAutoSchedule': {
        $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last auto-schedule > 24h ago
      }
    }).limit(10); // Process 10 plans per run to avoid overload
    
    for (const plan of plans) {
      try {
        const result = await adaptiveSchedulingService.redistributeMissedTasks(
          plan.userId,
          plan._id,
          { reason: 'auto_scheduled', maxTasksToReschedule: 10 }
        );
        
        if (result.rescheduled > 0) {
          console.log(`  Rescheduled ${result.rescheduled} tasks for plan ${plan._id}`);
        }
      } catch (err) {
        console.error(`  Failed to reschedule plan ${plan._id}:`, err.message);
      }
    }
  } catch (error) {
    console.error('Error in auto-rescheduling:', error);
  }
});

/**
 * Start all cron jobs
 */
const startNotificationScheduler = () => {
  console.log('🕐 Starting notification scheduler...');
  
  // Tier-1 (existing)
  checkTasksDueSoon.start();
  checkOverdueTasks.start();
  sendDailyPlanReminders.start();
  sendDailyMotivation.start();
  
  // Tier-2/3 (new)
  runBehaviorAnalysis.start();
  updateHeatmapData.start();
  checkExamPhases.start();
  autoAdaptiveReschedule.start();

  console.log('✓ Notification scheduler started (Tier-1 + Tier-2/3)');
};

/**
 * Stop all cron jobs
 */
const stopNotificationScheduler = () => {
  // Tier-1
  checkTasksDueSoon.stop();
  checkOverdueTasks.stop();
  sendDailyPlanReminders.stop();
  sendDailyMotivation.stop();
  
  // Tier-2/3
  runBehaviorAnalysis.stop();
  updateHeatmapData.stop();
  checkExamPhases.stop();
  autoAdaptiveReschedule.stop();

  console.log('✗ Notification scheduler stopped');
};

module.exports = {
  startNotificationScheduler,
  stopNotificationScheduler,
};
