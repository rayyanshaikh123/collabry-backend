/**
 * PlannerModeResolver - Intelligent Mode Detection Engine
 * 
 * Analyzes plan metrics and context to recommend optimal scheduling strategy.
 * Uses decision tree logic based on exam proximity, completion rate, backlog, and consistency.
 * 
 * Decision Criteria:
 * 
 * EMERGENCY MODE:
 * - Exam within 7 days AND completion rate < 60%
 * - Exam within 14 days AND completion rate < 40%
 * - Massive backlog (>20 pending tasks) within 2 weeks of exam
 * 
 * ADAPTIVE MODE:
 * - Plan has exam date AND exam mode enabled
 * - Backlog > 10 tasks OR completion rate < 70%
 * - Exam within 30 days
 * - User consistency score < 60 (unreliable study patterns)
 * 
 * BALANCED MODE:
 * - Default for all other scenarios
 * - New plans without exam dates
 * - High completion rate (>70%) + low backlog
 * - User learning at their own pace
 */

const StudyPlan = require('../../models/StudyPlan');
const StudyTask = require('../../models/StudyTask.ENHANCED');
const UserBehaviorProfile = require('../../models/UserBehaviorProfile');
const DailyStudyStats = require('../../models/DailyStudyStats');

class PlannerModeResolver {
  /**
   * Recommend optimal scheduling mode for a plan
   * @param {String} userId - User ID
   * @param {String} planId - Plan ID
   * @returns {Promise<Object>} Mode recommendation with reasoning
   */
  static async recommendMode(userId, planId) {
    try {
      // Fetch plan with metrics
      const plan = await StudyPlan.findById(planId);
      if (!plan) {
        throw new Error(`Plan ${planId} not found`);
      }

      // Calculate metrics
      const metrics = await this._calculateMetrics(userId, planId, plan);

      // Apply decision tree
      const recommendation = this._applyDecisionTree(metrics);

      // Add confidence score
      const confidence = this._calculateConfidence(metrics, recommendation.mode);

      return {
        recommendedMode: recommendation.mode,
        currentMode: this._getCurrentMode(plan),
        shouldSwitch: recommendation.mode !== this._getCurrentMode(plan),
        confidence, // 0-100
        reasoning: recommendation.reasoning,
        metrics,
        warnings: recommendation.warnings || [],
        timestamp: new Date()
      };

    } catch (error) {
      console.error('[PlannerModeResolver] Mode recommendation failed:', error);
      throw error;
    }
  }

  /**
   * Calculate comprehensive plan metrics
   * @private
   */
  static async _calculateMetrics(userId, planId, plan) {
    // Basic plan metrics
    const completionRate = plan.totalTasks > 0 
      ? plan.completedTasks / plan.totalTasks 
      : 0;
    
    const daysToExam = plan.examDate 
      ? Math.ceil((plan.examDate - new Date()) / (1000 * 60 * 60 * 24))
      : null;

    // Backlog calculation
    const backlog = await StudyTask.countDocuments({
      planId: plan._id,
      status: { $in: ['pending', 'rescheduled'] },
      scheduledDate: { $lt: new Date() },
      isDeleted: false
    });

    // Upcoming tasks (next 7 days)
    const upcomingTasks = await StudyTask.countDocuments({
      planId: plan._id,
      status: 'pending',
      scheduledDate: { 
        $gte: new Date(),
        $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      },
      isDeleted: false
    });

    // User behavior profile
    const behaviorProfile = await UserBehaviorProfile.findOne({ userId });
    const consistencyScore = behaviorProfile?.consistencyScore || 0;
    const hasReliableData = behaviorProfile?.isReliable() || false;

    // Recent study stats (last 7 days)
    const recentStats = await DailyStudyStats.find({
      userId,
      date: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }).sort({ date: -1 });

    const avgDailyMinutes = recentStats.length > 0
      ? recentStats.reduce((sum, stat) => sum + stat.totalStudyMinutes, 0) / recentStats.length
      : 0;

    const avgCompletionRate = recentStats.length > 0
      ? recentStats.reduce((sum, stat) => sum + (stat.getCompletionRate() || 0), 0) / recentStats.length
      : 0;

    return {
      planId,
      userId,
      totalTasks: plan.totalTasks,
      completedTasks: plan.completedTasks,
      completionRate: Math.round(completionRate * 100), // Percentage
      backlog,
      upcomingTasks,
      examDate: plan.examDate,
      daysToExam,
      examMode: plan.examMode,
      consistencyScore: Math.round(consistencyScore),
      hasReliableData,
      avgDailyMinutes: Math.round(avgDailyMinutes),
      avgCompletionRate: Math.round(avgCompletionRate * 100),
      currentStreak: plan.currentStreak,
      adaptationCount: plan.adaptationCount || 0
    };
  }

  /**
   * Apply decision tree logic to metrics
   * @private
   */
  static _applyDecisionTree(metrics) {
    const reasoning = [];
    const warnings = [];

    // EMERGENCY MODE CHECKS
    if (metrics.daysToExam !== null) {
      // Crisis scenario 1: Exam very soon + low completion
      if (metrics.daysToExam <= 7 && metrics.completionRate < 60) {
        reasoning.push(`⚠️ CRISIS: Exam in ${metrics.daysToExam} days with only ${metrics.completionRate}% completion`);
        reasoning.push(`Emergency mode applies syllabus compression and hyper time blocks`);
        warnings.push(`Intensive study schedule - expect 6-8 tasks/day with 90-120 min blocks`);
        return { mode: 'emergency', reasoning, warnings };
      }

      // Crisis scenario 2: Exam soon + very low completion
      if (metrics.daysToExam <= 14 && metrics.completionRate < 40) {
        reasoning.push(`⚠️ CRISIS: Exam in ${metrics.daysToExam} days with only ${metrics.completionRate}% completion`);
        reasoning.push(`Emergency mode needed to compress syllabus and maximize study time`);
        warnings.push(`High-intensity schedule required to cover remaining material`);
        return { mode: 'emergency', reasoning, warnings };
      }

      // Crisis scenario 3: Massive backlog near exam
      if (metrics.daysToExam <= 14 && metrics.backlog > 20) {
        reasoning.push(`⚠️ CRISIS: ${metrics.backlog} overdue tasks with exam in ${metrics.daysToExam} days`);
        reasoning.push(`Emergency redistribution required`);
        warnings.push(`Significant backlog - some low-priority topics may be pruned`);
        return { mode: 'emergency', reasoning, warnings };
      }
    }

    // ADAPTIVE MODE CHECKS
    if (metrics.examMode && metrics.daysToExam !== null) {
      // Exam mode is enabled - adaptive is appropriate
      if (metrics.daysToExam <= 30) {
        reasoning.push(`Exam in ${metrics.daysToExam} days - adaptive mode applies exam-driven strategies`);
        reasoning.push(`Current completion: ${metrics.completionRate}%`);
        
        if (metrics.backlog > 10) {
          reasoning.push(`${metrics.backlog} overdue tasks - adaptive mode will redistribute`);
        }
        
        return { mode: 'adaptive', reasoning, warnings };
      }
    }

    // Adaptive mode for backlog issues (even without exam)
    if (metrics.backlog > 10 && metrics.completionRate < 70) {
      reasoning.push(`High backlog (${metrics.backlog} tasks) with completion rate ${metrics.completionRate}%`);
      reasoning.push(`Adaptive mode applies priority scoring and cognitive load balancing`);
      warnings.push(`Focus on catching up with overdue tasks`);
      return { mode: 'adaptive', reasoning, warnings };
    }

    // Adaptive mode for poor consistency
    if (metrics.hasReliableData && metrics.consistencyScore < 60) {
      reasoning.push(`Low consistency score (${metrics.consistencyScore}/100) detected`);
      reasoning.push(`Adaptive mode uses behavior learning to optimize schedule`);
      return { mode: 'adaptive', reasoning, warnings };
    }

    // Adaptive mode for declining completion rate
    if (metrics.avgCompletionRate < 50 && metrics.avgCompletionRate > 0) {
      reasoning.push(`Recent completion rate (${metrics.avgCompletionRate}%) indicates scheduling issues`);
      reasoning.push(`Adaptive mode will optimize task distribution`);
      return { mode: 'adaptive', reasoning, warnings };
    }

    // BALANCED MODE (DEFAULT)
    reasoning.push(`Plan metrics indicate standard scheduling is appropriate`);
    reasoning.push(`Completion rate: ${metrics.completionRate}%, Backlog: ${metrics.backlog} tasks`);
    
    if (metrics.currentStreak > 7) {
      reasoning.push(`Strong consistency (${metrics.currentStreak}-day streak) - keep current pace`);
    }

    return { mode: 'balanced', reasoning, warnings };
  }

  /**
   * Calculate confidence score for recommendation
   * @private
   */
  static _calculateConfidence(metrics, recommendedMode) {
    let confidence = 50; // Base confidence

    // High confidence scenarios
    if (recommendedMode === 'emergency') {
      if (metrics.daysToExam <= 7) confidence += 40;
      if (metrics.completionRate < 50) confidence += 10;
    }

    if (recommendedMode === 'adaptive') {
      if (metrics.examMode && metrics.daysToExam <= 30) confidence += 30;
      if (metrics.backlog > 10) confidence += 10;
      if (metrics.hasReliableData) confidence += 10;
    }

    if (recommendedMode === 'balanced') {
      if (metrics.completionRate > 70) confidence += 20;
      if (metrics.backlog < 5) confidence += 15;
      if (metrics.currentStreak > 7) confidence += 15;
    }

    return Math.min(confidence, 100);
  }

  /**
   * Determine current mode from plan state
   * @private
   */
  static _getCurrentMode(plan) {
    // Check if plan has metadata indicating current mode
    if (plan.adaptiveMetadata?.currentMode) {
      return plan.adaptiveMetadata.currentMode;
    }

    // Infer from plan state
    if (plan.examMode && plan.examDate) {
      const daysToExam = Math.ceil((plan.examDate - new Date()) / (1000 * 60 * 60 * 24));
      if (daysToExam <= 7 && plan.completionPercentage < 60) {
        return 'emergency';
      }
      return 'adaptive';
    }

    return 'balanced';
  }

  /**
   * Batch recommendation for multiple plans
   * @param {String} userId - User ID
   * @returns {Promise<Array>} Recommendations for all active plans
   */
  static async recommendForAllPlans(userId) {
    const activePlans = await StudyPlan.find({
      userId,
      status: 'active',
      isArchived: false
    });

    const recommendations = [];
    for (const plan of activePlans) {
      try {
        const recommendation = await this.recommendMode(userId, plan._id.toString());
        recommendations.push({
          planId: plan._id,
          planTitle: plan.title,
          ...recommendation
        });
      } catch (error) {
        console.error(`Failed to recommend mode for plan ${plan._id}:`, error);
        recommendations.push({
          planId: plan._id,
          planTitle: plan.title,
          error: error.message
        });
      }
    }

    return recommendations;
  }
}

module.exports = PlannerModeResolver;
