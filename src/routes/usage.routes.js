const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth.middleware');
const {
  getMyUsage,
  getUsageHistory,
  getPlanLimitsInfo,
  checkAction,
  getResetTime,
} = require('../controllers/usage.controller');

// Public routes
router.get('/limits', getPlanLimitsInfo); // Can be accessed without auth to show plan comparison
router.get('/reset-time', getResetTime);

// Protected routes
router.get('/summary', protect, getMyUsage);
router.get('/history', protect, getUsageHistory);
router.post('/check', protect, checkAction);

module.exports = router;
