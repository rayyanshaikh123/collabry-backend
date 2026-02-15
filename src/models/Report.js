const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  contentType: {
    type: String,
    enum: ['board', 'user', 'element', 'chat', 'other'],
    required: true
  },
  contentId: {
    type: String,
    required: true
  },
  contentDetails: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  reason: {
    type: String,
    enum: ['spam', 'inappropriate', 'abuse', 'harassment', 'copyright', 'other'],
    required: true
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  status: {
    type: String,
    enum: ['pending', 'reviewing', 'resolved', 'dismissed'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewNotes: {
    type: String,
    trim: true,
    maxlength: [2000, 'Review notes cannot exceed 2000 characters']
  },
  action: {
    type: String,
    enum: ['none', 'warning', 'content_removed', 'user_suspended', 'user_banned'],
    default: 'none'
  },
  resolvedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ contentType: 1, contentId: 1 });
reportSchema.index({ reportedBy: 1 });
reportSchema.index({ reviewedBy: 1 });

// Virtual for time since report
reportSchema.virtual('timeSinceReport').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
});

// Populate reporter and reviewer info on find queries
// Use the promise-aware middleware signature (no `next`) to avoid callback issues
reportSchema.pre(/^find/, function() {
  this.populate('reportedBy', 'name email avatar')
      .populate('reviewedBy', 'name email');
});

const Report = mongoose.model('Report', reportSchema);

module.exports = Report;
