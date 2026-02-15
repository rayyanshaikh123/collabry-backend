const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [50, 'Name must not exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email',
      ],
    },
    avatar: {
      type: String,
      default: null,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // Don't return password by default
    },
    role: {
      type: String,
      enum: ['student', 'admin', 'mentor'],
      default: 'student',
    },
    subscriptionTier: {
      type: String,
      enum: ['free', 'basic', 'pro', 'enterprise'],
      default: 'free',
    },
    storageUsed: {
      type: Number,
      default: 0, // in bytes
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    resetPasswordToken: {
      type: String,
      default: null,
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
    },
    // Timestamp of last password change (used to invalidate tokens issued before)
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    // Account lockout after failed login attempts
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
      default: null,
    },
    // Email verification
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
      default: null,
    },
    emailVerificationExpires: {
      type: Date,
      default: null,
    },
    // Gamification fields
    gamification: {
      xp: {
        type: Number,
        default: 0,
        min: 0,
      },
      level: {
        type: Number,
        default: 1,
        min: 1,
      },
      streak: {
        current: {
          type: Number,
          default: 0,
          min: 0,
        },
        longest: {
          type: Number,
          default: 0,
          min: 0,
        },
        lastStudyDate: {
          type: Date,
          default: null,
        },
      },
      badges: [{
        id: String,
        name: String,
        description: String,
        icon: String,
        unlockedAt: {
          type: Date,
          default: Date.now,
        },
      }],
      achievements: [{
        id: String,
        name: String,
        description: String,
        progress: {
          type: Number,
          default: 0,
        },
        target: Number,
        completed: {
          type: Boolean,
          default: false,
        },
        completedAt: Date,
      }],
      stats: {
        totalStudyTime: {
          type: Number,
          default: 0, // in minutes
        },
        tasksCompleted: {
          type: Number,
          default: 0,
        },
        plansCreated: {
          type: Number,
          default: 0,
        },
        notesCreated: {
          type: Number,
          default: 0,
        },
        quizzesCompleted: {
          type: Number,
          default: 0,
        },
      },
      // Weekly history for You vs You comparison
      weeklyHistory: [{
        weekStart: Date,
        weekEnd: Date,
        xp: { type: Number, default: 0 },
        streak: { type: Number, default: 0 },
        tasksCompleted: { type: Number, default: 0 },
        studyHours: { type: Number, default: 0 },
      }],
      lastWeekSnapshot: {
        xp: { type: Number, default: 0 },
        streak: { type: Number, default: 0 },
        tasksCompleted: { type: Number, default: 0 },
        studyHours: { type: Number, default: 0 },
        recordedAt: Date,
      },
    },

    // BYOK (Bring Your Own Key) Configuration
    apiKeys: {
      type: Map,
      of: new mongoose.Schema({
        encryptedKey: {
          type: String,
          required: true,
        },
        provider: {
          type: String,
          enum: ['openai', 'groq', 'gemini'],
          required: true,
        },
        baseUrl: String,  // Optional custom endpoint
        model: String,  // Preferred model for this provider
        isActive: {
          type: Boolean,
          default: false,
        },
        isValid: {
          type: Boolean,
          default: true,
        },
        lastValidated: Date,
        addedAt: {
          type: Date,
          default: Date.now,
        },
        lastUsed: Date,
        errorCount: {
          type: Number,
          default: 0,
        },
      }, { _id: false }),
      default: () => new Map(),
    },

    // BYOK Settings
    byokSettings: {
      enabled: {
        type: Boolean,
        default: false,
      },
      activeProvider: {
        type: String,
        enum: ['openai', 'groq', 'gemini', null],
        default: null,
      },
      fallbackToSystem: {
        type: Boolean,
        default: true,  // If user key fails, use system key
      },
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving & track passwordChangedAt
userSchema.pre('save', async function () {
  // Only hash if password is modified
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);

  // Track when the password was changed (skip on brand-new documents)
  if (!this.isNew) {
    this.passwordChangedAt = new Date();
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw new Error('Password comparison failed');
  }
};

/**
 * Check if the password was changed after a JWT was issued.
 * @param {Number} jwtIssuedAt - The `iat` claim (epoch seconds)
 * @returns {Boolean} true = password was changed AFTER the token was issued
 */
userSchema.methods.changedPasswordAfter = function (jwtIssuedAt) {
  if (this.passwordChangedAt) {
    const changedTimestamp = Math.floor(this.passwordChangedAt.getTime() / 1000);
    return jwtIssuedAt < changedTimestamp;
  }
  return false;
};

/**
 * Account lockout constants
 */
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Check if the account is currently locked.
 * Virtual property — not stored, derived from lockUntil.
 */
userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

/**
 * Increment failed login attempts. Lock account if threshold exceeded.
 */
userSchema.methods.incLoginAttempts = async function () {
  // If a previous lock has expired, reset
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 },
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  // Lock the account if we've reached max attempts
  if (this.loginAttempts + 1 >= MAX_LOGIN_ATTEMPTS) {
    updates.$set = { lockUntil: new Date(Date.now() + LOCK_TIME_MS) };
  }

  return this.updateOne(updates);
};

/**
 * Reset login attempts on successful login.
 */
userSchema.methods.resetLoginAttempts = async function () {
  return this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 },
  });
};

// Method to return user object without sensitive data
userSchema.methods.toJSON = function () {
  const userObject = this.toObject();
  
  // Keep both _id and id for compatibility
  // Frontend socket needs _id (ObjectId string) for group membership checks
  // Frontend UI uses id for display
  userObject.id = userObject._id.toString();
  // Don't delete _id - keep it for socket authentication
  delete userObject.password;
  delete userObject.__v;
  delete userObject.emailVerificationToken;
  delete userObject.emailVerificationExpires;
  delete userObject.resetPasswordToken;
  delete userObject.resetPasswordExpires;
  delete userObject.loginAttempts;
  delete userObject.lockUntil;
  
  return userObject;
};

// Gamification methods
userSchema.methods.addXP = function (amount) {
  this.gamification.xp += amount;
  
  // Level up logic: level = floor(sqrt(xp / 100)) + 1
  const newLevel = Math.floor(Math.sqrt(this.gamification.xp / 100)) + 1;
  if (newLevel > this.gamification.level) {
    this.gamification.level = newLevel;
    return { leveledUp: true, newLevel };
  }
  return { leveledUp: false };
};

userSchema.methods.updateStreak = function () {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const lastStudy = this.gamification.streak.lastStudyDate 
    ? new Date(this.gamification.streak.lastStudyDate) 
    : null;
  
  if (lastStudy) {
    lastStudy.setHours(0, 0, 0, 0);
    const daysDiff = Math.floor((today - lastStudy) / (1000 * 60 * 60 * 24));
    
    if (daysDiff === 0) {
      // Already studied today
      return this.gamification.streak.current;
    } else if (daysDiff === 1) {
      // Consecutive day
      this.gamification.streak.current += 1;
    } else {
      // Streak broken
      this.gamification.streak.current = 1;
    }
  } else {
    // First study session
    this.gamification.streak.current = 1;
  }
  
  this.gamification.streak.lastStudyDate = new Date();
  
  // Update longest streak
  if (this.gamification.streak.current > this.gamification.streak.longest) {
    this.gamification.streak.longest = this.gamification.streak.current;
  }
  
  return this.gamification.streak.current;
};

userSchema.methods.unlockBadge = function (badge) {
  const exists = this.gamification.badges.find(b => b.id === badge.id);
  if (!exists) {
    this.gamification.badges.push({
      ...badge,
      unlockedAt: new Date(),
    });
    return true;
  }
  return false;
};

userSchema.methods.updateAchievementProgress = function (achievementId, progress) {
  const achievement = this.gamification.achievements.find(a => a.id === achievementId);
  if (achievement) {
    achievement.progress = Math.min(progress, achievement.target);
    if (achievement.progress >= achievement.target && !achievement.completed) {
      achievement.completed = true;
      achievement.completedAt = new Date();
      return { completed: true, achievement };
    }
  }
  return { completed: false };
};

// Save weekly snapshot for You vs You comparison
userSchema.methods.saveWeeklySnapshot = function() {
  const now = new Date();
  const lastSnapshot = this.gamification.lastWeekSnapshot?.recordedAt;
  
  // Only save once per week
  if (lastSnapshot) {
    const daysSinceLastSnapshot = (now - lastSnapshot) / (1000 * 60 * 60 * 24);
    if (daysSinceLastSnapshot < 7) {
      return this;
    }
  }

  this.gamification.lastWeekSnapshot = {
    xp: this.gamification.xp,
    streak: this.gamification.streak.current,
    tasksCompleted: this.gamification.stats.tasksCompleted,
    studyHours: Math.round((this.gamification.stats.totalStudyTime / 60) * 10) / 10,
    recordedAt: now,
  };

  return this;
};

userSchema.methods.getXPToNextLevel = function () {
  const nextLevel = this.gamification.level + 1;
  const xpForNextLevel = Math.pow(nextLevel - 1, 2) * 100;
  return xpForNextLevel - this.gamification.xp;
};

/**
 * Get decrypted API key for a provider
 * @param {string} provider - 'openai', 'groq', or 'gemini'
 * @returns {Promise<object|null>} - Decrypted key info or null
 */
userSchema.methods.getDecryptedApiKey = async function(provider) {
  const encryption = require('../utils/encryption');
  
  if (!this.apiKeys || !this.apiKeys.has(provider)) {
    return null;
  }

  const keyData = this.apiKeys.get(provider);
  
  if (!keyData.isActive || !keyData.isValid) {
    return null;
  }

  try {
    const decryptedKey = encryption.decrypt(keyData.encryptedKey, this._id.toString());
    
    return {
      apiKey: decryptedKey,
      provider: keyData.provider,
      baseUrl: keyData.baseUrl,
      model: keyData.model
    };
  } catch (error) {
    console.error('Failed to decrypt API key:', error);
    return null;
  }
};

/**
 * Check if user has BYOK enabled and active
 * @returns {boolean}
 */
userSchema.methods.hasByokEnabled = function() {
  return this.byokSettings.enabled && 
         this.byokSettings.activeProvider && 
         this.apiKeys.has(this.byokSettings.activeProvider);
};

// Prevent model overwrite error in development
const User = mongoose.models.User || mongoose.model('User', userSchema);

module.exports = User;
