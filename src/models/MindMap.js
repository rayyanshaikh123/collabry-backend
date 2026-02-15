const mongoose = require('mongoose');

const nodeSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  label: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['root', 'branch', 'leaf', 'concept', 'example', 'note'],
    default: 'concept'
  },
  position: {
    x: Number,
    y: Number
  },
  style: {
    color: String,
    backgroundColor: String,
    fontSize: Number
  },
  data: mongoose.Schema.Types.Mixed
}, { _id: false });

const edgeSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  from: {
    type: String,
    required: true
  },
  to: {
    type: String,
    required: true
  },
  relation: {
    type: String,
    trim: true
  },
  style: {
    color: String,
    strokeWidth: Number,
    strokeDasharray: String
  }
}, { _id: false });

const mindMapSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  topic: {
    type: String,
    required: [true, 'Topic is required'],
    trim: true
  },
  subject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sourceType: {
    type: String,
    enum: ['manual', 'ai', 'study_buddy'],
    default: 'manual'
  },
  visibility: {
    type: String,
    enum: ['private', 'shared'],
    default: 'private'
  },
  nodes: [nodeSchema],
  edges: [edgeSchema],
  version: {
    type: Number,
    default: 1
  },
  parentVersion: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MindMap'
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  tags: [{
    type: String,
    trim: true
  }],
  mermaidCode: {
    type: String,
    required: false
  },
  svgBase64: {
    type: String,
    required: false
  },
  metadata: {
    layout: {
      type: String,
      enum: ['tree', 'radial', 'force', 'hierarchical'],
      default: 'tree'
    },
    zoom: {
      type: Number,
      default: 1
    },
    center: {
      x: Number,
      y: Number
    }
  }
}, {
  timestamps: true
});

// Indexes
mindMapSchema.index({ createdBy: 1, subject: 1 });
mindMapSchema.index({ subject: 1, visibility: 1 });
mindMapSchema.index({ createdBy: 1, createdAt: -1 });
mindMapSchema.index({ parentVersion: 1, version: 1 });

module.exports = mongoose.models.MindMap || mongoose.model('MindMap', mindMapSchema);
