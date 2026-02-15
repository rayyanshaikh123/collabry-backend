/**
 * Daily Study Stats Model
 * 
 * Precomputed daily aggregations for heatmap visualization.
 * Generated nightly by HeatmapAnalyticsService.
 * 
 * @tier Tier-2 (Study Heatmap)
 * @performance One record per user per day, indexed for fast range queries
 */

const mongoose = require('mongoose');

const DailyStudyStatsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  date: {
    type: Date,
    required: true,
    index: true
  },
  
  // ===== HEATMAP METRICS =====
  totalStudyMinutes: { 
    type: Number, 
    default: 0,
    min: 0
  },
  
  tasksCompleted: { 
    type: Number, 
    default: 0,
    min: 0
  },
  
  tasksMissed: { 
    type: Number, 
    default: 0,
    min: 0
  },
  
  focusSessionsCount: { 
    type: Number, 
    default: 0,
    min: 0
  },
  
  pomodorosCompleted: { 
    type: Number, 
    default: 0,
    min: 0
  },
  
  // ===== INTENSITY SCORE (for heatmap gradient) =====
  intensityScore: { 
    type: Number, 
    default: 0, 
    min: 0, 
    max: 100 
  },
  
  // ===== HOURLY BREAKDOWN =====
  hourlyBreakdown: [{
    hour: { 
      type: Number, 
      min: 0, 
      max: 23,
      required: true
    },
    minutesStudied: { 
      type: Number, 
      default: 0,
      min: 0
    },
    tasksCompleted: { 
      type: Number, 
      default: 0,
      min: 0
    }
  }],
  
  // ===== QUALITY METRICS =====
  avgTaskCompletion: { 
    type: Number, 
    default: 0,
    min: 0,
    max: 100
  },
  
  avgDifficultyRating: { 
    type: Number, 
    default: 0,
    min: 0,
    max: 5
  },
  
  avgUnderstandingLevel: { 
    type: Number, 
    default: 0,
    min: 0,
    max: 5
  },
  
  // ===== STREAKS =====
  isStreakDay: { 
    type: Boolean, 
    default: false 
  },
  
  // ===== METADATA =====
  precomputedAt: { 
    type: Date, 
    default: Date.now 
  }
}, {
  timestamps: false  // No need for createdAt/updatedAt
});

// ===== UNIQUE CONSTRAINT =====
// One record per user per day
DailyStudyStatsSchema.index({ userId: 1, date: 1 }, { unique: true });

// ===== COMPOUND INDEXES for efficient queries =====
DailyStudyStatsSchema.index({ userId: 1, date: -1 });
DailyStudyStatsSchema.index({ userId: 1, date: -1, intensityScore: -1 });
DailyStudyStatsSchema.index({ userId: 1, isStreakDay: 1, date: -1 });

// ===== INSTANCE METHODS =====

/**
 * Calculate intensity score based on multiple factors
 * Formula: (studyMinutes * 0.5) + (tasks * 10) + (pomodoros * 5)
 * Capped at 100
 */
DailyStudyStatsSchema.methods.calculateIntensity = function() {
  const score = Math.min(100, 
    (this.totalStudyMinutes * 0.5) + 
    (this.tasksCompleted * 10) + 
    (this.pomodorosCompleted * 5)
  );
  
  this.intensityScore = Math.round(score);
  return this.intensityScore;
};

/**
 * Get completion rate for the day
 * @returns {number} Percentage (0-100)
 */
DailyStudyStatsSchema.methods.getCompletionRate = function() {
  const total = this.tasksCompleted + this.tasksMissed;
  if (total === 0) return 0;
  
  return Math.round((this.tasksCompleted / total) * 100);
};

/**
 * Get most productive hour of the day
 * @returns {number|null} Hour (0-23) or null if no data
 */
DailyStudyStatsSchema.methods.getPeakHour = function() {
  if (!this.hourlyBreakdown || this.hourlyBreakdown.length === 0) {
    return null;
  }
  
  const sorted = [...this.hourlyBreakdown].sort((a, b) => 
    b.minutesStudied - a.minutesStudied
  );
  
  return sorted[0]?.hour;
};

// ===== STATIC METHODS =====

/**
 * Get heatmap data for date range
 * @param {ObjectId} userId
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<Array>}
 */
DailyStudyStatsSchema.statics.getHeatmapData = async function(userId, startDate, endDate) {
  return this.find({
    userId,
    date: { $gte: startDate, $lte: endDate }
  })
  .select('date intensityScore totalStudyMinutes tasksCompleted focusSessionsCount')
  .lean()
  .sort({ date: 1 });
};

/**
 * Get current streak for user
 * @param {ObjectId} userId
 * @returns {Promise<number>} Days in streak
 */
DailyStudyStatsSchema.statics.getCurrentStreak = async function(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let streak = 0;
  let currentDate = new Date(today);
  
  while (true) {
    const stat = await this.findOne({
      userId,
      date: currentDate,
      isStreakDay: true
    }).lean();
    
    if (!stat) break;
    
    streak++;
    currentDate.setDate(currentDate.getDate() - 1);
  }
  
  return streak;
};

/**
 * Get weekly summary
 * @param {ObjectId} userId
 * @param {Date} weekStart
 * @returns {Promise<Object>}
 */
DailyStudyStatsSchema.statics.getWeeklySummary = async function(userId, weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  
  const stats = await this.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        date: { $gte: weekStart, $lt: weekEnd }
      }
    },
    {
      $group: {
        _id: null,
        totalMinutes: { $sum: '$totalStudyMinutes' },
        totalTasks: { $sum: '$tasksCompleted' },
        totalMissed: { $sum: '$tasksMissed' },
        totalPomodoros: { $sum: '$pomodorosCompleted' },
        avgIntensity: { $avg: '$intensityScore' },
        daysStudied: { $sum: 1 }
      }
    }
  ]);
  
  return stats[0] || {
    totalMinutes: 0,
    totalTasks: 0,
    totalMissed: 0,
    totalPomodoros: 0,
    avgIntensity: 0,
    daysStudied: 0
  };
};

/**
 * Create or update stats for specific day
 * @param {ObjectId} userId
 * @param {Date} date
 * @param {Object} updates
 * @returns {Promise<DailyStudyStats>}
 */
DailyStudyStatsSchema.statics.upsertStats = async function(userId, date, updates) {
  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);
  
  const stats = await this.findOneAndUpdate(
    { userId, date: dateOnly },
    { 
      $set: {
        ...updates,
        precomputedAt: new Date()
      }
    },
    { 
      upsert: true, 
      new: true,
      setDefaultsOnInsert: true
    }
  );
  
  // Recalculate intensity score
  stats.calculateIntensity();
  await stats.save();
  
  return stats;
};

/**
 * Increment counters for specific day
 * @param {ObjectId} userId
 * @param {Date} date
 * @param {Object} increments
 * @returns {Promise<DailyStudyStats>}
 */
DailyStudyStatsSchema.statics.incrementStats = async function(userId, date, increments) {
  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);
  
  const stats = await this.findOneAndUpdate(
    { userId, date: dateOnly },
    { 
      $inc: increments,
      $set: { precomputedAt: new Date() }
    },
    { 
      upsert: true, 
      new: true,
      setDefaultsOnInsert: true
    }
  );
  
  stats.calculateIntensity();
  await stats.save();
  
  return stats;
};

module.exports = mongoose.models.DailyStudyStats || mongoose.model('DailyStudyStats', DailyStudyStatsSchema);
