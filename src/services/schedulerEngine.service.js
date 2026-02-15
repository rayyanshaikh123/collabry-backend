/**
 * Scheduler Engine - Deterministic placement of strategy onto calendar.
 * AI provides strategy only; this engine assigns startTime/endTime.
 */

const StudyEvent = require('../models/StudyEvent');
const slotEngine = require('./slotEngine.service');
const constraintValidator = require('./constraintValidator.service');
const logger = require('../utils/logger');

const MAX_SESSION_MINUTES = 120;
const MIN_SESSION_MINUTES = 30;
const DEFAULT_SESSION_MINUTES = 60;

/**
 * Allocate strategy topics to available slots. Returns event payloads (no DB write).
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.planId
 * @param {Object} params.strategy - { subjects, topics: [{ name, estimatedHours, priorityWeight, difficultyScore, revisionStrategy }], totalEstimatedHours, recommendedDailyLoadRange }
 * @param {Object} params.plan - { startDate, endDate, dailyStudyHours, preferredTimeSlots, weeklyTimetableBlocks }
 * @param {string} params.subject - plan subject/title
 * @returns {Promise<{ events: Array, warnings: Array }>}
 */
async function scheduleStrategy(params) {
  const { userId, planId, strategy, plan, subject = 'Study' } = params;
  const warnings = [];

  // DIAGNOSTIC: Log input params
  logger.info('[SchedulerEngine] scheduleStrategy called', {
    userId,
    planId,
    subject,
    topicCount: strategy?.topics?.length || 0,
    startDate: plan?.startDate,
    endDate: plan?.endDate,
    dailyStudyHours: plan?.dailyStudyHours,
    timetableBlocks: plan?.weeklyTimetableBlocks?.length || 0,
    preferredSlots: plan?.preferredTimeSlots?.length || 0
  });

  if (!strategy || !strategy.topics || strategy.topics.length === 0) {
    logger.warn('[SchedulerEngine] No topics in strategy');
    return { events: [], warnings: ['No topics in strategy'] };
  }

  const startDate = new Date(plan.startDate);
  const endDate = new Date(plan.endDate);
  const dailyStudyHours = plan.dailyStudyHours || 2;
  const preferredTimeSlots = plan.preferredTimeSlots || [];
  const weeklyTimetableBlocks = plan.weeklyTimetableBlocks || [];

  logger.info('[SchedulerEngine] Time bounds', {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    durationDays: Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
  });

  const existingEvents = await StudyEvent.findByDateRange(userId, startDate, endDate);
  logger.info('[SchedulerEngine] Existing events:', existingEvents.length);

  const slots = await slotEngine.findAvailableSlots({
    startDate,
    endDate,
    dailyStudyHours,
    preferredTimeSlots: preferredTimeSlots.length ? preferredTimeSlots.map((s) => {
      if (typeof s === 'string') {
        const r = slotEngine._defaultTimeSlots();
        const map = { morning: r[0], afternoon: r[1], evening: { start: '18:00', end: '22:00' }, night: { start: '22:00', end: '24:00' } };
        return map[s] || r[0];
      }
      return s;
    }) : slotEngine._defaultTimeSlots(),
    existingEvents,
    weeklyTimetableBlocks,
  });

  logger.info('[SchedulerEngine] Available slots:', {
    count: slots.length,
    timetableBlocking: weeklyTimetableBlocks.length > 0,
    preferredSlotType: preferredTimeSlots.length > 0 ? preferredTimeSlots : 'default'
  });

  if (slots.length === 0) {
    logger.error('[SchedulerEngine] ZERO SLOTS AVAILABLE', {
      timetableBlocks: weeklyTimetableBlocks,
      preferredTimeSlots,
      dailyStudyHours,
      existingEventsCount: existingEvents.length
    });
    
    // FALLBACK STRATEGY: Try relaxing constraints
    logger.warn('[SchedulerEngine] Attempting fallback with relaxed constraints...');
    
    let fallbackSlots = [];
    
    // Attempt 1: Ignore timetable blocks (classes can be worked around)
    if (weeklyTimetableBlocks.length > 0) {
      fallbackSlots = await slotEngine.findAvailableSlots({
        startDate,
        endDate,
        dailyStudyHours,
        preferredTimeSlots: preferredTimeSlots.length ? preferredTimeSlots.map((s) => {
          if (typeof s === 'string') {
            const r = slotEngine._defaultTimeSlots();
            const map = { morning: r[0], afternoon: r[1], evening: { start: '18:00', end: '22:00' }, night: { start: '22:00', end: '24:00' } };
            return map[s] || r[0];
          }
          return s;
        }) : slotEngine._defaultTimeSlots(),
        existingEvents,
        weeklyTimetableBlocks: [], // IGNORE timetable blocks
      });
      
      if (fallbackSlots.length > 0) {
        logger.info('[SchedulerEngine] Fallback successful: Using slots despite timetable conflicts');
        warnings.push('⚠️ Some sessions may overlap with your timetable. Please review and adjust manually.');
        // CRITICAL FIX: Properly replace slots array
        slots.length = 0;
        slots.push(...fallbackSlots);
        logger.info(`[SchedulerEngine] Replaced slots array with ${slots.length} fallback slots`);
      }
    }
    
    // Attempt 2: Use all time slots (not just preferred)
    if (fallbackSlots.length === 0 && preferredTimeSlots.length > 0) {
      fallbackSlots = await slotEngine.findAvailableSlots({
        startDate,
        endDate,
        dailyStudyHours,
        preferredTimeSlots: slotEngine._defaultTimeSlots(), // All slots, not just preferred
        existingEvents,
        weeklyTimetableBlocks: [],
      });
      
      if (fallbackSlots.length > 0) {
        logger.info('[SchedulerEngine] Fallback successful: Using non-preferred time slots');
        warnings.push('⚠️ Sessions scheduled outside preferred times due to availability constraints.');
        // CRITICAL FIX: Properly replace slots array
        slots.length = 0;
        slots.push(...fallbackSlots);
        logger.info(`[SchedulerEngine] Replaced slots array with ${slots.length} fallback slots`);
      }
    }
    
    // Final check: Still no slots?
    if (slots.length === 0) {
      logger.error('[SchedulerEngine] All fallback attempts failed - slots still empty');
      return { 
        events: [], 
        warnings: [
          'Unable to create schedule: No available time slots found.',
          'Try: (1) Extend date range, (2) Increase daily study hours, (3) Remove timetable blocks'
        ] 
      };
    }
    
    logger.info(`[SchedulerEngine] Proceeding with ${slots.length} available slots`);
  }

  const topics = [...strategy.topics].sort((a, b) => (b.priorityWeight || 0) - (a.priorityWeight || 0));
  const used = new Set();
  const events = [];

  logger.info('[SchedulerEngine] Starting event generation', {
    topicCount: topics.length,
    slotCount: slots.length,
    sampleSlot: slots[0] || null
  });

  for (const topic of topics) {
    const estimatedHours = topic.estimatedHours || 2;
    // Allow full task duration - will be split across multiple sessions automatically
    let remainingMinutes = Math.round(estimatedHours * 60);
    
    // Normalize extreme durations
    if (remainingMinutes > 360) { // >6 hours
      logger.warn(`[SchedulerEngine] Topic "${topic.name}" has ${estimatedHours}h estimate - will split into multiple sessions`);
    }
    if (remainingMinutes < MIN_SESSION_MINUTES) {
      remainingMinutes = MIN_SESSION_MINUTES;
    }
    
    logger.debug(`[SchedulerEngine] Processing topic: ${topic.name}, estimatedHours: ${estimatedHours}, totalMinutes: ${remainingMinutes}, will split into ${Math.ceil(remainingMinutes / MAX_SESSION_MINUTES)} sessions`);

    let eventsCreatedForTopic = 0;
    for (let i = 0; i < slots.length && remainingMinutes > 0; i++) {
      if (used.has(i)) continue;
      const slot = slots[i];
      
      // DEFENSIVE: Handle multiple slot formats
      const slotStart = slot.startTime 
        ? (typeof slot.startTime === 'string' ? new Date(slot.startTime) : slot.startTime)
        : slot.start;
      const slotEnd = slot.endTime
        ? (typeof slot.endTime === 'string' ? new Date(slot.endTime) : slot.endTime)
        : slot.end;
      
      if (!slotStart || !slotEnd || isNaN(slotStart.getTime()) || isNaN(slotEnd.getTime())) {
        logger.warn(`[SchedulerEngine] Invalid slot at index ${i}:`, { slot });
        continue;
      }
      
      // Calculate available slot capacity first
      const slotCapacityMinutes = Math.floor((slotEnd.getTime() - slotStart.getTime()) / (60 * 1000));
      
      // Skip slots smaller than minimum session duration
      if (slotCapacityMinutes < MIN_SESSION_MINUTES) {
        logger.debug(`[SchedulerEngine] Slot ${i} too small: ${slotCapacityMinutes}min < ${MIN_SESSION_MINUTES}min minimum`);
        continue;
      }
      
      // INTELLIGENT SESSION SPLITTING: Use what fits instead of rejecting
      // Calculate duration as minimum of: remaining work, slot capacity, max session length
      const durationMin = Math.min(
        remainingMinutes,        // Don't schedule more than what's left for this topic
        slotCapacityMinutes,     // Don't exceed what this slot can hold
        MAX_SESSION_MINUTES      // Don't exceed recommended maximum (120min)
      );
      
      // Double-check we can fit minimum session (should always pass after capacity check)
      if (durationMin < MIN_SESSION_MINUTES) {
        logger.debug(`[SchedulerEngine] Calculated duration ${durationMin}min < ${MIN_SESSION_MINUTES}min for slot ${i}`);
        continue;
      }
      
      const endTime = new Date(slotStart.getTime() + durationMin * 60 * 1000);
      
      // Sanity assertion (should never trigger with correct logic above)
      if (endTime > slotEnd) {
        logger.error(`[SchedulerEngine] BUG: endTime ${endTime.toISOString()} > slotEnd ${slotEnd.toISOString()} despite using slotCapacity`);
        continue;
      }
      
      logger.debug(`[SchedulerEngine] ✅ Scheduling ${durationMin}min in slot ${i} (capacity: ${slotCapacityMinutes}min, topic remaining: ${remainingMinutes}min)`);

      used.add(i);
      remainingMinutes -= durationMin;
      eventsCreatedForTopic++;

      const difficulty = topic.difficultyScore >= 7 ? 'hard' : topic.difficultyScore >= 4 ? 'medium' : 'easy';
      events.push({
        userId,
        planId,
        title: `${topic.name} (${topic.revisionStrategy || 'study'})`,
        description: `Study ${topic.name}`,
        topic: topic.name,
        startTime: slotStart,
        endTime,
        priorityScore: (topic.priorityWeight || 0.5) * 100,
        energyTag: durationMin >= 90 ? 'deep_work' : 'medium',
        type: durationMin >= 90 ? 'deep_work' : 'practice',
        difficulty,
        priority: topic.priorityWeight >= 0.7 ? 'high' : 'medium',
        deepWork: durationMin >= 90,
        estimatedEffort: Math.min(10, Math.round((topic.difficultyScore || 5))),
        status: 'pending',
        aiGenerated: true,
        validationPassed: true,
      });
    }
    logger.info(`[SchedulerEngine] Topic "${topic.name}" scheduled: ${eventsCreatedForTopic} events`);
  }
  
  logger.info(`[SchedulerEngine] Event generation complete: ${events.length} total events from ${topics.length} topics`);

  const scheduleForValidation = events.map((e) => ({
    startTime: e.startTime,
    endTime: e.endTime,
  }));
  const validation = await constraintValidator.validate({
    schedule: scheduleForValidation,
    dailyHoursLimit: (plan.recommendedDailyLoadRange?.maxHours || dailyStudyHours) * 1.2,
  });
  if (!validation.valid) {
    warnings.push(...validation.violations);
  }

  // CRITICAL PRODUCTION GUARD: NEVER return empty plans when slots exist
  if (events.length === 0) {
    // Detailed diagnostic analysis
    const diagnostics = {
      slotCount: slots.length,
      topicCount: topics.length,
      topics: topics.map(t => ({ name: t.name, estimatedHours: t.estimatedHours || 2 })),
      usedSlots: used.size,
      availableSlots: slots.length - used.size,
      slotSample: slots.slice(0, 3).map(s => ({
        start: s.startTime || s.start,
        end: s.endTime || s.end,
        capacityMin: s.startTime && s.endTime 
          ? Math.floor((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000)
          : null
      })),
      minSessionRequired: MIN_SESSION_MINUTES,
      maxSessionAllowed: MAX_SESSION_MINUTES
    };
    
    logger.error('[SchedulerEngine] CRITICAL: Zero events generated despite available slots!', diagnostics);
    
    const errorMsg = [
      `Schedule generation failed: 0 events created from ${slots.length} available slots across ${topics.length} topics.`,
      `This indicates a logic bug in the slot allocation algorithm.`,
      `Topics: ${topics.map(t => `${t.name}(${t.estimatedHours || 2}h)`).join(', ')}`,
      `Used slots: ${used.size}/${slots.length}`,
      `Constraint: Sessions must be ${MIN_SESSION_MINUTES}-${MAX_SESSION_MINUTES} minutes`
    ].join(' ');
    
    throw new Error(errorMsg);
  }

  logger.info(`[SchedulerEngine] Generated ${events.length} events`);

  return {
    events: events.map((e) => ({
      ...e,
      startTime: e.startTime.toISOString ? e.startTime.toISOString() : e.startTime,
      endTime: e.endTime.toISOString ? e.endTime.toISOString() : e.endTime,
    })),
    warnings,
  };
}

/**
 * Auto-recovery: reschedule missed (pending, startTime < now) events to next available slots.
 * Updates events in place; does not create new ones.
 */
async function recoverMissedEvents(userId, planId) {
  const StudyPlan = require('../models/StudyPlan');
  const now = new Date();
  const plan = await StudyPlan.findOne({ _id: planId, userId }).lean();
  if (!plan) throw new Error('Plan not found');

  const missed = await StudyEvent.find({
    userId,
    planId,
    status: 'pending',
    startTime: { $lt: now },
  }).sort({ startTime: 1 });

  if (missed.length === 0) return { rescheduled: 0, events: [] };

  const endDate = new Date(plan.endDate);
  const existingEvents = await StudyEvent.findByDateRange(userId, now, endDate);
  const slots = await slotEngine.findAvailableSlots({
    startDate: now,
    endDate,
    dailyStudyHours: plan.dailyStudyHours || 2,
    preferredTimeSlots: plan.preferredTimeSlots || [],
    existingEvents,
    weeklyTimetableBlocks: plan.weeklyTimetableBlocks || [],
  });

  const slotTimes = slots.map((s) => ({
    start: typeof s.startTime === 'string' ? new Date(s.startTime) : s.start,
    end: typeof s.endTime === 'string' ? new Date(s.endTime) : s.end,
    used: false,
  }));

  let rescheduled = 0;
  for (const event of missed) {
    const durationMs = (new Date(event.endTime) - new Date(event.startTime)) || 60 * 60 * 1000;
    const durationMin = Math.ceil(durationMs / (60 * 1000));
    const slotsNeeded = Math.ceil(durationMin / 30);

    for (let i = 0; i <= slotTimes.length - slotsNeeded; i++) {
      const group = slotTimes.slice(i, i + slotsNeeded);
      if (group.some((s) => s.used)) continue;
      const start = group[0].start;
      const end = new Date(start.getTime() + durationMin * 60 * 1000);
      if (end > group[group.length - 1].end) continue;

      event.startTime = start;
      event.endTime = end;
      event.rescheduleCount = (event.rescheduleCount || 0) + 1;
      event.status = 'rescheduled';
      await event.save();
      for (let k = i; k < i + slotsNeeded; k++) slotTimes[k].used = true;
      rescheduled++;
      break;
    }
    if (event.status !== 'rescheduled') {
      event.status = 'missed';
      await event.save();
    }
  }

  return { rescheduled, totalMissed: missed.length };
}

module.exports = { scheduleStrategy, recoverMissedEvents };
