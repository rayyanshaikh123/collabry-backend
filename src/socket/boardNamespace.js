const Board = require('../models/Board');
const jwt = require('jsonwebtoken');
const config = require('../config/env');

// In-memory store for active sessions (user presence)
// boardId -> Map of userId -> sessionData
const activeSessions = new Map();

// ── Validation helpers ──────────────────────────────────────────────
const MONGO_ID_RE = /^[a-f\d]{24}$/i;

function isValidMongoId(id) {
  return typeof id === 'string' && MONGO_ID_RE.test(id);
}

function isValidElement(el) {
  if (!el || typeof el !== 'object') return false;
  if (typeof el.id !== 'string' || el.id.length === 0 || el.id.length > 200) return false;
  if (typeof el.type !== 'string' || el.type.length === 0 || el.type.length > 50) return false;
  return true;
}

function isValidChanges(changes) {
  return changes && typeof changes === 'object' && !Array.isArray(changes) && Object.keys(changes).length > 0;
}

// ── Per-socket rate limiter (sliding window) ────────────────────────
function createRateLimiter(maxPerWindow = 60, windowMs = 1000) {
  const buckets = new WeakMap(); // socket → timestamp[]
  return function checkRate(socket) {
    const now = Date.now();
    let list = buckets.get(socket);
    if (!list) {
      list = [];
      buckets.set(socket, list);
    }
    // Trim timestamps outside the window
    while (list.length > 0 && list[0] <= now - windowMs) list.shift();
    if (list.length >= maxPerWindow) return false; // rate-limited
    list.push(now);
    return true;
  };
}

// 60 element mutations per second per socket (generous for drawing)
const elementRateCheck = createRateLimiter(60, 1000);
// 30 cursor moves per second per socket
const cursorRateCheck = createRateLimiter(30, 1000);

/**
 * Initialize board-specific Socket.IO events
 * @param {Object} io - Socket.IO server instance
 */
module.exports = (io) => {
  // Board namespace for all board-related events
  const boardNamespace = io.of('/boards');

  // Authentication middleware for board namespace
  boardNamespace.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, config.jwt.accessSecret);
      socket.userId = decoded.id;
      socket.userEmail = decoded.email;
      socket.userRole = decoded.role;
      next();
    } catch (error) {
      return next(new Error('Invalid token'));
    }
  });

  boardNamespace.on('connection', (socket) => {

    /**
     * Join a board room
     */
    socket.on('board:join', async ({ boardId }, callback) => {
      console.log(`📡 Join request received from ${socket.userEmail} for board: ${boardId}`);
      try {
        if (!isValidMongoId(boardId)) {
          if (typeof callback === 'function') return callback({ error: 'Invalid board ID' });
          return;
        }
        // Verify user has access to this board
        // PERFORMANCE: Use .lean() for faster retrieval and plain JS object
        const board = await Board.findById(boardId).lean();

        if (!board) {
          if (typeof callback === 'function') {
            return callback({ error: 'Board not found' });
          }
          return;
        }

        // Check if user is a member or owner
        const isMember = board.owner.toString() === socket.userId ||
          board.members.some(m => m.userId.toString() === socket.userId);

        if (!isMember && !board.isPublic) {
          if (typeof callback === 'function') {
            return callback({ error: 'Access denied' });
          }
          return;
        }

        // Join the room
        socket.join(boardId);
        socket.currentBoardId = boardId;

        // Add to active sessions using Map for proper user tracking
        if (!activeSessions.has(boardId)) {
          activeSessions.set(boardId, new Map());
        }

        const sessionData = {
          socketId: socket.id,
          userId: socket.userId,
          email: socket.userEmail,
          cursor: { x: 0, y: 0 },
          color: generateUserColor(socket.userId),
          joinedAt: new Date()
        };

        // Use userId as key to prevent duplicate user entries
        activeSessions.get(boardId).set(socket.userId, sessionData);

        // Get all active participants (unique users)
        const participants = Array.from(activeSessions.get(boardId).values());

        // Notify others that user joined
        socket.to(boardId).emit('user:joined', {
          userId: socket.userId,
          email: socket.userEmail,
          color: sessionData.color,
          timestamp: new Date(),
          participants: participants.map(p => ({
            userId: p.userId,
            email: p.email,
            color: p.color,
            cursor: p.cursor
          }))
        });

        // Send current board state and participants to the joining user
        const originalElementCount = board.elements?.length || 0;
        console.log(`[Board ${boardId}] Sending board data with ${originalElementCount} elements to ${socket.userEmail}`);

        // Clean board elements before sending (remove Mongoose fields, ensure required tldraw fields)
        const cleanElements = (board.elements || []).map(el => ({
          id: el.id,
          type: el.type,
          typeName: el.typeName || 'shape',
          x: el.x || 0,
          y: el.y || 0,
          rotation: el.rotation || 0,
          isLocked: el.isLocked || false,
          opacity: el.opacity || 1,
          props: el.props || {},
          meta: el.meta || {},
          parentId: el.parentId || 'page:page',
          index: el.index || 'a1'
        })).filter(el => el.type);

        console.log(`[Board ${boardId}] Sending ${cleanElements.length} cleaned elements (Payload optimized)`);

        // PERFORMANCE: Create a lean board object WITHOUT the duplicate elements array
        const { elements: _, ...leanBoard } = board;

        if (typeof callback === 'function') {
          callback({
            success: true,
            board: leanBoard,
            elements: cleanElements,
            participants: participants.map(p => ({
              userId: p.userId,
              email: p.email,
              color: p.color,
              cursor: p.cursor
            }))
          });
        }

        console.log(`✅ ${socket.userEmail} joined board: ${boardId} (Final payload sent)`);
      } catch (error) {
        console.error('Error joining board:', error.message);
        if (typeof callback === 'function') {
          callback({ error: error.message });
        }
      }
    });

    /**
     * Leave a board room
     */
    socket.on('board:leave', ({ boardId }) => {
      handleUserLeave(socket, boardId);
    });

    /**
     * Create a new element on the board
     */
    socket.on('element:create', async ({ boardId, element }, callback) => {
      try {
        // Validate inputs
        if (!isValidMongoId(boardId) || !isValidElement(element)) {
          if (callback && typeof callback === 'function') return callback({ error: 'Invalid input' });
          return;
        }
        // Rate limit
        if (!elementRateCheck(socket)) {
          if (callback && typeof callback === 'function') return callback({ error: 'Rate limited' });
          return;
        }
        
        const board = await Board.findById(boardId);
        if (!board) {
          if (callback && typeof callback === 'function') {
            return callback({ error: 'Failed to confirm element save' });
          }
          return;
        }

        // Add element with metadata
        const newElement = {
          ...element,
          id: element.id || generateId(),
          createdBy: socket.userId,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        board.elements.push(newElement);
        board.updatedAt = new Date();
        await board.save();

        // Clean element for tldraw - remove Mongoose fields
        const cleanElement = {
          id: savedElement.id,
          type: savedElement.type,
          x: savedElement.x,
          y: savedElement.y,
          rotation: savedElement.rotation,
          isLocked: savedElement.isLocked,
          opacity: savedElement.opacity,
          props: savedElement.props,
          meta: savedElement.meta,
          parentId: savedElement.parentId,
          index: savedElement.index,
          typeName: savedElement.typeName || 'shape'
        };

        // Broadcast to all users in the room except sender
        socket.to(boardId).emit('element:created', {
          element: cleanElement,
          userId: socket.userId,
          timestamp: new Date()
        });

        if (callback && typeof callback === 'function') {
          callback({ success: true, element: cleanElement });
        }
      } catch (error) {
        console.error(`Error creating element on board ${boardId}:`, error.message);
        if (callback && typeof callback === 'function') {
          callback({ error: error.message });
        }
      }
    });

    /**
     * Update an existing element
     */
    socket.on('element:update', async ({ boardId, elementId, changes }, callback) => {
      try {
        // Validate inputs
        if (!isValidMongoId(boardId) || typeof elementId !== 'string' || !elementId || !isValidChanges(changes)) {
          if (callback && typeof callback === 'function') return callback({ error: 'Invalid input' });
          return;
        }
        // Rate limit
        if (!elementRateCheck(socket)) {
          if (callback && typeof callback === 'function') return callback({ error: 'Rate limited' });
          return;
        }
        // Use findOneAndUpdate with upsert for atomic operation
        const board = await Board.findOneAndUpdate(
          {
            _id: boardId,
            'elements.id': elementId
          },
          { $set: updateObj },
          { new: true }
        );

        let wasCreated = false;
        let element;

        // If element wasn't found (no update happened), create it
        if (!board) {
          console.log(`[Board ${boardId}] Element ${elementId} not found for update, attempting push as new`);
          // Element doesn't exist, so add it - use $addToSet pattern to prevent duplicates
          const updatedBoard = await Board.findOneAndUpdate(
            {
              _id: boardId,
              'elements.id': { $ne: elementId }  // Only push if element doesn't exist
            },
            {
              $push: {
                elements: {
                  id: elementId,
                  ...changes,
                  createdBy: socket.userId,
                  createdAt: new Date(),
                  updatedAt: new Date()
                }
              },
              $set: { updatedAt: new Date() }
            },
            { new: true }
          );

          if (!updatedBoard) {
            // Either board doesn't exist OR element was already added by another request
            // If it was already added, it might have been an update that just missed the first check
            const retryBoard = await Board.findOneAndUpdate(
              {
                _id: boardId,
                'elements.id': elementId
              },
              { $set: updateObj },
              { new: true }
            );

            if (!retryBoard) {
              console.error(`[Board ${boardId}] Board not found even on retry for ${elementId}`);
              if (callback && typeof callback === 'function') {
                return callback({ error: 'Board not found' });
              }
              return;
            }

            element = retryBoard.elements.find(el => el.id === elementId);
            // Don't broadcast since it was likely already created
            if (typeof callback === 'function') {
              return callback({ success: true });
            }
            return;
          }

          element = updatedBoard.elements.find(el => el.id === elementId);
          wasCreated = true;
        } else {
          element = board.elements.find(el => el.id === elementId);
        }

        console.log(`[Board ${boardId}] Element update saved to DB. Total elements: ${element ? 'present' : 'error'}`);

        // Broadcast - if it was created, send full element; otherwise send changes
        if (wasCreated) {
          // Convert Mongoose document to plain object and remove Mongoose-specific fields
          const elementObj = element.toObject ? element.toObject() : element;
          const cleanElement = {
            id: elementObj.id,
            type: elementObj.type,
            typeName: elementObj.typeName || 'shape',
            x: elementObj.x,
            y: elementObj.y,
            rotation: elementObj.rotation,
            isLocked: elementObj.isLocked,
            opacity: elementObj.opacity,
            props: elementObj.props,
            meta: elementObj.meta,
            parentId: elementObj.parentId,
            index: elementObj.index,
            typeName: elementObj.typeName || 'shape'
          };

          socket.to(boardId).emit('element:created', {
            element: cleanElement,
            userId: socket.userId,
            timestamp: new Date()
          });
        } else {
          // Get the full element for broadcasting
          const elementObj = element.toObject ? element.toObject() : element;

          // For draw shapes, send complete shape data instead of just changes
          const broadcastData = elementObj.type === 'draw' ? {
            elementId,
            changes: {
              x: elementObj.x,
              y: elementObj.y,
              rotation: elementObj.rotation,
              opacity: elementObj.opacity,
              isLocked: elementObj.isLocked,
              props: elementObj.props, // Complete props with all segments
              type: elementObj.type,
              typeName: elementObj.typeName || 'shape',
              parentId: elementObj.parentId,
              index: elementObj.index,
              meta: elementObj.meta
            },
            userId: socket.userId,
            timestamp: new Date()
          } : {
            elementId,
            changes,
            userId: socket.userId,
            timestamp: new Date()
          };

          socket.to(boardId).emit('element:updated', broadcastData);
        }

        if (callback && typeof callback === 'function') {
          callback({ success: true });
        }
      } catch (error) {
        console.error(`Error updating element on board ${boardId}:`, error.message);
        if (callback && typeof callback === 'function') {
          callback({ error: error.message });
        }
      }
    });

    /**
     * Delete an element
     */
    socket.on('element:delete', async ({ boardId, elementId }, callback) => {
      try {
        // Validate inputs
        if (!isValidMongoId(boardId) || typeof elementId !== 'string' || !elementId) {
          if (typeof callback === 'function') return callback({ error: 'Invalid input' });
          return;
        }
        // Rate limit
        if (!elementRateCheck(socket)) {
          if (typeof callback === 'function') return callback({ error: 'Rate limited' });
          return;
        }
        
        // Use atomic operation to avoid version conflicts
        const board = await Board.findOneAndUpdate(
          { _id: boardId },
          {
            $pull: { elements: { id: elementId } },
            $set: { updatedAt: new Date() }
          },
          { new: true }
        );

        if (!board) {
          if (typeof callback === 'function') {
            return callback({ error: 'Board not found' });
          }
          return;
        }

        // Broadcast to all users in the room except sender
        socket.to(boardId).emit('element:deleted', {
          elementId,
          userId: socket.userId,
          timestamp: new Date()
        });

        if (typeof callback === 'function') {
          callback({ success: true });
        }
      } catch (error) {
        console.error(`Error deleting element on board ${boardId}:`, error.message);
        if (typeof callback === 'function') {
          callback({ error: error.message });
        }
      }
    });

    /**
     * Update cursor position
     */
    socket.on('cursor:move', ({ boardId, position }) => {
      if (!boardId || !position || typeof position.x !== 'number' || typeof position.y !== 'number') return;
      if (!cursorRateCheck(socket)) return;

      // Update cursor in active sessions
      const sessions = activeSessions.get(boardId);
      if (sessions && sessions.has(socket.userId)) {
        const session = sessions.get(socket.userId);
        session.cursor = position;
      }

      // Broadcast cursor position to others (no callback needed for performance)
      socket.to(boardId).emit('cursor:moved', {
        userId: socket.userId,
        email: socket.userEmail,
        position,
        timestamp: Date.now()
      });
    });

    /**
     * Batch update multiple elements (for performance)
     * NOTE: Currently not used by frontend, but kept for future optimization
     */
    socket.on('elements:batch-update', async ({ boardId, updates }, callback) => {
      try {
        if (!isValidMongoId(boardId) || !Array.isArray(updates) || updates.length === 0 || updates.length > 100) {
          if (typeof callback === 'function') return callback({ error: 'Invalid input' });
          return;
        }
        if (!elementRateCheck(socket)) {
          if (typeof callback === 'function') return callback({ error: 'Rate limited' });
          return;
        }
        
        // Use atomic operations for each update to avoid version conflicts
        const updatePromises = updates.map(({ elementId, changes }) => {
          return Board.findOneAndUpdate(
            { _id: boardId, 'elements.id': elementId },
            {
              $set: Object.keys(changes).reduce((acc, key) => {
                acc[`elements.$.${key}`] = changes[key];
                return acc;
              }, { 'elements.$.updatedAt': new Date() })
            },
            { new: true }
          );
        });

        await Promise.all(updatePromises);

        // Update board timestamp
        await Board.findByIdAndUpdate(boardId, { updatedAt: new Date() });

        // Broadcast to all users
        socket.to(boardId).emit('elements:batch-updated', {
          updates,
          userId: socket.userId,
          timestamp: new Date()
        });

        if (typeof callback === 'function') {
          callback({ success: true });
        }
      } catch (error) {
        console.error(`Error batch updating on board ${boardId}:`, error.message);
        if (typeof callback === 'function') {
          callback({ error: error.message });
        }
      }
    });

    /**
     * Handle disconnection
     */
    socket.on('disconnect', () => {
      if (socket.currentBoardId) {
        handleUserLeave(socket, socket.currentBoardId);
      }
    });
  });

  /**
   * Handle user leaving a board
   */
  function handleUserLeave(socket, boardId) {
    socket.leave(boardId);

    // Remove from active sessions using userId as key
    const sessions = activeSessions.get(boardId);
    if (sessions && sessions.has(socket.userId)) {
      sessions.delete(socket.userId);

      // Clean up empty session maps
      if (sessions.size === 0) {
        activeSessions.delete(boardId);
      }
    }

    // Notify others that user left
    const remainingSessions = activeSessions.get(boardId);
    const remainingParticipants = remainingSessions
      ? Array.from(remainingSessions.values()).map(p => ({
          userId: p.userId,
          email: p.email,
          color: p.color,
          cursor: p.cursor
        }))
      : [];

    socket.to(boardId).emit('user:left', {
      userId: socket.userId,
      email: socket.userEmail,
      timestamp: new Date(),
      participants: remainingParticipants
    });
  }

  /**
   * Generate a consistent color for a user based on their ID
   */
  function generateUserColor(userId) {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
      '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
      '#F8B739', '#52B788', '#E76F51', '#2A9D8F'
    ];

    // Generate consistent index from userId
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }

    return colors[Math.abs(hash) % colors.length];
  }

  /**
   * Generate unique ID for elements
   */
  function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  console.log('Board namespace initialized');
};
