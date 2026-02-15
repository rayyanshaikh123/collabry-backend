const FocusSession = require('../models/FocusSession');
const FocusSettings = require('../models/FocusSettings');
const gamificationService = require('./gamification.service');

class FocusService {
  /**
   * Start a new focus session
   */
  async startSession(userId, { type, duration, pomodoroNumber }) {
    // Check for existing active session
    const existingSession = await FocusSession.findActiveSession(userId);
    if (existingSession) {
      throw new Error('You already have an active session. Please complete or cancel it first.');
    }

    // Get user settings for default duration
    let sessionDuration = duration;
    if (!sessionDuration) {
      const settings = await FocusSettings.getOrCreate(userId);
      sessionDuration = settings.getDurationForType(type);
    }

    // Create new session
    const session = await FocusSession.create({
      user: userId,
      type,
      duration: sessionDuration,
      startTime: new Date(),
      pomodoroNumber,
      status: 'active'
    });

    return session;
  }

  /**
   * Pause active session
   */
  async pauseSession(sessionId, userId) {
    const session = await FocusSession.findOne({
      _id: sessionId,
      user: userId,
      status: 'active'
    });

    if (!session) {
      throw new Error('Active session not found');
    }

    session.status = 'paused';
    session.pausedAt = new Date();
    await session.save();

    return session;
  }

  /**
   * Resume paused session
   */
  async resumeSession(sessionId, userId) {
    const session = await FocusSession.findOne({
      _id: sessionId,
      user: userId,
      status: 'paused'
    });

    if (!session) {
      throw new Error('Paused session not found');
    }

    if (session.pausedAt) {
      const pauseTime = Date.now() - session.pausedAt.getTime();
      session.pauseDuration += pauseTime;
    }

    session.status = 'active';
    session.pausedAt = null;
    await session.save();

    return session;
  }

  /**
   * Complete session and award XP
   */
  async completeSession(sessionId, userId, { notes, distractions } = {}) {
    const session = await FocusSession.findOne({
      _id: sessionId,
      user: userId,
      status: { $in: ['active', 'paused'] }
    });

    if (!session) {
      throw new Error('Session not found or already completed');
    }

    // If paused, add final pause duration
    if (session.status === 'paused' && session.pausedAt) {
      const pauseTime = Date.now() - session.pausedAt.getTime();
      session.pauseDuration += pauseTime;
    }

    // Update session
    session.status = 'completed';
    session.completedAt = new Date();
    session.endTime = new Date();
    if (notes) session.notes = notes;
    if (distractions !== undefined) session.distractions = distractions;
    
    await session.save();

    // Award XP only for work sessions
    let xpResult = { xpAwarded: 0 };
    if (session.type === 'work') {
      const actualMinutes = session.actualDuration || session.duration;
      xpResult = await gamificationService.awardStudyTimeXP(userId, actualMinutes);

      // Bonus XP for no distractions
      if (session.distractions === 0) {
        const bonusXp = await gamificationService.awardXP(
          userId,
          20,
          'FOCUS_SESSION',
          { bonus: 'no_distractions' }
        );
        xpResult.xpAwarded += bonusXp.xpAwarded;
      }
    }

    return {
      session,
      ...xpResult
    };
  }

  /**
   * Cancel session (no XP)
   */
  async cancelSession(sessionId, userId) {
    const session = await FocusSession.findOne({
      _id: sessionId,
      user: userId,
      status: { $in: ['active', 'paused'] }
    });

    if (!session) {
      throw new Error('Session not found or already completed');
    }

    session.status = 'cancelled';
    session.endTime = new Date();
    await session.save();

    return session;
  }

  /**
   * Update session details
   */
  async updateSession(sessionId, userId, updates) {
    const allowedUpdates = ['notes', 'distractions'];
    const filteredUpdates = {};
    
    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        filteredUpdates[key] = updates[key];
      }
    }

    const session = await FocusSession.findOneAndUpdate(
      { _id: sessionId, user: userId },
      filteredUpdates,
      { new: true, runValidators: true }
    );

    if (!session) {
      throw new Error('Session not found');
    }

    return session;
  }

  /**
   * Get single session
   */
  async getSession(sessionId, userId) {
    const session = await FocusSession.findOne({
      _id: sessionId,
      user: userId
    });

    if (!session) {
      throw new Error('Session not found');
    }

    return session;
  }

  /**
   * Get sessions with filters
   */
  async getSessions(userId, filters = {}) {
    const {
      status,
      type,
      startDate,
      endDate,
      limit = 50,
      skip = 0
    } = filters;

    const query = { user: userId };

    if (status) query.status = status;
    if (type) query.type = type;
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const [sessions, total] = await Promise.all([
      FocusSession.find(query)
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(parseInt(skip)),
      FocusSession.countDocuments(query)
    ]);

    return {
      sessions,
      pagination: {
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: total > (parseInt(skip) + parseInt(limit))
      }
    };
  }

  /**
   * Get user settings
   */
  async getSettings(userId) {
    return await FocusSettings.getOrCreate(userId);
  }

  /**
   * Update user settings
   */
  async updateSettings(userId, updates) {
    const settings = await FocusSettings.getOrCreate(userId);
    
    const allowedUpdates = [
      'workDuration',
      'shortBreakDuration',
      'longBreakDuration',
      'longBreakInterval',
      'autoStartBreaks',
      'autoStartPomodoros',
      'notifications',
      'soundEnabled',
      'dailyGoal'
    ];

    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        settings[key] = updates[key];
      }
    }

    await settings.save();
    return settings;
  }

  /**
   * Get focus statistics
   */
  async getStats(userId, period = 'all') {
    const now = new Date();
    let startDate;

    switch (period) {
      case 'today':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case 'year':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      default:
        startDate = new Date(0); // Beginning of time
    }

    const sessions = await FocusSession.find({
      user: userId,
      createdAt: { $gte: startDate }
    }).sort({ createdAt: -1 });

    // Calculate stats
    const completed = sessions.filter(s => s.status === 'completed');
    const totalSessions = sessions.length;
    const completedSessions = completed.length;

    const stats = {
      totalSessions,
      completedSessions,
      totalFocusTime: 0,
      totalBreakTime: 0,
      averageSessionDuration: 0,
      completionRate: totalSessions > 0 ? (completedSessions / totalSessions) * 100 : 0,
      currentStreak: await this.calculateStreak(userId),
      longestStreak: await this.calculateLongestStreak(userId),
      todaysSessions: 0,
      todaysGoalProgress: 0,
      pomodorosCompleted: 0,
      totalDistractions: 0,
      averageDistractions: 0,
      byType: {
        work: { count: 0, totalTime: 0 },
        shortBreak: { count: 0, totalTime: 0 },
        longBreak: { count: 0, totalTime: 0 }
      },
      recentSessions: sessions.slice(0, 10)
    };

    // Calculate aggregated stats
    completed.forEach(session => {
      const actualDuration = session.actualDuration || session.duration;
      
      if (session.type === 'work') {
        stats.totalFocusTime += actualDuration;
        stats.pomodorosCompleted++;
      } else {
        stats.totalBreakTime += actualDuration;
      }

      stats.totalDistractions += session.distractions || 0;

      // By type
      stats.byType[session.type].count++;
      stats.byType[session.type].totalTime += actualDuration;
    });

    if (completedSessions > 0) {
      stats.averageSessionDuration = (stats.totalFocusTime + stats.totalBreakTime) / completedSessions;
      stats.averageDistractions = stats.totalDistractions / completedSessions;
    }

    // Today's progress
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todaySessions = sessions.filter(s => 
      s.createdAt >= todayStart && s.type === 'work' && s.status === 'completed'
    );
    stats.todaysSessions = todaySessions.length;

    const settings = await this.getSettings(userId);
    stats.todaysGoalProgress = settings.dailyGoal > 0 
      ? (stats.todaysSessions / settings.dailyGoal) * 100 
      : 0;

    return stats;
  }

  /**
   * Calculate current streak (consecutive days with completed sessions)
   */
  async calculateStreak(userId) {
    const sessions = await FocusSession.find({
      user: userId,
      type: 'work',
      status: 'completed'
    }).sort({ createdAt: -1 });

    if (sessions.length === 0) return 0;

    let streak = 0;
    let checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);

    for (let i = 0; i < 365; i++) { // Check up to a year
      const dayStart = new Date(checkDate);
      const dayEnd = new Date(checkDate);
      dayEnd.setHours(23, 59, 59, 999);

      const hasSession = sessions.some(s => 
        s.createdAt >= dayStart && s.createdAt <= dayEnd
      );

      if (hasSession) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  }

  /**
   * Calculate longest streak
   */
  async calculateLongestStreak(userId) {
    const sessions = await FocusSession.find({
      user: userId,
      type: 'work',
      status: 'completed'
    }).sort({ createdAt: 1 }); // Ascending order

    if (sessions.length === 0) return 0;

    let longestStreak = 0;
    let currentStreak = 0;
    let lastDate = null;

    sessions.forEach(session => {
      const sessionDate = new Date(session.createdAt);
      sessionDate.setHours(0, 0, 0, 0);

      if (!lastDate) {
        currentStreak = 1;
      } else {
        const daysDiff = Math.floor((sessionDate - lastDate) / (1000 * 60 * 60 * 24));
        
        if (daysDiff === 0) {
          // Same day, don't increment
        } else if (daysDiff === 1) {
          // Consecutive day
          currentStreak++;
        } else {
          // Gap in streak
          longestStreak = Math.max(longestStreak, currentStreak);
          currentStreak = 1;
        }
      }

      lastDate = sessionDate;
    });

    return Math.max(longestStreak, currentStreak);
  }
}

module.exports = new FocusService();
