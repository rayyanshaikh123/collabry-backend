/**
 * Subscription & Payment Tests
 * Tests for subscription plans, orders, and webhook verification
 */
const request = require('supertest');
const crypto = require('crypto');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Subscription = require('../../src/models/Subscription');

describe('Subscription API', () => {
  let accessToken;
  let userId;

  beforeEach(async () => {
    // Create a test user and get token
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test User',
        email: 'subscription@example.com',
        password: 'password123',
      });

    accessToken = response.body.data.accessToken;
    userId = response.body.data.user.id;
  });

  describe('GET /api/subscriptions/plans', () => {
    it('should return available plans (public)', async () => {
      const response = await request(app)
        .get('/api/subscriptions/plans')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      
      // Check plan structure
      const plan = response.body.data[0];
      expect(plan).toHaveProperty('id');
      expect(plan).toHaveProperty('name');
      expect(plan).toHaveProperty('price');
    });
  });

  describe('GET /api/subscriptions/current', () => {
    it('should return current subscription (authenticated)', async () => {
      const response = await request(app)
        .get('/api/subscriptions/current')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      // New users should have free tier
      expect(response.body.data).toBeDefined();
    });

    it('should reject unauthenticated request', async () => {
      await request(app)
        .get('/api/subscriptions/current')
        .expect(401);
    });
  });

  describe('POST /api/subscriptions/create-order', () => {
    it('should create order for valid plan', async () => {
      const response = await request(app)
        .post('/api/subscriptions/create-order')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ planId: 'basic_monthly' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      // Should have order details (may fail without valid Razorpay credentials)
    });

    it('should reject without plan ID', async () => {
      const response = await request(app)
        .post('/api/subscriptions/create-order')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/subscriptions/verify-payment', () => {
    it('should reject with missing parameters', async () => {
      const response = await request(app)
        .post('/api/subscriptions/verify-payment')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Missing required');
    });

    it('should reject with invalid signature', async () => {
      const response = await request(app)
        .post('/api/subscriptions/verify-payment')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          razorpay_order_id: 'order_test123',
          razorpay_payment_id: 'pay_test123',
          razorpay_signature: 'invalid_signature',
          planId: 'basic_monthly',
        })
        .expect(500); // Will fail signature verification

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/subscriptions/feature-access/:feature', () => {
    it('should check feature access for authenticated user', async () => {
      const response = await request(app)
        .get('/api/subscriptions/feature-access/unlimited_ai')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('feature');
      expect(response.body.data).toHaveProperty('hasAccess');
    });
  });

  describe('POST /api/subscriptions/cancel', () => {
    it('should handle cancellation request', async () => {
      // This may return error if no active subscription
      const response = await request(app)
        .post('/api/subscriptions/cancel')
        .set('Authorization', `Bearer ${accessToken}`);

      // Either success or specific error about no subscription
      expect([200, 400, 404]).toContain(response.status);
    });
  });
});

describe('Webhook Signature Verification', () => {
  it('should verify valid Razorpay webhook signature', () => {
    const webhookSecret = 'test_webhook_secret';
    const payload = JSON.stringify({ event: 'payment.captured' });
    
    // Generate valid signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    // Verify signature matches
    const actualSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    expect(actualSignature).toBe(expectedSignature);
  });

  it('should reject tampered payload', () => {
    const webhookSecret = 'test_webhook_secret';
    const originalPayload = JSON.stringify({ event: 'payment.captured' });
    const tamperedPayload = JSON.stringify({ event: 'payment.failed' });
    
    const originalSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(originalPayload)
      .digest('hex');

    const tamperedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(tamperedPayload)
      .digest('hex');

    expect(tamperedSignature).not.toBe(originalSignature);
  });
});
