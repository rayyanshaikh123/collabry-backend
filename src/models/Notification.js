const mongoose = require('mongoose');

/**
 * Notification Model
 * Handles system-wide notifications for users
 */

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        // Study Planner
        'task_due_soon',
        'task_overdue',
        'task_completed',
        'daily_plan_reminder',
        'streak_milestone',
        'streak_at_risk',
        'plan_completed',

        // Study Board
        'board_invitation',
        'board_member_joined',
        'board_updated',
        'board_comment',

        // Study Notebook/AI
        'document_processed',
        'quiz_generated',
        'mindmap_generated',
        'ai_session_complete',
        'notebook_invite',

        // Reports/Admin
        'report_submitted',
        'report_resolved',
        'content_flagged',
        'user_suspended',

        // General
        'welcome',
        'daily_motivation',
        'achievement_unlocked',
        'system_announcement',
      ],
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
      index: true,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
    },
    // Metadata for any extra info
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Action button
    actionLink: {
      type: String,
      trim: true,
    },
    // Keep actionUrl for backward compatibility (optional, but good to have)
    actionUrl: {
      type: String,
      trim: true,
    },
    expiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, type: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual for age
notificationSchema.virtual('age').get(function () {
  return Date.now() - this.createdAt.getTime();
});

// Format for response strictly matching contract
notificationSchema.methods.toJSON = function () {
  const notification = this.toObject();
  notification.id = notification._id.toString();
  delete notification._id;
  delete notification.__v;
  
  // Ensure actionLink is populated if actionUrl exists (backwards compat)
  if (!notification.actionLink && notification.actionUrl) {
    notification.actionLink = notification.actionUrl;
  }
  
  return notification;
};

// Static methods
notificationSchema.statics.getUnreadCount = async function (userId) {
  return this.countDocuments({ userId, isRead: false });
};

notificationSchema.statics.markAllAsRead = async function (userId) {
  return this.updateMany(
    { userId, isRead: false },
    { isRead: true, readAt: new Date() }
  );
};

notificationSchema.statics.deleteOldNotifications = async function (userId, daysOld = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  return this.deleteMany({
    userId,
    isRead: true,
    createdAt: { $lt: cutoffDate },
  });
};

const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

module.exports = Notification;
