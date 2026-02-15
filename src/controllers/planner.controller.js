/**
 * PLANNER CONTROLLER - Backend Orchestration
 * 
 * Coordinates:
 * - Context collection
 * - Slot engine
 * - Constraint validation
 * - Event persistence
 * 
 * Bridges AI engine and backend persistence
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middlewares/auth.middleware');
const plannerContextCollector = require('../services/plannerContextCollector.service');
const slotEngine = require('../services/slotEngine.service');
const constraintValidator = require('../services/constraintValidator.service');
const StudyEvent = require('../models/StudyEvent');
const logger = require('../utils/logger');

// AI Engine URL
const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8000';

// ============================================================================
// CONTEXT COLLECTION ENDPOINT
// ============================================================================
// AI Engine calls: POST /scheduler/context
// Returns rich student profile for prompt injection

router.post(
  '/scheduler/context',
  protect,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized', message: 'User not found' });
    }
    logger.info('[PlannerController] Collecting context', { userId, subject: req.body?.planInput?.subject });
    const context = await plannerContextCollector.collectContext(userId, req.body?.planInput || {});
    res.json(context);
  })
);

// ============================================================================
// SLOT ENGINE ENDPOINT
// ============================================================================
// AI Engine calls: POST /scheduler/slots
// Returns available time blocks for scheduling

router.post(
  '/scheduler/slots',
  protect,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized', message: 'User not found' });
    }
    const startDate = req.body?.startDate;
    const endDate = req.body?.endDate;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate required' });
    }

    logger.info('[PlannerController] Finding available slots', { userId, startDate, endDate });

    const existingEvents = await StudyEvent.findByDateRange(
      userId,
      new Date(startDate),
      new Date(endDate)
    );

    const slots = await slotEngine.findAvailableSlots({
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      dailyStudyHours: req.body.dailyStudyHours || 2,
      preferredTimeSlots: req.body.preferredTimeSlots || slotEngine._defaultTimeSlots(),
      existingEvents: existingEvents || [],
      sleepSchedule: req.body.sleepSchedule || { start: '23:00', end: '07:00' },
      weeklyTimetableBlocks: req.body.weeklyTimetableBlocks || [],
    });

    // Generate statistics
    const stats = slotEngine.getSlotStatistics(slots);

    res.json({
      slots: slots.map(s => ({
        startTime: s.startTime,
        endTime: s.endTime,
        durationMinutes: s.durationMinutes,
        deepWork: s.deepWork,
        quality: s.quality,
      })),
      statistics: stats,
    });
  })
);

// ============================================================================
// CONSTRAINT VALIDATION ENDPOINT
// ============================================================================
// AI Engine calls: POST /scheduler/validate
// Returns validation results before saving

router.post(
  '/scheduler/validate',
  protect,
  asyncHandler(async (req, res) => {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: 'Unauthorized', message: 'User not found' });
    }
    const schedule = req.body?.schedule;
    if (!Array.isArray(schedule)) {
      return res.status(400).json({ success: false, error: 'schedule array required' });
    }
    logger.info('[PlannerController] Validating schedule', { userId: req.user.id, eventCount: schedule.length });

    const events = schedule.map(session => ({
      title: session.title,
      startTime: new Date(session.startTime),
      endTime: new Date(session.endTime),
      type: session.type,
      difficulty: session.difficulty,
      priority: session.priority,
      durationMinutes: (new Date(session.endTime) - new Date(session.startTime)) / (1000 * 60),
      deepWork: session.deepWork,
    }));

    // Validate
    const result = await constraintValidator.validate({
      schedule: events,
      studentContext: req.body.studentContext,
      dailyHoursLimit: req.body.dailyHoursLimit || 6,
      examDate: req.body.examDate ? new Date(req.body.examDate) : null,
    });

    res.json(result);
  })
);

// ============================================================================
// DETECT CONFLICTS ENDPOINT
// ============================================================================
// Check if new events conflict with existing calendar

router.post(
  '/scheduler/detect-conflicts',
  protect,
  asyncHandler(async (req, res) => {
    logger.info('[PlannerController] Detecting conflicts', {
      userId: req.user.id,
      eventCount: req.body.events?.length || 0,
    });

    const conflicts = await slotEngine.detectConflicts({
      userId: req.user.id,
      events: req.body.events.map(e => ({
        title: e.title,
        startTime: new Date(e.startTime),
        endTime: new Date(e.endTime),
        priority: e.priority,
      })),
    });

    res.json({
      hasConflicts: conflicts.length > 0,
      conflicts,
    });
  })
);

// ============================================================================
// V2: Strategy → Scheduler (deterministic). AI returns strategy only; we assign times.
// ============================================================================
// Frontend calls: POST /generate-v2
// Flow: 1) AI /ai/v2/planning-strategy (no timestamps) 2) schedulerEngine 3) return sessions

const schedulerEngine = require('../services/schedulerEngine.service');

router.post(
  '/generate-v2',
  protect,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { subject, topics, startDate, endDate, dailyStudyHours, preferredTimeSlots, examDate, difficulty, planId, weeklyTimetableBlocks } = req.body || {};
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: 'Unauthorized', message: 'User not found' });
    }

    logger.info('[PlannerController] V2 strategy → scheduler', { userId, subject, topicCount: topics?.length });

    if (!subject || !topics || !Array.isArray(topics) || topics.length === 0 || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'subject, topics, startDate, endDate are required',
      });
    }

    try {
      let strategy;
      try {
        const strategyRes = await axios.post(
          `${AI_ENGINE_URL}/ai/v2/planning-strategy`,
          {
            subject: subject || req.body.title,
            topics,
            difficulty: difficulty || 'medium',
            examDate: examDate || null,
            dailyStudyHours: dailyStudyHours || 2,
            planType: req.body.planType || 'custom',
          },
          {
            headers: {
              Authorization: req.headers.authorization,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          }
        );
        strategy = strategyRes.data;
      } catch (aiErr) {
        logger.warn('[PlannerController] AI strategy failed, using heuristic', aiErr.message);
        strategy = {
          subjects: [subject],
          topics: topics.map((t) => ({
            name: t,
            difficultyScore: 5,
            estimatedHours: 2,
            priorityWeight: 1 / topics.length,
            dependencies: [],
            revisionStrategy: 'spaced',
          })),
          totalEstimatedHours: topics.length * 2,
          recommendedDailyLoadRange: { minHours: 1, maxHours: dailyStudyHours || 2 },
          emergencyPlan: null,
        };
      }

      const plan = {
        startDate,
        endDate,
        dailyStudyHours: dailyStudyHours || 2,
        preferredTimeSlots: preferredTimeSlots || [],
        weeklyTimetableBlocks: weeklyTimetableBlocks || [],
        recommendedDailyLoadRange: strategy.recommendedDailyLoadRange,
      };

      const { events, warnings } = await schedulerEngine.scheduleStrategy({
        userId,
        planId: planId || null,
        strategy,
        plan,
        subject,
      });

      const sessions = events.map((e) => ({
        title: e.title,
        description: e.description,
        topic: e.topic,
        startTime: e.startTime,
        endTime: e.endTime,
        type: e.type,
        difficulty: e.difficulty,
        priority: e.priority,
        deepWork: e.deepWork,
        estimatedEffort: e.estimatedEffort,
      }));

      logger.info('[PlannerController] V2 success', { sessionCount: sessions.length });

      res.json({
        success: true,
        data: {
          sessions,
          recommendations: ['Complete high-priority sessions first.', 'Use breaks between deep work blocks.'],
          warnings: warnings || [],
        },
      });
    } catch (err) {
      logger.error('[PlannerController] V2 failed', err.message);
      res.status(500).json({
        success: false,
        error: 'Schedule generation failed',
        message: err.message || 'Internal error',
      });
    }
  })
);

// ============================================================================
// AUTO-RECOVERY: reschedule missed events to next available slots
// ============================================================================
router.post(
  '/plans/:planId/recover-missed',
  protect,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const { planId } = req.params;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized', message: 'User not found' });
    if (!planId) return res.status(400).json({ success: false, error: 'planId required' });
    const result = await schedulerEngine.recoverMissedEvents(userId, planId);
    res.json({
      success: true,
      data: { rescheduled: result.rescheduled, totalMissed: result.totalMissed },
      message: result.rescheduled > 0
        ? `Rescheduled ${result.rescheduled} missed session(s).`
        : result.totalMissed > 0
          ? 'No available slots to reschedule; events marked as missed.'
          : 'No missed events.',
    });
  })
);

// ============================================================================
// SAVE EVENTS ENDPOINT
// ============================================================================
// Persist validated events to database

router.post(
  '/study-events/batch',
  protect,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const { planId, events: bodyEvents } = req.body || {};
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized', message: 'User not found' });
    }
    if (!planId) {
      return res.status(400).json({ success: false, error: 'planId required', message: 'Request body must include planId' });
    }
    if (!Array.isArray(bodyEvents) || bodyEvents.length === 0) {
      return res.status(400).json({ success: false, error: 'events required', message: 'Request body must include non-empty events array' });
    }

    logger.info('[PlannerController] Saving batch events', { userId, eventCount: bodyEvents.length });

    const events = await StudyEvent.insertMany(
      bodyEvents.map(session => ({
        userId,
        planId,
        title: (session.title || 'Session').substring(0, 200),
        description: (session.description || '').substring(0, 1000),
        startTime: new Date(session.startTime),
        endTime: new Date(session.endTime),
        topic: session.topic || '',
        type: session.type || 'deep_work',
        difficulty: session.difficulty || 'medium',
        priority: session.priority || 'medium',
        deepWork: Boolean(session.deepWork),
        resources: Array.isArray(session.resources) ? session.resources : [],
        aiGenerated: true,
        generationRunId: req.body.generationRunId || null,
        status: 'pending',
        validationPassed: true,
      }))
    );

    logger.info('[PlannerController] Events saved successfully', {
      count: events.length,
    });

    res.json({
      success: true,
      count: events.length,
      events: events.map(e => ({
        id: e._id,
        title: e.title,
        startTime: e.startTime,
        endTime: e.endTime,
      })),
    });
  })
);

// ============================================================================
// GET PLAN CALENDAR ENDPOINT
// ============================================================================
// Fetch time-bound events for calendar display

router.get(
  '/study-plans/:planId/calendar',
  protect,
  asyncHandler(async (req, res) => {
    logger.info('[PlannerController] Fetching calendar', {
      userId: req.user.id,
      planId: req.params.planId,
    });

    const events = await StudyEvent.find({
      userId: req.user.id,
      planId: req.params.planId,
    }).sort({ startTime: 1 });

    // Group by date
    const byDate = {};
    events.forEach(event => {
      const date = event.startTime.toISOString().split('T')[0];
      if (!byDate[date]) {
        byDate[date] = [];
      }
      byDate[date].push(event.toCalendarObject());
    });

    res.json({ byDate, total: events.length });
  })
);

// ============================================================================
// VALIDATION STATISTICS ENDPOINT
// ============================================================================
// Get compliance score and recommendations for existing plan

router.get(
  '/study-plans/:planId/validation-stats',
  protect,
  asyncHandler(async (req, res) => {
    logger.info('[PlannerController] Getting validation stats', {
      planId: req.params.planId,
    });

    const events = await StudyEvent.find({
      userId: req.user.id,
      planId: req.params.planId,
    });

    // Group by day
    const byDay = {};
    events.forEach(event => {
      const day = event.startTime.toISOString().split('T')[0];
      if (!byDay[day]) {
        byDay[day] = [];
      }
      byDay[day].push(event);
    });

    // Calculate stats per day
    const stats = Object.entries(byDay).map(([day, dayEvents]) => {
      const validation = slotEngine.validateCognitiveDayLoad(dayEvents, 6);
      return {
        day,
        ...validation,
      };
    });

    const overallValid = stats.every(d => d.valid);
    const avgHoursPerDay = stats.reduce((sum, s) => sum + (s.totalMinutes / 60), 0) / stats.length;

    res.json({
      overall: {
        valid: overallValid,
        daysChecked: stats.length,
        avgHoursPerDay: avgHoursPerDay.toFixed(1),
      },
      byDay: stats,
    });
  })
);

// ============================================================================
// STUDY EVENTS CRUD ENDPOINTS
// ============================================================================

// Create single event
router.post(
  '/study-events',
  protect,
  asyncHandler(async (req, res) => {
    logger.info('[PlannerController] Creating study event', {
      userId: req.user.id,
      title: req.body.title,
    });

    const event = new StudyEvent({
      userId: req.user.id,
      ...req.body,
    });

    await event.save();
    res.status(201).json(event);
  })
);

// Get single event
router.get(
  '/study-events/:eventId',
  protect,
  asyncHandler(async (req, res) => {
    const event = await StudyEvent.findById(req.params.eventId);
    
    if (!event || event.userId.toString() !== req.user.id) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(event);
  })
);

// Update event
router.put(
  '/study-events/:eventId',
  protect,
  asyncHandler(async (req, res) => {
    const event = await StudyEvent.findByIdAndUpdate(
      req.params.eventId,
      req.body,
      { new: true, runValidators: true }
    );

    if (!event || event.userId.toString() !== req.user.id) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(event);
  })
);

// Delete event
router.delete(
  '/study-events/:eventId',
  protect,
  asyncHandler(async (req, res) => {
    const event = await StudyEvent.findByIdAndDelete(req.params.eventId);

    if (!event || event.userId.toString() !== req.user.id) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ message: 'Event deleted', event });
  })
);

// Reschedule event
router.put(
  '/study-events/:eventId/reschedule',
  protect,
  asyncHandler(async (req, res) => {
    const { newStartTime, newEndTime } = req.body;

    const event = await StudyEvent.findByIdAndUpdate(
      req.params.eventId,
      { startTime: newStartTime, endTime: newEndTime },
      { new: true, runValidators: true }
    );

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(event);
  })
);

// Complete event
router.put(
  '/study-events/:eventId/complete',
  protect,
  asyncHandler(async (req, res) => {
    const event = await StudyEvent.findByIdAndUpdate(
      req.params.eventId,
      { 
        status: 'completed',
        completedAt: new Date(),
      },
      { new: true }
    );

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(event);
  })
);

// Skip event
router.put(
  '/study-events/:eventId/skip',
  protect,
  asyncHandler(async (req, res) => {
    const event = await StudyEvent.findByIdAndUpdate(
      req.params.eventId,
      { status: 'skipped' },
      { new: true }
    );

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(event);
  })
);

// ============================================================================
// CALENDAR VIEW ENDPOINTS
// ============================================================================

// Get calendar view for date range
const getEventsRange = asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, error: 'Unauthorized', message: 'User not found' });
  }
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ success: false, error: 'startDate and endDate query params required' });
  }
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid startDate or endDate' });
  }

  const events = await StudyEvent.find({
    userId,
    startTime: { $gte: start },
    endTime: { $lte: end },
    status: { $nin: ['cancelled'] },
  }).sort({ startTime: 1 }).lean();

  res.json({
    success: true,
    data: events || []
  });
});

// Get calendar view for date range
router.get('/study-events/range', protect, getEventsRange);

// Get events for specific date
router.get(
  '/study-events/date/:date',
  protect,
  asyncHandler(async (req, res) => {
    const date = new Date(req.params.date);
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);

    const events = await StudyEvent.find({
      userId: req.user.id,
      startTime: { $gte: date },
      startTime: { $lt: nextDay },
    }).sort({ startTime: 1 });

    res.json({ date: req.params.date, events });
  })
);

// Get calendar view with events for a plan
router.get(
  '/plans/:planId/calendar',
  protect,
  asyncHandler(async (req, res) => {
    const { date } = req.query;

    let query = {
      userId: req.user.id,
      planId: req.params.planId,
    };

    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + 1);
      endDate.setHours(0, 0, 0, 0);

      query.startTime = { $gte: startDate, $lt: endDate };
    }

    const events = await StudyEvent.find(query).sort({ startTime: 1 });

    res.json({
      date,
      events,
      total: events.length,
    });
  })
);

module.exports = router;
module.exports.getEventsRange = getEventsRange;

/**
 * Save Events (Manual or AI)
 * POST /api/study-planner/plans/:planId/events
 */
const saveEvents = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { planId } = req.params;
  const { sessions } = req.body;

  if (!sessions || !Array.isArray(sessions)) {
    return res.status(400).json({ success: false, message: 'Invalid sessions array' });
  }

  console.log(`[PlannerController] Saving ${sessions.length} events for plan ${planId}`);

  // Map to Unified Schema
  const eventsToCreate = sessions.map(s => ({
    userId,
    planId,
    title: s.title || 'Study Session',
    description: s.description,
    topic: s.topic,
    startTime: new Date(s.startTime),
    endTime: new Date(s.endTime),
    type: s.type || 'MANUAL', // Distinguish manual vs AI
    isAutoScheduled: s.isAutoScheduled || false,
    status: 'scheduled',
    metadata: {
      difficulty: s.difficulty,
      priority: s.priority,
      source: 'manual_mode'
    }
  }));

  // Validate Constraints & Conflicts
  if (eventsToCreate.length > 0) {
    const minStart = new Date(Math.min(...eventsToCreate.map(e => e.startTime.getTime())));
    const maxEnd = new Date(Math.max(...eventsToCreate.map(e => e.endTime.getTime())));
    
    // Fetch existing events in range
    const existing = await StudyEvent.find({
      userId,
      startTime: { $lt: maxEnd },
      endTime: { $gt: minStart },
      status: { $ne: 'cancelled' }
    });

    const conflicts = [];
    for (const newEv of eventsToCreate) {
      for (const exEv of existing) {
        if (newEv.startTime < exEv.endTime && newEv.endTime > exEv.startTime) {
          conflicts.push(`'${newEv.title}' overlaps with '${exEv.title}'`);
        }
      }
    }

    if (conflicts.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Scheduling Conflict Detected',
        conflicts
      });
    }
  }

  const created = await StudyEvent.insertMany(eventsToCreate);

  res.status(201).json({
    success: true,
    message: `Saved ${created.length} events`,
    data: created
  });
});

/**
 * Update Event
 * PUT /api/study-planner/events/:eventId
 */
const updateEvent = asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  const updates = req.body;
  const userId = req.user.id;

  const event = await StudyEvent.findOne({ _id: eventId, userId });
  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found' });
  }

  // Basic update
  if (updates.title) event.title = updates.title;
  if (updates.description) event.description = updates.description;
  if (updates.status) event.status = updates.status;
  
  // Time updates & conflict check
  if (updates.startTime && updates.endTime) {
    const newStart = new Date(updates.startTime);
    const newEnd = new Date(updates.endTime);
    
    // Check conflicts excluding self
    const conflict = await StudyEvent.findOne({
      userId,
      _id: { $ne: eventId },
      startTime: { $lt: newEnd },
      endTime: { $gt: newStart },
      status: { $ne: 'cancelled' }
    });

    if (conflict) {
      return res.status(409).json({ success: false, message: 'Time conflict detected' });
    }

    event.startTime = newStart;
    event.endTime = newEnd;
    event.durationMinutes = (newEnd - newStart) / 60000;
  }

  await event.save();
  res.json({ success: true, data: event });
});

/**
 * Delete Event
 * DELETE /api/study-planner/events/:eventId
 */
const deleteEvent = asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  const userId = req.user.id;

  const result = await StudyEvent.deleteOne({ _id: eventId, userId });
  if (result.deletedCount === 0) {
    return res.status(404).json({ success: false, message: 'Event not found' });
  }

  res.json({ success: true, message: 'Event deleted' });
});

module.exports.saveEvents = saveEvents;
module.exports.updateEvent = updateEvent;
module.exports.deleteEvent = deleteEvent;
