const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config/env');

/**
 * Generate a unique JWT ID (jti) for token identification
 * @returns {String} - Unique token ID
 */
const generateJti = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Generate a token family ID (shared across a login session's token chain)
 * @returns {String} - Unique family ID
 */
const generateTokenFamily = () => {
  return crypto.randomBytes(16).toString('hex');
};

/**
 * Sign access token
 * @param {Object} payload - Token payload (user data)
 * @returns {String} - Signed JWT access token
 */
const signAccessToken = (payload) => {
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
    jwtid: generateJti(),
  });
};

/**
 * Sign refresh token with a specific jti (for server-side tracking)
 * @param {Object} payload - Token payload (user data)
 * @param {String} jti - Unique token ID for server-side storage
 * @returns {String} - Signed JWT refresh token
 */
const signRefreshToken = (payload, jti) => {
  if (!jti) {
    jti = generateJti();
  }
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
    jwtid: jti,
  });
};

/**
 * Decode a refresh token WITHOUT verifying (to extract jti for revocation even if expired)
 * @param {String} token - JWT refresh token
 * @returns {Object|null} - Decoded payload or null
 */
const decodeRefreshToken = (token) => {
  try {
    return jwt.decode(token);
  } catch {
    return null;
  }
};

/**
 * Calculate refresh token expiry as a Date object (for DB storage)
 * @returns {Date} - Expiry date
 */
const getRefreshTokenExpiry = () => {
  const expiresIn = config.jwt.refreshExpiresIn || '7d';
  const match = expiresIn.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    // Default to 7 days
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }
  const value = parseInt(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return new Date(Date.now() + value * multipliers[unit]);
};

/**
 * Verify access token
 * @param {String} token - JWT access token
 * @returns {Object} - Decoded token payload
 * @throws {Error} - If token is invalid or expired
 */
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, config.jwt.accessSecret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Access token expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid access token');
    }
    throw error;
  }
};

/**
 * Verify refresh token
 * @param {String} token - JWT refresh token
 * @returns {Object} - Decoded token payload
 * @throws {Error} - If token is invalid or expired
 */
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, config.jwt.refreshSecret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Refresh token expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid refresh token');
    }
    throw error;
  }
};

module.exports = {
  generateJti,
  generateTokenFamily,
  signAccessToken,
  signRefreshToken,
  decodeRefreshToken,
  getRefreshTokenExpiry,
  verifyAccessToken,
  verifyRefreshToken,
};
