/**
 * Behavior Learning Service
 * 
 * Analyzes user behavior patterns to enable predictive scheduling.
 * Learns productivity peaks, completion rates, topic-specific durations.
 * 
 * @tier Tier-3 (Machine Learning / Predictive Scheduling)
 */

const mongoose = require('mongoose');
const UserBehaviorProfile = require('../models/UserBehaviorProfile');
const DailyStudyStats = require('../models/DailyStudyStats');
const StudyTask = require('../models/StudyTask.ENHANCED');
const FocusSession = require('../models/FocusSession');
const logger = require('../utils/logger');
const eventEmitter = require('../utils/eventEmitter');

class BehaviorLearningService {
  /**
   * Minimum samples required for reliable predictions
   */
  MIN_SAMPLES = 20;
  MIN_TOPIC_SAMPLES = 5;
  
  /**
   * Main analysis: Learn user patterns from historical data
   * 
   * Should run nightly via cron job
   * 
   * @param {ObjectId} userId
   * @returns {Promise<Object>} Analysis results
   */
  async analyzeUserBehavior(userId) {
    const startTime = Date.now();
    
    try {
      logger.info(`[BehaviorLearning] Starting analysis for user=${userId}`);
      
      // Get profile or create new
      let profile = await UserBehaviorProfile.findOne({ userId });
      if (!profile) {
        profile = await UserBehaviorProfile.create({ userId });
      }
      
      // 1. Analyze productivity peak hours
      const peakHours = await this._analyzePeakHours(userId);
      
      // 2. Analyze completion rates by time slot
      const completionRates = await this._analyzeCompletionRates(userId);
      
      // 3. Analyze average session durations
      const sessionDurations = await this._analyzeSessionDurations(userId);
      
      // 4. Analyze topic-specific durations
      const topicDurations = await this._analyzeTopicDurations(userId);
      
      // 5. Calculate consistency score (streak-based)
      const consistencyScore = await this._calculateConsistency(userId);
      
      // 6. Calculate data quality (enough samples?)
      const dataQuality = await this._assessDataQuality(userId);
      
      // Update profile
      profile.productivityPeakHours = peakHours;
      profile.completionRateByTimeSlot = completionRates;
      profile.avgStudySessionMinutes = sessionDurations.average;
      profile.topicDurationMap = topicDurations;
      profile.consistencyScore = consistencyScore;
      profile.dataQualityScore = dataQuality.score;
      profile.totalTasksSampled = dataQuality.totalTasks;
      profile.lastAnalyzedAt = new Date();
      
      await profile.save();
      
      const executionTime = Date.now() - startTime;
      logger.info(`[BehaviorLearning] Analysis complete in ${executionTime}ms: quality=${dataQuality.score}, consistency=${consistencyScore}`);
      
      // Emit event if profile is now reliable
      if (profile.isReliable() && dataQuality.totalTasks >= this.MIN_SAMPLES) {
        eventEmitter.emit('behavior.profile.reliable', {
          userId,
          profile: profile.toObject()
        });
      }
      
      return {
        success: true,
        peakHours,
        completionRates,
        avgSessionMinutes: sessionDurations.average,
        topicCount: topicDurations.size,
        consistencyScore,
        dataQuality,
        executionTimeMs: executionTime
      };
      
    } catch (error) {
      logger.error(`[BehaviorLearning] Error: ${error.message}`, error);
      throw error;
    }
  }
  
  /**
   * Estimate task duration based on learned patterns
   * 
   * @param {ObjectId} userId
   * @param {string} topic - Task topic
   * @param {number} estimatedMinutes - AI/user estimate
   * @returns {Promise<number>} Adjusted duration in minutes
   */
  async estimateTaskDuration(userId, topic, estimatedMinutes) {
    const profile = await UserBehaviorProfile.findOne({ userId });
    
    // Not enough data - use estimate as-is
    if (!profile || !profile.isReliable()) {
      return estimatedMinutes;
    }
    
    // Check if we have topic-specific data
    const historicalDuration = profile.getTopicDuration(topic);
    
    if (historicalDuration) {
      // Blend: 70% historical, 30% estimate
      const adjusted = Math.round(historicalDuration * 0.7 + estimatedMinutes * 0.3);
      logger.debug(`[BehaviorLearning] Duration adjusted: ${estimatedMinutes}m → ${adjusted}m (topic=${topic})`);
      return adjusted;
    }
    
    // Use average session duration as fallback
    return Math.round(profile.avgStudySessionMinutes);
  }
  
  /**
   * Get optimal scheduling slot for a user
   * 
   * @param {ObjectId} userId
   * @returns {Promise<Object>} { timeSlot: string, confidence: number }
   */
  async getOptimalSlot(userId) {
    const profile = await UserBehaviorProfile.findOne({ userId });
    
    if (!profile || !profile.isReliable()) {
      return {
        timeSlot: 'morning', // Default
        confidence: 0
      };
    }
    
    const optimalSlot = profile.getOptimalSlot();
    const completionRate = profile.completionRateByTimeSlot.get(optimalSlot) || 0;
    
    return {
      timeSlot: optimalSlot,
      confidence: completionRate
    };
  }
  
  /**
   * Calculate user efficiency factor (used in adaptive scheduling)
   * 
   * @param {ObjectId} userId
   * @param {string} topic
   * @returns {Promise<number>} Factor 0.5-1.5 (1.0 = normal)
   */
  async calculateEfficiencyFactor(userId, topic) {
    const profile = await UserBehaviorProfile.findOne({ userId });
    
    if (!profile || !profile.isReliable()) {
      return 1.0; // Neutral
    }
    
    // Get topic-specific completion rate
    const topicDuration = profile.getTopicDuration(topic);
    const avgDuration = profile.avgStudySessionMinutes;
    
    if (!topicDuration) return 1.0;
    
    // Faster than average = higher efficiency
    // Slower than average = lower efficiency
    const efficiency = avgDuration / topicDuration;
    
    // Clamp to [0.5, 1.5]
    return Math.min(1.5, Math.max(0.5, efficiency));
  }
  
  // ============================================================
  // PRIVATE ANALYSIS METHODS
  // ============================================================
  
  /**
   * Find hours of day with highest productivity
   */
  async _analyzePeakHours(userId) {
    const completedTasks = await StudyTask.find({
      userId,
      status: 'completed',
      completedAt: { $exists: true }
    }).lean();
    
    if (completedTasks.length < this.MIN_SAMPLES) {
      return [9, 10, 11]; // Default morning hours
    }
    
    // Count completions by hour
    const hourlyCompletions = new Array(24).fill(0);
    
    for (const task of completedTasks) {
      const hour = new Date(task.completedAt).getHours();
      hourlyCompletions[hour]++;
    }
    
    // Find top 3 hours
    const hoursWithCounts = hourlyCompletions
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    
    return hoursWithCounts.map(h => h.hour).sort((a, b) => a - b);
  }
  
  /**
   * Analyze completion rates by time slot (morning/afternoon/evening)
   */
  async _analyzeCompletionRates(userId) {
    const tasks = await StudyTask.find({
      userId,
      timeSlotStart: { $exists: true }
    }).lean();
    
    if (tasks.length < this.MIN_SAMPLES) {
      return new Map([
        ['morning', 0.7],
        ['afternoon', 0.65],
        ['evening', 0.6],
        ['night', 0.5]
      ]);
    }
    
    const slotStats = {
      morning: { completed: 0, total: 0 },
      afternoon: { completed: 0, total: 0 },
      evening: { completed: 0, total: 0 },
      night: { completed: 0, total: 0 }
    };
    
    for (const task of tasks) {
      const hour = new Date(task.timeSlotStart).getHours();
      
      let slot;
      if (hour >= 8 && hour < 12) slot = 'morning';
      else if (hour >= 12 && hour < 17) slot = 'afternoon';
      else if (hour >= 17 && hour < 22) slot = 'evening';
      else slot = 'night';
      
      slotStats[slot].total++;
      if (task.status === 'completed') {
        slotStats[slot].completed++;
      }
    }
    
    const rates = new Map();
    for (const [slot, stats] of Object.entries(slotStats)) {
      const rate = stats.total > 0 ? stats.completed / stats.total : 0.5;
      rates.set(slot, rate);
    }
    
    return rates;
  }
  
  /**
   * Analyze average study session durations
   */
  async _analyzeSessionDurations(userId) {
    const sessions = await FocusSession.find({
      userId,
      sessionStatus: 'completed',
      actualDurationMinutes: { $gt: 0 }
    })
    .limit(100) // Recent 100 sessions
    .lean();
    
    if (sessions.length === 0) {
      return { average: 45, min: 15, max: 90 }; // Defaults
    }
    
    const durations = sessions.map(s => s.actualDurationMinutes);
    const sum = durations.reduce((a, b) => a + b, 0);
    const average = Math.round(sum / durations.length);
    const min = Math.min(...durations);
    const max = Math.max(...durations);
    
    return { average, min, max };
  }
  
  /**
   * Analyze topic-specific average durations
   */
  async _analyzeTopicDurations(userId) {
    const completedTasks = await StudyTask.find({
      userId,
      status: 'completed',
      completedAt: { $exists: true },
      topic: { $exists: true, $ne: '' }
    })
    .select('topic duration')
    .lean();
    
    const topicMap = new Map();
    const topicCounts = new Map();
    
    for (const task of completedTasks) {
      const topic = task.topic.toLowerCase().trim();
      if (!topic) continue;
      
      if (!topicMap.has(topic)) {
        topicMap.set(topic, 0);
        topicCounts.set(topic, 0);
      }
      
      topicMap.set(topic, topicMap.get(topic) + task.duration);
      topicCounts.set(topic, topicCounts.get(topic) + 1);
    }
    
    // Calculate averages
    const topicDurations = new Map();
    for (const [topic, totalDuration] of topicMap) {
      const count = topicCounts.get(topic);
      if (count >= this.MIN_TOPIC_SAMPLES) {
        topicDurations.set(topic, Math.round(totalDuration / count));
      }
    }
    
    return topicDurations;
  }
  
  /**
   * Calculate consistency score based on streaks
   */
  async _calculateConsistency(userId) {
    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);
    
    const stats = await DailyStudyStats.find({
      userId,
      date: { $gte: last30Days }
    })
    .sort({ date: 1 })
    .lean();
    
    if (stats.length < 7) {
      return 0; // Not enough data
    }
    
    // Check how many days user studied
    const studyDays = stats.filter(s => s.totalStudyMinutes > 0).length;
    const totalDays = stats.length;
    
    // Base score: percentage of days studied
    let score = (studyDays / totalDays) * 70; // Max 70 points
    
    // Streak bonus (up to 30 points)
    const currentStreak = await DailyStudyStats.getCurrentStreak(userId);
    score += Math.min(30, currentStreak * 2);
    
    return Math.min(100, Math.round(score));
  }
  
  /**
   * Assess data quality (do we have enough samples?)
   */
  async _assessDataQuality(userId) {
    const totalTasks = await StudyTask.countDocuments({ userId });
    const completedTasks = await StudyTask.countDocuments({ 
      userId, 
      status: 'completed' 
    });
    
    const focusSessions = await FocusSession.countDocuments({ 
      userId,
      sessionStatus: 'completed'
    });
    
    // Calculate quality score
    let score = 0;
    
    if (totalTasks >= this.MIN_SAMPLES) score += 40;
    else score += (totalTasks / this.MIN_SAMPLES) * 40;
    
    if (completedTasks >= 10) score += 30;
    else score += (completedTasks / 10) * 30;
    
    if (focusSessions >= 10) score += 30;
    else score += (focusSessions / 10) * 30;
    
    return {
      score: Math.round(score),
      totalTasks,
      completedTasks,
      focusSessions,
      isReliable: score >= 75
    };
  }
  
  /**
   * Batch analyze multiple users (for cron job)
   * 
   * @param {Array<ObjectId>} userIds - Array of user IDs or empty for all
   * @returns {Promise<Object>} Results summary
   */
  async batchAnalyze(userIds = null) {
    const startTime = Date.now();
    
    try {
      // Get all users if not specified
      if (!userIds || userIds.length === 0) {
        const User = require('../models/User');
        const users = await User.find({}, '_id').lean();
        userIds = users.map(u => u._id);
      }
      
      logger.info(`[BehaviorLearning] Starting batch analysis for ${userIds.length} users`);
      
      const results = {
        total: userIds.length,
        analyzed: 0,
        reliable: 0,
        errors: 0
      };
      
      // Process in batches of 10
      const batchSize = 10;
      for (let i = 0; i < userIds.length; i += batchSize) {
        const batch = userIds.slice(i, i + batchSize);
        
        await Promise.allSettled(
          batch.map(async (userId) => {
            try {
              const result = await this.analyzeUserBehavior(userId);
              results.analyzed++;
              if (result.dataQuality.isReliable) {
                results.reliable++;
              }
            } catch (error) {
              results.errors++;
              logger.error(`[BehaviorLearning] Batch error for user ${userId}: ${error.message}`);
            }
          })
        );
      }
      
      const executionTime = Date.now() - startTime;
      logger.info(`[BehaviorLearning] Batch complete in ${executionTime}ms: ${results.analyzed}/${results.total} analyzed, ${results.reliable} reliable`);
      
      return results;
      
    } catch (error) {
      logger.error(`[BehaviorLearning] Batch analysis error: ${error.message}`, error);
      throw error;
    }
  }
}

module.exports = new BehaviorLearningService();
