const express = require('express');
const router = express.Router();
const focusController = require('../controllers/focus.controller');
const { protect } = require('../middlewares/auth.middleware');
const { body, param, query } = require('express-validator');

// Validation middleware
const validateSession = [
  param('id').isMongoId().withMessage('Invalid session ID')
];

const validateStartSession = [
  body('type')
    .isIn(['work', 'shortBreak', 'longBreak'])
    .withMessage('Type must be work, shortBreak, or longBreak'),
  body('duration')
    .optional()
    .isInt({ min: 1, max: 120 })
    .withMessage('Duration must be between 1 and 120 minutes'),
  body('pomodoroNumber')
    .optional()
    .isInt({ min: 1, max: 4 })
    .withMessage('Pomodoro number must be between 1 and 4')
];

const validateUpdateSession = [
  param('id').isMongoId().withMessage('Invalid session ID'),
  body('notes')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Notes must be a string with max 500 characters'),
  body('distractions')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Distractions must be a non-negative integer')
];

const validateCompleteSession = [
  param('id').isMongoId().withMessage('Invalid session ID'),
  body('notes')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Notes must be a string with max 500 characters'),
  body('distractions')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Distractions must be a non-negative integer')
];

const validateUpdateSettings = [
  body('workDuration')
    .optional()
    .isInt({ min: 1, max: 60 })
    .withMessage('Work duration must be between 1 and 60 minutes'),
  body('shortBreakDuration')
    .optional()
    .isInt({ min: 1, max: 30 })
    .withMessage('Short break duration must be between 1 and 30 minutes'),
  body('longBreakDuration')
    .optional()
    .isInt({ min: 1, max: 60 })
    .withMessage('Long break duration must be between 1 and 60 minutes'),
  body('longBreakInterval')
    .optional()
    .isInt({ min: 2, max: 10 })
    .withMessage('Long break interval must be between 2 and 10'),
  body('autoStartBreaks')
    .optional()
    .isBoolean()
    .withMessage('Auto start breaks must be a boolean'),
  body('autoStartPomodoros')
    .optional()
    .isBoolean()
    .withMessage('Auto start pomodoros must be a boolean'),
  body('notifications')
    .optional()
    .isBoolean()
    .withMessage('Notifications must be a boolean'),
  body('soundEnabled')
    .optional()
    .isBoolean()
    .withMessage('Sound enabled must be a boolean'),
  body('dailyGoal')
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage('Daily goal must be between 1 and 20 pomodoros')
];

const validateStats = [
  query('period')
    .optional()
    .isIn(['today', 'week', 'month', 'year', 'all'])
    .withMessage('Period must be one of: today, week, month, year, all')
];

// All routes require authentication
router.use(protect);

// Session routes
router.route('/sessions')
  .get(focusController.getSessions)
  .post(validateStartSession, focusController.startSession);

router.route('/sessions/:id')
  .get(validateSession, focusController.getSession)
  .patch(validateUpdateSession, focusController.updateSession);

router.post(
  '/sessions/:id/pause',
  validateSession,
  focusController.pauseSession
);

router.post(
  '/sessions/:id/resume',
  validateSession,
  focusController.resumeSession
);

router.post(
  '/sessions/:id/complete',
  validateCompleteSession,
  focusController.completeSession
);

router.post(
  '/sessions/:id/cancel',
  validateSession,
  focusController.cancelSession
);

// Settings routes
router.route('/settings')
  .get(focusController.getSettings)
  .patch(validateUpdateSettings, focusController.updateSettings);

// Stats routes
router.get('/stats', validateStats, focusController.getStats);

module.exports = router;
