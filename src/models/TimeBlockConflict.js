/**
 * BACKEND: TimeBlockConflict Model (NEW COLLECTION)
 * File: backend/src/models/TimeBlockConflict.js
 * 
 * Purpose: Audit trail for task scheduling conflicts
 * Stores: Which tasks conflict, overlap duration, resolution attempts
 * 
 * Use Cases:
 * 1. Display conflict warnings to user
 * 2. Track auto-resolution success rate
 * 3. Identify problem time slots (peak conflict zones)
 * 4. Generate analytics: "This user has 40% conflict rate"
 */

const mongoose = require('mongoose');

const timeBlockConflictSchema = new mongoose.Schema(
  {
    // === FOREIGN KEYS ===
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudyPlan',
      required: [true, 'Plan ID is required'],
      index: true,
    },
    task1Id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudyTask',
      required: [true, 'First task ID is required'],
      index: true,
    },
    task2Id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudyTask',
      required: [true, 'Second task ID is required'],
      index: true,
    },
    
    // === CONFLICT DETAILS ===
    conflictType: {
      type: String,
      enum: [
        'direct_overlap',      // Both tasks at exact same time
        'partial_overlap',     // Tasks overlap partially
        'edge_case',           // Tasks touch at boundary (minute-level precision issue)
        'hard_constraint',     // User has constraint (time zone, travel time, etc)
      ],
      default: 'partial_overlap',
    },
    
    overlappingMinutes: {
      type: Number,
      required: true,
      // How many minutes do they overlap?
      // Example: task1=9-10am (60min), task2=9:30-10:30am (60min) => overlap=30min
    },
    
    overlapStartTime: {
      type: Date,
      // ISO datetime when overlap begins
    },
    overlapEndTime: {
      type: Date,
      // ISO datetime when overlap ends
    },
    
    // === RESOLUTION TRACKING ===
    resolutionStatus: {
      type: String,
      enum: [
        'detected',           // Found, not yet handled
        'user_notified',      // Notification sent, awaiting user action
        'auto_resolved',      // SchedulingService fixed it
        'user_resolved',      // User manually fixed it
        'accepted',           // User acknowledged and accepted conflict
        'ignored',            // User dismissed warning
      ],
      default: 'detected',
      index: true,
    },
    
    resolutionAttemptCount: {
      type: Number,
      default: 0,
      // How many times did SchedulingService try to auto-resolve?
    },
    
    lastResolutionAttemptAt: {
      type: Date,
      // When was last resolution attempt?
    },
    
    resolutionDetails: {
      action: String,       // What action was taken? "moved_task2_to_2pm", "split_into_two_sessions", etc
      affectedTasks: [mongoose.Schema.Types.ObjectId],  // Which tasks were modified?
      success: Boolean,     // Did resolution work?
      message: String,      // Human-readable result
    },
    
    // === PRIORITY & IMPACT ===
    severity: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
      // "low" = 5 min overlap, "medium" = 15 min, "high" = 30+ min overlap
    },
    
    taskPriorityConflict: {
      type: String,
      // If both tasks are "urgent", severity is higher
      // Values: "both_urgent", "one_urgent", "neither_urgent", "different_schedules"
    },
    
    // === METADATA ===
    detectedAt: {
      type: Date,
      default: Date.now,
      // When was this conflict first detected?
    },
    
    detectedBy: {
      type: String,
      enum: ['auto_schedule', 'manual_reschedule', 'user_edit', 'system_check'],
      default: 'auto_schedule',
      // What operation detected this conflict?
    },
    
    // === FOR FUTURE: Why did it happen? ===
    rootCause: {
      type: String,
      // "user_override", "ai_plan_error", "manual_entry_error", "daylight_savings", etc
    },
  },
  {
    timestamps: true,
  }
);

// ============================================================================
// INDEXES FOR QUERY PERFORMANCE
// ============================================================================

// Query: "Get all conflicts for this user"
timeBlockConflictSchema.index({ userId: 1, detectedAt: -1 });

// Query: "Get unresolved conflicts"
timeBlockConflictSchema.index({ userId: 1, resolutionStatus: 1, detectedAt: -1 });

// Query: "Get conflicts for this plan"
timeBlockConflictSchema.index({ planId: 1, resolutionStatus: 1 });

// Query: "Is task1 conflicting with anything?"
timeBlockConflictSchema.index({ task1Id: 1, resolutionStatus: 1 });
timeBlockConflictSchema.index({ task2Id: 1, resolutionStatus: 1 });

// Query: "Show me high-severity unresolved conflicts"
timeBlockConflictSchema.index({ userId: 1, severity: 1, resolutionStatus: 1 });

// Compound: Detect if SAME conflict exists (prevents duplicates)
timeBlockConflictSchema.index({ task1Id: 1, task2Id: 1, detectedAt: -1 });

// Keep existing tasks index
timeBlockConflictSchema.index({ createdAt: -1 });

// ============================================================================
// VIRTUAL FIELDS
// ============================================================================

timeBlockConflictSchema.virtual('isResolved').get(function() {
  return ['auto_resolved', 'user_resolved', 'accepted'].includes(this.resolutionStatus);
});

timeBlockConflictSchema.virtual('isPending').get(function() {
  return ['detected', 'user_notified'].includes(this.resolutionStatus);
});

timeBlockConflictSchema.virtual('hoursUntilOverlap').get(function() {
  if (!this.overlapStartTime) return null;
  const now = new Date();
  const diffMs = this.overlapStartTime - now;
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60)));
});

// ============================================================================
// METHODS
// ============================================================================

/**
 * Mark conflict as resolved via auto-resolution
 */
timeBlockConflictSchema.methods.markAutoResolved = function(action, affectedTasks, message) {
  this.resolutionStatus = 'auto_resolved';
  this.resolutionAttemptCount += 1;
  this.lastResolutionAttemptAt = new Date();
  this.resolutionDetails = {
    action: action || 'rescheduled',
    affectedTasks: affectedTasks || [],
    success: true,
    message: message || 'Conflict automatically resolved',
  };
};

/**
 * Mark conflict as accepted by user (won't auto-resolve)
 */
timeBlockConflictSchema.methods.markAccepted = function(message) {
  this.resolutionStatus = 'accepted';
  this.resolutionDetails = {
    action: 'user_accepted_conflict',
    success: true,
    message: message || 'User acknowledged conflict',
  };
};

/**
 * Update severity based on overlap minutes
 */
timeBlockConflictSchema.methods.updateSeverity = function() {
  if (this.overlappingMinutes >= 30) {
    this.severity = 'high';
  } else if (this.overlappingMinutes >= 15) {
    this.severity = 'medium';
  } else {
    this.severity = 'low';
  }
};

// ============================================================================
// JSON TRANSFORMATION
// ============================================================================

timeBlockConflictSchema.methods.toJSON = function() {
  const obj = this.toObject({ virtuals: true });
  obj.id = obj._id.toString();
  delete obj._id;
  delete obj.__v;
  return obj;
};

// ============================================================================
// MODEL CREATION
// ============================================================================

const TimeBlockConflict = mongoose.model('TimeBlockConflict', timeBlockConflictSchema);

module.exports = TimeBlockConflict;
