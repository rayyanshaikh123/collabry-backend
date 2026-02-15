const AppError = require('../utils/AppError');

/**
 * Middleware to authorize specific roles
 * Must be used after protect middleware
 * @param  {...String} roles - Allowed roles (e.g., 'admin', 'user')
 */
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    // Check if user exists (should be attached by protect middleware)
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    // Check if user role is in allowed roles
    if (!roles.includes(req.user.role)) {
      throw new AppError(
        `Role '${req.user.role}' is not authorized to access this resource`,
        403
      );
    }

    next();
  };
};

module.exports = authorizeRoles;
