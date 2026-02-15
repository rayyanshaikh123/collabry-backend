/**
 * Exam Strategy Engine
 * 
 * Dynamically adjusts study plan based on exam proximity.
 * Implements 4-phase system: Concept Building → Practice Heavy → Revision → Light Review
 * 
 * @tier Tier-2 (Exam Mode)
 */

const logger = require('../utils/logger');
const eventEmitter = require('../utils/eventEmitter');

class ExamStrategyService {
  /**
   * Phase configurations with intensity multipliers
   */
  PHASE_CONFIGS = {
    concept_building: {
      daysBeforeExam: [90, Infinity],  // 90+ days before
      intensityMultiplier: 1.0,
      taskDensityPerDay: 2,
      focusAreas: ['theory', 'concepts', 'understanding'],
      description: 'Building foundational understanding',
      taskDistribution: { theory: 0.7, practice: 0.2, revision: 0.1 }
    },
    practice_heavy: {
      daysBeforeExam: [30, 90],         // 30-90 days before
      intensityMultiplier: 1.3,
      taskDensityPerDay: 3,
      focusAreas: ['practice', 'application', 'problem-solving'],
      description: 'Apply knowledge through practice',
      taskDistribution: { theory: 0.2, practice: 0.6, revision: 0.2 }
    },
    revision: {
      daysBeforeExam: [7, 30],          // 7-30 days before
      intensityMultiplier: 1.5,
      taskDensityPerDay: 4,
      focusAreas: ['revision', 'weak-areas', 'mock-tests'],
      description: 'Intensive revision and weak area focus',
      taskDistribution: { theory: 0.1, practice: 0.3, revision: 0.6 }
    },
    light_review: {
      daysBeforeExam: [0, 7],           // Final week
      intensityMultiplier: 1.2,
      taskDensityPerDay: 3,
      focusAreas: ['quick-review', 'formulas', 'key-concepts'],
      description: 'Light review to avoid burnout',
      taskDistribution: { theory: 0.2, practice: 0.2, revision: 0.6 }
    }
  };
  
  /**
   * Determine current exam phase based on exam date
   * 
   * @param {Date} examDate
   * @returns {Object} { phase: string, config: Object, daysRemaining: number }
   */
  determinePhase(examDate) {
    if (!examDate) {
      return {
        phase: null,
        config: null,
        daysRemaining: null
      };
    }
    
    const now = new Date();
    const daysRemaining = Math.ceil((examDate - now) / (1000 * 60 * 60 * 24));
    
    // Already passed
    if (daysRemaining < 0) {
      return {
        phase: 'exam_passed',
        config: null,
        daysRemaining
      };
    }
    
    // Find matching phase
    for (const [phaseName, config] of Object.entries(this.PHASE_CONFIGS)) {
      const [min, max] = config.daysBeforeExam;
      if (daysRemaining >= min && daysRemaining < max) {
        return {
          phase: phaseName,
          config,
          daysRemaining
        };
      }
    }
    
    // Default to concept building
    return {
      phase: 'concept_building',
      config: this.PHASE_CONFIGS.concept_building,
      daysRemaining
    };
  }
  
  /**
   * Get complete strategy for a study plan in exam mode
   * 
   * @param {Object} plan - StudyPlan document
   * @returns {Promise<Object>} Strategy object with phase, config, recommendations
   */
  async getStrategy(plan) {
    if (!plan.examMode || !plan.examDate) {
      return {
        enabled: false,
        phase: null,
        config: null,
        recommendations: []
      };
    }
    
    const { phase, config, daysRemaining } = this.determinePhase(plan.examDate);
    
    // Check if phase changed since last check
    const phaseChanged = plan.currentExamPhase !== phase;
    
    if (phaseChanged && phase !== 'exam_passed') {
      logger.info(`[ExamStrategy] Phase transition detected: ${plan.currentExamPhase} → ${phase} (${daysRemaining} days remaining)`);
      
      // Update plan with new phase
      await plan.updateOne({
        $set: {
          currentExamPhase: phase,
          'examPhaseConfig.intensityMultiplier': config.intensityMultiplier,
          'examPhaseConfig.taskDensityPerDay': config.taskDensityPerDay,
          'examPhaseConfig.lastPhaseUpdate': new Date()
        }
      });
      
      // Emit event for notifications
      eventEmitter.emit('exam.phase.changed', {
        userId: plan.userId,
        planId: plan._id,
        oldPhase: plan.currentExamPhase,
        newPhase: phase,
        daysRemaining,
        description: config.description
      });
    }
    
    // Generate recommendations
    const recommendations = this._generateRecommendations(phase, config, daysRemaining, plan);
    
    return {
      enabled: true,
      phase,
      config,
      daysRemaining,
      phaseChanged,
      recommendations
    };
  }
  
  /**
   * Calculate exam proximity score (0-100)
   * Higher score = closer to exam = higher priority
   * 
   * @param {Date} examDate
   * @param {Date} taskDate - Task's scheduled date
   * @returns {number} Score 0-100
   */
  calculateExamProximityScore(examDate, taskDate) {
    if (!examDate) return 50; // Neutral score
    
    const daysToExam = Math.ceil((examDate - new Date()) / (1000 * 60 * 60 * 24));
    const daysToTask = Math.ceil((new Date(taskDate) - new Date()) / (1000 * 60 * 60 * 24));
    
    // Already passed
    if (daysToExam < 0) return 0;
    
    // Exponential urgency curve
    let score;
    if (daysToExam <= 7) {
      // Final week: very high scores (70-100)
      score = 70 + (30 * (7 - daysToExam) / 7);
    } else if (daysToExam <= 30) {
      // Revision phase: high scores (50-70)
      score = 50 + (20 * (30 - daysToExam) / 23);
    } else if (daysToExam <= 90) {
      // Practice phase: medium scores (30-50)
      score = 30 + (20 * (90 - daysToExam) / 60);
    } else {
      // Concept building: baseline scores (20-30)
      score = 20 + Math.min(10, daysToExam / 30);
    }
    
    // Adjust based on task timing (tasks closer to exam date get boost)
    const taskProximity = Math.abs(daysToTask - daysToExam);
    if (taskProximity <= 3) {
      score += 10; // Task scheduled close to exam date
    }
    
    return Math.min(100, Math.max(0, Math.round(score)));
  }
  
  /**
   * Adjust plan intensity based on exam phase
   * 
   * @param {ObjectId} planId
   * @param {string} phase - Phase name
   * @returns {Promise<Object>} Adjustment details
   */
  async adjustPlanIntensity(planId, phase) {
    const config = this.PHASE_CONFIGS[phase];
    if (!config) {
      throw new Error(`Invalid phase: ${phase}`);
    }
    
    const StudyPlan = require('../models/StudyPlan');
    const plan = await StudyPlan.findById(planId);
    
    if (!plan || !plan.examMode) {
      throw new Error('Plan not found or not in exam mode');
    }
    
    // Calculate new daily study hours
    const baseDailyHours = plan.dailyStudyHours || 4;
    const adjustedDailyHours = Math.min(
      baseDailyHours * config.intensityMultiplier,
      8 // Hard cap at 8 hours/day
    );
    
    await plan.updateOne({
      $set: {
        currentExamPhase: phase,
        'examPhaseConfig.intensityMultiplier': config.intensityMultiplier,
        'examPhaseConfig.taskDensityPerDay': config.taskDensityPerDay,
        'examPhaseConfig.lastPhaseUpdate': new Date(),
        dailyStudyHours: adjustedDailyHours
      }
    });
    
    logger.info(`[ExamStrategy] Adjusted plan intensity: phase=${phase}, dailyHours=${adjustedDailyHours}`);
    
    return {
      phase,
      oldDailyHours: baseDailyHours,
      newDailyHours: adjustedDailyHours,
      taskDensityPerDay: config.taskDensityPerDay,
      focusAreas: config.focusAreas
    };
  }
  
  /**
   * Generate actionable recommendations for current phase
   * 
   * @param {string} phase
   * @param {Object} config
   * @param {number} daysRemaining
   * @param {Object} plan
   * @returns {Array} Recommendation strings
   */
  _generateRecommendations(phase, config, daysRemaining, plan) {
    const recommendations = [];
    
    recommendations.push(`${config.description} (${daysRemaining} days until exam)`);
    
    // Phase-specific recommendations
    switch (phase) {
      case 'concept_building':
        recommendations.push('Focus on understanding core concepts before moving to practice');
        recommendations.push('Build strong fundamentals - don\'t rush through theory');
        break;
        
      case 'practice_heavy':
        recommendations.push('Solve practice problems daily to reinforce learning');
        recommendations.push('Start identifying weak areas that need extra attention');
        break;
        
      case 'revision':
        recommendations.push('Prioritize revision of completed topics over new material');
        recommendations.push('Take mock tests to assess readiness');
        recommendations.push('Create quick-reference notes for formulas and key concepts');
        break;
        
      case 'light_review':
        recommendations.push('Avoid learning new topics - focus on quick reviews only');
        recommendations.push('Get adequate sleep and avoid burnout');
        recommendations.push('Review your quick-reference notes and formulas');
        break;
    }
    
    // Task density recommendation
    if (config.taskDensityPerDay > (plan.dailyStudyHours || 4)) {
      recommendations.push(`Consider increasing daily study time to ${config.taskDensityPerDay} hours`);
    }
    
    // Focus areas
    recommendations.push(`Key focus areas: ${config.focusAreas.join(', ')}`);
    
    return recommendations;
  }
  
  /**
   * Get phase timeline for display (milestone calendar)
   * 
   * @param {Date} examDate
   * @returns {Array} Phase timeline with dates
   */
  getPhaseTimeline(examDate) {
    if (!examDate) return [];
    
    const timeline = [];
    const examTime = examDate.getTime();
    
    for (const [phaseName, config] of Object.entries(this.PHASE_CONFIGS)) {
      const [minDays, maxDays] = config.daysBeforeExam;
      
      if (maxDays === Infinity) {
        timeline.push({
          phase: phaseName,
          label: config.description,
          startDate: null, // Open-ended
          endDate: new Date(examTime - minDays * 24 * 60 * 60 * 1000),
          isCurrentPhase: false
        });
      } else {
        const startDate = new Date(examTime - maxDays * 24 * 60 * 60 * 1000);
        const endDate = new Date(examTime - minDays * 24 * 60 * 60 * 1000);
        
        timeline.push({
          phase: phaseName,
          label: config.description,
          startDate,
          endDate,
          durationDays: maxDays - minDays,
          isCurrentPhase: false
        });
      }
    }
    
    // Mark current phase
    const { phase: currentPhase } = this.determinePhase(examDate);
    const currentItem = timeline.find(t => t.phase === currentPhase);
    if (currentItem) {
      currentItem.isCurrentPhase = true;
    }
    
    return timeline.reverse(); // Oldest to newest
  }
}

module.exports = new ExamStrategyService();
