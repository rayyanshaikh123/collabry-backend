const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');
const Board = require('../models/Board');
const Usage = require('../models/Usage');
const AuthAuditLog = require('../models/AuthAuditLog');
const FocusSession = require('../models/FocusSession');
const StudyPlan = require('../models/StudyPlan');
const QuizAttempt = require('../models/QuizAttempt');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');

// ── helpers ──────────────────────────────────────────────────────────────────
function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function daysAgoDate(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── GET /api/admin/deep-reports/user-growth ──────────────────────────────────
const getUserGrowthReport = asyncHandler(async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const since = daysAgoDate(days);

  // Signups per day
  const signupTrend = await User.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { date: '$_id', count: 1, _id: 0 } },
  ]);

  // Role distribution
  const roleDistribution = await User.aggregate([
    { $group: { _id: '$role', count: { $sum: 1 } } },
    { $project: { role: '$_id', count: 1, _id: 0 } },
  ]);

  // Subscription tier distribution
  const tierDistribution = await User.aggregate([
    { $group: { _id: '$subscriptionTier', count: { $sum: 1 } } },
    { $project: { tier: '$_id', count: 1, _id: 0 } },
  ]);

  // Active vs inactive
  const totalUsers = await User.countDocuments();
  const activeUsers = await User.countDocuments({ isActive: true });
  const verifiedUsers = await User.countDocuments({ emailVerified: true });

  // Recent logins (last 7 days)
  const recentLogins = await AuthAuditLog.countDocuments({
    event: 'login_success',
    createdAt: { $gte: daysAgoDate(7) },
  });

  res.json({
    success: true,
    data: {
      signupTrend,
      roleDistribution,
      tierDistribution,
      summary: { totalUsers, activeUsers, verifiedUsers, recentLogins },
    },
  });
});

// ── GET /api/admin/deep-reports/engagement ───────────────────────────────────
const getEngagementReport = asyncHandler(async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const since = daysAgoDate(days);

  // Daily active users (by login events)
  const dauTrend = await AuthAuditLog.aggregate([
    { $match: { event: 'login_success', createdAt: { $gte: since } } },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          userId: '$userId',
        },
      },
    },
    { $group: { _id: '$_id.date', activeUsers: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { date: '$_id', activeUsers: 1, _id: 0 } },
  ]);

  // Top users by study time
  const topByStudyTime = await User.find({ 'gamification.stats.totalStudyTime': { $gt: 0 } })
    .sort({ 'gamification.stats.totalStudyTime': -1 })
    .limit(10)
    .select('name email gamification.stats.totalStudyTime gamification.level gamification.xp');

  // Top users by XP
  const topByXP = await User.find({ 'gamification.xp': { $gt: 0 } })
    .sort({ 'gamification.xp': -1 })
    .limit(10)
    .select('name email gamification.xp gamification.level gamification.streak');

  // Focus session stats
  const focusStats = await FocusSession.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: null,
        totalSessions: { $sum: 1 },
        completedSessions: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        totalMinutes: { $sum: '$duration' },
        avgDistractions: { $avg: '$distractions' },
      },
    },
  ]);

  // Study plan stats
  const planStats = await StudyPlan.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: null,
        totalPlans: { $sum: 1 },
        aiGenerated: { $sum: { $cond: ['$generatedByAI', 1, 0] } },
        avgCompletion: { $avg: '$completionPercentage' },
        completedPlans: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
      },
    },
  ]);

  res.json({
    success: true,
    data: {
      dauTrend,
      topByStudyTime: topByStudyTime.map((u) => ({
        name: u.name,
        email: u.email,
        studyTime: u.gamification?.stats?.totalStudyTime || 0,
        level: u.gamification?.level || 1,
        xp: u.gamification?.xp || 0,
      })),
      topByXP: topByXP.map((u) => ({
        name: u.name,
        email: u.email,
        xp: u.gamification?.xp || 0,
        level: u.gamification?.level || 1,
        streak: u.gamification?.streak?.current || 0,
      })),
      focusStats: focusStats[0] || { totalSessions: 0, completedSessions: 0, totalMinutes: 0, avgDistractions: 0 },
      planStats: planStats[0] || { totalPlans: 0, aiGenerated: 0, avgCompletion: 0, completedPlans: 0 },
    },
  });
});

// ── GET /api/admin/deep-reports/ai-usage ─────────────────────────────────────
const getAIUsageReport = asyncHandler(async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const sinceStr = daysAgoStr(days);

  // Daily AI usage trend
  const dailyTrend = await Usage.aggregate([
    { $match: { date: { $gte: sinceStr } } },
    {
      $group: {
        _id: '$date',
        totalTokens: { $sum: '$aiTokensUsed' },
        totalQuestions: { $sum: '$aiQuestions' },
        uniqueUsers: { $addToSet: '$user' },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        date: '$_id',
        totalTokens: 1,
        totalQuestions: 1,
        uniqueUsers: { $size: '$uniqueUsers' },
        _id: 0,
      },
    },
  ]);

  // By question type
  const byQuestionType = await Usage.aggregate([
    { $match: { date: { $gte: sinceStr } } },
    { $unwind: { path: '$aiUsageDetails', preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: '$aiUsageDetails.questionType',
        count: { $sum: 1 },
        totalTokens: { $sum: '$aiUsageDetails.tokensUsed' },
      },
    },
    { $project: { type: '$_id', count: 1, totalTokens: 1, _id: 0 } },
    { $sort: { count: -1 } },
  ]);

  // By model
  const byModel = await Usage.aggregate([
    { $match: { date: { $gte: sinceStr } } },
    { $unwind: { path: '$aiUsageDetails', preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: '$aiUsageDetails.model',
        count: { $sum: 1 },
        totalTokens: { $sum: '$aiUsageDetails.tokensUsed' },
      },
    },
    { $project: { model: '$_id', count: 1, totalTokens: 1, _id: 0 } },
    { $sort: { totalTokens: -1 } },
  ]);

  // Top AI consumers
  const topConsumers = await Usage.aggregate([
    { $match: { date: { $gte: sinceStr } } },
    {
      $group: {
        _id: '$user',
        totalTokens: { $sum: '$aiTokensUsed' },
        totalQuestions: { $sum: '$aiQuestions' },
      },
    },
    { $sort: { totalTokens: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'userDoc',
      },
    },
    { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        name: '$userDoc.name',
        email: '$userDoc.email',
        totalTokens: 1,
        totalQuestions: 1,
        _id: 0,
      },
    },
  ]);

  // Summary
  const totals = await Usage.aggregate([
    { $match: { date: { $gte: sinceStr } } },
    {
      $group: {
        _id: null,
        totalTokens: { $sum: '$aiTokensUsed' },
        totalQuestions: { $sum: '$aiQuestions' },
        uniqueUsers: { $addToSet: '$user' },
      },
    },
    {
      $project: {
        totalTokens: 1,
        totalQuestions: 1,
        uniqueUsers: { $size: '$uniqueUsers' },
        _id: 0,
      },
    },
  ]);

  res.json({
    success: true,
    data: {
      dailyTrend,
      byQuestionType,
      byModel,
      topConsumers,
      summary: totals[0] || { totalTokens: 0, totalQuestions: 0, uniqueUsers: 0 },
    },
  });
});

// ── GET /api/admin/deep-reports/boards ───────────────────────────────────────
const getBoardsReport = asyncHandler(async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const since = daysAgoDate(days);

  // Board creation trend
  const creationTrend = await Board.aggregate([
    { $match: { createdAt: { $gte: since }, deletedAt: null } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { date: '$_id', count: 1, _id: 0 } },
  ]);

  // Collaboration metrics
  const collabMetrics = await Board.aggregate([
    { $match: { deletedAt: null } },
    {
      $project: {
        memberCount: { $size: { $ifNull: ['$members', []] } },
        elementCount: { $size: { $ifNull: ['$elements', []] } },
        isPublic: 1,
        isArchived: 1,
      },
    },
    {
      $group: {
        _id: null,
        totalBoards: { $sum: 1 },
        avgMembers: { $avg: '$memberCount' },
        avgElements: { $avg: '$elementCount' },
        soloBoards: { $sum: { $cond: [{ $lte: ['$memberCount', 0] }, 1, 0] } },
        collabBoards: { $sum: { $cond: [{ $gt: ['$memberCount', 0] }, 1, 0] } },
        publicBoards: { $sum: { $cond: ['$isPublic', 1, 0] } },
        archivedBoards: { $sum: { $cond: ['$isArchived', 1, 0] } },
      },
    },
  ]);

  // Top board creators
  const topCreators = await Board.aggregate([
    { $match: { deletedAt: null } },
    { $group: { _id: '$owner', boardCount: { $sum: 1 } } },
    { $sort: { boardCount: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'userDoc',
      },
    },
    { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } },
    { $project: { name: '$userDoc.name', email: '$userDoc.email', boardCount: 1, _id: 0 } },
  ]);

  // Most popular tags
  const popularTags = await Board.aggregate([
    { $match: { deletedAt: null } },
    { $unwind: { path: '$tags', preserveNullAndEmptyArrays: false } },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
    { $project: { tag: '$_id', count: 1, _id: 0 } },
  ]);

  res.json({
    success: true,
    data: {
      creationTrend,
      collabMetrics: collabMetrics[0] || {
        totalBoards: 0, avgMembers: 0, avgElements: 0, soloBoards: 0,
        collabBoards: 0, publicBoards: 0, archivedBoards: 0,
      },
      topCreators,
      popularTags,
    },
  });
});

// ── GET /api/admin/deep-reports/revenue ──────────────────────────────────────
const getRevenueReport = asyncHandler(async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const since = daysAgoDate(days);

  // Revenue trend
  const revenueTrend = await Payment.aggregate([
    { $match: { status: 'captured', createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        revenue: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { date: '$_id', revenue: 1, count: 1, _id: 0 } },
  ]);

  // Subscription distribution
  const subDistribution = await Subscription.aggregate([
    { $match: { status: 'active' } },
    { $group: { _id: '$plan', count: { $sum: 1 } } },
    { $project: { plan: '$_id', count: 1, _id: 0 } },
  ]);

  // Summary
  const revenueSummary = await Payment.aggregate([
    { $match: { status: 'captured', createdAt: { $gte: since } } },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$amount' },
        totalPayments: { $sum: 1 },
        avgPayment: { $avg: '$amount' },
        totalDiscount: { $sum: '$discountApplied' },
      },
    },
  ]);

  // Payment method distribution
  const byMethod = await Payment.aggregate([
    { $match: { status: 'captured', createdAt: { $gte: since } } },
    { $group: { _id: '$method', count: { $sum: 1 }, total: { $sum: '$amount' } } },
    { $project: { method: '$_id', count: 1, total: 1, _id: 0 } },
    { $sort: { total: -1 } },
  ]);

  // Active subscriptions count
  const activeSubscriptions = await Subscription.countDocuments({ status: 'active' });

  res.json({
    success: true,
    data: {
      revenueTrend,
      subDistribution,
      byMethod,
      summary: {
        ...(revenueSummary[0] || { totalRevenue: 0, totalPayments: 0, avgPayment: 0, totalDiscount: 0 }),
        activeSubscriptions,
      },
    },
  });
});

module.exports = {
  getUserGrowthReport,
  getEngagementReport,
  getAIUsageReport,
  getBoardsReport,
  getRevenueReport,
};
