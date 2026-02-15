/**
 * User Behavior Profile Model
 * 
 * Stores learned patterns from task completion history for predictive scheduling.
 * Updated nightly by BehaviorLearningService.
 * 
 * @tier Tier-3 (Predictive Scheduling)
 * @performance Indexed on userId for fast lookup
 */

const mongoose = require('mongoose');

const UserBehaviorProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  
  // ===== TIME-OF-DAY PREFERENCES =====
  productivityPeakHours: [{
    type: Number,
    min: 0,
    max: 23
  }],
  
  completionRateByTimeSlot: {
    morning: { type: Number, default: 0, min: 0, max: 1 },    // 6AM-12PM
    afternoon: { type: Number, default: 0, min: 0, max: 1 },  // 12PM-6PM
    evening: { type: Number, default: 0, min: 0, max: 1 },    // 6PM-10PM
    night: { type: Number, default: 0, min: 0, max: 1 }       // 10PM-6AM
  },
  
  // ===== STUDY SESSION PATTERNS =====
  avgStudySessionMinutes: { 
    type: Number, 
    default: 60,
    min: 15,
    max: 180
  },
  
  preferredBreakDuration: { 
    type: Number, 
    default: 10,
    min: 5,
    max: 30
  },
  
  optimalTasksPerDay: { 
    type: Number, 
    default: 4,
    min: 1,
    max: 10
  },
  
  // ===== CONSISTENCY METRICS =====
  consistencyScore: { 
    type: Number, 
    default: 0.5, 
    min: 0, 
    max: 1 
  },
  
  weeklyCompletionRate: { 
    type: Number, 
    default: 0.7,
    min: 0,
    max: 1
  },
  
  streakReliability: { 
    type: Number, 
    default: 0.5,
    min: 0,
    max: 1
  },
  
  // ===== DURATION ESTIMATION ACCURACY =====
  durationEstimationError: { 
    type: Number, 
    default: 0.2,
    min: 0,
    max: 1
  },
  
  underestimationBias: { 
    type: Number, 
    default: 0,
    min: -1,
    max: 1
  },
  
  // ===== RESCHEDULING BEHAVIOR =====
  avgReschedulesPerWeek: { 
    type: Number, 
    default: 2,
    min: 0
  },
  
  reschedulingTrigger: {
    userManual: { type: Number, default: 0 },
    missedTasks: { type: Number, default: 0 },
    conflicts: { type: Number, default: 0 }
  },
  
  // ===== TOPIC PERFORMANCE =====
  topicDurationMap: {
    type: Map,
    of: {
      avgMinutes: Number,
      completionRate: Number,
      sampleSize: Number,
      lastUpdated: Date
    },
    default: new Map()
  },
  
  // ===== METADATA =====
  lastAnalyzedAt: { 
    type: Date, 
    default: Date.now,
    index: true
  },
  
  sampleSize: { 
    type: Number, 
    default: 0 
  },
  
  dataQualityScore: { 
    type: Number, 
    default: 0,
    min: 0,
    max: 1
  }
}, {
  timestamps: true
});

// ===== INDEXES =====
UserBehaviorProfileSchema.index({ userId: 1 });
UserBehaviorProfileSchema.index({ lastAnalyzedAt: -1 });
UserBehaviorProfileSchema.index({ consistencyScore: -1 });
UserBehaviorProfileSchema.index({ dataQualityScore: -1 });

// ===== INSTANCE METHODS =====

/**
 * Check if profile has enough data for reliable predictions
 * @returns {boolean}
 */
UserBehaviorProfileSchema.methods.isReliable = function() {
  return this.sampleSize >= 20 && this.dataQualityScore > 0.6;
};

/**
 * Get optimal time slot based on completion rates
 * @returns {string} 'morning' | 'afternoon' | 'evening' | 'night'
 */
UserBehaviorProfileSchema.methods.getOptimalSlot = function() {
  const slots = Object.entries(this.completionRateByTimeSlot.toObject())
    .sort(([, a], [, b]) => b - a);
  return slots[0]?.[0] || 'morning';
};

/**
 * Get estimated duration for a topic
 * @param {string} topic - Task topic
 * @param {number} defaultDuration - Fallback duration
 * @returns {number} Estimated duration in minutes
 */
UserBehaviorProfileSchema.methods.getTopicDuration = function(topic, defaultDuration = 60) {
  const topicData = this.topicDurationMap.get(topic);
  
  if (topicData && topicData.sampleSize >= 3) {
    return Math.round(topicData.avgMinutes);
  }
  
  return this.avgStudySessionMinutes || defaultDuration;
};

/**
 * Check if user is consistent enough for predictive scheduling
 * @returns {boolean}
 */
UserBehaviorProfileSchema.methods.isConsistent = function() {
  return this.consistencyScore >= 0.7 && this.sampleSize >= 30;
};

// ===== STATIC METHODS =====

/**
 * Get or create behavior profile for user
 * @param {ObjectId} userId
 * @returns {Promise<UserBehaviorProfile>}
 */
UserBehaviorProfileSchema.statics.getOrCreate = async function(userId) {
  let profile = await this.findOne({ userId });
  
  if (!profile) {
    profile = await this.create({ userId });
  }
  
  return profile;
};

/**
 * Get users needing behavior analysis (stale profiles)
 * @param {number} hoursSinceLastAnalysis - Default 24 hours
 * @returns {Promise<ObjectId[]>} Array of user IDs
 */
UserBehaviorProfileSchema.statics.getStaleProfiles = async function(hoursSinceLastAnalysis = 24) {
  const threshold = new Date(Date.now() - hoursSinceLastAnalysis * 60 * 60 * 1000);
  
  const profiles = await this.find({
    lastAnalyzedAt: { $lt: threshold }
  }).select('userId').lean();
  
  return profiles.map(p => p.userId);
};

/**
 * Get highly consistent users for A/B testing
 * @returns {Promise<ObjectId[]>}
 */
UserBehaviorProfileSchema.statics.getConsistentUsers = async function() {
  const profiles = await this.find({
    consistencyScore: { $gte: 0.8 },
    sampleSize: { $gte: 30 },
    dataQualityScore: { $gte: 0.7 }
  }).select('userId').lean();
  
  return profiles.map(p => p.userId);
};

module.exports = mongoose.models.UserBehaviorProfile || mongoose.model('UserBehaviorProfile', UserBehaviorProfileSchema);
