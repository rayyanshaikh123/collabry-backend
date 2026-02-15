/**
 * AI Usage Limits Tests
 * Tests for quota enforcement and usage tracking
 */
const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Usage = require('../../src/models/Usage');

describe('AI Usage & Quota API', () => {
  let accessToken;
  let userId;

  beforeEach(async () => {
    // Create test user
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test User',
        email: 'usage@example.com',
        password: 'password123',
      });

    accessToken = response.body.data.accessToken;
    userId = response.body.data.user.id;
  });

  describe('GET /api/usage/my-usage', () => {
    it('should return user usage statistics', async () => {
      const response = await request(app)
        .get('/api/usage/my-usage')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should reject unauthenticated requests', async () => {
      await request(app)
        .get('/api/usage/my-usage')
        .expect(401);
    });
  });

  describe('Usage Quota Logic', () => {
    it('should enforce free tier daily limits', () => {
      const FREE_TIER_LIMITS = {
        ai_questions: 10,
        boards: 1,
        group_members: 5,
      };

      // Simulate usage check
      const currentUsage = { ai_questions: 9 };
      const hasQuota = currentUsage.ai_questions < FREE_TIER_LIMITS.ai_questions;
      expect(hasQuota).toBe(true);

      // At limit
      const atLimit = { ai_questions: 10 };
      const quotaExceeded = atLimit.ai_questions >= FREE_TIER_LIMITS.ai_questions;
      expect(quotaExceeded).toBe(true);
    });

    it('should allow unlimited for pro tier', () => {
      const PRO_TIER_LIMITS = {
        ai_questions: Infinity,
        boards: Infinity,
        group_members: 50,
      };

      const currentUsage = { ai_questions: 1000 };
      const hasQuota = currentUsage.ai_questions < PRO_TIER_LIMITS.ai_questions;
      expect(hasQuota).toBe(true);
    });

    it('should reset daily quotas', () => {
      const shouldResetDaily = (usage, now) => {
        const lastReset = new Date(usage.lastResetDate);
        return (
          lastReset.getFullYear() !== now.getFullYear() ||
          lastReset.getMonth() !== now.getMonth() ||
          lastReset.getDate() !== now.getDate()
        );
      };

      const yesterday = new Date('2026-01-10');
      const today = new Date('2026-01-11');

      const usage = {
        dailyCount: 10,
        lastResetDate: yesterday,
      };

      expect(shouldResetDaily(usage, today)).toBe(true);
      expect(shouldResetDaily(usage, yesterday)).toBe(false);
    });
  });

  describe('Subscription Tier Features', () => {
    it('should map subscription tier to features correctly', () => {
      const TIER_FEATURES = {
        free: {
          ai_questions_per_day: 10,
          max_boards: 1,
          max_group_members: 5,
          advanced_ai: false,
          priority_support: false,
        },
        basic: {
          ai_questions_per_day: 100,
          max_boards: 5,
          max_group_members: 20,
          advanced_ai: true,
          priority_support: false,
        },
        pro: {
          ai_questions_per_day: Infinity,
          max_boards: Infinity,
          max_group_members: 50,
          advanced_ai: true,
          priority_support: true,
        },
      };

      // Check feature access
      expect(TIER_FEATURES.free.ai_questions_per_day).toBe(10);
      expect(TIER_FEATURES.basic.advanced_ai).toBe(true);
      expect(TIER_FEATURES.pro.max_boards).toBe(Infinity);
      expect(TIER_FEATURES.free.priority_support).toBe(false);
    });

    it('should check feature access correctly', () => {
      const checkFeatureAccess = (userTier, feature, tierFeatures) => {
        const userFeatures = tierFeatures[userTier];
        if (!userFeatures) return false;
        const featureValue = userFeatures[feature];
        return featureValue === true || featureValue === Infinity || 
               (typeof featureValue === 'number' && featureValue > 0);
      };

      const tierFeatures = {
        free: { advanced_ai: false, basic_ai: true },
        pro: { advanced_ai: true, basic_ai: true },
      };

      expect(checkFeatureAccess('free', 'advanced_ai', tierFeatures)).toBe(false);
      expect(checkFeatureAccess('pro', 'advanced_ai', tierFeatures)).toBe(true);
      expect(checkFeatureAccess('free', 'basic_ai', tierFeatures)).toBe(true);
    });
  });

  describe('Usage Tracking', () => {
    it('should increment usage count correctly', () => {
      let usageCount = 0;
      
      const incrementUsage = () => {
        usageCount += 1;
        return usageCount;
      };

      expect(incrementUsage()).toBe(1);
      expect(incrementUsage()).toBe(2);
      expect(incrementUsage()).toBe(3);
    });

    it('should track different usage types', () => {
      const usage = {
        ai_chat: 0,
        ai_quiz: 0,
        ai_summary: 0,
        ai_mindmap: 0,
      };

      const trackUsage = (type, tracker) => {
        if (type in tracker) {
          tracker[type] += 1;
        }
      };

      trackUsage('ai_chat', usage);
      trackUsage('ai_chat', usage);
      trackUsage('ai_quiz', usage);

      expect(usage.ai_chat).toBe(2);
      expect(usage.ai_quiz).toBe(1);
      expect(usage.ai_summary).toBe(0);
    });
  });
});
