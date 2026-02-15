const asyncHandler = require('../utils/asyncHandler');
const mongoose = require('mongoose');
const { checkRedisHealth } = require('../config/redis');

/**
 * @desc    Basic health check (liveness probe)
 * @route   GET /health
 * @access  Public
 * @info    Fast check - just confirms process is running
 */
const healthCheck = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      unit: 'MB'
    }
  });
});

/**
 * @desc    Readiness check (readiness probe)
 * @route   GET /ready
 * @access  Public
 * @info    Comprehensive check - verifies all dependencies
 */
const readinessCheck = asyncHandler(async (req, res) => {
  const checks = {
    mongodb: false,
    redis: false,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  };

  // Check MongoDB connection
  try {
    if (mongoose.connection.readyState === 1) {
      // Ping MongoDB to ensure it's responsive
      await mongoose.connection.db.admin().ping();
      checks.mongodb = true;
    }
  } catch (error) {
    console.error('MongoDB health check failed:', error.message);
    checks.mongodb = false;
    checks.mongodb_error = error.message;
  }

  // Check Redis connection
  try {
    const redisHealthy = await checkRedisHealth();
    checks.redis = redisHealthy;
    if (!redisHealthy) {
      checks.redis_warning = 'Redis not available - rate limiting using memory store';
    }
  } catch (error) {
    console.error('Redis health check failed:', error.message);
    checks.redis = false;
    checks.redis_error = error.message;
  }

  // Determine overall readiness
  // MongoDB is critical, Redis is optional (falls back to memory)
  const isReady = checks.mongodb;

  res.status(isReady ? 200 : 503).json({
    success: isReady,
    message: isReady ? 'Service is ready' : 'Service is not ready',
    checks
  });
});

module.exports = {
  healthCheck,
  readinessCheck,
};
