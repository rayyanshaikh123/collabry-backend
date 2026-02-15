const mongoose = require('mongoose');

const platformSettingsSchema = new mongoose.Schema({
  // General Settings
  platform: {
    name: { type: String, default: 'Collabry' },
    tagline: { type: String, default: 'AI-Powered Collaborative Study Platform' },
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: { type: String, default: 'We\'ll be back soon!' }
  },

  // Email Configuration
  email: {
    enabled: { type: Boolean, default: true },
    service: { type: String, default: 'gmail' },
    from: String,
    fromName: { type: String, default: 'Collabry' },
    templates: {
      welcome: { subject: String, body: String },
      resetPassword: { subject: String, body: String },
      invitation: { subject: String, body: String }
    }
  },

  // AI Engine Configuration
  ai: {
    enabled: { type: Boolean, default: true },
    engineUrl: { type: String, default: 'http://localhost:8000' },
    maxTokensPerRequest: { type: Number, default: 4000 },
    defaultModel: { type: String, default: 'gpt-4' },
    rateLimit: {
      requestsPerHour: { type: Number, default: 100 },
      tokensPerDay: { type: Number, default: 100000 }
    }
  },

  // Feature Toggles
  features: {
    studyBoards: { type: Boolean, default: true },
    visualAids: { type: Boolean, default: true },
    studyPlanner: { type: Boolean, default: true },
    flashcards: { type: Boolean, default: true },
    aiCopilot: { type: Boolean, default: true }
  },

  // Storage & Limits
  storage: {
    maxFileSize: { type: Number, default: 52428800 }, // 50MB in bytes
    maxBoardElements: { type: Number, default: 10000 },
    maxBoardsPerUser: { type: Number, default: 50 }
  },

  // Security Settings
  security: {
    requireEmailVerification: { type: Boolean, default: false },
    passwordMinLength: { type: Number, default: 6 },
    sessionTimeout: { type: Number, default: 86400 }, // 24 hours in seconds
    maxLoginAttempts: { type: Number, default: 5 }
  },

  // Analytics
  analytics: {
    enabled: { type: Boolean, default: true },
    trackUsage: { type: Boolean, default: true },
    retentionDays: { type: Number, default: 90 }
  },

  updatedAt: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Ensure only one settings document exists
platformSettingsSchema.statics.getSettings = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

const PlatformSettings = mongoose.model('PlatformSettings', platformSettingsSchema);

module.exports = PlatformSettings;
