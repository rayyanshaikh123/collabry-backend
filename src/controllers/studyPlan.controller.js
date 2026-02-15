const studyPlanService = require('../services/studyPlan.service');
const { GamificationService } = require('../services/gamification.service');

class StudyPlanController {
  /**
   * Create study plan
   * POST /api/study-planner/plans
   */
  async createPlan(req, res, next) {
    try {
      const userId = req.user.id;
      console.log(`[StudyPlan] Creating plan for user ${userId}:`, req.body);
      
      const plan = await studyPlanService.createPlan(userId, req.body);
      
      // CRITICAL: Assert plan was created successfully
      if (!plan) {
        console.error('[StudyPlan] ❌ CRITICAL: Plan service returned null/undefined');
        throw new Error('Plan generation failed before persistence');
      }
      
      if (!plan.id && !plan._id) {
        console.error('[StudyPlan] ❌ CRITICAL: Plan has no ID:', plan);
        throw new Error('Plan was created but has no identifier');
      }
      
      console.log(`[StudyPlan] ✅ Plan created successfully:`, {
        id: plan.id || plan._id,
        title: plan.title,
        userId: plan.userId
      });

      // Award XP for plan creation
      let gamificationResult = null;
      try {
        gamificationResult = await GamificationService.awardPlanCreationXP(userId);
      } catch (gamError) {
        console.error('Error awarding plan creation XP:', gamError);
      }

      res.status(201).json({
        success: true,
        data: plan,
        gamification: gamificationResult,
      });
    } catch (error) {
      console.error('[StudyPlan] ❌ Error creating plan:', error.message);
      next(error);
    }
  }

  /**
   * Get all user plans
   * GET /api/study-planner/plans
   */
  async getPlans(req, res, next) {
    try {
      const userId = req.user.id;
      const { status, planType } = req.query;

      console.log('[getPlans] userId:', userId, 'filters:', { status, planType });

      const plans = await studyPlanService.getUserPlans(userId, {
        status,
        planType,
      });

      console.log('[getPlans] Found plans:', plans.length);

      res.json({
        success: true,
        count: plans.length,
        data: plans,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get plan by ID
   * GET /api/study-planner/plans/:id
   */
  async getPlanById(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;

      const plan = await studyPlanService.getPlanById(id, userId, isAdmin);

      res.json({
        success: true,
        data: plan,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update plan
   * PUT /api/study-planner/plans/:id
   */
  async updatePlan(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;

      const plan = await studyPlanService.updatePlan(
        id,
        userId,
        req.body,
        isAdmin
      );

      res.json({
        success: true,
        data: plan,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete plan
   * DELETE /api/study-planner/plans/:id
   */
  async deletePlan(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;

      const result = await studyPlanService.deletePlan(id, userId, isAdmin);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get plan analytics
   * GET /api/study-planner/plans/:id/analytics
   */
  async getPlanAnalytics(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;

      const stats = await studyPlanService.getPlanAnalytics(
        id,
        userId,
        isAdmin
      );

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user analytics
   * GET /api/study-planner/analytics
   */
  async getUserAnalytics(req, res, next) {
    try {
      const userId = req.user.id;
      const stats = await studyPlanService.getUserAnalytics(userId);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }

  // ============================================================================
  // TIER-2/3: EXAM MODE & ADAPTIVE SCHEDULING
  // ============================================================================

  /**
   * Enable exam mode for a plan
   * PATCH /api/study-planner/plans/:id/exam-mode
   */
  async enableExamMode(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { examDate, examMode } = req.body;

      if (!examDate) {
        return res.status(400).json({
          success: false,
          message: 'Exam date is required'
        });
      }

      const examStrategyService = require('../services/examStrategy.service');
      const StudyPlan = require('../models/StudyPlan');

      // Get plan
      const plan = await StudyPlan.findOne({ _id: id, userId });
      if (!plan) {
        return res.status(404).json({
          success: false,
          message: 'Plan not found'
        });
      }

      // Determine initial phase
      const { phase, config } = examStrategyService.determinePhase(new Date(examDate));

      // Update plan
      plan.examMode = examMode !== undefined ? examMode : true;
      plan.examDate = new Date(examDate);
      plan.currentExamPhase = phase;
      plan.examPhaseConfig = {
        intensityMultiplier: config?.intensityMultiplier || 1.0,
        taskDensityPerDay: config?.taskDensityPerDay || 3,
        lastPhaseUpdate: new Date()
      };

      await plan.save();

      res.json({
        success: true,
        message: 'Exam mode enabled',
        data: {
          planId: plan._id,
          examDate: plan.examDate,
          currentPhase: phase,
          config: plan.examPhaseConfig
        }
      });

    } catch (error) {
      console.error('[StudyPlan] Error enabling exam mode:', error);
      next(error);
    }
  }

  /**
   * Get exam strategy for a plan
   * GET /api/study-planner/plans/:id/exam-strategy
   */
  async getExamStrategy(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const examStrategyService = require('../services/examStrategy.service');
      const StudyPlan = require('../models/StudyPlan');

      const plan = await StudyPlan.findOne({ _id: id, userId });
      if (!plan) {
        return res.status(404).json({
          success: false,
          message: 'Plan not found'
        });
      }

      const strategy = await examStrategyService.getStrategy(plan);

      res.json({
        success: true,
        data: strategy
      });

    } catch (error) {
      console.error('[StudyPlan] Error getting exam strategy:', error);
      next(error);
    }
  }

  /**
   * Get exam phase timeline
   * GET /api/study-planner/plans/:id/exam-timeline
   */
  async getExamTimeline(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const examStrategyService = require('../services/examStrategy.service');
      const StudyPlan = require('../models/StudyPlan');

      const plan = await StudyPlan.findOne({ _id: id, userId });
      if (!plan) {
        return res.status(404).json({
          success: false,
          message: 'Plan not found'
        });
      }

      if (!plan.examMode || !plan.examDate) {
        return res.status(400).json({
          success: false,
          message: 'Plan is not in exam mode'
        });
      }

      const timeline = examStrategyService.getPhaseTimeline(plan.examDate);

      res.json({
        success: true,
        data: {
          examDate: plan.examDate,
          timeline
        }
      });

    } catch (error) {
      console.error('[StudyPlan] Error getting exam timeline:', error);
      next(error);
    }
  }

  // ============================================================================
  // TIER-2/3: BEHAVIOR ANALYTICS
  // ============================================================================

  /**
   * Get user behavior profile
   * GET /api/study-planner/analytics/behavior-profile
   */
  async getBehaviorProfile(req, res, next) {
    try {
      const userId = req.user.id;
      const UserBehaviorProfile = require('../models/UserBehaviorProfile');

      let profile = await UserBehaviorProfile.findOne({ userId });

      // If no profile exists, trigger analysis
      if (!profile) {
        const behaviorService = require('../services/behaviorLearning.service');
        await behaviorService.analyzeUserBehavior(userId);
        profile = await UserBehaviorProfile.findOne({ userId });
      }

      res.json({
        success: true,
        data: profile || {
          message: 'Not enough data yet. Complete more tasks to generate insights.'
        }
      });

    } catch (error) {
      console.error('[StudyPlan] Error getting behavior profile:', error);
      next(error);
    }
  }

  /**
   * Get heatmap data
   * GET /api/study-planner/analytics/heatmap
   */
  async getHeatmapData(req, res, next) {
    try {
      const userId = req.user.id;
      const { days = 30 } = req.query;

      const DailyStudyStats = require('../models/DailyStudyStats');
      const heatmapData = await DailyStudyStats.getHeatmapData(userId, parseInt(days));

      res.json({
        success: true,
        data: heatmapData
      });

    } catch (error) {
      console.error('[StudyPlan] Error getting heatmap data:', error);
      next(error);
    }
  }

  /**
   * Get optimal scheduling slots
   * GET /api/study-planner/analytics/optimal-slots
   */
  async getOptimalSlots(req, res, next) {
    try {
      const userId = req.user.id;
      const behaviorService = require('../services/behaviorLearning.service');

      const optimalSlot = await behaviorService.getOptimalSlot(userId);

      res.json({
        success: true,
        data: optimalSlot
      });

    } catch (error) {
      console.error('[StudyPlan] Error getting optimal slots:', error);
      next(error);
    }
  }

  /**
   * Get recommended planner mode
   * GET /api/study-planner/plans/:id/recommended-mode
   */
  async getRecommendedMode(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      console.log(`[StudyPlan] Getting recommended mode for plan ${id}`);

      const { PlannerModeResolver } = require('../services/strategies');
      const recommendation = await PlannerModeResolver.recommendMode(userId, id);

      res.json({
        success: true,
        data: recommendation
      });

    } catch (error) {
      console.error('[StudyPlan] Error getting recommended mode:', error);
      next(error);
    }
  }

  /**
   * Get recommended modes for all active plans
   * GET /api/study-planner/plans/recommended-modes/all
   */
  async getRecommendedModesForAllPlans(req, res, next) {
    try {
      const userId = req.user.id;

      console.log(`[StudyPlan] Getting recommended modes for all plans of user ${userId}`);

      const { PlannerModeResolver } = require('../services/strategies');
      const recommendations = await PlannerModeResolver.recommendForAllPlans(userId);

      res.json({
        success: true,
        count: recommendations.length,
        data: recommendations
      });

    } catch (error) {
      console.error('[StudyPlan] Error getting recommended modes for all plans:', error);
      next(error);
    }
  }

  /**
   * Execute scheduling strategy
   * POST /api/study-planner/plans/:id/execute-strategy
   */
  async executeStrategy(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { mode, context = {} } = req.body;

      console.log(`[StudyPlan] Executing ${mode} strategy for plan ${id}`);

      // Validate mode
      const { StrategyFactory } = require('../services/strategies');
      if (!StrategyFactory.isValidMode(mode)) {
        return res.status(400).json({
          success: false,
          error: `Invalid strategy mode: ${mode}. Valid modes: balanced, adaptive, emergency`
        });
      }

      // Get strategy instance
      const strategy = StrategyFactory.getStrategy(mode);

      // Execute strategy
      const result = await strategy.execute(id, userId, context);

      // Update plan metadata to track current mode
      const StudyPlan = require('../models/StudyPlan');
      await StudyPlan.findByIdAndUpdate(id, {
        $set: {
          'adaptiveMetadata.currentMode': mode,
          'adaptiveMetadata.lastAutoSchedule': new Date()
        }
      });

      res.json({
        success: true,
        message: `${mode.charAt(0).toUpperCase() + mode.slice(1)} strategy executed successfully`,
        data: result
      });

    } catch (error) {
      console.error('[StudyPlan] Error executing strategy:', error);
      console.error('[StudyPlan] Error stack:', error.stack);
      next(error);
    }
  }

  /**
   * Get available scheduling strategies
   * GET /api/study-planner/strategies
   */
  async getAvailableStrategies(req, res, next) {
    try {
      const { StrategyFactory } = require('../services/strategies');
      const strategies = StrategyFactory.getAllStrategies();

      res.json({
        success: true,
        count: strategies.length,
        data: strategies
      });

    } catch (error) {
      console.error('[StudyPlan] Error getting available strategies:', error);
      next(error);
    }
  }

  /**
   * Auto-execute recommended strategy
   * POST /api/study-planner/plans/:id/auto-strategy
   */
  async autoExecuteStrategy(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const context = req.body?.context || {};

      console.log(`[StudyPlan] Auto-executing recommended strategy for plan ${id}`);

      // Get recommendation
      const { PlannerModeResolver, StrategyFactory } = require('../services/strategies');
      const recommendation = await PlannerModeResolver.recommendMode(userId, id);

      console.log(`[StudyPlan] Recommended mode: ${recommendation.recommendedMode} (confidence: ${recommendation.confidence}%)`);

      // Execute recommended strategy
      const strategy = StrategyFactory.getStrategy(recommendation.recommendedMode);
      const result = await strategy.execute(id, userId, context);

      // Update plan metadata
      const StudyPlan = require('../models/StudyPlan');
      await StudyPlan.findByIdAndUpdate(id, {
        $set: {
          'adaptiveMetadata.currentMode': recommendation.recommendedMode,
          'adaptiveMetadata.lastAutoSchedule': new Date()
        }
      });

      res.json({
        success: true,
        message: `${recommendation.recommendedMode} strategy executed successfully`,
        data: {
          recommendation,
          execution: result
        }
      });

    } catch (error) {
      console.error('[StudyPlan] Auto-execute strategy failed');
      console.error('[StudyPlan] Plan ID:', req.params.id);
      console.error('[StudyPlan] User ID:', req.user?.id);
      console.error('[StudyPlan] Error:', error.message);
      console.error('[StudyPlan] Stack:', error.stack);
      
      // Hydration failures (legacy/corrupted plans)
      if (error.message.includes('Hydration failure') || 
          error.message.includes('Cannot hydrate')) {
        return res.status(400).json({
          success: false,
          error: 'Plan Configuration Error',
          message: 'This study plan is corrupted or missing required data. Please create a new plan.',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
      
      // Data integrity failures (plan missing critical fields after hydration)
      if (error.message.includes('Data integrity failure') || 
          error.message.includes('missing dailyStudyHours') ||
          error.message.includes('Invalid configuration')) {
        return res.status(400).json({
          success: false,
          error: 'Plan Configuration Error',
          message: 'This study plan has invalid configuration. Please recreate the plan or contact support.',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
      
      // Plan not found
      if (error.message.includes('Plan is required') || 
          error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: 'Plan Not Found',
          message: 'The requested study plan does not exist.'
        });
      }
      
      next(error);
    }
  }

  /**
   * Auto-schedule plan time blocks
   * POST /api/study-planner/plans/:id/auto-schedule
   */
  async autoSchedulePlan(req, res, next) {
    try {
      const userId = req.user.id;
      const { id: planId } = req.params;

      console.log(`[AutoSchedule] Scheduling plan ${planId} for user ${userId}`);

      // Import SchedulingService
      const SchedulingService = require('../services/scheduling.service');

      // Execute scheduling
      const result = await SchedulingService.autoSchedulePlan(userId, planId);

      console.log(`[AutoSchedule] Success: ${result.stats.allocatedTasks} tasks scheduled`);

      res.json({
        success: true,
        data: {
          tasksScheduled: result.stats.allocatedTasks,
          conflictsDetected: result.stats.conflictsDetected,
          executionTimeMs: result.stats.executionTimeMs,
          totalSlots: Object.keys(result.allocated || {}).length
        },
        message: `Successfully scheduled ${result.stats.allocatedTasks} task${result.stats.allocatedTasks === 1 ? '' : 's'}`
      });
    } catch (error) {
      console.error('[AutoSchedule] Error:', error.message);
      
      // Plan not found
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: 'Plan Not Found',
          message: 'The requested study plan does not exist.'
        });
      }
      
      // User doesn't own plan
      if (error.message.includes('does not own')) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'You do not have permission to schedule this plan.'
        });
      }
      
      
      next(error);
    }
  }

  /**
   * Reschedule missed sessions
   * POST /api/study-planner/plans/:id/recover-missed
   */
  async recoverMissed(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      
      console.log(`[StudyPlan] Recovering missed sessions for plan ${id}`);
      
      const result = await studyPlanService.recoverMissed(userId, id);
      
      res.json({
        success: true,
        message: `Found ${result.totalMissed} missed sessions`,
        data: result
      });
    } catch (error) {
      console.error('[StudyPlan] Recover missed failed:', error);
      next(error);
    }
  }
}

module.exports = new StudyPlanController();
