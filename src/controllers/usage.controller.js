const { getUsageSummary, getPlanLimits, PLAN_LIMITS } = require('../middleware/usageEnforcement');
const Usage = require('../models/Usage');

/**
 * Get current user's usage summary
 * GET /api/usage/summary
 */
const getMyUsage = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }
    
    const summary = await getUsageSummary(userId);
    
    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('Error getting usage summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get usage summary',
      message: error.message,
    });
  }
};

/**
 * Get usage history for a specific period
 * GET /api/usage/history?days=30
 */
const getUsageHistory = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const days = parseInt(req.query.days) || 30;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    const history = await Usage.find({
      user: userId,
      date: { $gte: startDateStr },
    }).sort({ date: -1 });
    
    res.json({
      success: true,
      data: {
        period: `${days} days`,
        history: history.map(record => ({
          date: record.date,
          aiQuestions: record.aiQuestions,
          aiTokensUsed: record.aiTokensUsed,
          fileUploads: record.fileUploads,
        })),
      },
    });
  } catch (error) {
    console.error('Error getting usage history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get usage history',
      message: error.message,
    });
  }
};

/**
 * Get plan limits information
 * GET /api/usage/limits
 */
const getPlanLimitsInfo = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    
    let userPlan = 'free';
    let userLimits = PLAN_LIMITS.free;
    
    if (userId) {
      const { plan, limits } = await getPlanLimits(userId);
      userPlan = plan;
      userLimits = limits;
    }
    
    res.json({
      success: true,
      data: {
        currentPlan: userPlan,
        currentLimits: userLimits,
        allPlans: PLAN_LIMITS,
      },
    });
  } catch (error) {
    console.error('Error getting plan limits:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get plan limits',
      message: error.message,
    });
  }
};

/**
 * Check if user can perform an action
 * POST /api/usage/check
 * Body: { action: 'ai_question' | 'create_board' | 'upload_file', model?: string }
 */
const checkAction = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { action, model } = req.body;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }
    
    const { plan, limits } = await getPlanLimits(userId);
    const todayUsage = await Usage.getTodayUsage(userId);
    
    let canPerform = true;
    let reason = null;
    let remaining = null;
    
    switch (action) {
      case 'ai_question':
        if (limits.aiQuestionsPerDay !== -1 && todayUsage.aiQuestions >= limits.aiQuestionsPerDay) {
          canPerform = false;
          reason = 'Daily AI question limit reached';
          remaining = 0;
        } else {
          remaining = limits.aiQuestionsPerDay === -1 ? 'unlimited' : limits.aiQuestionsPerDay - todayUsage.aiQuestions;
        }
        break;
        
      case 'create_board':
        const Board = require('../models/Board');
        const boardCount = await Board.countDocuments({ owner: userId });
        if (limits.boards !== -1 && boardCount >= limits.boards) {
          canPerform = false;
          reason = 'Board limit reached';
          remaining = 0;
        } else {
          remaining = limits.boards === -1 ? 'unlimited' : limits.boards - boardCount;
        }
        break;
        
      case 'upload_file':
        if (limits.fileUploadsPerDay !== -1 && todayUsage.fileUploads >= limits.fileUploadsPerDay) {
          canPerform = false;
          reason = 'Daily file upload limit reached';
          remaining = 0;
        } else {
          remaining = limits.fileUploadsPerDay === -1 ? 'unlimited' : limits.fileUploadsPerDay - todayUsage.fileUploads;
        }
        break;
        
      case 'create_notebook':
        const Notebook = require('../models/Notebook');
        const notebookCount = await Notebook.countDocuments({ userId });
        if (limits.notebooks !== -1 && notebookCount >= limits.notebooks) {
          canPerform = false;
          reason = 'Notebook limit reached';
          remaining = 0;
        } else {
          remaining = limits.notebooks === -1 ? 'unlimited' : limits.notebooks - notebookCount;
        }
        break;
        
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action',
          validActions: ['ai_question', 'create_board', 'upload_file', 'create_notebook'],
        });
    }
    
    res.json({
      success: true,
      data: {
        canPerform,
        reason,
        remaining,
        plan,
        upgradeUrl: canPerform ? null : '/pricing',
      },
    });
  } catch (error) {
    console.error('Error checking action:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check action',
      message: error.message,
    });
  }
};

/**
 * Get daily usage reset time
 * GET /api/usage/reset-time
 */
const getResetTime = async (req, res) => {
  try {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilReset = tomorrow.getTime() - now.getTime();
    const hoursUntilReset = Math.floor(msUntilReset / (1000 * 60 * 60));
    const minutesUntilReset = Math.floor((msUntilReset % (1000 * 60 * 60)) / (1000 * 60));
    
    res.json({
      success: true,
      data: {
        resetTime: tomorrow.toISOString(),
        msUntilReset,
        timeUntilReset: `${hoursUntilReset}h ${minutesUntilReset}m`,
      },
    });
  } catch (error) {
    console.error('Error getting reset time:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get reset time',
      message: error.message,
    });
  }
};

module.exports = {
  getMyUsage,
  getUsageHistory,
  getPlanLimitsInfo,
  checkAction,
  getResetTime,
};
