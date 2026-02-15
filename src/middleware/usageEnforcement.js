const Usage = require('../models/Usage');
const Subscription = require('../models/Subscription');
const { PLAN_LIMITS, getLimitsForTier, isUnlimited } = require('../config/plans');

// Get user's current plan
const getUserPlan = async (userId) => {
  const subscription = await Subscription.findOne({ 
    user: userId,
    status: { $in: ['active', 'trialing'] }
  });
  
  return subscription?.plan || 'free';
};

// Get plan limits for a user
const getPlanLimits = async (userId) => {
  const plan = await getUserPlan(userId);
  return { plan, limits: PLAN_LIMITS[plan] || PLAN_LIMITS.free };
};

/**
 * Middleware to check AI usage limits
 * Use this before any AI-related endpoint
 */
const checkAIUsageLimit = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?._id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }
    
    // Check if user has BYOK (Bring Your Own Key) enabled
    const User = require('../models/User');
    const user = await User.findById(userId).select('byokSettings apiKeys');
    
    if (user && user.hasByokEnabled()) {
      // User is using their own API key - bypass limits
      console.log(`[BYOK] User ${userId} using own ${user.byokSettings.activeProvider} key - bypassing limits`);
      req.byokEnabled = true;
      req.byokProvider = user.byokSettings.activeProvider;
      return next();
    }
    
    req.byokEnabled = false;
    
    const { plan, limits } = await getPlanLimits(userId);
    
    // Unlimited plans can proceed
    if (limits.aiQuestionsPerDay === -1) {
      req.userPlan = plan;
      req.planLimits = limits;
      return next();
    }
    
    // Atomic check-and-increment: reserve one question slot BEFORE processing.
    // This prevents race conditions where concurrent requests both pass the check.
    const today = new Date().toISOString().split('T')[0];
    const updated = await Usage.findOneAndUpdate(
      {
        user: userId,
        date: today,
        aiQuestions: { $lt: limits.aiQuestionsPerDay },
      },
      {
        $inc: { aiQuestions: 1 },
        $setOnInsert: { user: userId, date: today },
      },
      { upsert: false, new: true }
    );

    if (!updated) {
      // Either no doc exists yet (first request today) or limit already reached.
      // Try to check if a doc exists at all:
      const existing = await Usage.getTodayUsage(userId);
      if (existing.aiQuestions >= limits.aiQuestionsPerDay) {
        return res.status(429).json({
          success: false,
          error: 'Daily AI limit reached',
          message: `You've used all ${limits.aiQuestionsPerDay} AI questions for today. Upgrade your plan for more.`,
          limitReached: true,
          currentUsage: existing.aiQuestions,
          dailyLimit: limits.aiQuestionsPerDay,
          plan,
          resetTime: getNextResetTime(),
          upgradeUrl: '/pricing',
        });
      }
      // Doc didn't exist — create it with 1 question already counted
      await Usage.findOneAndUpdate(
        { user: userId, date: today },
        { $inc: { aiQuestions: 1 }, $setOnInsert: { user: userId, date: today } },
        { upsert: true, new: true }
      );
    }
    
    // Attach usage info to request (question already reserved)
    req.userPlan = plan;
    req.planLimits = limits;
    req.aiQuestionReserved = true; // Signal that trackAIUsage should skip incrementing aiQuestions
    
    next();
  } catch (error) {
    console.error('Error checking AI usage limit:', error);
    return res.status(503).json({
      success: false,
      error: 'Unable to verify usage limits. Please try again.',
    });
  }
};

/**
 * Middleware to check board creation limits
 */
const checkBoardLimit = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?._id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }
    
    const { plan, limits } = await getPlanLimits(userId);
    
    // Unlimited plans can proceed
    if (limits.boards === -1) {
      req.userPlan = plan;
      req.planLimits = limits;
      return next();
    }
    
    // Count existing boards (exclude soft-deleted and archived)
    const Board = require('../models/Board');
    const boardCount = await Board.countDocuments({ owner: userId, deletedAt: null, isArchived: false });
    
    if (boardCount >= limits.boards) {
      return res.status(429).json({
        success: false,
        error: 'Board limit reached',
        message: `You've reached the maximum of ${limits.boards} boards for your ${plan} plan. Upgrade for more boards.`,
        limitReached: true,
        currentCount: boardCount,
        limit: limits.boards,
        plan,
        upgradeUrl: '/pricing',
      });
    }
    
    req.userPlan = plan;
    req.planLimits = limits;
    req.boardCount = boardCount;
    req.remainingBoards = limits.boards - boardCount;
    
    next();
  } catch (error) {
    console.error('Error checking board limit:', error);
    return res.status(503).json({
      success: false,
      error: 'Unable to verify usage limits. Please try again.',
    });
  }
};

/**
 * Middleware to check file upload limits
 */
const checkFileUploadLimit = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?._id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }
    
    const { plan, limits } = await getPlanLimits(userId);
    
    // Unlimited plans can proceed
    if (limits.fileUploadsPerDay === -1) {
      req.userPlan = plan;
      req.planLimits = limits;
      return next();
    }
    
    // Get today's usage
    const usage = await Usage.getTodayUsage(userId);
    
    if (usage.fileUploads >= limits.fileUploadsPerDay) {
      return res.status(429).json({
        success: false,
        error: 'Daily file upload limit reached',
        message: `You've used all ${limits.fileUploadsPerDay} file uploads for today. Upgrade for more.`,
        limitReached: true,
        currentUsage: usage.fileUploads,
        dailyLimit: limits.fileUploadsPerDay,
        plan,
        resetTime: getNextResetTime(),
        upgradeUrl: '/pricing',
      });
    }
    
    req.userPlan = plan;
    req.planLimits = limits;
    req.currentUsage = usage;
    
    next();
  } catch (error) {
    console.error('Error checking file upload limit:', error);
    return res.status(503).json({
      success: false,
      error: 'Unable to verify usage limits. Please try again.',
    });
  }
};

/**
 * Middleware to check storage limits
 */
const checkStorageLimit = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const fileSize = req.file?.size || parseInt(req.headers['content-length']) || 0;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }
    
    const { plan, limits } = await getPlanLimits(userId);
    const storageLimit = limits.storageGB * 1024 * 1024 * 1024; // Convert GB to bytes
    
    // Get current storage usage (would need to calculate from user's files)
    const User = require('../models/User');
    const user = await User.findById(userId);
    const currentStorage = user?.storageUsed || 0;
    
    if (currentStorage + fileSize > storageLimit) {
      return res.status(429).json({
        success: false,
        error: 'Storage limit reached',
        message: `You've reached your storage limit of ${limits.storageGB}GB. Upgrade for more storage.`,
        limitReached: true,
        currentStorage: formatBytes(currentStorage),
        storageLimit: `${limits.storageGB}GB`,
        plan,
        upgradeUrl: '/pricing',
      });
    }
    
    req.userPlan = plan;
    req.planLimits = limits;
    
    next();
  } catch (error) {
    console.error('Error checking storage limit:', error);
    return res.status(503).json({
      success: false,
      error: 'Unable to verify usage limits. Please try again.',
    });
  }
};

/**
 * Middleware to check notebook creation limits
 */
const checkNotebookLimit = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const { plan, limits } = await getPlanLimits(userId);

    // Unlimited plans can proceed
    if (limits.notebooks === -1) {
      req.userPlan = plan;
      req.planLimits = limits;
      return next();
    }

    // Count existing notebooks
    const Notebook = require('../models/Notebook');
    const notebookCount = await Notebook.countDocuments({ userId });

    if (notebookCount >= limits.notebooks) {
      return res.status(429).json({
        success: false,
        error: 'Notebook limit reached',
        message: `You've reached the maximum of ${limits.notebooks} notebooks for your ${plan} plan. Upgrade for more notebooks.`,
        limitReached: true,
        currentCount: notebookCount,
        limit: limits.notebooks,
        plan,
        upgradeUrl: '/pricing',
      });
    }

    req.userPlan = plan;
    req.planLimits = limits;
    req.notebookCount = notebookCount;
    req.remainingNotebooks = limits.notebooks - notebookCount;

    next();
  } catch (error) {
    console.error('Error checking notebook limit:', error);
    return res.status(503).json({
      success: false,
      error: 'Unable to verify usage limits. Please try again.',
    });
  }
};

/**
 * Track AI usage after successful request.
 * If the middleware already reserved a question slot (req.aiQuestionReserved),
 * only track tokens and details — don't double-increment aiQuestions.
 */
const trackAIUsage = async (userId, tokens = 0, model = 'basic', questionType = 'chat', alreadyReserved = false) => {
  try {
    if (alreadyReserved) {
      // Question count already incremented atomically by checkAIUsageLimit — only track tokens + details
      const today = new Date().toISOString().split('T')[0];
      await Usage.findOneAndUpdate(
        { user: userId, date: today },
        {
          $inc: { aiTokensUsed: tokens },
          $push: {
            aiUsageDetails: {
              timestamp: new Date(),
              model,
              tokensUsed: tokens,
              questionType,
            },
          },
        },
        { upsert: false }
      );
    } else {
      await Usage.incrementAIUsage(userId, tokens, model, questionType);
    }
  } catch (error) {
    console.error('Error tracking AI usage:', error);
  }
};

/**
 * Track file upload
 */
const trackFileUpload = async (userId) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    await Usage.findOneAndUpdate(
      { user: userId, date: today },
      {
        $inc: { fileUploads: 1 },
        $setOnInsert: { user: userId, date: today },
      },
      { upsert: true }
    );
  } catch (error) {
    console.error('Error tracking file upload:', error);
  }
};

/**
 * Get usage summary for a user
 */
const getUsageSummary = async (userId) => {
  try {
    const { plan, limits } = await getPlanLimits(userId);
    const todayUsage = await Usage.getTodayUsage(userId);
    const monthlyStats = await Usage.getUsageStats(userId, 30);
    
    // Get board count (exclude soft-deleted and archived)
    const Board = require('../models/Board');
    const boardCount = await Board.countDocuments({ owner: userId, deletedAt: null, isArchived: false });

    // Get notebook count
    const Notebook = require('../models/Notebook');
    const notebookCount = await Notebook.countDocuments({ userId });
    
    // Get storage usage
    const User = require('../models/User');
    const user = await User.findById(userId);
    const storageUsed = user?.storageUsed || 0;
    const storageLimit = limits.storageGB * 1024 * 1024 * 1024;
    
    // Get BYOK status
    const byokStatus = {
      enabled: user?.byokSettings?.enabled || false,
      activeProvider: user?.byokSettings?.activeProvider || null,
      hasKeys: user?.apiKeys && user.apiKeys.size > 0,
      providers: []
    };

    if (user?.apiKeys) {
      for (const [provider, data] of user.apiKeys) {
        byokStatus.providers.push({
          provider,
          isActive: data.isActive,
          isValid: data.isValid
        });
      }
    }
    
    return {
      plan,
      byok: byokStatus,
      today: {
        aiQuestions: {
          used: todayUsage.aiQuestions,
          limit: limits.aiQuestionsPerDay,
          remaining: limits.aiQuestionsPerDay === -1 ? 'unlimited' : Math.max(0, limits.aiQuestionsPerDay - todayUsage.aiQuestions),
        },
        fileUploads: {
          used: todayUsage.fileUploads,
          limit: limits.fileUploadsPerDay,
          remaining: limits.fileUploadsPerDay === -1 ? 'unlimited' : Math.max(0, limits.fileUploadsPerDay - todayUsage.fileUploads),
        },
      },
      totals: {
        boards: {
          used: boardCount,
          limit: limits.boards,
          remaining: limits.boards === -1 ? 'unlimited' : Math.max(0, limits.boards - boardCount),
        },
        notebooks: {
          used: notebookCount,
          limit: limits.notebooks,
          remaining: limits.notebooks === -1 ? 'unlimited' : Math.max(0, limits.notebooks - notebookCount),
        },
        storage: {
          used: formatBytes(storageUsed),
          usedBytes: storageUsed,
          limit: `${limits.storageGB}GB`,
          limitBytes: storageLimit,
          percentUsed: Math.round((storageUsed / storageLimit) * 100),
        },
      },
      monthly: {
        totalQuestions: monthlyStats.totalAIQuestions || 0,
        totalTokens: monthlyStats.totalTokensUsed || 0,
        totalFileUploads: monthlyStats.totalFileUploads || 0,
        avgDailyQuestions: monthlyStats.daysActive
          ? Math.round((monthlyStats.totalAIQuestions || 0) / monthlyStats.daysActive * 10) / 10
          : 0,
      },
      limits,
      resetTime: getNextResetTime(),
    };
  } catch (error) {
    console.error('Error getting usage summary:', error);
    throw error;
  }
};

// Helper functions
function getNextResetTime() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
  PLAN_LIMITS,
  getUserPlan,
  getPlanLimits,
  checkAIUsageLimit,
  checkBoardLimit,
  checkNotebookLimit,
  checkFileUploadLimit,
  checkStorageLimit,
  trackAIUsage,
  trackFileUpload,
  getUsageSummary,
};
