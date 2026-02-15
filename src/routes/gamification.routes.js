const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/role.middleware');
const gamificationController = require('../controllers/gamification.controller');

// User stats and gamification
router.get('/stats', protect, gamificationController.getUserStats);
router.get('/personal-progress', protect, gamificationController.getPersonalProgress);

// Leaderboards
router.get('/leaderboard', protect, gamificationController.getLeaderboard);
router.get('/leaderboard/friends', protect, gamificationController.getFriendLeaderboard);

// Admin routes
router.post('/award-xp', protect, authorizeRoles('admin'), gamificationController.awardXP);

module.exports = router;
