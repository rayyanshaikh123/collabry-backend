const mongoose = require('mongoose');

const studyTaskSchema = new mongoose.Schema(
  {
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudyPlan',
      required: [true, 'Plan ID is required'],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    // Task details
    title: {
      type: String,
      required: [true, 'Task title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
    // Task metadata
    topic: {
      type: String,
      trim: true,
    },
    resources: [{
      title: String,
      url: String,
      type: {
        type: String,
        enum: ['video', 'article', 'pdf', 'quiz', 'practice', 'other'],
      },
    }],
    // Scheduling
    scheduledDate: {
      type: Date,
      required: [true, 'Scheduled date is required'],
      index: true,
    },
    scheduledTime: {
      type: String, // Format: "HH:MM" (24-hour)
    },
    duration: {
      type: Number, // in minutes
      default: 60,
      min: [15, 'Minimum duration is 15 minutes'],
      max: [480, 'Maximum duration is 8 hours'],
    },
    // Priority and difficulty
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium',
    },
    // Task status
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed', 'skipped', 'rescheduled'],
      default: 'pending',
      index: true,
    },
    // Completion tracking
    completedAt: {
      type: Date,
    },
    actualDuration: {
      type: Number, // in minutes
    },
    completionNotes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
    // Self-assessment
    difficultyRating: {
      type: Number,
      min: 1,
      max: 5,
    },
    understandingLevel: {
      type: Number,
      min: 1,
      max: 5,
    },
    // Reminders
    reminderSent: {
      type: Boolean,
      default: false,
    },
    reminderTime: {
      type: Date,
    },
    // Rescheduling
    originalDate: {
      type: Date,
    },
    rescheduledCount: {
      type: Number,
      default: 0,
    },
    rescheduledReason: {
      type: String,
      trim: true,
    },
    // Order in plan
    order: {
      type: Number,
      default: 0,
    },
    // Soft delete
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Check if task is overdue
studyTaskSchema.virtual('isOverdue').get(function() {
  if (this.status === 'completed') return false;
  const now = new Date();
  const taskDate = new Date(this.scheduledDate);
  return now > taskDate;
});

// Check if task is today
studyTaskSchema.virtual('isToday').get(function() {
  const today = new Date();
  const taskDate = new Date(this.scheduledDate);
  return today.toDateString() === taskDate.toDateString();
});

// Mark as completed
studyTaskSchema.methods.markCompleted = function(notes, actualDuration) {
  this.status = 'completed';
  this.completedAt = new Date();
  if (notes) this.completionNotes = notes;
  if (actualDuration) this.actualDuration = actualDuration;
};

// Reschedule task
studyTaskSchema.methods.reschedule = function(newDate, reason) {
  if (!this.originalDate) {
    this.originalDate = this.scheduledDate;
  }
  this.scheduledDate = newDate;
  this.status = 'rescheduled';
  this.rescheduledCount += 1;
  if (reason) this.rescheduledReason = reason;
};

// Indexes for performance
studyTaskSchema.index({ planId: 1, status: 1 });
studyTaskSchema.index({ userId: 1, scheduledDate: 1 });
studyTaskSchema.index({ userId: 1, status: 1, scheduledDate: 1 });
studyTaskSchema.index({ createdAt: -1 });

// Transform for frontend
studyTaskSchema.methods.toJSON = function() {
  const obj = this.toObject({ virtuals: true });
  obj.id = obj._id.toString();
  delete obj._id;
  delete obj.__v;
  return obj;
};

// Prevent model overwrite error in development with hot-reloading
const StudyTask = mongoose.models.StudyTask || mongoose.model('StudyTask', studyTaskSchema);

module.exports = StudyTask;
