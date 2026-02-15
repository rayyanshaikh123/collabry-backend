const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config/env');

let io = null;

/**
 * Initialize Socket.IO server
 * @param {Object} httpServer - HTTP server instance
 */
const initializeSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Allow all origins in development or if strict origin check is disabled
        if (config.env === 'development' || !origin) {
          callback(null, true);
        } else {
          const allowedOrigins = [
            'http://localhost:3000', 
            'https://colab-back.onrender.com',
            process.env.FRONTEND_URL // Add env variable support
          ].filter(Boolean);
          
          if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*')) {
            callback(null, true);
          } else {
            console.warn('Socket CORS blocked origin:', origin);
            callback(new Error('Not allowed by CORS'));
          }
        }
      },
      credentials: true,
      methods: ['GET', 'POST']
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    allowEIO3: true,
  });

  // REMOVED redundant global middleware to prevent double-auth hangs
  // Authentication is handled at the namespace level (e.g., boardNamespace.js)

  // Connection handler (simplified)
  io.on('connection', (socket) => {
    console.log(`🔌 New base socket connection: ${socket.id}`);

    socket.on('disconnect', (reason) => {
      console.log(`❌ Base socket disconnected: ${reason}`);
    });
  });

  // Board sync is now handled by Yjs WebSocket (yjsServer.js)
  // Legacy boardNamespace kept but disabled to avoid confusion:
  // require('./boardNamespace')(io);

  // Initialize chat namespace
  const { initializeChatNamespace } = require('./chatNamespace');
  initializeChatNamespace(io);

  // Initialize notification namespace
  require('./notificationNamespace')(io);
  require('./notebookCollabNamespace')(io);

  console.log('🔌 Socket.IO initialized');
  return io;
};

/**
 * Get Socket.IO instance
 */
const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized. Call initializeSocket first.');
  }
  return io;
};

module.exports = { initializeSocket, getIO };
