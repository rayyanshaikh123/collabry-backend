const WebSocket = require('ws');
const http = require('http');
const Y = require('yjs');
const { setupWSConnection, setPersistence } = require('./yjsPersistence');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const Board = require('../models/Board');
const url = require('url');

/**
 * Yjs WebSocket Server for tldraw collaboration
 * 
 * Handles real-time CRDT sync between tldraw clients.
 * Each board gets its own Yjs document identified by boardId.
 * Documents are persisted to MongoDB on changes.
 */

// In-memory map of active Yjs docs: boardId -> { doc, conns, awareness }
const docs = new Map();

/**
 * Attach the Yjs WebSocket server to an existing HTTP server
 * @param {http.Server} server - The Express HTTP server
 */
function attachYjsWebSocket(server) {
  const wss = new WebSocket.Server({ noServer: true });

  // Handle upgrade requests on /yjs path
  server.on('upgrade', async (request, socket, head) => {
    const pathname = url.parse(request.url).pathname;

    if (pathname?.startsWith('/yjs/')) {
      // Extract boardId and token from URL: /yjs/{boardId}?token={jwt}
      const parts = pathname.split('/');
      const boardId = parts[2];
      const params = new URLSearchParams(url.parse(request.url).query || '');
      const token = params.get('token');

      // Authenticate
      try {
        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        const decoded = jwt.verify(token, config.jwt.accessSecret);
        
        // Verify board access
        const board = await Board.findById(boardId).lean();
        if (!board) {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }

        const userId = decoded.id;
        const isMember = board.owner.toString() === userId ||
          board.members.some(m => m.userId.toString() === userId);

        if (!isMember && !board.isPublic) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }

        // Store user info on the request for later use
        request.userId = userId;
        request.userEmail = decoded.email;
        request.boardId = boardId;

        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      } catch (error) {
        console.error('[Yjs] Auth error:', error.message);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      }
    }
    // Don't handle non-yjs upgrades — let Socket.IO handle those
  });

  wss.on('connection', (ws, request) => {
    const { boardId, userId, userEmail } = request;
    console.log(`[Yjs] ${userEmail} connected to board ${boardId}`);

    setupWSConnection(ws, request, { docName: boardId });
  });

  console.log('[Yjs] WebSocket server attached (upgrade path: /yjs/{boardId})');
  return wss;
}

module.exports = { attachYjsWebSocket };
