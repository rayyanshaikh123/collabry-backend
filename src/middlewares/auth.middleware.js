const { verifyAccessToken } = require('../utils/jwt');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Middleware to protect routes - requires authentication
 * Verifies JWT access token and attaches user to request
 */
const protect = asyncHandler(async (req, res, next) => {
  let token;

  // Check for Bearer token in Authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // Check if token exists
  if (!token) {
    throw new AppError('Not authorized, no token provided', 401);
  }

  try {
    // Verify token
    const decoded = verifyAccessToken(token);

    // Find user by ID from token
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Check if user is active
    if (!user.isActive) {
      throw new AppError('User account is deactivated', 401);
    }

    // Check if password was changed after this token was issued
    if (user.changedPasswordAfter(decoded.iat)) {
      throw new AppError('Password recently changed. Please login again.', 401);
    }

    // Attach user to request object
    req.user = user;
    next();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(error.message || 'Not authorized, token failed', 401);
  }
});

module.exports = { protect };
