const User = require('../models/User');

// Achievement and Badge Definitions
const BADGES = {
  FIRST_STEP: {
    id: 'first_step',
    name: 'First Step',
    description: 'Complete your first task',
    icon: '🎯',
  },
  WEEK_WARRIOR: {
    id: 'week_warrior',
    name: 'Week Warrior',
    description: 'Maintain a 7-day streak',
    icon: '🔥',
  },
  MONTH_MASTER: {
    id: 'month_master',
    name: 'Month Master',
    description: 'Maintain a 30-day streak',
    icon: '👑',
  },
  TASK_CRUSHER: {
    id: 'task_crusher',
    name: 'Task Crusher',
    description: 'Complete 50 tasks',
    icon: '💪',
  },
  STUDY_CHAMPION: {
    id: 'study_champion',
    name: 'Study Champion',
    description: 'Complete 100 tasks',
    icon: '🏆',
  },
  TIME_LORD: {
    id: 'time_lord',
    name: 'Time Lord',
    description: 'Study for 100+ hours',
    icon: '⏰',
  },
  PLANNER_PRO: {
    id: 'planner_pro',
    name: 'Planner Pro',
    description: 'Create 10 study plans',
    icon: '📋',
  },
  KNOWLEDGE_KEEPER: {
    id: 'knowledge_keeper',
    name: 'Knowledge Keeper',
    description: 'Create 50 notes',
    icon: '📚',
  },
  QUIZ_MASTER: {
    id: 'quiz_master',
    name: 'Quiz Master',
    description: 'Complete 25 quizzes',
    icon: '🎓',
  },
  EARLY_BIRD: {
    id: 'early_bird',
    name: 'Early Bird',
    description: 'Study before 8 AM 10 times',
    icon: '🌅',
  },
  NIGHT_OWL: {
    id: 'night_owl',
    name: 'Night Owl',
    description: 'Study after 10 PM 10 times',
    icon: '🦉',
  },
  CONSISTENT_LEARNER: {
    id: 'consistent_learner',
    name: 'Consistent Learner',
    description: 'Study every day for 14 days',
    icon: '📈',
  },
};

const ACHIEVEMENTS = {
  TASK_NOVICE: {
    id: 'task_novice',
    name: 'Task Novice',
    description: 'Complete 10 tasks',
    target: 10,
    xpReward: 100,
  },
  TASK_EXPERT: {
    id: 'task_expert',
    name: 'Task Expert',
    description: 'Complete 25 tasks',
    target: 25,
    xpReward: 250,
  },
  STREAK_STARTER: {
    id: 'streak_starter',
    name: 'Streak Starter',
    description: 'Build a 3-day streak',
    target: 3,
    xpReward: 50,
  },
  STREAK_BUILDER: {
    id: 'streak_builder',
    name: 'Streak Builder',
    description: 'Build a 10-day streak',
    target: 10,
    xpReward: 200,
  },
  STUDY_HOURS_10: {
    id: 'study_hours_10',
    name: 'Study Starter',
    description: 'Study for 10 hours',
    target: 600, // in minutes
    xpReward: 150,
  },
  STUDY_HOURS_50: {
    id: 'study_hours_50',
    name: 'Study Devotee',
    description: 'Study for 50 hours',
    target: 3000,
    xpReward: 500,
  },
  PLAN_CREATOR: {
    id: 'plan_creator',
    name: 'Plan Creator',
    description: 'Create 5 study plans',
    target: 5,
    xpReward: 100,
  },
};

// XP Rewards for different actions
const XP_REWARDS = {
  TASK_COMPLETE: 20,
  PLAN_CREATE: 50,
  NOTE_CREATE: 10,
  QUIZ_COMPLETE: 30,
  STREAK_BONUS: 10, // per day of streak
  FOCUS_SESSION: 15,
};

class GamificationService {
  // Award XP for completing a task
  static async awardTaskCompletionXP(userId, taskDetails = {}) {
    try {
      const user = await User.findById(userId);
      if (!user) throw new Error('User not found');

      let xpEarned = XP_REWARDS.TASK_COMPLETE;

      // Bonus XP for difficult tasks
      if (taskDetails.priority === 'high') {
        xpEarned += 10;
      }

      // Update streak
      const streak = user.updateStreak();
      
      // Streak bonus
      if (streak > 1) {
        xpEarned += Math.min(streak, 10) * 2; // Max 20 bonus XP
      }

      // Add XP
      const levelResult = user.addXP(xpEarned);

      // Update stats
      user.gamification.stats.tasksCompleted += 1;

      // Check for badge unlocks
      const newBadges = [];
      
      // First task badge
      if (user.gamification.stats.tasksCompleted === 1) {
        if (user.unlockBadge(BADGES.FIRST_STEP)) {
          newBadges.push(BADGES.FIRST_STEP);
        }
      }

      // Task milestones
      if (user.gamification.stats.tasksCompleted === 50) {
        if (user.unlockBadge(BADGES.TASK_CRUSHER)) {
          newBadges.push(BADGES.TASK_CRUSHER);
        }
      }

      if (user.gamification.stats.tasksCompleted === 100) {
        if (user.unlockBadge(BADGES.STUDY_CHAMPION)) {
          newBadges.push(BADGES.STUDY_CHAMPION);
        }
      }

      // Streak badges
      if (streak === 7) {
        if (user.unlockBadge(BADGES.WEEK_WARRIOR)) {
          newBadges.push(BADGES.WEEK_WARRIOR);
        }
      }

      if (streak === 14) {
        if (user.unlockBadge(BADGES.CONSISTENT_LEARNER)) {
          newBadges.push(BADGES.CONSISTENT_LEARNER);
        }
      }

      if (streak === 30) {
        if (user.unlockBadge(BADGES.MONTH_MASTER)) {
          newBadges.push(BADGES.MONTH_MASTER);
        }
      }

      await user.save();

      return {
        xpEarned,
        totalXP: user.gamification.xp,
        level: user.gamification.level,
        leveledUp: levelResult.leveledUp,
        newLevel: levelResult.newLevel,
        streak,
        newBadges,
      };
    } catch (error) {
      console.error('Error awarding task XP:', error);
      throw error;
    }
  }

  // Award XP for creating a study plan
  static async awardPlanCreationXP(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) throw new Error('User not found');

      const xpEarned = XP_REWARDS.PLAN_CREATE;
      const levelResult = user.addXP(xpEarned);

      user.gamification.stats.plansCreated += 1;

      const newBadges = [];
      if (user.gamification.stats.plansCreated === 10) {
        if (user.unlockBadge(BADGES.PLANNER_PRO)) {
          newBadges.push(BADGES.PLANNER_PRO);
        }
      }

      await user.save();

      return {
        xpEarned,
        totalXP: user.gamification.xp,
        level: user.gamification.level,
        leveledUp: levelResult.leveledUp,
        newBadges,
      };
    } catch (error) {
      console.error('Error awarding plan XP:', error);
      throw error;
    }
  }

  // Award XP for study time
  static async awardStudyTimeXP(userId, minutes) {
    try {
      const user = await User.findById(userId);
      if (!user) throw new Error('User not found');

      const xpEarned = Math.floor(minutes / 5) * XP_REWARDS.FOCUS_SESSION;
      const levelResult = user.addXP(xpEarned);

      user.gamification.stats.totalStudyTime += minutes;

      const newBadges = [];
      const totalHours = user.gamification.stats.totalStudyTime / 60;
      
      if (totalHours >= 100) {
        if (user.unlockBadge(BADGES.TIME_LORD)) {
          newBadges.push(BADGES.TIME_LORD);
        }
      }

      await user.save();

      return {
        xpEarned,
        totalXP: user.gamification.xp,
        level: user.gamification.level,
        leveledUp: levelResult.leveledUp,
        newBadges,
      };
    } catch (error) {
      console.error('Error awarding study time XP:', error);
      throw error;
    }
  }

  // Get user's gamification stats
  static async getUserStats(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) throw new Error('User not found');

      const xpToNextLevel = user.getXPToNextLevel();
      const levelProgress = ((user.gamification.xp - Math.pow(user.gamification.level - 1, 2) * 100) / 
        (Math.pow(user.gamification.level, 2) * 100 - Math.pow(user.gamification.level - 1, 2) * 100)) * 100;

      return {
        xp: user.gamification.xp,
        level: user.gamification.level,
        xpToNextLevel,
        levelProgress: Math.round(levelProgress),
        streak: user.gamification.streak,
        badges: user.gamification.badges,
        achievements: user.gamification.achievements,
        stats: user.gamification.stats,
      };
    } catch (error) {
      console.error('Error getting user stats:', error);
      throw error;
    }
  }

  // Get leaderboard
  static async getLeaderboard(type = 'xp', limit = 10) {
    try {
      let sortField;
      switch (type) {
        case 'xp':
          sortField = { 'gamification.xp': -1 };
          break;
        case 'level':
          sortField = { 'gamification.level': -1, 'gamification.xp': -1 };
          break;
        case 'streak':
          sortField = { 'gamification.streak.current': -1 };
          break;
        case 'tasks':
          sortField = { 'gamification.stats.tasksCompleted': -1 };
          break;
        default:
          sortField = { 'gamification.xp': -1 };
      }

      const users = await User.find({ isActive: true })
        .select('name avatar gamification')
        .sort(sortField)
        .limit(limit);

      return users.map((user, index) => ({
        rank: index + 1,
        userId: user._id,
        name: user.name,
        avatar: user.avatar,
        xp: user.gamification.xp,
        level: user.gamification.level,
        streak: user.gamification.streak.current,
        tasksCompleted: user.gamification.stats.tasksCompleted,
        badges: user.gamification.badges.length,
      }));
    } catch (error) {
      console.error('Error getting leaderboard:', error);
      throw error;
    }
  }

  // Get friend leaderboard
  static async getFriendLeaderboard(userId) {
    try {
      const Friendship = require('../models/Friendship');
      
      const friendships = await Friendship.find({
        $or: [{ user1: userId }, { user2: userId }],
        status: 'active',
      });

      const friendIds = friendships.map(f => 
        f.user1.toString() === userId.toString() ? f.user2 : f.user1
      );

      friendIds.push(userId); // Include self

      const users = await User.find({ _id: { $in: friendIds }, isActive: true })
        .select('name avatar gamification')
        .sort({ 'gamification.xp': -1 });

      return users.map((user, index) => ({
        rank: index + 1,
        userId: user._id,
        name: user.name,
        avatar: user.avatar,
        xp: user.gamification.xp,
        level: user.gamification.level,
        streak: user.gamification.streak.current,
        tasksCompleted: user.gamification.stats.tasksCompleted,
        isCurrentUser: user._id.toString() === userId.toString(),
      }));
    } catch (error) {
      console.error('Error getting friend leaderboard:', error);
      throw error;
    }
  }

  // Get personal progress (You vs You)
  static async getPersonalProgress(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Save current week snapshot if needed
      user.saveWeeklySnapshot();
      await user.save();

      const currentStats = {
        xp: user.gamification.xp,
        streak: user.gamification.streak.current,
        tasksCompleted: user.gamification.stats.tasksCompleted,
        studyHours: Math.round((user.gamification.stats.totalStudyTime / 60) * 10) / 10,
      };

      const previousStats = user.gamification.lastWeekSnapshot ? {
        xp: user.gamification.lastWeekSnapshot.xp || 0,
        streak: user.gamification.lastWeekSnapshot.streak || 0,
        tasksCompleted: user.gamification.lastWeekSnapshot.tasksCompleted || 0,
        studyHours: user.gamification.lastWeekSnapshot.studyHours || 0,
      } : null;

      return {
        current: currentStats,
        previous: previousStats,
        hasHistory: !!previousStats,
      };
    } catch (error) {
      console.error('Error getting personal progress:', error);
      throw error;
    }
  }

  // Initialize default achievements for a new user
  static initializeAchievements(user) {
    const achievements = Object.values(ACHIEVEMENTS).map(ach => ({
      id: ach.id,
      name: ach.name,
      description: ach.description,
      progress: 0,
      target: ach.target,
      completed: false,
    }));

    user.gamification.achievements = achievements;
    return user;
  }
}

module.exports = { GamificationService, BADGES, ACHIEVEMENTS, XP_REWARDS };
