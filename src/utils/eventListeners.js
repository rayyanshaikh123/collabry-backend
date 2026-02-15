/**
 * Event Listeners
 * 
 * Register all event handlers for decoupled service communication
 * Connects Tier-2/3 features via event-driven architecture
 */

const eventEmitter = require('../utils/eventEmitter');
const logger = require('../utils/logger');

/**
 * Register all event listeners
 */
function registerEventListeners() {
  logger.info('[EventListeners] Registering event handlers...');
  
  // ============================================================================
  // TASK EVENTS
  // ============================================================================
  
  /**
   * When task is completed:
   * 1. Update daily stats for heatmap
   * 2. Trigger behavior learning (if enough samples)
   */
  eventEmitter.on('task.completed', async (data) => {
    try {
      const { userId, taskId, task } = data;
      logger.debug(`[Event] task.completed: user=${userId}, task=${taskId}`);
      
      // Update daily stats
      const DailyStudyStats = require('../models/DailyStudyStats');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      await DailyStudyStats.incrementStats(userId, today, {
        tasksCompleted: 1,
        totalStudyMinutes: task?.duration || 0
      });
      
      // Check if we should trigger behavior analysis
      const UserBehaviorProfile = require('../models/UserBehaviorProfile');
      const profile = await UserBehaviorProfile.findOne({ userId });
      
      if (!profile || !profile.lastAnalyzedAt || 
          (Date.now() - profile.lastAnalyzedAt) > 7 * 24 * 60 * 60 * 1000) {
        // Last analysis > 7 days ago or never analyzed
        const behaviorService = require('../services/behaviorLearning.service');
        setTimeout(() => {
          behaviorService.analyzeUserBehavior(userId).catch(err => {
            logger.error(`[Event] Background behavior analysis failed for user ${userId}:`, err);
          });
        }, 5000); // Async delay to avoid blocking
      }
      
    } catch (error) {
      logger.error('[Event] Error handling task.completed:', error);
    }
  });
  
  /**
   * When tasks are rescheduled:
   * Send notification to user
   */
  eventEmitter.on('tasks.rescheduled', async (data) => {
    try {
      const { userId, planId, tasks, reason } = data;
      logger.info(`[Event] tasks.rescheduled: ${tasks.length} tasks for user=${userId}`);
      
      const notificationService = require('../services/notification.service');
      const { emitNotificationToUser } = require('../socket/notificationNamespace');
      const { getIO } = require('../socket');
      
      // Create notification
      const notification = await notificationService.create({
        userId,
        type: 'system',
        title: 'Tasks Automatically Rescheduled',
        message: `${tasks.length} missed tasks have been redistributed to optimal time slots.`,
        priority: 'medium',
        metadata: { planId, reason, taskCount: tasks.length }
      });
      
      // Emit real-time
      try {
        const io = getIO();
        emitNotificationToUser(io, userId, notification);
      } catch (err) {
        logger.warn('[Event] Failed to emit real-time notification:', err);
      }
      
    } catch (error) {
      logger.error('[Event] Error handling tasks.rescheduled:', error);
    }
  });
  
  // ============================================================================
  // EXAM MODE EVENTS
  // ============================================================================
  
  /**
   * When exam phase changes:
   * Send notification with new phase recommendations
   */
  eventEmitter.on('exam.phase.changed', async (data) => {
    try {
      const { userId, planId, oldPhase, newPhase, daysRemaining, description } = data;
      logger.info(`[Event] exam.phase.changed: ${oldPhase} → ${newPhase} (${daysRemaining} days), user=${userId}`);
      
      const notificationService = require('../services/notification.service');
      const { emitNotificationToUser } = require('../socket/notificationNamespace');
      const { getIO } = require('../socket');
      
      // Create notification
      const phaseEmojis = {
        concept_building: '📚',
        practice_heavy: '✍️',
        revision: '🔄',
        light_review: '✨'
      };
      
      const emoji = phaseEmojis[newPhase] || '🎯';
      
      const notification = await notificationService.create({
        userId,
        type: 'system',
        title: `${emoji} Exam Phase Update`,
        message: `Your study plan has transitioned to: ${description}. ${daysRemaining} days until your exam!`,
        priority: 'high',
        metadata: { planId, phase: newPhase, daysRemaining }
      });
      
      // Emit real-time
      try {
        const io = getIO();
        emitNotificationToUser(io, userId, notification);
      } catch (err) {
        logger.warn('[Event] Failed to emit real-time notification:', err);
      }
      
    } catch (error) {
      logger.error('[Event] Error handling exam.phase.changed:', error);
    }
  });
  
  // ============================================================================
  // BEHAVIOR LEARNING EVENTS
  // ============================================================================
  
  /**
   * When user profile becomes reliable:
   * Enable predictive scheduling features
   */
  eventEmitter.on('behavior.profile.reliable', async (data) => {
    try {
      const { userId, profile } = data;
      logger.info(`[Event] behavior.profile.reliable: user=${userId}, quality=${profile.dataQualityScore}`);
      
      // Send congratulatory notification
      const notificationService = require('../services/notification.service');
      const { emitNotificationToUser } = require('../socket/notificationNamespace');
      const { getIO } = require('../socket');
      
      const optimalSlot = profile.getOptimalSlot ? profile.getOptimalSlot() : 'morning';
      
      const notification = await notificationService.create({
        userId,
        type: 'achievement',
        title: '🎉 Smart Scheduling Unlocked!',
        message: `We've learned your study patterns! Future tasks will be scheduled during your peak productivity hours (${optimalSlot}).`,
        priority: 'medium',
        metadata: { feature: 'predictive_scheduling', peakHours: profile.productivityPeakHours }
      });
      
      // Emit real-time
      try {
        const io = getIO();
        emitNotificationToUser(io, userId, notification);
      } catch (err) {
        logger.warn('[Event] Failed to emit real-time notification:', err);
      }
      
    } catch (error) {
      logger.error('[Event] Error handling behavior.profile.reliable:', error);
    }
  });
  
  /**
   * When heatmap data is updated:
   * Trigger streak calculations
   */
  eventEmitter.on('heatmap.updated', async (data) => {
    try {
      const { userId, date } = data;
      logger.debug(`[Event] heatmap.updated: user=${userId}, date=${date}`);
      
      // Check for streak milestones
      const DailyStudyStats = require('../models/DailyStudyStats');
      const streak = await DailyStudyStats.getCurrentStreak(userId);
      
      // Milestone notifications
      const milestones = [7, 14, 30, 60, 100];
      if (milestones.includes(streak)) {
        const notificationService = require('../services/notification.service');
        const { GamificationService } = require('../services/gamification.service');
        
        // Award bonus XP for streak milestones
        await GamificationService.awardXP(userId, streak * 10, `${streak}-day streak bonus`);
        
        await notificationService.create({
          userId,
          type: 'achievement',
          title: `🔥 ${streak}-Day Streak!`,
          message: `Amazing consistency! You've studied for ${streak} days in a row.`,
          priority: 'high',
          metadata: { streak, milestone: true }
        });
      }
      
    } catch (error) {
      logger.error('[Event] Error handling heatmap.updated:', error);
    }
  });
  
  // ============================================================================
  // COLLABORATIVE SESSION EVENTS (Tier-3)
  // ============================================================================
  
  /**
   * When collaborative session is created:
   * Notify invited participants
   */
  eventEmitter.on('collaborative.session.created', async (data) => {
    try {
      const { sessionId, ownerId, participants, startTime } = data;
      logger.info(`[Event] collaborative.session.created: session=${sessionId}, participants=${participants.length}`);
      
      // TODO: Implement notifications to participants
      // This is a placeholder for Tier-3 implementation
      
    } catch (error) {
      logger.error('[Event] Error handling collaborative.session.created:', error);
    }
  });
  
  logger.info('[EventListeners] ✓ All event handlers registered');
}

module.exports = { registerEventListeners };
