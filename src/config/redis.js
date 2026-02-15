/**
 * Redis Client Configuration
 * Used for rate limiting and session management across replicas
 */

const redis = require('redis');
const config = require('./env');

let redisClient = null;

/**
 * Get Redis client instance (singleton)
 */
async function getRedisClient() {
  if (redisClient && redisClient.isReady) {
    return redisClient;
  }

  try {
    // Create Redis client
    redisClient = redis.createClient({
      url: config.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('❌ Redis reconnection failed after 10 attempts');
            return new Error('Redis max reconnection attempts exceeded');
          }
          // Exponential backoff: 50ms, 100ms, 200ms, 400ms, ...
          const delay = Math.min(retries * 50, 2000);
          console.log(`⏳ Redis reconnecting... attempt ${retries}, delay ${delay}ms`);
          return delay;
        },
      },
    });

    // Event handlers
    redisClient.on('error', (err) => {
      console.error('❌ Redis Client Error:', err.message);
    });

    redisClient.on('connect', () => {
      console.log('🔌 Redis connecting...');
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis client ready');
    });

    redisClient.on('disconnect', () => {
      console.warn('⚠️  Redis client disconnected');
    });

    redisClient.on('reconnecting', () => {
      console.log('🔄 Redis client reconnecting...');
    });

    // Connect to Redis
    await redisClient.connect();

    return redisClient;
  } catch (error) {
    console.error('❌ Failed to connect to Redis:', error.message);
    console.warn('⚠️  Rate limiting will fall back to memory store (not recommended for production)');
    redisClient = null;
    return null;
  }
}

/**
 * Close Redis connection gracefully
 */
async function closeRedis() {
  if (redisClient && redisClient.isReady) {
    try {
      await redisClient.disconnect();
      console.log('👋 Redis connection closed');
    } catch (error) {
      console.error('Error closing Redis:', error.message);
    }
  }
}

/**
 * Check Redis health
 */
async function checkRedisHealth() {
  try {
    const client = await getRedisClient();
    if (!client) return false;
    
    const pong = await client.ping();
    return pong === 'PONG';
  } catch (error) {
    console.error('Redis health check failed:', error.message);
    return false;
  }
}

module.exports = {
  getRedisClient,
  closeRedis,
  checkRedisHealth,
};
