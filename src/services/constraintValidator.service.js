/**
 * Constraint Validator - Validates a schedule (array of events) against limits.
 * Deterministic; no AI.
 */

const slotEngine = require('./slotEngine.service');

async function validate(options) {
  const {
    schedule = [],
    studentContext = {},
    dailyHoursLimit = 6,
    examDate = null,
  } = options;

  const violations = [];
  const warnings = [];
  let score = 100;

  if (!Array.isArray(schedule) || schedule.length === 0) {
    return { valid: true, score: 100, warnings: ['Empty schedule'], violations: [] };
  }

  const byDay = {};
  for (const ev of schedule) {
    const start = new Date(ev.startTime);
    const dayKey = start.toISOString().split('T')[0];
    if (!byDay[dayKey]) byDay[dayKey] = [];
    byDay[dayKey].push(ev);
  }

  for (const [day, dayEvents] of Object.entries(byDay)) {
    const result = slotEngine.validateCognitiveDayLoad(dayEvents, dailyHoursLimit);
    if (!result.valid) {
      violations.push(`Day ${day}: exceeds ${dailyHoursLimit}h or too many events (${result.eventCount})`);
      score -= 15;
    }
    if (result.totalHours > dailyHoursLimit * 0.9) {
      warnings.push(`Day ${day}: close to daily limit (${result.totalHours}h)`);
    }
  }

  const conflicts = await slotEngine.detectConflicts({ events: schedule });
  if (conflicts.length > 0) {
    violations.push(`${conflicts.length} conflict(s) detected`);
    score -= conflicts.length * 20;
  }

  const valid = violations.length === 0 && score >= 50;
  return {
    valid,
    score: Math.max(0, score),
    warnings,
    violations,
  };
}

module.exports = { validate };
