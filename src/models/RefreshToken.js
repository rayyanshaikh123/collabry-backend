const mongoose = require('mongoose');
const crypto = require('crypto');

const refreshTokenSchema = new mongoose.Schema({
  // Hashed token (SHA-256 of the raw JWT)
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  // JWT ID (jti claim) — for fast lookup without hashing
  jti: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  // Owner
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  // Has this token been used/rotated? (for replay detection)
  revoked: {
    type: Boolean,
    default: false,
  },
  // Why was it revoked?
  revokedReason: {
    type: String,
    enum: ['rotation', 'logout', 'logout_all', 'theft_detected', 'password_change', null],
    default: null,
  },
  // The token that replaced this one (for theft detection chain)
  replacedByJti: {
    type: String,
    default: null,
  },
  // Token family — all tokens from the same login share a family ID.
  // If a revoked token in this family is reused, revoke the entire family.
  family: {
    type: String,
    required: true,
    index: true,
  },
  // When the JWT itself expires (mirrors the JWT exp claim)
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 }, // TTL index — MongoDB auto-deletes after expiry
  },
  // Device/session info
  userAgent: {
    type: String,
    default: null,
  },
  ipAddress: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

/**
 * Hash a raw JWT string for storage
 */
refreshTokenSchema.statics.hashToken = function (rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
};

/**
 * Find a valid (non-revoked, non-expired) token by jti
 */
refreshTokenSchema.statics.findValidByJti = function (jti) {
  return this.findOne({
    jti,
    revoked: false,
    expiresAt: { $gt: new Date() },
  });
};

/**
 * Revoke all tokens in a family (theft detection)
 */
refreshTokenSchema.statics.revokeFamily = async function (family, reason = 'theft_detected') {
  return this.updateMany(
    { family, revoked: false },
    { $set: { revoked: true, revokedReason: reason } }
  );
};

/**
 * Revoke all tokens for a user (logout everywhere / password change)
 */
refreshTokenSchema.statics.revokeAllForUser = async function (userId, reason = 'logout_all') {
  return this.updateMany(
    { user: userId, revoked: false },
    { $set: { revoked: true, revokedReason: reason } }
  );
};

/**
 * Clean up expired tokens (backup to TTL index)
 */
refreshTokenSchema.statics.cleanExpired = function () {
  return this.deleteMany({ expiresAt: { $lte: new Date() } });
};

module.exports = mongoose.models.RefreshToken || mongoose.model('RefreshToken', refreshTokenSchema);
