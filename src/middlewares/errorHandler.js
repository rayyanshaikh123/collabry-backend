const AppError = require('../utils/AppError');

/**
 * Handle 404 errors - Route not found
 */
const notFound = (req, res, next) => {
  const error = new AppError(`Not Found - ${req.originalUrl}`, 404);
  next(error);
};

/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.statusCode = err.statusCode || 500;

  // Log error for debugging
  if (process.env.NODE_ENV === 'development') {
    console.error('Error:', {
      message: error.message,
      stack: err.stack,
      statusCode: error.statusCode,
    });
  }

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    error.message = 'Resource not found';
    error.statusCode = 404;
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    error.message = 'Duplicate field value entered';
    error.statusCode = 400;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map((val) => val.message);
    error.message = message;
    error.statusCode = 400;

    // Log validation specifics in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Validation Error Details:', err.errors);
    }
  }

  // JWT errors — return 401 with clear messages
  if (err.name === 'TokenExpiredError') {
    error.message = 'Token has expired. Please login again.';
    error.statusCode = 401;
  }

  if (err.name === 'JsonWebTokenError') {
    error.message = 'Invalid token. Please login again.';
    error.statusCode = 401;
  }

  if (err.name === 'NotBeforeError') {
    error.message = 'Token is not yet active.';
    error.statusCode = 401;
  }

  res.status(error.statusCode).json({
    success: false,
    error: error.message || 'Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = {
  notFound,
  errorHandler,
};
