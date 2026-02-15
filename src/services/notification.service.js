const Notification = require('../models/Notification');

/**
 * Notification Service
 * Business logic for creating and managing notifications
 */

class NotificationService {
  /**
   * Helper to get IO instance safely (avoids circular dependency)
   */
  _getIO() {
    try {
      const { getIO } = require('../socket');
      return getIO();
    } catch (e) {
      // Socket not initialized yet or not available
      return null;
    }
  }

  /**
   * Create a notification for a user
   * Validates, Saves, Emits
   */
  async createNotification({
    userId,
    type,
    title,
    message,
    priority = 'medium',
    actionLink = null,
    actionUrl = null, // Backward compat
    metadata = {},
    expiresAt = null,
    deduplicationKey = null, // Optional key to prevent duplicates
  }) {
    if (!userId) {
      console.warn('NotificationService: userId is required');
      return null;
    }

    // 1. Deduplication (Spam Prevention)
    // Check if same notification exists within last 2 minutes
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const duplicateQuery = {
      userId,
      type,
      title,
      createdAt: { $gte: twoMinutesAgo },
    };
    
    // If deduplicationKey provided, use that for stricter check
    if (deduplicationKey) {
      duplicateQuery['metadata.deduplicationKey'] = deduplicationKey;
    }
    
    const duplicate = await Notification.findOne(duplicateQuery);
    if (duplicate) {
      // Update existing one
      duplicate.message = message; // Update message in case it changed
      duplicate.isRead = false; // Mark as unread again if it happened again
      duplicate.createdAt = new Date(); // Bump to top
      await duplicate.save();
      
      this.emitToUser(userId, duplicate);
      return duplicate;
    }

    // 2. Create Notification
    const notification = await Notification.create({
      userId,
      type,
      title,
      message,
      priority,
      actionLink: actionLink || actionUrl,
      actionUrl: actionUrl || actionLink, // Keep sync
      metadata: { ...metadata, deduplicationKey },
      expiresAt,
    });

    // 3. Emit via Socket
    this.emitToUser(userId, notification);

    return notification;
  }

  /**
   * Helper to emit socket event safely
   */
  emitToUser(userId, notification) {
    try {
      const io = this._getIO();
      if (!io) return;
      
      const notifData = notification.toJSON ? notification.toJSON() : notification;
      
      // Emit 'new-notification'
      io.of('/notifications').to(`user:${userId}`).emit('new-notification', notifData);
      
      // Emit updated count
      this.getUnreadCount(userId).then(count => {
        io.of('/notifications').to(`user:${userId}`).emit('unread-count', { count });
      });
    } catch (error) {
      console.warn('Socket emit failed (non-critical):', error.message);
    }
  }

  /**
   * Create multiple notifications at once
   */
  async createBulkNotifications(notifications) {
    const created = await Notification.insertMany(notifications);
    // Emit individually to ensure proper routing
    created.forEach(n => this.emitToUser(n.userId, n));
    return created;
  }

  /**
   * Get notifications for a user with filters
   */
  async getUserNotifications(userId, { isRead, type, priority, limit = 50, skip = 0 } = {}) {
    const query = { userId };
    
    // Handle 'false' string from query params
    if (isRead !== undefined) {
      // Parse boolean or string
      if (typeof isRead === 'string') {
        query.isRead = isRead === 'true';
      } else {
        query.isRead = !!isRead;
      }
    }
    if (type) query.type = type;
    if (priority) query.priority = priority;

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip(Number(skip));

    const total = await Notification.countDocuments(query);
    const unreadCount = await this.getUnreadCount(userId);

    return {
      notifications,
      total,
      unreadCount,
    };
  }

  /**
   * Get unread count for user
   */
  async getUnreadCount(userId) {
    return Notification.getUnreadCount(userId);
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId, userId) {
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, userId },
      { isRead: true, readAt: new Date() },
      { new: true }
    );
    
    // Update count via socket
    if (notification) {
       this.emitUnreadCount(userId);
    }

    return notification;
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(userId) {
    const result = await Notification.markAllAsRead(userId);
    this.emitUnreadCount(userId);
    return result;
  }

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId, userId) {
    const result = await Notification.findOneAndDelete({
      _id: notificationId,
      userId,
    });
    
    if (result) {
       this.emitUnreadCount(userId);
    }

    return result;
  }
  
  async deleteOldNotifications(userId, daysOld = 30) {
    return Notification.deleteOldNotifications(userId, daysOld);
  }
  
  /**
   * Helper to emit unread count
   */
  async emitUnreadCount(userId) {
    try {
        const io = this._getIO();
        if (!io) return;
        
        const count = await this.getUnreadCount(userId);
        io.of('/notifications').to(`user:${userId}`).emit('unread-count', { count });
    } catch(e) {}
  }

  // ============================================================================
  // NOTIFICATION GENERATORS
  // ============================================================================

  async notifyTaskDueSoon(userId, task) {
    return this.createNotification({
      userId,
      type: 'task_due_soon',
      title: '📝 Task Due Soon',
      message: `"${task.title}" is due soon!`,
      priority: 'high',
      metadata: { taskId: task._id || task.id },
      actionLink: '/planner',
      deduplicationKey: `due-${task._id || task.id}`
    });
  }

  async notifyTaskOverdue(userId, task) {
    return this.createNotification({
      userId,
      type: 'task_overdue',
      title: '⚠️ Task Overdue',
      message: `"${task.title}" is overdue.`,
      priority: 'high',
      metadata: { taskId: task._id || task.id },
      actionLink: '/planner',
      deduplicationKey: `overdue-${task._id || task.id}`
    });
  }

  async notifyDailyPlanReminder(userId, taskCount) {
     return this.createNotification({
      userId,
      type: 'daily_plan_reminder',
      title: '🌅 Good Morning!',
      message: `You have ${taskCount} tasks today.`,
      priority: 'medium',
      actionLink: '/planner',
      deduplicationKey: `daily-reminder-${new Date().toDateString()}`
    });
  }

  async notifyStreakAtRisk(userId, currentStreak) {
    return this.createNotification({
      userId,
      type: 'streak_at_risk',
      title: '🔥 Streak Alert!',
      message: `${currentStreak}-day streak at risk!`,
      priority: 'high',
      actionLink: '/planner',
      deduplicationKey: `streak-risk-${new Date().toDateString()}`
    });
  }

  async notifyStreakMilestone(userId, streak) {
    return this.createNotification({
      userId,
      type: 'streak_milestone',
      title: '🎉 Streak Milestone!',
      message: `You reached a ${streak}-day streak!`,
      priority: 'low',
      actionLink: '/profile',
      deduplicationKey: `streak-milestone-${streak}`
    });
  }

  async notifyPlanCompleted(userId, plan) {
    return this.createNotification({
      userId,
      type: 'plan_completed',
      title: '✅ Plan Completed!',
      message: `You completed "${plan.title}"!`,
      priority: 'medium',
      actionLink: '/planner',
      deduplicationKey: `plan-complete-${plan._id || plan.id}`
    });
  }

  // Study Board Notifications
  async notifyBoardInvitation(userId, board, invitedBy) {
    return this.createNotification({
      userId,
      type: 'board_invitation',
      title: '📋 Board Invitation',
      message: `${invitedBy.name || 'Someone'} invited you to collaborate on "${board.title}"`,
      priority: 'high',
      metadata: { boardId: board._id || board.id },
      actionLink: `/study-board/${board._id || board.id}`,
    });
  }

  async notifyNotebookInvite(userId, notebookTitle, senderName, notebookId) {
    return this.createNotification({
      userId,
      type: 'notebook_invite',
      title: '📚 Notebook Invitation',
      message: `${senderName || 'Someone'} invited you to collaborate on the notebook "${notebookTitle}"`,
      priority: 'high',
      relatedEntity: {
        entityType: 'Notebook',
        entityId: notebookId,
      },
      actionUrl: `/study-notebook/${notebookId}`,
      actionText: 'Join Notebook',
    });
  }

  async notifyBoardMemberJoined(userId, board, member) {
    return this.createNotification({
      userId,
      type: 'board_member_joined',
      title: '👋 New Collaborator',
      message: `${member.name} joined "${board.title}"`,
      priority: 'low',
      metadata: { boardId: board._id || board.id },
      actionLink: `/study-board/${board._id || board.id}`,
    });
  }

  // AI Notifications
  async notifyDocumentProcessed(userId, documentName) {
    return this.createNotification({
      userId,
      type: 'document_processed',
      title: '📄 Document Ready',
      message: `"${documentName}" is processed.`,
      priority: 'medium',
      actionLink: '/study-notebook',
    });
  }

  async notifyQuizGenerated(userId, quiz) {
     return this.createNotification({
      userId,
      type: 'quiz_generated',
      title: '📝 Quiz Ready',
      message: `Quiz "${quiz.title}" is ready.`,
      priority: 'medium',
      metadata: { quizId: quiz._id || quiz.id },
      actionLink: '/visual-aids',
    });
  }

  async notifyMindmapGenerated(userId, mindmap) {
    return this.createNotification({
      userId,
      type: 'mindmap_generated',
      title: '🗺️ Mind Map Ready',
      message: `Mind map for "${mindmap.topic}" is ready.`,
      priority: 'medium',
      metadata: { mindmapId: mindmap._id || mindmap.id },
      actionLink: '/visual-aids',
    });
  }

  async notifyDailyMotivation(userId) {
     const motivations = [
       "Keep going!",
       "You got this!",
       "Small steps lead to big change."
     ];
     const msg = motivations[Math.floor(Math.random() * motivations.length)];
     
     return this.createNotification({
       userId,
       type: 'daily_motivation',
       title: '💡 Daily Motivation',
       message: msg,
       priority: 'low',
       expiresAt: new Date(Date.now() + 86400000), 
       deduplicationKey: `motivation-${new Date().toDateString()}`
     });
  }
}

module.exports = new NotificationService();
