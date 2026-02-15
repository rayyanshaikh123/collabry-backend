const mongoose = require('mongoose');

const usageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    date: {
      type: String, // Format: YYYY-MM-DD for daily tracking
      required: true,
    },
    
    // AI Usage
    aiQuestions: {
      type: Number,
      default: 0,
    },
    aiTokensUsed: {
      type: Number,
      default: 0,
    },
    
    // Board Usage
    boardsCreated: {
      type: Number,
      default: 0,
    },
    
    // Storage Usage (in bytes)
    storageUsed: {
      type: Number,
      default: 0,
    },
    
    // File uploads count
    fileUploads: {
      type: Number,
      default: 0,
    },
    
    // Detailed AI usage breakdown
    aiUsageDetails: [{
      timestamp: {
        type: Date,
        default: Date.now,
      },
      model: {
        type: String,
        default: 'basic',
      },
      tokensUsed: {
        type: Number,
        default: 0,
      },
      questionType: {
        type: String,
        enum: ['chat', 'study-copilot', 'summarize', 'quiz-generate', 'other'],
        default: 'chat',
      },
    }],
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient querying
usageSchema.index({ user: 1, date: 1 }, { unique: true });
usageSchema.index({ date: 1 }); // For cleanup/analytics

// Static method to get or create today's usage record
usageSchema.statics.getTodayUsage = async function(userId) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  let usage = await this.findOne({ user: userId, date: today });
  
  if (!usage) {
    usage = await this.create({
      user: userId,
      date: today,
      aiQuestions: 0,
      aiTokensUsed: 0,
      boardsCreated: 0,
      storageUsed: 0,
      fileUploads: 0,
    });
  }
  
  return usage;
};

// Static method to increment AI usage
usageSchema.statics.incrementAIUsage = async function(userId, tokens = 0, model = 'basic', questionType = 'chat') {
  const today = new Date().toISOString().split('T')[0];
  
  const usage = await this.findOneAndUpdate(
    { user: userId, date: today },
    {
      $inc: {
        aiQuestions: 1,
        aiTokensUsed: tokens,
      },
      $push: {
        aiUsageDetails: {
          timestamp: new Date(),
          model,
          tokensUsed: tokens,
          questionType,
        },
      },
      $setOnInsert: {
        user: userId,
        date: today,
      },
    },
    { upsert: true, new: true }
  );
  
  return usage;
};

// Static method to get usage statistics
usageSchema.statics.getUsageStats = async function(userId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];
  
  const stats = await this.aggregate([
    {
      $match: {
        user: new mongoose.Types.ObjectId(userId),
        date: { $gte: startDateStr },
      },
    },
    {
      $group: {
        _id: null,
        totalAIQuestions: { $sum: '$aiQuestions' },
        totalTokensUsed: { $sum: '$aiTokensUsed' },
        totalBoardsCreated: { $sum: '$boardsCreated' },
        totalFileUploads: { $sum: '$fileUploads' },
        daysActive: { $sum: 1 },
      },
    },
  ]);
  
  return stats[0] || {
    totalAIQuestions: 0,
    totalTokensUsed: 0,
    totalBoardsCreated: 0,
    totalFileUploads: 0,
    daysActive: 0,
  };
};

// Static method to cleanup old usage records (keep last 90 days)
usageSchema.statics.cleanupOldRecords = async function() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
  
  const result = await this.deleteMany({ date: { $lt: cutoffDateStr } });
  return result.deletedCount;
};

const Usage = mongoose.model('Usage', usageSchema);

module.exports = Usage;
