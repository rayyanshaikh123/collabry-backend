/**
 * Planner Context Collector - Student profile for strategy/scheduler.
 * Does NOT schedule; only gathers plan config, behavior, exam strategy.
 */

const StudyPlan = require('../models/StudyPlan');
const UserBehaviorProfile = require('../models/UserBehaviorProfile');
const examStrategyService = require('./examStrategy.service');
const logger = require('../utils/logger');

async function collectContext(userId, planInput = {}) {
  const subject = planInput.subject || '';
  const topics = planInput.topics || [];
  const examDate = planInput.examDate;
  const difficulty = planInput.difficulty || 'medium';

  const context = {
    learningPace: 'medium',
    averageScore: null,
    completionRate: null,
    topics: topics.map((t) => ({ name: t, estimatedHours: 2 })),
    examDate: examDate || null,
    dailyHours: planInput.dailyStudyHours || 2,
  };

  try {
    const profile = await UserBehaviorProfile.findOne({ userId }).lean();
    if (profile) {
      context.learningPace = profile.learningPace || 'medium';
      context.averageScore = profile.averageScore;
      context.completionRate = profile.completionRate;
      context.productivityPeakHours = profile.productivityPeakHours || [];
      context.optimalTimeOfDay = profile.optimalTimeOfDay || 'evening';
    }
  } catch (e) {
    logger.warn('[PlannerContext] Behavior profile lookup failed', e.message);
  }

  if (examDate && planInput.planId) {
    try {
      const plan = await StudyPlan.findOne({ _id: planInput.planId, userId }).lean();
      if (plan && plan.examMode) {
        const strategy = await examStrategyService.getStrategy(plan);
        context.examStrategy = strategy;
        context.daysToExam = strategy?.daysToExam;
        context.currentPhase = strategy?.currentPhase || strategy?.phase;
      }
    } catch (e) {
      logger.warn('[PlannerContext] Exam strategy lookup failed', e.message);
    }
  }

  return context;
}

module.exports = { collectContext };
