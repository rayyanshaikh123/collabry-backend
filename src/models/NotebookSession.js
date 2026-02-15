const mongoose = require('mongoose');

// ─── Participant Schema ──────────────────────────────────────────────
const ParticipantSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    displayName: {
        type: String,
        default: 'Unknown'
    },
    avatar: String,
    joinedAt: {
        type: Date,
        default: Date.now
    },
    lastSeen: {
        type: Date,
        default: Date.now
    },
    isOnline: {
        type: Boolean,
        default: false
    }
});

// ─── Notebook Session Schema ─────────────────────────────────────────
const NotebookSessionSchema = new mongoose.Schema({
    notebookId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Notebook',
        required: true,
        index: true
    },
    aiSessionId: {
        type: String,
        required: true,
        index: true
    },
    participants: [ParticipantSchema],
    messageCount: {
        type: Number,
        default: 0
    },
    // Track active socket connections per user
    activeConnections: {
        type: Map,
        of: [String], // userId -> [socketId, ...]
        default: new Map()
    }
}, {
    timestamps: true
});

// ─── Indexes ─────────────────────────────────────────────────────────
NotebookSessionSchema.index({ notebookId: 1, aiSessionId: 1 });
NotebookSessionSchema.index({ 'participants.userId': 1 });

// ─── Methods ─────────────────────────────────────────────────────────

/**
 * Add or update a participant in the session.
 */
NotebookSessionSchema.methods.addParticipant = function (userId, displayName, avatar) {
    const existing = this.participants.find(p => p.userId.toString() === userId.toString());
    if (existing) {
        existing.lastSeen = new Date();
        existing.isOnline = true;
        if (displayName) existing.displayName = displayName;
        if (avatar) existing.avatar = avatar;
    } else {
        this.participants.push({
            userId,
            displayName: displayName || 'Unknown',
            avatar,
            joinedAt: new Date(),
            lastSeen: new Date(),
            isOnline: true
        });
    }
};

/**
 * Mark a participant as offline.
 */
NotebookSessionSchema.methods.removeParticipant = function (userId) {
    const participant = this.participants.find(p => p.userId.toString() === userId.toString());
    if (participant) {
        participant.isOnline = false;
        participant.lastSeen = new Date();
    }
};

/**
 * Get list of currently online participants.
 */
NotebookSessionSchema.methods.getOnlineParticipants = function () {
    return this.participants.filter(p => p.isOnline);
};

module.exports = mongoose.model('NotebookSession', NotebookSessionSchema);
