const mongoose = require('mongoose');

const focusSessionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['work', 'shortBreak', 'longBreak'],
    required: true
  },
  duration: {
    type: Number,
    required: true,
    min: 1,
    max: 120 // Max 2 hours
  },
  startTime: {
    type: Date,
    required: true,
    default: Date.now
  },
  endTime: {
    type: Date
  },
  pausedAt: {
    type: Date
  },
  pauseDuration: {
    type: Number,
    default: 0 // Accumulated pause time in milliseconds
  },
  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'cancelled'],
    default: 'active',
    index: true
  },
  pomodoroNumber: {
    type: Number,
    min: 1,
    max: 4
  },
  distractions: {
    type: Number,
    default: 0,
    min: 0
  },
  notes: {
    type: String,
    maxlength: 500
  },
  completedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
focusSessionSchema.index({ user: 1, createdAt: -1 });
focusSessionSchema.index({ user: 1, status: 1 });
focusSessionSchema.index({ user: 1, type: 1 });

// Virtual for actual focus duration (excluding pauses)
focusSessionSchema.virtual('actualDuration').get(function() {
  if (this.status === 'completed' && this.startTime && this.endTime) {
    const totalMs = this.endTime.getTime() - this.startTime.getTime();
    const actualMs = totalMs - this.pauseDuration;
    return Math.floor(actualMs / 60000); // Convert to minutes
  }
  return 0;
});

// Method to check if session is overdue
focusSessionSchema.methods.isOverdue = function() {
  if (this.status !== 'active' && this.status !== 'paused') {
    return false;
  }
  
  const expectedEndTime = new Date(this.startTime.getTime() + (this.duration * 60000));
  return Date.now() > expectedEndTime.getTime();
};

// Static method to find active session for user
focusSessionSchema.statics.findActiveSession = function(userId) {
  return this.findOne({
    user: userId,
    status: { $in: ['active', 'paused'] }
  });
};

// Static method to get sessions for period
focusSessionSchema.statics.getSessionsForPeriod = function(userId, startDate, endDate) {
  return this.find({
    user: userId,
    createdAt: {
      $gte: startDate,
      $lte: endDate
    }
  }).sort({ createdAt: -1 });
};

module.exports = mongoose.models.FocusSession || mongoose.model('FocusSession', focusSessionSchema);
