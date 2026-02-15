/**
 * Slot Engine - Deterministic availability grid.
 * Respects dailyStudyHours, preferredTimeSlots, existing events, sleep, and optional weeklyTimetableBlocks.
 */

const logger = require('../utils/logger');

const SLOT_DURATION_MIN = 30;
const TIME_RANGES = {
  morning: { start: 6, end: 12 },
  afternoon: { start: 12, end: 18 },
  evening: { start: 18, end: 23 },
  night: { start: 22, end: 24 },
};

function _defaultTimeSlots() {
  return [
    { start: '09:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ];
}

function _parseTime(str) {
  if (!str || typeof str !== 'string') return 0;
  const [h, m] = str.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function _isInSleep(slotStartMin, slotEndMin, sleepStart, sleepEnd) {
  const start = _parseTime(sleepStart);
  const end = _parseTime(sleepEnd);
  if (end <= start) {
    return slotStartMin >= start || slotEndMin <= end;
  }
  return slotStartMin >= start && slotEndMin <= end;
}

function _isBlockedByTimetable(slotStart, slotEnd, dayOfWeek, weeklyBlocks = []) {
  if (!weeklyBlocks || weeklyBlocks.length === 0) return false;
  const blocksForDay = weeklyBlocks.filter((b) => b.dayOfWeek === dayOfWeek);
  const slotStartMin = slotStart.getHours() * 60 + slotStart.getMinutes();
  const slotEndMin = slotEnd.getHours() * 60 + slotEnd.getMinutes();
  for (const b of blocksForDay) {
    const bStart = _parseTime(b.startTime);
    const bEnd = _parseTime(b.endTime);
    if (slotStartMin < bEnd && slotEndMin > bStart) return true;
  }
  return false;
}

function _overlapsExisting(slotStart, slotEnd, existingEvents) {
  if (!existingEvents || existingEvents.length === 0) return false;
  const s = slotStart.getTime();
  const e = slotEnd.getTime();
  for (const ev of existingEvents) {
    const es = new Date(ev.startTime).getTime();
    const ee = new Date(ev.endTime || ev.startTime).getTime();
    if (s < ee && e > es) return true;
  }
  return false;
}

/**
 * Build available slots (deterministic). Optional weeklyTimetableBlocks on plan to respect locked blocks.
 */
async function findAvailableSlots(options) {
  const {
    startDate,
    endDate,
    dailyStudyHours = 2,
    preferredTimeSlots = _defaultTimeSlots(),
    existingEvents = [],
    sleepSchedule = { start: '23:00', end: '07:00' },
    weeklyTimetableBlocks = [],
  } = options;

  const slots = [];
  const dailyMinutes = Math.round(dailyStudyHours * 60);
  const sleepStart = sleepSchedule.start || '23:00';
  const sleepEnd = sleepSchedule.end || '07:00';

  const prefRanges = Array.isArray(preferredTimeSlots)
    ? preferredTimeSlots
    : _defaultTimeSlots();
  const ranges = prefRanges.map((p) => ({
    start: _parseTime(p.start || p.startTime),
    end: _parseTime(p.end || p.endTime),
  })).filter((r) => r.end > r.start);

  if (ranges.length === 0) {
    ranges.push({ start: 9 * 60, end: 18 * 60 });
  }

  let current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  while (current <= end) {
    const dayOfWeek = current.getDay();
    let usedMinutes = 0;

    for (const range of ranges) {
      if (usedMinutes >= dailyMinutes) break;
      let slotStartMin = range.start;
      const dayStart = new Date(current);
      dayStart.setHours(0, 0, 0, 0);

      while (slotStartMin + SLOT_DURATION_MIN <= range.end && usedMinutes < dailyMinutes) {
        const slotStart = new Date(dayStart);
        slotStart.setMinutes(slotStartMin);
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + SLOT_DURATION_MIN);
        const slotStartMinAbs = slotStart.getHours() * 60 + slotStart.getMinutes();
        const slotEndMinAbs = slotEnd.getHours() * 60 + slotEnd.getMinutes();

        if (_isInSleep(slotStartMinAbs, slotEndMinAbs, sleepStart, sleepEnd)) {
          slotStartMin += SLOT_DURATION_MIN;
          continue;
        }
        if (_isBlockedByTimetable(slotStart, slotEnd, dayOfWeek, weeklyTimetableBlocks)) {
          slotStartMin += SLOT_DURATION_MIN;
          continue;
        }
        if (_overlapsExisting(slotStart, slotEnd, existingEvents)) {
          slotStartMin += SLOT_DURATION_MIN;
          continue;
        }

        const quality = range.end - slotStartMin >= 120 ? 85 : 65;
        slots.push({
          startTime: slotStart.toISOString(),
          endTime: slotEnd.toISOString(),
          start: slotStart,
          end: slotEnd,
          durationMinutes: SLOT_DURATION_MIN,
          deepWork: SLOT_DURATION_MIN >= 60,
          quality,
        });
        usedMinutes += SLOT_DURATION_MIN;
        slotStartMin += SLOT_DURATION_MIN;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  return slots;
}

function getSlotStatistics(slots) {
  const total = slots.length;
  const totalMinutes = total * SLOT_DURATION_MIN;
  const byDay = {};
  slots.forEach((s) => {
    const d = (s.startTime || (s.start && s.start.toISOString())).split('T')[0];
    byDay[d] = (byDay[d] || 0) + 1;
  });
  return { totalSlots: total, totalMinutes, daysWithSlots: Object.keys(byDay).length };
}

function validateCognitiveDayLoad(dayEvents, maxHoursPerDay = 6) {
  const totalMinutes = dayEvents.reduce((sum, ev) => {
    const start = new Date(ev.startTime).getTime();
    const end = new Date(ev.endTime || ev.startTime).getTime();
    return sum + (end - start) / (1000 * 60);
  }, 0);
  const totalHours = totalMinutes / 60;
  const valid = totalHours <= maxHoursPerDay && dayEvents.length <= 8;
  return {
    valid,
    totalMinutes: Math.round(totalMinutes),
    totalHours: Math.round(totalHours * 10) / 10,
    eventCount: dayEvents.length,
  };
}

async function detectConflicts(options) {
  const { userId, events = [] } = options;
  const conflicts = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      const as = new Date(a.startTime).getTime();
      const ae = new Date(a.endTime || a.startTime).getTime();
      const bs = new Date(b.startTime).getTime();
      const be = new Date(b.endTime || b.startTime).getTime();
      if (as < be && bs < ae) {
        conflicts.push({ eventA: a, eventB: b });
      }
    }
  }
  return conflicts;
}

module.exports = {
  findAvailableSlots,
  getSlotStatistics,
  validateCognitiveDayLoad,
  detectConflicts,
  _defaultTimeSlots,
};
