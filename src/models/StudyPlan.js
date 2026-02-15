const mongoose = require('mongoose');

const studyPlanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Plan title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
    // Study plan metadata
    subject: {
      type: String,
      trim: true,
    },
    topics: [{
      type: String,
      trim: true,
    }],
    // Timeline
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required'],
      validate: {
        validator: function(value) {
          return value > this.startDate;
        },
        message: 'End date must be after start date',
      },
    },
    // Study preferences
    dailyStudyHours: {
      type: Number,
      default: 2,
      min: [0.5, 'Minimum 0.5 hours per day'],
      max: [12, 'Maximum 12 hours per day'],
    },
    preferredTimeSlots: [{
      type: String,
      enum: ['morning', 'afternoon', 'evening', 'night'],
    }],
    difficulty: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced'],
      default: 'intermediate',
    },
    // Plan type
    planType: {
      type: String,
      enum: ['exam', 'course', 'skill', 'custom'],
      default: 'custom',
    },
    // Generation metadata
    generatedByAI: {
      type: Boolean,
      default: false,
    },
    aiPrompt: {
      type: String,
      trim: true,
    },
    // Progress tracking
    status: {
      type: String,
      enum: ['active', 'completed', 'paused', 'cancelled'],
      default: 'active',
      index: true,
    },
    completionPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    // Analytics
    totalTasks: {
      type: Number,
      default: 0,
    },
    completedTasks: {
      type: Number,
      default: 0,
    },
    missedTasks: {
      type: Number,
      default: 0,
    },
    currentStreak: {
      type: Number,
      default: 0,
    },
    longestStreak: {
      type: Number,
      default: 0,
    },
    totalStudyHours: {
      type: Number,
      default: 0,
    },
    // Exam Countdown Mode (Tier-2)
    examDate: {
      type: Date,
      index: true,
      validate: {
        validator: function(v) {
          return !v || v > this.startDate;
        },
        message: 'Exam date must be after plan start date'
      }
    },
    examMode: {
      type: Boolean,
      default: false,
      index: true
    },
    currentExamPhase: {
      type: String,
      enum: ['concept_building', 'practice_heavy', 'revision', 'light_review', null],
      default: null
    },
    examPhaseConfig: {
      intensityMultiplier: { type: Number, default: 1.0 },
      taskDensityPerDay: { type: Number, default: 3 },
      lastPhaseUpdate: Date
    },
    // Adaptive planning (enhanced)
    lastAdaptedAt: {
      type: Date,
    },
    adaptationCount: {
      type: Number,
      default: 0,
    },
    adaptiveMetadata: {
      missedTasksRedistributed: { type: Number, default: 0 },
      avgReschedulesPerWeek: { type: Number, default: 0 },
      lastAutoSchedule: Date
    },
    // Soft delete
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Academic timetable: locked blocks per weekday (scheduler respects these)
    // Each block: { dayOfWeek: 0-6, startTime: "09:00", endTime: "11:00", label?: "College" }
    weeklyTimetableBlocks: [{
      dayOfWeek: { type: Number, min: 0, max: 6 },
      startTime: { type: String },
      endTime: { type: String },
      label: { type: String, default: 'block' },
    }],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for tasks
studyPlanSchema.virtual('tasks', {
  ref: 'StudyTask',
  localField: '_id',
  foreignField: 'planId',
});

// Calculate completion percentage
studyPlanSchema.methods.updateProgress = function() {
  if (this.totalTasks > 0) {
    this.completionPercentage = Math.round((this.completedTasks / this.totalTasks) * 100);
  } else {
    this.completionPercentage = 0;
  }
  
  // Auto-complete plan if all tasks done
  if (this.completionPercentage === 100 && this.status === 'active') {
    this.status = 'completed';
  }
};

// Update streak
studyPlanSchema.methods.updateStreak = function(completed) {
  if (completed) {
    this.currentStreak += 1;
    if (this.currentStreak > this.longestStreak) {
      this.longestStreak = this.currentStreak;
    }
  } else {
    this.currentStreak = 0;
  }
};

// Indexes for performance
studyPlanSchema.index({ userId: 1, status: 1 });
studyPlanSchema.index({ userId: 1, startDate: 1, endDate: 1 });
studyPlanSchema.index({ userId: 1, examDate: 1, examMode: 1 });
studyPlanSchema.index({ userId: 1, currentExamPhase: 1 });
studyPlanSchema.index({ createdAt: -1 });

// Transform for frontend
studyPlanSchema.methods.toJSON = function() {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  delete obj._id;
  delete obj.__v;
  return obj;
};

// Prevent model overwrite error in development
const StudyPlan = mongoose.models.StudyPlan || mongoose.model('StudyPlan', studyPlanSchema);

module.exports = StudyPlan;
