const mongoose = require('mongoose');
const crypto = require('crypto');

// ─── Collaborator Schema ──────────────────────────────────────────────
const CollaboratorSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: ['owner', 'editor', 'viewer'],
    default: 'editor'
  },
  // Granular permissions (owner controls these via settings)
  permissions: {
    canChat: { type: Boolean, default: true },
    canAddSources: { type: Boolean, default: true },
    canDeleteSources: { type: Boolean, default: false }, // Only own sources by default
    canGenerateArtifacts: { type: Boolean, default: true },
    canInvite: { type: Boolean, default: false }
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

// ─── Source Schema ────────────────────────────────────────────────────
const SourceSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['pdf', 'text', 'website', 'audio'],  // Replaced 'notes' with 'audio'
    required: true
  },
  name: {
    type: String,
    required: true
  },
  filePath: String, // For uploaded files (local storage)
  url: String, // For websites or audio file URLs
  content: String, // For text or transcriptions
  size: Number, // File size in bytes
  
  // Audio-specific fields
  audioUrl: String, // Cloud storage URL for audio file
  duration: Number, // Duration in seconds
  transcription: String, // Whisper transcription text
  transcriptionStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  transcriptionError: String, // Error message if transcription failed
  transcriptionSegments: [mongoose.Schema.Types.Mixed], // Granular timing data
  
  // RAG-specific fields
  ragStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  ragError: String,
  
  selected: {
    type: Boolean,
    default: true
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  dateAdded: {
    type: Date,
    default: Date.now
  }
});

// ─── Artifact Schema ─────────────────────────────────────────────────
const ArtifactSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['quiz', 'mindmap', 'flashcards', 'infographic', 'course-finder'],
    required: true
  },
  referenceId: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// ─── Notebook Schema ─────────────────────────────────────────────────
const NotebookSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    default: 'Untitled Notebook',
    trim: true
  },
  description: {
    type: String,
    default: ''
  },

  // Sources stored locally
  sources: [SourceSchema],

  // AI Chat Session ID from AI Engine (notebook-scoped for collaboration)
  aiSessionId: {
    type: String,
    index: true
  },

  // Generated artifacts (references to Quiz/MindMap collections)
  artifacts: [ArtifactSchema],

  // ─── Collaboration ─────────────────────────────────────────
  collaborators: [CollaboratorSchema],
  isShared: {
    type: Boolean,
    default: false
  },
  shareCode: {
    type: String,
    unique: true,
    sparse: true // Allow null for non-shared notebooks
  },

  // ─── Collaboration Settings (controlled by owner) ──────────
  settings: {
    allowEditorInvite: { type: Boolean, default: false },
    allowViewerChat: { type: Boolean, default: false },
    allowViewerSources: { type: Boolean, default: false },
    maxCollaborators: { type: Number, default: 10 }
  },

  // Metadata
  lastAccessed: {
    type: Date,
    default: Date.now
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// ─── Indexes ─────────────────────────────────────────────────────────
NotebookSchema.index({ userId: 1, createdAt: -1 });
NotebookSchema.index({ userId: 1, lastAccessed: -1 });
NotebookSchema.index({ 'collaborators.userId': 1 });
// Note: shareCode index is created automatically by 'unique: true' in schema

// ─── Middleware ──────────────────────────────────────────────────────
NotebookSchema.pre('save', function () {
  this.lastAccessed = new Date();
});

// ─── Methods ─────────────────────────────────────────────────────────

/**
 * Check if a user can access this notebook and return their role.
 * @param {ObjectId|string} userId
 * @returns {'owner'|'editor'|'viewer'|null}
 */
NotebookSchema.methods.canAccess = function (userId) {
  const uid = userId.toString();

  // Use .equals() for robust comparison (handles ObjectIds and populated Documents)
  const isOwner = this.userId.equals ? this.userId.equals(uid) : this.userId.toString() === uid;

  // If deleted, only owner has access
  if (this.deletedAt) {
    return isOwner ? 'owner' : null;
  }

  if (isOwner) return 'owner';

  const collab = this.collaborators.find(c => {
    // Check if c.userId is populated
    const cid = c.userId.equals ? c.userId.equals(uid) : c.userId.toString() === uid;
    return cid && (c.status === 'accepted' || !c.status);
  });

  return collab ? collab.role : null;
};

/**
 * Check if a user has a specific permission.
 * Owner always has all permissions.
 * @param {ObjectId|string} userId
 * @param {string} permission - e.g. 'canChat', 'canAddSources', 'canInvite'
 * @returns {boolean}
 */
NotebookSchema.methods.hasPermission = function (userId, permission) {
  const uid = userId.toString();

  // Use .equals() for robust comparison
  const isOwner = this.userId.equals ? this.userId.equals(uid) : this.userId.toString() === uid;

  // If deleted, only owner has permissions
  if (this.deletedAt) {
    return isOwner;
  }

  if (isOwner) return true; // Owner has all permissions

  const collab = this.collaborators.find(c => {
    const cid = c.userId.equals ? c.userId.equals(uid) : c.userId.toString() === uid;
    return cid && (c.status === 'accepted' || !c.status);
  });
  if (!collab) return false;

  // Check granular permission
  if (collab.permissions && collab.permissions[permission] !== undefined) {
    return collab.permissions[permission];
  }

  // Role-based fallback
  if (collab.role === 'editor') return true;
  if (collab.role === 'viewer') {
    // Viewers can only read by default, unless settings override
    if (permission === 'canChat') return this.settings.allowViewerChat;
    if (permission === 'canAddSources') return this.settings.allowViewerSources;
    return false;
  }
  return false;
};

/**
 * Generate a unique share code for invite links.
 */
NotebookSchema.methods.generateShareCode = function () {
  this.shareCode = crypto.randomBytes(6).toString('hex'); // 12-char code
  this.isShared = true;
  return this.shareCode;
};

// ─── Virtuals ────────────────────────────────────────────────────────
NotebookSchema.virtual('sourceCount').get(function () {
  return this.sources.length;
});

NotebookSchema.virtual('artifactCount').get(function () {
  return this.artifacts.length;
});

NotebookSchema.virtual('collaboratorCount').get(function () {
  return this.collaborators.length;
});

module.exports = mongoose.model('Notebook', NotebookSchema);
