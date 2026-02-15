/**
 * BACKEND: SchedulingLog Model (NEW COLLECTION)
 * File: backend/src/models/SchedulingLog.js
 * 
 * Purpose: Audit trail for all scheduling operations
 * Use Cases:
 * 1. Track what the SchedulingService did (for debugging)
 * 2. Analytics: "User's tasks were rescheduled 5 times"
 * 3. Rollback capability: "Restore previous schedule"
 * 4. Performance metrics: "Auto-scheduling took 234ms"
 */

const mongoose = require('mongoose');

const schedulingLogSchema = new mongoose.Schema(
  {
    // === CONTEXT ===
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
    
    // === ACTION DETAILS ===
    action: {
      type: String,
      enum: [
        'auto_schedule',              // Ran full auto-scheduling
        'reschedule_task',            // Moved single task
        'resolve_conflict',           // Fixed overlapping tasks
        'handle_missed_task',         // Redistributed after skip
        'detect_conflicts',           // Ran conflict detection
        'update_task_slot',           // Manual time slot edit
      ],
      required: [true, 'Action is required'],
      index: true,
    },
    
    // === AFFECTED RESOURCES ===
    taskIds: [mongoose.Schema.Types.ObjectId],
    // Which tasks were affected by this action?
    
    // === EXECUTION DETAILS ===
    details: {
      type: mongoose.Schema.Types.Mixed,
      // Action-specific details:
      // auto_schedule: { tasksScheduled, slotsGenerated, dailyStudyHours }
      // reschedule_task: { reason, newStart, oldStart }
      // resolve_conflict: { conflictId, resolution }
      // detect_conflicts: { conflictsFound, severity }
    },
    
    // === RESULT STATUS ===
    success: {
      type: Boolean,
      required: true,
      index: true,
    },
    
    errorMessage: {
      type: String,
      // If success=false, what was the error?
    },
    
    // === PERFORMANCE METRICS ===
    executionTimeMs: {
      type: Number,
      // How long did this action take?
    },
    
    // === AUTOMATIC METADATA ===
    triggeredBy: {
      type: String,
      enum: [
        'user_action',          // User clicked "Schedule"
        'api_endpoint',         // Called via REST API
        'background_job',       // Automatic background task
        'conflict_detection',   // Triggered by conflict found
      ],
      default: 'api_endpoint',
    },
  },
  {
    timestamps: true,
  }
);

// ============================================================================
// INDEXES FOR AUDIT & ANALYTICS
// ============================================================================

// Query: "Show me all scheduling actions for this user"
schedulingLogSchema.index({ userId: 1, createdAt: -1 });

// Query: "What happened to this plan?"
schedulingLogSchema.index({ planId: 1, action: 1, createdAt: -1 });

// Query: "Show me failed actions needing attention"
schedulingLogSchema.index({ success: 1, createdAt: -1 });

// Query: "Show me slow operations (perf analysis)"
schedulingLogSchema.index({ executionTimeMs: -1 });

// Compound: Recent activity for plan
schedulingLogSchema.index({ planId: 1, createdAt: -1, action: 1 });

// ============================================================================
// VIRTUAL FIELDS
// ============================================================================

schedulingLogSchema.virtual('isSlow').get(function() {
  // > 1 second is considered slow
  return this.executionTimeMs > 1000;
});

schedulingLogSchema.virtual('isFailure').get(function() {
  return !this.success;
});

// ============================================================================
// STATICS FOR ANALYTICS
// ============================================================================

/**
 * Get summary stats for a plan
 */
schedulingLogSchema.statics.getPlanStats = async function(planId) {
  const logs = await this.find({ planId });
  
  return {
    totalActions: logs.length,
    successfulActions: logs.filter(l => l.success).length,
    failedActions: logs.filter(l => !l.success).length,
    avgExecutionTimeMs: logs.reduce((sum, l) => sum + (l.executionTimeMs || 0), 0) / logs.length,
    slowActionsCount: logs.filter(l => l.isSlow).length,
    actionBreakdown: {
      autoSchedule: logs.filter(l => l.action === 'auto_schedule').length,
      reschedule: logs.filter(l => l.action === 'reschedule_task').length,
      resolveConflict: logs.filter(l => l.action === 'resolve_conflict').length,
      handleMissed: logs.filter(l => l.action === 'handle_missed_task').length,
    },
  };
};

/**
 * Get summary stats for a user
 */
schedulingLogSchema.statics.getUserStats = async function(userId) {
  const logs = await this.find({ userId });
  
  return {
    totalActions: logs.length,
    successRate: logs.length > 0 ? (logs.filter(l => l.success).length / logs.length * 100).toFixed(1) : 0,
    avgExecutionTimeMs: logs.reduce((sum, l) => sum + (l.executionTimeMs || 0), 0) / logs.length || 0,
    plansScheduled: new Set(logs.map(l => l.planId.toString())).size,
    tasksAffected: logs.reduce((sum, l) => sum + (l.taskIds?.length || 0), 0),
  };
};

/**
 * Get recent failures
 */
schedulingLogSchema.statics.getRecentFailures = async function(userId, limitDays = 7) {
  const date = new Date();
  date.setDate(date.getDate() - limitDays);
  
  return this.find({
    userId,
    success: false,
    createdAt: { $gte: date },
  }).sort({ createdAt: -1 });
};

// ============================================================================
// JSON TRANSFORMATION
// ============================================================================

schedulingLogSchema.methods.toJSON = function() {
  const obj = this.toObject({ virtuals: true });
  obj.id = obj._id.toString();
  delete obj._id;
  delete obj.__v;
  return obj;
};

// ============================================================================
// MODEL CREATION
// ============================================================================

// Prevent model overwrite error in development
const SchedulingLog = mongoose.models.SchedulingLog || mongoose.model('SchedulingLog', schedulingLogSchema);

module.exports = SchedulingLog;
