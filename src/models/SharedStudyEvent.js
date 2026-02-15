/**
 * Shared Study Event Model
 * 
 * Enables collaborative group study sessions across multiple users.
 * Handles cross-user conflict detection and real-time synchronization.
 * 
 * @tier Tier-3 (Collaborative Time Blocks)
 * @performance Indexed on participants and time ranges
 */

const mongoose = require('mongoose');

const SharedStudyEventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Event title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  
  // ===== OWNERSHIP =====
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // ===== PARTICIPANTS =====
  participants: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'tentative'],
      default: 'pending'
    },
    respondedAt: Date,
    joinedAt: Date
  }],
  
  // ===== TIMING =====
  startTime: {
    type: Date,
    required: [true, 'Start time is required'],
    index: true
  },
  
  endTime: {
    type: Date,
    required: [true, 'End time is required'],
    validate: {
      validator: function(v) {
        return v > this.startTime;
      },
      message: 'End time must be after start time'
    }
  },
  
  timezone: {
    type: String,
    default: 'UTC'
  },
  
  // ===== LINKED RESOURCES =====
  linkedNotebookId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Notebook'
  },
  
  linkedPlanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudyPlan'
  },
  
  // ===== SETTINGS =====
  maxParticipants: { 
    type: Number, 
    default: 10,
    min: 2,
    max: 50
  },
  
  isPublic: { 
    type: Boolean, 
    default: false 
  },
  
  allowInvites: { 
    type: Boolean, 
    default: true 
  },
  
  requireApproval: {
    type: Boolean,
    default: false
  },
  
  // ===== CONFLICT TRACKING =====
  hasConflicts: { 
    type: Boolean, 
    default: false,
    index: true
  },
  
  conflictDetails: [{
    userId: mongoose.Schema.Types.ObjectId,
    conflictingTaskId: mongoose.Schema.Types.ObjectId,
    conflictType: {
      type: String,
      enum: ['time_overlap', 'double_booking', 'rest_period_violation']
    },
    detectedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // ===== STATUS =====
  status: {
    type: String,
    enum: ['scheduled', 'in_progress', 'completed', 'cancelled'],
    default: 'scheduled',
    index: true
  },
  
  // ===== MEETING INFO =====
  meetingLink: String,
  meetingPlatform: {
    type: String,
    enum: ['zoom', 'teams', 'meet', 'discord', 'other']
  },
  
  // ===== METADATA =====
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  lastSyncedAt: Date
}, {
  timestamps: true
});

// ===== INDEXES =====
SharedStudyEventSchema.index({ 'participants.userId': 1, startTime: 1 });
SharedStudyEventSchema.index({ ownerId: 1, status: 1 });
SharedStudyEventSchema.index({ startTime: 1, endTime: 1 });
SharedStudyEventSchema.index({ status: 1, startTime: 1 });
SharedStudyEventSchema.index({ hasConflicts: 1, status: 1 });

// ===== INSTANCE METHODS =====

/**
 * Check for conflicts across all participant calendars
 * @returns {Promise<Array>} Array of conflict details
 */
SharedStudyEventSchema.methods.checkCrossUserConflicts = async function() {
  const StudyTask = mongoose.model('StudyTask');
  const conflicts = [];
  
  for (const participant of this.participants) {
    if (participant.status === 'declined') continue;
    
    // Find overlapping tasks
    const overlappingTasks = await StudyTask.find({
      userId: participant.userId,
      timeSlotStart: { $lt: this.endTime },
      timeSlotEnd: { $gt: this.startTime },
      status: { $in: ['pending', 'in-progress'] }
    }).lean();
    
    if (overlappingTasks.length > 0) {
      conflicts.push({
        userId: participant.userId,
        conflictingTaskId: overlappingTasks[0]._id,
        conflictType: 'time_overlap',
        detectedAt: new Date()
      });
    }
  }
  
  this.conflictDetails = conflicts;
  this.hasConflicts = conflicts.length > 0;
  
  return conflicts;
};

/**
 * Add participant to event
 * @param {ObjectId} userId
 * @returns {Promise<SharedStudyEvent>}
 */
SharedStudyEventSchema.methods.addParticipant = async function(userId) {
  // Check if already a participant
  const exists = this.participants.some(p => 
    p.userId.equals(userId)
  );
  
  if (exists) {
    throw new Error('User is already a participant');
  }
  
  // Check max participants
  if (this.participants.length >= this.maxParticipants) {
    throw new Error('Event has reached maximum participants');
  }
  
  this.participants.push({
    userId,
    status: this.requireApproval ? 'pending' : 'accepted',
    respondedAt: this.requireApproval ? null : new Date()
  });
  
  await this.save();
  return this;
};

/**
 * Update participant status
 * @param {ObjectId} userId
 * @param {string} status - 'accepted' | 'declined' | 'tentative'
 * @returns {Promise<SharedStudyEvent>}
 */
SharedStudyEventSchema.methods.updateParticipantStatus = async function(userId, status) {
  const participant = this.participants.find(p => 
    p.userId.equals(userId)
  );
  
  if (!participant) {
    throw new Error('User is not a participant');
  }
  
  participant.status = status;
  participant.respondedAt = new Date();
  
  if (status === 'accepted') {
    participant.joinedAt = new Date();
  }
  
  await this.save();
  return this;
};

/**
 * Get accepted participants count
 * @returns {number}
 */
SharedStudyEventSchema.methods.getAcceptedCount = function() {
  return this.participants.filter(p => p.status === 'accepted').length;
};

/**
 * Check if event is full
 * @returns {boolean}
 */
SharedStudyEventSchema.methods.isFull = function() {
  return this.getAcceptedCount() >= this.maxParticipants;
};

/**
 * Check if user is participant
 * @param {ObjectId} userId
 * @returns {boolean}
 */
SharedStudyEventSchema.methods.isParticipant = function(userId) {
  return this.participants.some(p => p.userId.equals(userId));
};

/**
 * Get event duration in minutes
 * @returns {number}
 */
SharedStudyEventSchema.methods.getDuration = function() {
  return Math.round((this.endTime - this.startTime) / (1000 * 60));
};

// ===== STATIC METHODS =====

/**
 * Get upcoming events for user
 * @param {ObjectId} userId
 * @param {number} days - Look ahead days
 * @returns {Promise<Array>}
 */
SharedStudyEventSchema.statics.getUpcomingForUser = async function(userId, days = 7) {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + days);
  
  return this.find({
    'participants.userId': userId,
    startTime: { $gte: new Date(), $lte: endDate },
    status: { $in: ['scheduled', 'in_progress'] }
  })
  .populate('ownerId', 'name email')
  .populate('participants.userId', 'name email')
  .populate('linkedNotebookId', 'title')
  .sort({ startTime: 1 })
  .lean();
};

/**
 * Get events with unresolved conflicts
 * @param {ObjectId} userId - Optional: filter by user
 * @returns {Promise<Array>}
 */
SharedStudyEventSchema.statics.getConflictingEvents = async function(userId = null) {
  const query = {
    hasConflicts: true,
    status: 'scheduled'
  };
  
  if (userId) {
    query['participants.userId'] = userId;
  }
  
  return this.find(query)
    .populate('ownerId', 'name email')
    .populate('conflictDetails.userId', 'name email')
    .sort({ startTime: 1 })
    .lean();
};

/**
 * Find overlapping events for users
 * @param {Array<ObjectId>} userIds
 * @param {Date} startTime
 * @param {Date} endTime
 * @returns {Promise<Array>}
 */
SharedStudyEventSchema.statics.findOverlappingEvents = async function(userIds, startTime, endTime) {
  return this.find({
    'participants.userId': { $in: userIds },
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
    status: { $in: ['scheduled', 'in_progress'] }
  }).lean();
};

/**
 * Cancel event and notify participants
 * @param {ObjectId} eventId
 * @param {string} reason
 * @returns {Promise<SharedStudyEvent>}
 */
SharedStudyEventSchema.statics.cancelEvent = async function(eventId, reason = '') {
  const event = await this.findById(eventId);
  
  if (!event) {
    throw new Error('Event not found');
  }
  
  event.status = 'cancelled';
  await event.save();
  
  // Emit event for notification service
  const eventEmitter = require('../utils/eventEmitter');
  eventEmitter.emit('collaborative.event.cancelled', {
    eventId,
    participants: event.participants,
    reason
  });
  
  return event;
};

module.exports = mongoose.models.SharedStudyEvent || mongoose.model('SharedStudyEvent', SharedStudyEventSchema);
