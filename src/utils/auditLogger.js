const AuthAuditLog = require('../models/AuthAuditLog');

/**
 * Auth Audit Logger
 *
 * Fire-and-forget logging — never throws or blocks the auth flow.
 * If logging fails, we console.error and move on.
 */

/**
 * Log an auth event
 *
 * @param {string} event - Event type (matches AuthAuditLog.event enum)
 * @param {Object} data
 * @param {string} [data.userId] - User ID (if known)
 * @param {string} [data.email] - Email used in the request
 * @param {string} [data.ipAddress] - Client IP
 * @param {string} [data.userAgent] - Client user-agent
 * @param {boolean} [data.success=true] - Whether the action succeeded
 * @param {Object} [data.details] - Extra context
 */
const logAuthEvent = (event, data = {}) => {
  const {
    userId = null,
    email = null,
    ipAddress = null,
    userAgent = null,
    success = true,
    details = null,
  } = data;

  // Fire-and-forget — don't await
  AuthAuditLog.create({
    event,
    userId,
    email,
    ipAddress,
    userAgent,
    success,
    details,
  }).catch((err) => {
    console.error('Audit log write failed:', err.message);
  });
};

module.exports = { logAuthEvent };
