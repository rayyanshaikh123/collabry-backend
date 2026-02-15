/**
 * BACKEND: Enhanced StudyTask Model with Time-Slot Support
 * File: backend/src/models/StudyTask.js
 * 
 * IMPORTANT: This is a COMPLETE REPLACEMENT for the existing StudyTask.js
 * It maintains full backward compatibility while adding time-slot fields.
 * 
 * Changes:
 * - Added timeSlotStart, timeSlotEnd (DateTime fields)
 * - Added schedulingMetadata object
 * - Added pre-save hook to compute endTime
 * - Added new compound indexes
 * - Kept ALL existing fields unchanged
 */

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
    
    // === CORE TASK FIELDS (UNCHANGED) ===
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
    
    // === EXISTING SCHEDULING (KEPT FOR BACKWARD COMPAT) ===
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
    
    // === NEW: TIME-SLOT FIELDS (SMART CALENDAR) ===
    timeSlotStart: {
      type: Date,
      index: true,
      // ISO format with time: "2026-02-11T09:00:00Z"
      // Auto-populated by SchedulingService or computed from scheduledTime
    },
    timeSlotEnd: {
      type: Date,
      index: true,
      // Computed: timeSlotStart + duration (milliseconds)
      // Pre-save hook calculates this automatically
    },
    
    // === NEW: SCHEDULING METADATA ===
    schedulingMetadata: {
      isAutoScheduled: {
        type: Boolean,
        default: false,
        // true if scheduled by SchedulingService (not user)
      },
      isRescheduled: {
        type: Boolean,
        default: false,
        // true if moved from original date
      },
      conflictFlag: {
        type: Boolean,
        default: false,
        // true if overlaps with another task
      },
      lastScheduledAt: {
        type: Date,
        // When SchedulingService last touched this task
      },
      conflictResolvedAt: {
        type: Date,
        // When conflict was last resolved
      },
      conflictCount: {
        type: Number,
        default: 0,
        // How many times this task conflicted
      },
    },
    
    // === EXISTING METADATA (UNCHANGED) ===
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
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed', 'skipped', 'rescheduled'],
      default: 'pending',
      index: true,
    },
    
    // === COMPLETION TRACKING (UNCHANGED) ===
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
    
    // === REMINDERS (UNCHANGED) ===
    reminderSent: {
      type: Boolean,
      default: false,
    },
    reminderTime: {
      type: Date,
    },
    
    // === RESCHEDULING TRACKING (UNCHANGED) ===
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
    
    // === ORDERING (UNCHANGED) ===
    order: {
      type: Number,
      default: 0,
    },
    
    // === TIER-2/3 FEATURES ===
    // Notebook Deep Linking (Tier-3)
    linkedNotebookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Notebook',
      index: true
    },
    linkedArtifact: {
      type: String,
      category: { 
        type: String, 
        enum: ['pdf', 'quiz', 'flashcard', 'mindmap', 'note'] 
      }
    },
    
    // Behavior Metadata (Tier-3)
    behaviorMetadata: {
      estimatedDuration: Number,
      historicalAvgDuration: Number,
      optimalTimeOfDay: { 
        type: String, 
        enum: ['morning', 'afternoon', 'evening', 'night'] 
      },
      userEfficiencyFactor: { type: Number, default: 1.0 },
      lastDurationUpdate: Date
    },
    
    // Exam Priority Weighting (Tier-2)
    examProximityScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    
    // Enhanced Rescheduling History (Tier-2)
    reschedulingHistory: [{
      timestamp: Date,
      reason: { 
        type: String, 
        enum: ['user_manual', 'missed_task', 'conflict', 'adaptive_engine'] 
      },
      oldSlot: Date,
      newSlot: Date,
      triggeredBy: String
    }],
    
    // === SOFT DELETE (UNCHANGED) ===
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

// ============================================================================
// INDEXES FOR TIME-SLOT PERFORMANCE
// ============================================================================

// Query: Get all tasks in date range for calendar view
studyTaskSchema.index({ userId: 1, timeSlotStart: 1, timeSlotEnd: 1 });

// Query: Get all tasks for a day (backward compat + new)
studyTaskSchema.index({ userId: 1, scheduledDate: 1, timeSlotStart: 1 });

// Query: Find conflicts efficiently
studyTaskSchema.index({ 
  userId: 1, 
  'schedulingMetadata.conflictFlag': 1, 
  scheduledDate: 1 
});

// Tier-2/3 Indexes
studyTaskSchema.index({ userId: 1, linkedNotebookId: 1 });
studyTaskSchema.index({ userId: 1, examProximityScore: -1, timeSlotStart: 1 });
studyTaskSchema.index({ userId: 1, 'behaviorMetadata.optimalTimeOfDay': 1 });
studyTaskSchema.index({ userId: 1, status: 1, completedAt: -1 });

// Keep existing indexes
studyTaskSchema.index({ planId: 1, status: 1 });
studyTaskSchema.index({ userId: 1, scheduledDate: 1 });
studyTaskSchema.index({ userId: 1, status: 1, scheduledDate: 1 });
studyTaskSchema.index({ createdAt: -1 });

// ============================================================================
// VIRTUAL FIELDS (Computed, not stored)
// ============================================================================

studyTaskSchema.virtual('isOverdue').get(function() {
  if (this.status === 'completed') return false;
  const now = new Date();
  const taskDate = new Date(this.timeSlotStart || this.scheduledDate);
  return now > taskDate;
});

studyTaskSchema.virtual('isToday').get(function() {
  const today = new Date();
  const taskDate = new Date(this.timeSlotStart || this.scheduledDate);
  return today.toDateString() === taskDate.toDateString();
});

// ============================================================================
// METHODS
// ============================================================================

studyTaskSchema.methods.markCompleted = function(notes, actualDuration) {
  this.status = 'completed';
  this.completedAt = new Date();
  if (notes) this.completionNotes = notes;
  if (actualDuration) this.actualDuration = actualDuration;
};

studyTaskSchema.methods.reschedule = function(newDate, reason) {
  if (!this.originalDate) {
    this.originalDate = this.scheduledDate;
  }
  this.scheduledDate = newDate;
  this.status = 'rescheduled';
  this.rescheduledCount += 1;
  if (reason) this.rescheduledReason = reason;
};

// ============================================================================
// PRE-SAVE HOOKS
// ============================================================================

/**
 * Auto-compute timeSlotEnd from timeSlotStart + duration
 * Auto-populate scheduledTime from timeSlotStart if available
 * Maintain backward compatibility
 */
studyTaskSchema.pre('save', function(next) {
  try {
    // 1. If we have timeSlotStart, compute timeSlotEnd
    if (this.timeSlotStart && this.duration) {
      this.timeSlotEnd = new Date(this.timeSlotStart.getTime() + this.duration * 60 * 1000);
    }
    
    // 2. Auto-populate scheduledTime from timeSlotStart (if not already set)
    if (this.timeSlotStart && !this.scheduledTime) {
      const hours = String(this.timeSlotStart.getHours()).padStart(2, '0');
      const minutes = String(this.timeSlotStart.getMinutes()).padStart(2, '0');
      this.scheduledTime = `${hours}:${minutes}`;
    }
    
    // 3. Validate: timeSlotStart cannot be in the past (except for completed tasks)
    if (this.timeSlotStart && this.status !== 'completed' && this.status !== 'skipped') {
      const now = new Date();
      // Allow up to 1 hour in the past (in case of time sync issues)
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      if (this.timeSlotStart < oneHourAgo) {
        console.warn(`[StudyTask] Warning: timeSlotStart is in the past for task ${this._id}`);
      }
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// JSON TRANSFORMATION
// ============================================================================

studyTaskSchema.methods.toJSON = function() {
  const obj = this.toObject({ virtuals: true });
  obj.id = obj._id.toString();
  delete obj._id;
  delete obj.__v;
  return obj;
};

// ============================================================================
// MODEL CREATION
// ============================================================================

// Prevent model overwrite error in development with hot-reloading
const StudyTask = mongoose.models.StudyTask || mongoose.model('StudyTask', studyTaskSchema);

module.exports = StudyTask;
