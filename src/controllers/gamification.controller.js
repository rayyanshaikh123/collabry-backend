const { GamificationService } = require('../services/gamification.service');

// @desc    Get user gamification stats
// @route   GET /api/gamification/stats
// @access  Private
exports.getUserStats = async (req, res) => {
  try {
    const stats = await GamificationService.getUserStats(req.user._id);
    
    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get user stats',
    });
  }
};

// @desc    Get personal progress (You vs You)
// @route   GET /api/gamification/personal-progress
// @access  Private
exports.getPersonalProgress = async (req, res) => {
  try {
    const progress = await GamificationService.getPersonalProgress(req.user._id);
    
    res.status(200).json({
      success: true,
      data: progress,
    });
  } catch (error) {
    console.error('Get personal progress error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get personal progress',
    });
  }
};

// @desc    Get global leaderboard
// @route   GET /api/gamification/leaderboard
// @access  Private
exports.getLeaderboard = async (req, res) => {
  try {
    const { type = 'xp', limit = 10 } = req.query;
    
    const leaderboard = await GamificationService.getLeaderboard(
      type,
      parseInt(limit)
    );
    
    res.status(200).json({
      success: true,
      data: leaderboard,
    });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get leaderboard',
    });
  }
};

// @desc    Get friend leaderboard
// @route   GET /api/gamification/leaderboard/friends
// @access  Private
exports.getFriendLeaderboard = async (req, res) => {
  try {
    const leaderboard = await GamificationService.getFriendLeaderboard(req.user._id);
    
    res.status(200).json({
      success: true,
      data: leaderboard,
    });
  } catch (error) {
    console.error('Get friend leaderboard error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get friend leaderboard',
    });
  }
};

// @desc    Award XP manually (admin only)
// @route   POST /api/gamification/award-xp
// @access  Private/Admin
exports.awardXP = async (req, res) => {
  try {
    const { userId, amount, reason } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'User ID and amount are required',
      });
    }

    const User = require('../models/User');
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const levelResult = user.addXP(amount);
    await user.save();

    res.status(200).json({
      success: true,
      message: `Awarded ${amount} XP ${reason ? 'for ' + reason : ''}`,
      data: {
        xpEarned: amount,
        totalXP: user.gamification.xp,
        level: user.gamification.level,
        leveledUp: levelResult.leveledUp,
      },
    });
  } catch (error) {
    console.error('Award XP error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to award XP',
    });
  }
};
