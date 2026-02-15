const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const map = require('lib0/map');
const Board = require('../models/Board');

/**
 * Yjs Persistence + WebSocket Connection Handler
 * 
 * Custom implementation (instead of y-websocket's default utils)
 * to support MongoDB persistence for Collabry boards.
 */

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

// Message types
const messageSync = 0;
const messageAwareness = 1;

// In-memory doc store: docName -> WSSharedDoc
const docs = new Map();

// Debounce timers for persistence
const persistTimers = new Map();
const PERSIST_DEBOUNCE_MS = 2000; // Save to MongoDB 2s after last change

/**
 * WSSharedDoc - A Y.Doc with WebSocket connection tracking + awareness
 */
class WSSharedDoc extends Y.Doc {
  constructor(name) {
    super({ gc: true }); // Enable garbage collection
    this.name = name;
    /** @type {Map<any, Set<number>>} Maps WebSocket -> set of controlled awareness client IDs */
    this.conns = new Map();
    /** @type {awarenessProtocol.Awareness} */
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    // Handle awareness updates
    const awarenessChangeHandler = ({ added, updated, removed }, conn) => {
      const changedClients = added.concat(updated, removed);
      if (conn !== null) {
        const connControlledIDs = this.conns.get(conn);
        if (connControlledIDs !== undefined) {
          added.forEach(clientID => connControlledIDs.add(clientID));
          removed.forEach(clientID => connControlledIDs.delete(clientID));
        }
      }
      // Broadcast awareness update
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
      );
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_, c) => send(this, c, buff));
    };
    this.awareness.on('update', awarenessChangeHandler);

    // Schedule persistence on document update
    this.on('update', (update, origin) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      // Broadcast to all connected clients
      this.conns.forEach((_, conn) => send(this, conn, message));

      // Debounced persist to MongoDB
      schedulePersist(this.name);
    });
  }
}

/**
 * Schedule a debounced persist to MongoDB
 */
function schedulePersist(docName) {
  if (persistTimers.has(docName)) {
    clearTimeout(persistTimers.get(docName));
  }
  persistTimers.set(docName, setTimeout(async () => {
    persistTimers.delete(docName);
    await persistDoc(docName);
  }, PERSIST_DEBOUNCE_MS));
}

/**
 * Persist a Yjs document to MongoDB
 */
async function persistDoc(docName) {
  const doc = docs.get(docName);
  if (!doc) return;

  try {
    const stateVector = Y.encodeStateAsUpdate(doc);
    const stateBuffer = Buffer.from(stateVector);

    // Count shapes in the Yjs store for the board card display
    let shapeCount = 0;
    try {
      const store = doc.getMap('tldraw');
      store.forEach((value, key) => {
        // tldraw stores shapes with keys like 'shape:...' 
        if (key.startsWith('shape:')) shapeCount++;
      });
    } catch (_) { /* ignore count errors */ }

    await Board.findByIdAndUpdate(docName, {
      yjsState: stateBuffer,
      yjsUpdatedAt: new Date(),
      updatedAt: new Date(),
      lastActivity: new Date(),
      shapeCount,
    });

    console.log(`[Yjs] Persisted doc ${docName} (${stateBuffer.length} bytes)`);
  } catch (error) {
    console.error(`[Yjs] Failed to persist doc ${docName}:`, error.message);
  }
}

/**
 * Load a Yjs document from MongoDB (or existing elements)
 */
async function loadDoc(docName, doc) {
  try {
    const board = await Board.findById(docName).lean();
    if (!board) return;

    // If we have a saved Yjs state, apply it
    if (board.yjsState) {
      const update = new Uint8Array(board.yjsState.buffer || board.yjsState);
      Y.applyUpdate(doc, update);
      console.log(`[Yjs] Loaded doc ${docName} from yjsState (${update.length} bytes)`);
      return;
    }

    // Migration: If we have legacy elements but no yjsState, 
    // populate the Yjs doc from the elements array
    if (board.elements && board.elements.length > 0) {
      console.log(`[Yjs] Migrating ${board.elements.length} legacy elements for board ${docName}`);
      
      const store = doc.getMap('tldraw');
      
      board.elements.forEach(el => {
        if (!el.id || !el.type) return;
        
        const record = {
          id: el.id,
          typeName: el.typeName || 'shape',
          type: el.type,
          x: el.x || 0,
          y: el.y || 0,
          rotation: el.rotation || 0,
          isLocked: el.isLocked || false,
          opacity: el.opacity ?? 1,
          props: el.props || {},
          meta: el.meta || {},
          parentId: el.parentId || 'page:page',
          index: el.index || 'a1',
        };
        
        store.set(el.id, record);
      });

      // Persist immediately so next load uses yjsState
      const stateVector = Y.encodeStateAsUpdate(doc);
      await Board.findByIdAndUpdate(docName, {
        yjsState: Buffer.from(stateVector),
        yjsUpdatedAt: new Date(),
      });
      
      console.log(`[Yjs] Migration complete for board ${docName}`);
    }
  } catch (error) {
    console.error(`[Yjs] Failed to load doc ${docName}:`, error.message);
  }
}

/**
 * Get or create a YDoc for a board
 */
async function getYDoc(docName) {
  let doc = docs.get(docName);
  if (doc) return doc;

  doc = new WSSharedDoc(docName);
  docs.set(docName, doc);
  
  await loadDoc(docName, doc);
  return doc;
}

/**
 * Send a message to a WebSocket if it's open
 */
function send(doc, conn, m) {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    closeConn(doc, conn);
    return;
  }
  try {
    conn.send(m, (err) => {
      if (err) closeConn(doc, conn);
    });
  } catch (e) {
    closeConn(doc, conn);
  }
}

/**
 * Close a WebSocket connection and clean up
 */
function closeConn(doc, conn) {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(
      doc.awareness,
      Array.from(controlledIds),
      null
    );

    // If no more connections, persist and clean up after a delay
    if (doc.conns.size === 0) {
      // Final persist
      persistDoc(doc.name);
      // Clean up from memory after 30s of no connections
      setTimeout(() => {
        if (doc.conns.size === 0) {
          docs.delete(doc.name);
          console.log(`[Yjs] Evicted idle doc ${doc.name} from memory`);
        }
      }, 30000);
    }
  }
  conn.close();
}

/**
 * Handle a new WebSocket connection for Yjs sync
 */
async function setupWSConnection(conn, req, { docName }) {
  conn.binaryType = 'arraybuffer';

  const doc = await getYDoc(docName);

  doc.conns.set(conn, new Set());

  // Handle incoming messages
  conn.on('message', (message) => {
    try {
      const data = new Uint8Array(message);
      const decoder = decoding.createDecoder(data);
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case messageSync: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
          if (encoding.length(encoder) > 1) {
            send(doc, conn, encoding.toUint8Array(encoder));
          }
          break;
        }
        case messageAwareness: {
          awarenessProtocol.applyAwarenessUpdate(
            doc.awareness,
            decoding.readVarUint8Array(decoder),
            conn
          );
          break;
        }
      }
    } catch (err) {
      console.error('[Yjs] Error handling message:', err);
      doc.emit('error', [err]);
    }
  });

  // Handle close
  conn.on('close', () => {
    closeConn(doc, conn);
    console.log(`[Yjs] Connection closed for doc ${docName} (${doc.conns.size} remaining)`);
  });

  // Send initial sync step 1
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(doc, conn, encoding.toUint8Array(encoder));
  }

  // Send current awareness states
  const awarenessStates = doc.awareness.getStates();
  if (awarenessStates.size > 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(
        doc.awareness,
        Array.from(awarenessStates.keys())
      )
    );
    send(doc, conn, encoding.toUint8Array(encoder));
  }
}

module.exports = { setupWSConnection, getYDoc, docs, persistDoc };
