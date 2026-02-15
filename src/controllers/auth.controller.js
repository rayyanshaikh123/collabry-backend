const asyncHandler = require('../utils/asyncHandler');
const authService = require('../services/auth.service');

/**
 * Cookie options for the httpOnly refresh token cookie.
 * - httpOnly: not accessible via JavaScript (XSS protection)
 * - secure: only sent over HTTPS in production
 * - sameSite: 'none' for cross-origin (Vercel frontend → Render backend)
 * - path: only sent to auth endpoints that need it
 */
const REFRESH_COOKIE_NAME = 'refreshToken';
const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/api/auth', // only sent to auth routes
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
});

/**
 * Helper: extract request metadata for token audit trail
 */
const getRequestMeta = (req) => ({
  userAgent: req.headers['user-agent'] || null,
  ipAddress: req.ip || req.connection?.remoteAddress || null,
});

/**
 * Helper: set refresh token cookie and send response
 */
const sendAuthResponse = (res, statusCode, message, { user, accessToken, refreshToken }) => {
  // Set refresh token as httpOnly cookie
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions());

  // Only send accessToken in the JSON body (NOT the refresh token)
  // Also include CSRF token for cross-origin setups (frontend can't read backend cookies)
  res.status(statusCode).json({
    success: true,
    message,
    data: {
      user,
      accessToken,
      csrfToken: res.locals.csrfToken, // Exposed by ensureCsrfToken middleware
    },
  });
};

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Public
 */
const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  const result = await authService.registerUser(
    { name, email, password },
    getRequestMeta(req)
  );

  // No tokens issued — user must verify email first
  res.status(201).json({
    success: true,
    message: result.message,
    data: {
      user: result.user,
    },
  });
});

/**
 * @desc    Login user
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const result = await authService.loginUser(email, password, getRequestMeta(req));

  sendAuthResponse(res, 200, 'Login successful', result);
});

/**
 * @desc    Refresh access token
 * @route   POST /api/auth/refresh
 * @access  Public (uses httpOnly cookie)
 */
const refresh = asyncHandler(async (req, res) => {
  // Read refresh token from httpOnly cookie (primary) or body (fallback for migration)
  const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

  const result = await authService.refreshTokens(rawRefreshToken, getRequestMeta(req));

  // Set the new refresh token cookie
  res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getRefreshCookieOptions());

  res.status(200).json({
    success: true,
    message: 'Tokens refreshed successfully',
    data: {
      accessToken: result.accessToken,
      csrfToken: res.locals.csrfToken, // Include CSRF token for cross-origin setups
    },
  });
});

/**
 * @desc    Logout user (revokes refresh token)
 * @route   POST /api/auth/logout
 * @access  Public
 */
const logout = asyncHandler(async (req, res) => {
  const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

  // Revoke the refresh token in DB
  await authService.logoutUser(rawRefreshToken);

  // Clear the cookie
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/api/auth',
  });

  res.status(200).json({
    success: true,
    message: 'Logout successful',
  });
});

/**
 * @desc    Logout from all devices
 * @route   POST /api/auth/logout-all
 * @access  Private (requires auth)
 */
const logoutAll = asyncHandler(async (req, res) => {
  await authService.logoutAll(req.user.id);

  // Clear the cookie on this device too
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/api/auth',
  });

  res.status(200).json({
    success: true,
    message: 'Logged out from all devices',
  });
});

/**
 * @desc    Request password reset
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const result = await authService.forgotPassword(email);

  res.status(200).json({
    success: true,
    message: result.message,
  });
});

/**
 * @desc    Reset password with token
 * @route   POST /api/auth/reset-password
 * @access  Public
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  const result = await authService.resetPassword(token, newPassword);

  // Clear any existing refresh cookie (force re-login)
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/api/auth',
  });

  res.status(200).json({
    success: true,
    message: result.message,
  });
});

/**
 * @desc    Verify email with token
 * @route   POST /api/auth/verify-email
 * @access  Public
 */
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;

  const result = await authService.verifyEmail(token);

  res.status(200).json({
    success: true,
    message: result.message,
  });
});

/**
 * @desc    Resend verification email
 * @route   POST /api/auth/resend-verification
 * @access  Public
 */
const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const result = await authService.resendVerificationEmail(email);

  res.status(200).json({
    success: true,
    message: result.message,
  });
});

/**
 * @desc    Get active sessions for current user
 * @route   GET /api/auth/sessions
 * @access  Private
 */
const getSessions = asyncHandler(async (req, res) => {
  const sessions = await authService.getActiveSessions(req.user.id);

  res.status(200).json({
    success: true,
    data: { sessions },
  });
});

/**
 * @desc    Revoke a specific session
 * @route   DELETE /api/auth/sessions/:sessionId
 * @access  Private
 */
const revokeSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  const result = await authService.revokeSession(req.user.id, sessionId);

  res.status(200).json({
    success: true,
    message: result.message,
  });
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  getSessions,
  revokeSession,
};
