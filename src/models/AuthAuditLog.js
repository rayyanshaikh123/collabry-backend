const mongoose = require('mongoose');

/**
 * Auth Audit Log Schema
 *
 * Records all security-relevant authentication events for audit trail,
 * intrusion detection, and compliance.
 *
 * Stored in a separate capped/TTL collection to avoid bloating the main DB.
 */
const authAuditLogSchema = new mongoose.Schema(
  {
    /** The type of auth event */
    event: {
      type: String,
      required: true,
      enum: [
        'register',
        'login_success',
        'login_failed',
        'logout',
        'logout_all',
        'token_refresh',
        'token_theft_detected',
        'password_change',
        'password_reset_request',
        'password_reset_complete',
        'email_verification',
        'email_verification_resend',
        'session_revoke',
        'account_locked',
      ],
      index: true,
    },

    /** The user ID (null for failed logins with unknown email) */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    /** The email used in the request (useful for failed login tracking) */
    email: {
      type: String,
      default: null,
    },

    /** IP address of the request */
    ipAddress: {
      type: String,
      default: null,
    },

    /** User agent of the request */
    userAgent: {
      type: String,
      default: null,
    },

    /** Whether the action succeeded or failed */
    success: {
      type: Boolean,
      default: true,
    },

    /** Additional context (failure reason, session jti, etc.) */
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Only need createdAt
  }
);

// TTL index — auto-delete logs older than 90 days
authAuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Compound index for querying user history
authAuditLogSchema.index({ userId: 1, createdAt: -1 });

// Compound index for querying events by type + time
authAuditLogSchema.index({ event: 1, createdAt: -1 });

module.exports = mongoose.models.AuthAuditLog || mongoose.model('AuthAuditLog', authAuditLogSchema);
