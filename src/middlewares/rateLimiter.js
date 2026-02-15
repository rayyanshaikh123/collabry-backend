/**
 * Redis-based Rate Limiting Middleware
 * Replaces memory-based rate limiting for production multi-replica deployments
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { getRedisClient } = require('../config/redis');

// Note: rate-limit-redis requires a connected Redis client
// For now, using memory store. Redis integration will be added in production deployment.
// TODO: Initialize Redis stores after Redis client is connected in server.js

/**
 * Global rate limiter for all API routes
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 1000,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/ready',
  // Using memory store for now - will be replaced with Redis in production
});

/**
 * Auth rate limiter (stricter)
 * Keys by IP + email to prevent both distributed and per-account attacks
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 5 : 100,
  message: 'Too many login attempts, please try again after 15 minutes.',
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    const email = (req.body?.email || '').toLowerCase().trim();
    // Use ipKeyGenerator helper for proper IPv6 handling
    const ip = ipKeyGenerator(req, res);
    return `${ip}:${email}`;
  },
  // Using memory store for now - will be replaced with Redis in production
});

/**
 * Coupon validation rate limiter (prevent brute-force)
 */
const couponLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: 'Too many coupon validation attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  // Using memory store for now - will be replaced with Redis in production
});

module.exports = {
  globalLimiter,
  authLimiter,
  couponLimiter,
};
