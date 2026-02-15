const app = require('./app');
const http = require('http');
const connectDB = require('./config/db');
const config = require('./config/env');
const { initializeSocket } = require('./socket');
const { registerEventListeners } = require('./utils/eventListeners');
const { getRedisClient, closeRedis } = require('./config/redis');
const { killPort } = require('./utils/killPort');

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  console.error(err.name, err.message);
  process.exit(1);
});

// Initialize services
async function initializeServices() {
  // Connect to database
  await connectDB();
  
  // Connect to Redis (for rate limiting)
  try {
    await getRedisClient();
    console.log('✅ Redis initialized for rate limiting');
  } catch (error) {
    console.warn('⚠️  Redis connection failed. Rate limiting will use memory store.');
    console.warn('   This is NOT recommended for production with multiple replicas.');
  }
}

// Start initialization
initializeServices();

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO (for chat, notifications, notebook collab)
const io = initializeSocket(server);

// Initialize Yjs WebSocket server (for tldraw board collaboration)
const { attachYjsWebSocket } = require('./socket/yjsServer');
attachYjsWebSocket(server);

// Register Tier-2/3 event listeners
registerEventListeners();

// NOTE: Cron jobs are now handled by backend-worker service
// See: backend/src/workers/cron.js
// This prevents duplicate job execution in multi-replica deployments

// Start server with automatic port cleanup
async function startServer() {
  try {
    // Kill any process using the port
    const wasKilled = await killPort(config.port);
    if (wasKilled) {
      console.log(`🔄 Freed up port ${config.port}`);
    }
    
    // Start the server
    server.listen(config.port, () => {
      console.log(`🚀 Server running in ${config.env} mode on port ${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION! 💥 Shutting down...');
  console.error(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});

// Graceful shutdown
let isShuttingDown = false;

process.on('SIGTERM', () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  
  // 1. Stop accepting new connections (HTTP server)
  server.close(() => {
    console.log('✅ HTTP server closed');
  });
  
  // 2. Close Socket.IO connections gracefully
  if (io) {
    console.log('🔌 Closing Socket.IO connections...');
    io.close(() => {
      console.log('✅ Socket.IO closed');
    });
  }
  
  // 3. Close Redis connection
  closeRedis().then(() => {
    console.log('✅ Redis connection closed');
  }).catch((err) => {
    console.error('Error closing Redis:', err.message);
  });
  
  // 4. Force shutdown after grace period
  setTimeout(() => {
    console.error('⏱️  Forcing shutdown after 30s grace period');
    process.exit(0);
  }, 30000); // 30 second grace period
});
