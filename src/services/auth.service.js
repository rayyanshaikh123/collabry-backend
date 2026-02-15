const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  decodeRefreshToken,
  generateJti,
  generateTokenFamily,
  getRefreshTokenExpiry,
} = require('../utils/jwt');
const AppError = require('../utils/AppError');
const crypto = require('crypto');
const emailService = require('../utils/emailService');
const { logAuthEvent } = require('../utils/auditLogger');

const config = require('../config/env');

/**
 * Generate email verification token and expiry
 */
const generateVerificationToken = () => {
  const token = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  return { token, hashedToken, expires };
};

/**
 * Issue a new refresh token, persist it in DB, and return both tokens.
 * @param {Object} user - Mongoose user document
 * @param {String} family - Token family ID (new on login, inherited on rotation)
 * @param {Object} meta - { userAgent, ipAddress }
 * @returns {{ accessToken, refreshToken }}
 */
const issueTokenPair = async (user, family, meta = {}) => {
  const payload = {
    id: user._id,
    email: user.email,
    role: user.role,
    subscriptionTier: user.subscriptionTier,
  };

  const jti = generateJti();
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload, jti);

  // Store refresh token in DB
  await RefreshToken.create({
    tokenHash: RefreshToken.hashToken(refreshToken),
    jti,
    user: user._id,
    family,
    expiresAt: getRefreshTokenExpiry(),
    userAgent: meta.userAgent || null,
    ipAddress: meta.ipAddress || null,
  });

  return { accessToken, refreshToken };
};

/**
 * Register a new user
 * @param {Object} data - User registration data
 * @param {Object} meta - Request metadata { userAgent, ipAddress }
 * @returns {Object} - User object and tokens
 */
const registerUser = async (data, meta = {}) => {
  const { name, email, password } = data;

  // Check if user already exists
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    throw new AppError('Email already registered', 400);
  }

  // Generate email verification token
  const { token: verifyToken, hashedToken, expires } = generateVerificationToken();

  // Create new user (emailVerified defaults to false)
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    password,
    emailVerificationToken: hashedToken,
    emailVerificationExpires: expires,
  });

  // Send verification email
  try {
    await emailService.sendEmailVerification(user.email, user.name, verifyToken);
  } catch (error) {
    console.error('Verification email failed:', error);
    // Don't block registration — user can request resend
  }

  logAuthEvent('register', {
    userId: user._id,
    email: user.email,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    user: user.toJSON(),
    message: 'Registration successful. Please check your email to verify your account.',
  };
};

/**
 * Login user
 * @param {String} email - User email
 * @param {String} password - User password
 * @param {Object} meta - Request metadata { userAgent, ipAddress }
 * @returns {Object} - User object and tokens
 */
const loginUser = async (email, password, meta = {}) => {
  if (!email || !password) {
    throw new AppError('Please provide email and password', 400);
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  if (!user.isActive) {
    throw new AppError('Account is deactivated', 401);
  }

  // Check email verification
  if (!user.emailVerified) {
    logAuthEvent('login_failed', {
      userId: user._id,
      email: email.toLowerCase(),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      success: false,
      details: { reason: 'email_not_verified' },
    });
    throw new AppError('Please verify your email before logging in. Check your inbox or request a new verification link.', 403);
  }

  // Check if account is locked
  if (user.isLocked) {
    logAuthEvent('login_failed', {
      userId: user._id,
      email: email.toLowerCase(),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      success: false,
      details: { reason: 'account_locked' },
    });
    throw new AppError('Account is temporarily locked due to too many failed login attempts. Please try again later.', 423);
  }

  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    // Increment failed attempts (may lock the account)
    await user.incLoginAttempts();
    logAuthEvent('login_failed', {
      userId: user._id,
      email: email.toLowerCase(),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      success: false,
      details: { reason: 'invalid_password', attempts: (user.loginAttempts || 0) + 1 },
    });
    throw new AppError('Invalid email or password', 401);
  }

  // Successful login — reset any failed attempt counters
  if (user.loginAttempts > 0) {
    await user.resetLoginAttempts();
  }

  // Issue token pair with a new family (new login session)
  const family = generateTokenFamily();
  const { accessToken, refreshToken } = await issueTokenPair(user, family, meta);

  logAuthEvent('login_success', {
    userId: user._id,
    email: user.email,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    user: user.toJSON(),
    accessToken,
    refreshToken,
  };
};

/**
 * Refresh access token using refresh token (with rotation & theft detection)
 * @param {String} rawRefreshToken - The JWT refresh token string
 * @param {Object} meta - Request metadata { userAgent, ipAddress }
 * @returns {Object} - New access and refresh tokens
 */
const refreshTokens = async (rawRefreshToken, meta = {}) => {
  if (!rawRefreshToken) {
    throw new AppError('Refresh token is required', 400);
  }

  // Step 1: Verify the JWT signature & expiry
  let decoded;
  try {
    decoded = verifyRefreshToken(rawRefreshToken);
  } catch (error) {
    // If expired, try to decode to revoke the family
    const expired = decodeRefreshToken(rawRefreshToken);
    if (expired && expired.jti) {
      const storedToken = await RefreshToken.findOne({ jti: expired.jti });
      if (storedToken) {
        await RefreshToken.revokeFamily(storedToken.family, 'theft_detected');
      }
    }
    throw new AppError('Refresh token expired or invalid. Please login again.', 401);
  }

  // Step 2: Look up the token in DB by jti
  const storedToken = await RefreshToken.findOne({ jti: decoded.jti });

  if (!storedToken) {
    // Token not in DB at all — could be an old token from before this system
    throw new AppError('Refresh token not recognized. Please login again.', 401);
  }

  // Step 3: THEFT DETECTION — if the token was already revoked (used before),
  // someone is replaying an old token. Revoke the entire family.
  if (storedToken.revoked) {
    console.warn(
      `🚨 REFRESH TOKEN REUSE DETECTED for user ${storedToken.user}. ` +
      `Revoking entire token family: ${storedToken.family}`
    );
    await RefreshToken.revokeFamily(storedToken.family, 'theft_detected');
    logAuthEvent('token_theft_detected', {
      userId: storedToken.user,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      success: false,
      details: { family: storedToken.family, jti: storedToken.jti },
    });
    throw new AppError('Suspicious activity detected. All sessions revoked. Please login again.', 401);
  }

  // Step 4: Verify the user still exists and is active
  const user = await User.findById(decoded.id);
  if (!user) {
    await RefreshToken.revokeFamily(storedToken.family, 'rotation');
    throw new AppError('User not found', 404);
  }

  if (!user.isActive) {
    await RefreshToken.revokeFamily(storedToken.family, 'rotation');
    throw new AppError('Account is deactivated', 401);
  }

  // Step 5: Rotate — revoke the current token and issue a new pair in the same family
  const newJti = generateJti();
  storedToken.revoked = true;
  storedToken.revokedReason = 'rotation';
  storedToken.replacedByJti = newJti;
  await storedToken.save();

  const { accessToken, refreshToken: newRefreshToken } = await issueTokenPair(
    user,
    storedToken.family, // same family
    meta
  );

  logAuthEvent('token_refresh', {
    userId: user._id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    details: { family: storedToken.family },
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
  };
};

/**
 * Logout — revoke the specific refresh token
 * @param {String} rawRefreshToken - The JWT refresh token to revoke
 */
const logoutUser = async (rawRefreshToken) => {
  if (!rawRefreshToken) {
    return; // Nothing to revoke
  }

  // Try to decode (even if expired) to get the jti
  const decoded = decodeRefreshToken(rawRefreshToken);
  if (decoded && decoded.jti) {
    await RefreshToken.findOneAndUpdate(
      { jti: decoded.jti },
      { $set: { revoked: true, revokedReason: 'logout' } }
    );
    logAuthEvent('logout', {
      userId: decoded.id,
      details: { jti: decoded.jti },
    });
  }
};

/**
 * Logout from all devices — revoke all refresh tokens for the user
 * @param {String} userId - User ID
 */
const logoutAll = async (userId) => {
  await RefreshToken.revokeAllForUser(userId, 'logout_all');
  logAuthEvent('logout_all', { userId });
};

/**
 * Request password reset
 * @param {String} email - User email
 * @returns {Object} - Success message
 */
const forgotPassword = async (email) => {
  if (!email) {
    throw new AppError('Please provide email address', 400);
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return {
      message: 'If an account with that email exists, we sent a password reset link',
    };
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpires = Date.now() + 3600000;
  await user.save();

  try {
    await emailService.sendPasswordResetEmail(user.email, user.name, resetToken);
  } catch (error) {
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    console.error('Email sending failed:', error);
    throw new AppError('Failed to send password reset email. Please try again.', 500);
  }

  logAuthEvent('password_reset_request', { userId: user._id, email: user.email });

  return {
    message: 'Password reset link sent to your email',
  };
};

/**
 * Reset password with token
 * @param {String} token - Reset token from email
 * @param {String} newPassword - New password
 * @returns {Object} - Success message
 */
const resetPassword = async (token, newPassword) => {
  if (!token || !newPassword) {
    throw new AppError('Token and new password are required', 400);
  }

  if (newPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    throw new AppError('Invalid or expired reset token', 400);
  }

  user.password = newPassword;
  user.resetPasswordToken = null;
  user.resetPasswordExpires = null;
  await user.save();

  // Revoke all existing refresh tokens (force re-login on all devices)
  await RefreshToken.revokeAllForUser(user._id, 'password_change');

  logAuthEvent('password_reset_complete', { userId: user._id, email: user.email });

  try {
    await emailService.sendPasswordResetConfirmation(user.email, user.name);
  } catch (error) {
    console.error('Confirmation email failed:', error);
  }

  return {
    message: 'Password reset successful. Please login with your new password.',
  };
};

/**
 * Verify email with token
 * @param {String} token - Raw verification token from email link
 * @returns {Object} - Success message
 */
const verifyEmail = async (token) => {
  if (!token) {
    throw new AppError('Verification token is required', 400);
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: Date.now() },
  });

  if (!user) {
    throw new AppError('Invalid or expired verification token', 400);
  }

  user.emailVerified = true;
  user.emailVerificationToken = null;
  user.emailVerificationExpires = null;
  await user.save({ validateModifiedOnly: true });

  logAuthEvent('email_verification', { userId: user._id, email: user.email });

  try {
    const notificationService = require('./notification.service');
    await notificationService.notifyWelcome(user._id, user.name);
  } catch (error) {
    console.warn('Failed to send welcome notification:', error.message);
  }

  return {
    message: 'Email verified successfully. You can now login.',
  };
};

/**
 * Resend verification email
 * @param {String} email - User email
 * @returns {Object} - Success message
 */
const resendVerificationEmail = async (email) => {
  if (!email) {
    throw new AppError('Email is required', 400);
  }

  const user = await User.findOne({ email: email.toLowerCase() });

  // Don't reveal if user exists
  if (!user || user.emailVerified) {
    return {
      message: 'If an unverified account with that email exists, a new verification link has been sent.',
    };
  }

  // Rate-limit: don't resend if last token was generated < 60 seconds ago
  if (
    user.emailVerificationExpires &&
    user.emailVerificationExpires.getTime() > Date.now() + (24 * 60 * 60 * 1000 - 60 * 1000)
  ) {
    throw new AppError('Verification email was recently sent. Please wait 60 seconds before requesting again.', 429);
  }

  const { token: verifyToken, hashedToken, expires } = generateVerificationToken();

  user.emailVerificationToken = hashedToken;
  user.emailVerificationExpires = expires;
  await user.save({ validateModifiedOnly: true });

  try {
    await emailService.sendEmailVerification(user.email, user.name, verifyToken);
  } catch (error) {
    console.error('Resend verification email failed:', error);
    throw new AppError('Failed to send verification email. Please try again later.', 500);
  }

  return {
    message: 'If an unverified account with that email exists, a new verification link has been sent.',
  };
};

/**
 * Get active sessions for a user
 * @param {String} userId - User ID
 * @returns {Array} - List of active sessions
 */
const getActiveSessions = async (userId) => {
  const sessions = await RefreshToken.find({
    user: userId,
    revoked: false,
    expiresAt: { $gt: new Date() },
  })
    .select('jti userAgent ipAddress createdAt expiresAt')
    .sort({ createdAt: -1 })
    .lean();

  return sessions.map((s) => ({
    id: s.jti,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
  }));
};

/**
 * Revoke a specific session by jti
 * @param {String} userId - User ID (ensures they can only revoke their own)
 * @param {String} sessionId - The jti of the session to revoke
 * @returns {Object} - Success message
 */
const revokeSession = async (userId, sessionId) => {
  const token = await RefreshToken.findOne({
    jti: sessionId,
    user: userId,
    revoked: false,
  });

  if (!token) {
    throw new AppError('Session not found or already revoked', 404);
  }

  token.revoked = true;
  token.revokedReason = 'logout';
  await token.save();

  logAuthEvent('session_revoke', {
    userId,
    details: { jti: sessionId },
  });

  return {
    message: 'Session revoked successfully',
  };
};

module.exports = {
  registerUser,
  loginUser,
  refreshTokens,
  logoutUser,
  logoutAll,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerificationEmail,
  getActiveSessions,
  revokeSession,
};
