const mongoose = require('mongoose');

// Flexible schema for tldraw elements - store as-is
const boardElementSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  // Store the entire tldraw shape as flexible JSON
  type: String,
  x: Number,
  y: Number,
  rotation: Number,
  isLocked: Boolean,
  opacity: Number,
  meta: mongoose.Schema.Types.Mixed,
  props: mongoose.Schema.Types.Mixed,
  parentId: String,
  index: String,
  typeName: String,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true, strict: false }); // Allow additional fields

const boardSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Board title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [{
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
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  elements: [boardElementSchema],
  // Yjs CRDT state — binary snapshot of the collaborative document
  yjsState: {
    type: Buffer,
    default: null
  },
  yjsUpdatedAt: {
    type: Date,
    default: null
  },
  isPublic: {
    type: Boolean,
    default: false
  },
  settings: {
    backgroundColor: {
      type: String,
      default: '#FFFFFF'
    },
    gridEnabled: {
      type: Boolean,
      default: true
    },
    gridSize: {
      type: Number,
      default: 20
    },
    snapToGrid: {
      type: Boolean,
      default: false
    },
    canvasWidth: {
      type: Number,
      default: 5000
    },
    canvasHeight: {
      type: Number,
      default: 5000
    },
    allowComments: {
      type: Boolean,
      default: true
    },
    allowExport: {
      type: Boolean,
      default: true
    }
  },
  thumbnail: {
    type: String // URL to thumbnail image
  },
  tags: [{
    type: String,
    trim: true
  }],
  lastActivity: {
    type: Date,
    default: Date.now
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  shapeCount: {
    type: Number,
    default: 0
  },
  deletedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
boardSchema.index({ owner: 1, createdAt: -1 });
boardSchema.index({ 'members.userId': 1 });
boardSchema.index({ isPublic: 1, isArchived: 1 });
boardSchema.index({ lastActivity: -1 });
boardSchema.index({ tags: 1 });
boardSchema.index({ title: 'text', description: 'text' });

// Virtual for element count (prefer persisted shapeCount, fall back to elements array)
boardSchema.virtual('elementCount').get(function () {
  return this.shapeCount || this.elements?.length || 0;
});

// Virtual for member count
boardSchema.virtual('memberCount').get(function () {
  return (this.members?.length || 0) + 1; // +1 for owner
});

// Update lastActivity on any change
boardSchema.pre('save', function () {
  this.lastActivity = new Date();
});

// Method to check if user has access
boardSchema.methods.hasAccess = function (userId) {
  const userIdStr = userId.toString();

  // Handle both populated and unpopulated owner field
  const ownerIdStr = (this.owner._id || this.owner).toString();

  console.log('  🔐 hasAccess check:');
  console.log('    userId:', userId, 'type:', typeof userId);
  console.log('    userIdStr:', userIdStr);
  console.log('    this.owner:', this.owner, 'type:', typeof this.owner);
  console.log('    ownerIdStr:', ownerIdStr);
  console.log('    Match owner?', ownerIdStr === userIdStr);

  if (ownerIdStr === userIdStr) {
    console.log('    ✅ Access granted: User is owner');
    return true;
  }

  if (this.isPublic) {
    console.log('    ✅ Access granted: Board is public');
    return true;
  }

  // Handle both populated and unpopulated member userId
  const isMember = this.members.some(m => {
    const memberIdStr = (m.userId._id || m.userId).toString();
    return memberIdStr === userIdStr;
  });
  
  console.log('    Is member?', isMember);
  if (isMember) {
    console.log('    ✅ Access granted: User is member');
  } else {
    console.log('    ❌ Access denied: Not owner, not public, not member');
  }
  
  return isMember;
};

// Method to get user role
boardSchema.methods.getUserRole = function (userId) {
  const userIdStr = userId.toString();
  const ownerIdStr = (this.owner._id || this.owner).toString();

  if (ownerIdStr === userIdStr) {
    return 'owner';
  }

  const member = this.members.find(m => {
    const memberIdStr = (m.userId._id || m.userId).toString();
    return memberIdStr === userIdStr;
  });
  return member ? member.role : null;
};

// Method to check if user can edit
boardSchema.methods.canEdit = function (userId) {
  const role = this.getUserRole(userId);
  return role === 'owner' || role === 'editor';
};

const Board = mongoose.model('Board', boardSchema);

module.exports = Board;
