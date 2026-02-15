const mongoose = require('mongoose');

const focusSettingsSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  workDuration: {
    type: Number,
    default: 25,
    min: 1,
    max: 60
  },
  shortBreakDuration: {
    type: Number,
    default: 5,
    min: 1,
    max: 30
  },
  longBreakDuration: {
    type: Number,
    default: 15,
    min: 1,
    max: 60
  },
  longBreakInterval: {
    type: Number,
    default: 4,
    min: 2,
    max: 10
  },
  autoStartBreaks: {
    type: Boolean,
    default: false
  },
  autoStartPomodoros: {
    type: Boolean,
    default: false
  },
  notifications: {
    type: Boolean,
    default: true
  },
  soundEnabled: {
    type: Boolean,
    default: true
  },
  dailyGoal: {
    type: Number,
    default: 8,
    min: 1,
    max: 20
  }
}, {
  timestamps: true
});

// Static method to get or create settings
focusSettingsSchema.statics.getOrCreate = async function(userId) {
  let settings = await this.findOne({ user: userId });
  
  if (!settings) {
    settings = await this.create({ user: userId });
  }
  
  return settings;
};

// Method to get duration for session type
focusSettingsSchema.methods.getDurationForType = function(type) {
  switch (type) {
    case 'work':
      return this.workDuration;
    case 'shortBreak':
      return this.shortBreakDuration;
    case 'longBreak':
      return this.longBreakDuration;
    default:
      return this.workDuration;
  }
};

module.exports = mongoose.models.FocusSettings || mongoose.model('FocusSettings', focusSettingsSchema);
