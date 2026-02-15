const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth.middleware');
const studyPlanController = require('../controllers/studyPlan.controller');
const studyTaskController = require('../controllers/studyTask.controller');
const plannerController = require('../controllers/planner.controller');

// ============================================================================
// STUDY PLANS ROUTES
// ============================================================================

// Plans CRUD
router.post('/plans', protect, studyPlanController.createPlan);
router.get('/plans', protect, studyPlanController.getPlans);
router.get('/plans/:id', protect, studyPlanController.getPlanById);
router.put('/plans/:id', protect, studyPlanController.updatePlan);
router.delete('/plans/:id', protect, studyPlanController.deletePlan);

// Plan analytics
router.get('/plans/:id/analytics', protect, studyPlanController.getPlanAnalytics);
router.get('/analytics', protect, studyPlanController.getUserAnalytics);

// Plan tasks (nested route)
router.get('/plans/:planId/tasks', protect, studyTaskController.getPlanTasks);

// ============================================================================
// STUDY TASKS ROUTES
// ============================================================================

// Tasks CRUD
router.post('/tasks', protect, studyTaskController.createTask);
router.post('/tasks/bulk', protect, studyTaskController.createBulkTasks);
router.get('/tasks', protect, studyTaskController.getUserTasks);
router.get('/tasks/today', protect, studyTaskController.getTodayTasks);
router.get('/tasks/upcoming', protect, studyTaskController.getUpcomingTasks);
router.get('/tasks/overdue', protect, studyTaskController.getOverdueTasks);
router.get('/tasks/:id', protect, studyTaskController.getTaskById);
router.put('/tasks/:id', protect, studyTaskController.updateTask);
router.delete('/tasks/:id', protect, studyTaskController.deleteTask);

// Task actions
router.post('/tasks/:id/complete', protect, studyTaskController.completeTask);
router.post('/tasks/:id/reschedule', protect, studyTaskController.rescheduleTask);

// ============================================================================
// TIER-2/3: ADAPTIVE SCHEDULING & EXAM MODE
// ============================================================================

// Adaptive rescheduling
router.post('/scheduling/adaptive-reschedule', protect, studyTaskController.adaptiveReschedule);

// Exam mode management
router.patch('/plans/:id/exam-mode', protect, studyPlanController.enableExamMode);
router.get('/plans/:id/exam-strategy', protect, studyPlanController.getExamStrategy);
router.get('/plans/:id/exam-timeline', protect, studyPlanController.getExamTimeline);

// Link tasks to notebooks
router.patch('/tasks/:id/link-notebook', protect, studyTaskController.linkNotebook);

// ============================================================================
// TIER-2/3: BEHAVIOR ANALYTICS
// ============================================================================

// User behavior profile
router.get('/analytics/behavior-profile', protect, studyPlanController.getBehaviorProfile);
router.get('/analytics/heatmap', protect, studyPlanController.getHeatmapData);
router.get('/analytics/optimal-slots', protect, studyPlanController.getOptimalSlots);

// ============================================================================
// STRATEGY PATTERN: INTELLIGENT MODE SWITCHING
// ============================================================================

// Get available strategies
router.get('/strategies', protect, studyPlanController.getAvailableStrategies);

// Mode recommendations
router.get('/plans/:id/recommended-mode', protect, studyPlanController.getRecommendedMode);
router.get('/plans/recommended-modes/all', protect, studyPlanController.getRecommendedModesForAllPlans);

// Strategy execution
router.post('/plans/:id/execute-strategy', protect, studyPlanController.executeStrategy);
router.post('/plans/:id/auto-strategy', protect, studyPlanController.autoExecuteStrategy);

// Time-block auto-scheduling (Phase 1)
router.post('/plans/:id/auto-schedule', protect, studyPlanController.autoSchedulePlan);
router.post('/plans/:id/recover-missed', protect, studyPlanController.recoverMissed);

// ============================================================================
// UNIFIED SCHEDULE: Task/Event Adapter Layer
// ============================================================================

const unifiedScheduleController = require('../controllers/unifiedSchedule.controller');

// Unified schedule access (tasks + events)
router.get('/plans/:id/schedule', protect, unifiedScheduleController.getUnifiedSchedule);
router.post('/sync-completion', protect, unifiedScheduleController.syncCompletion);
router.get('/plans/:id/model-preference', protect, unifiedScheduleController.getModelPreference);

// ============================================================================
// V2 PLANNER: strategy → scheduler → events (generate-v2, scheduler/*, study-events/*)
// ============================================================================
// Explicitly mount study-events/range to avoid router ambiguity
router.get('/study-events/range', protect, plannerController.getEventsRange);
router.post('/plans/:planId/events', protect, plannerController.saveEvents);
router.put('/events/:eventId', protect, plannerController.updateEvent);
router.delete('/events/:eventId', protect, plannerController.deleteEvent);

router.use(plannerController);

// ============================================================================
// TIER-3: COLLABORATIVE SESSIONS (Placeholder)
// ============================================================================

// Collaborative study sessions
// router.post('/collaborative/sessions', protect, collaborativeController.createSession);
// router.get('/collaborative/sessions', protect, collaborativeController.getSessions);
// router.post('/collaborative/sessions/:id/join', protect, collaborativeController.joinSession);

module.exports = router;
