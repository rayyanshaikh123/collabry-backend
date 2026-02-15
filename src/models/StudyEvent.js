/**
 * StudyEvent - Calendar-native study session (single user)
 *
 * Used by the deterministic scheduler. Each event has fixed start/end
 * and optional flex window for rescheduling. No AI assigns these times;
 * the scheduler engine does.
 */

const mongoose = require('mongoose');

const studyEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudyPlan',
      required: true,
      index: true,
    },
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudyTask',
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: { type: String, trim: true, maxlength: 1000 },
    topic: { type: String, trim: true },

    // Required time bounds (set by scheduler)
    startTime: { type: Date, required: true, index: true },
    endTime: {
      type: Date,
      required: true,
      validate: { validator: function (v) { return v > this.startTime; }, message: 'endTime must be after startTime' },
    },

    // Optional flex window for reschedule (scheduler can move within this)
    flexWindowStart: { type: Date },
    flexWindowEnd: { type: Date },

    // Scoring and metadata (from strategy + scheduler)
    priorityScore: { type: Number, default: 0 },
    energyTag: { type: String, enum: ['low', 'medium', 'high', 'deep_work'], default: 'medium' },
    rescheduleCount: { type: Number, default: 0 },

    type: {
      type: String,
      enum: ['deep_work', 'practice', 'review', 'exam_prep', 'lecture', 'break', 'other'],
      default: 'deep_work',
    },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    deepWork: { type: Boolean, default: false },
    estimatedEffort: { type: Number, min: 1, max: 10 },

    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed', 'cancelled', 'missed', 'rescheduled'],
      default: 'pending',
      index: true,
    },
    completedAt: { type: Date },
    actualStartTime: { type: Date },
    actualEndTime: { type: Date },
    completionNotes: { type: String, trim: true, maxlength: 500 },

    resources: [{ title: String, url: String, type: { type: String, enum: ['video', 'article', 'pdf', 'quiz', 'practice', 'other'] } }],

    aiGenerated: { type: Boolean, default: false },
    generationRunId: { type: String },
    validationPassed: { type: Boolean, default: true },
    isLocked: { type: Boolean, default: false }, // academic block, not movable
  },
  { timestamps: true }
);

studyEventSchema.index({ userId: 1, startTime: 1 });
studyEventSchema.index({ userId: 1, planId: 1, startTime: 1 });
studyEventSchema.index({ planId: 1, startTime: 1 });

studyEventSchema.statics.findByDateRange = function (userId, startDate, endDate) {
  return this.find({
    userId,
    startTime: { $gte: new Date(startDate), $lte: new Date(endDate) },
    status: { $nin: ['cancelled'] },
  })
    .sort({ startTime: 1 })
    .lean();
};

studyEventSchema.methods.toCalendarObject = function () {
  return {
    id: this._id.toString(),
    title: this.title,
    startTime: this.startTime,
    endTime: this.endTime,
    topic: this.topic,
    type: this.type,
    difficulty: this.difficulty,
    priority: this.priority,
    status: this.status,
    isLocked: this.isLocked,
  };
};

const StudyEvent = mongoose.models.StudyEvent || mongoose.model('StudyEvent', studyEventSchema);
module.exports = StudyEvent;
