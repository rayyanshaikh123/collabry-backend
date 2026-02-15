/**
 * Study Planner Tests
 * Tests for study plan and task CRUD operations
 */
const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User');
const StudyPlan = require('../../src/models/StudyPlan');
const StudyTask = require('../../src/models/StudyTask');

describe('Study Planner API', () => {
  let accessToken;
  let userId;

  beforeEach(async () => {
    // Create a test user and get token
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test User',
        email: 'planner@example.com',
        password: 'password123',
      });

    accessToken = response.body.data.accessToken;
    userId = response.body.data.user.id;
  });

  describe('Study Plans', () => {
    describe('POST /api/study-planner/plans', () => {
      it('should create a new study plan', async () => {
        const planData = {
          title: 'Test Study Plan',
          description: 'A test plan for unit testing',
          subject: 'Mathematics',
          topics: ['Algebra', 'Calculus'],
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          dailyStudyHours: 2,
        };

        const response = await request(app)
          .post('/api/study-planner/plans')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(planData)
          .expect(201);

        expect(response.body.success).toBe(true);
        expect(response.body.data.plan).toBeDefined();
        expect(response.body.data.plan.title).toBe(planData.title);
        expect(response.body.data.plan.subject).toBe(planData.subject);
      });

      it('should reject plan creation without required fields', async () => {
        const response = await request(app)
          .post('/api/study-planner/plans')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({})
          .expect(400);

        expect(response.body.success).toBe(false);
      });
    });

    describe('GET /api/study-planner/plans', () => {
      beforeEach(async () => {
        // Create test plans
        await StudyPlan.create({
          userId,
          title: 'Plan 1',
          subject: 'Math',
          startDate: new Date(),
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        await StudyPlan.create({
          userId,
          title: 'Plan 2',
          subject: 'Physics',
          startDate: new Date(),
          endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        });
      });

      it('should get all plans for user', async () => {
        const response = await request(app)
          .get('/api/study-planner/plans')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.plans).toBeDefined();
        expect(response.body.data.plans.length).toBe(2);
      });
    });

    describe('GET /api/study-planner/plans/:id', () => {
      let planId;

      beforeEach(async () => {
        const plan = await StudyPlan.create({
          userId,
          title: 'Test Plan',
          subject: 'Chemistry',
          startDate: new Date(),
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        planId = plan._id.toString();
      });

      it('should get plan by ID', async () => {
        const response = await request(app)
          .get(`/api/study-planner/plans/${planId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.plan).toBeDefined();
        expect(response.body.data.plan.title).toBe('Test Plan');
      });

      it('should return 404 for non-existent plan', async () => {
        const fakeId = '507f1f77bcf86cd799439011';
        const response = await request(app)
          .get(`/api/study-planner/plans/${fakeId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(404);

        expect(response.body.success).toBe(false);
      });
    });

    describe('PUT /api/study-planner/plans/:id', () => {
      let planId;

      beforeEach(async () => {
        const plan = await StudyPlan.create({
          userId,
          title: 'Original Title',
          subject: 'Biology',
          startDate: new Date(),
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        planId = plan._id.toString();
      });

      it('should update plan', async () => {
        const response = await request(app)
          .put(`/api/study-planner/plans/${planId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ title: 'Updated Title' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.plan.title).toBe('Updated Title');
      });
    });

    describe('DELETE /api/study-planner/plans/:id', () => {
      let planId;

      beforeEach(async () => {
        const plan = await StudyPlan.create({
          userId,
          title: 'To Delete',
          subject: 'Geography',
          startDate: new Date(),
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        planId = plan._id.toString();
      });

      it('should delete plan', async () => {
        const response = await request(app)
          .delete(`/api/study-planner/plans/${planId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(response.body.success).toBe(true);

        // Verify deletion
        const deleted = await StudyPlan.findById(planId);
        expect(deleted).toBeNull();
      });
    });
  });

  describe('Study Tasks', () => {
    let planId;

    beforeEach(async () => {
      const plan = await StudyPlan.create({
        userId,
        title: 'Task Test Plan',
        subject: 'Computer Science',
        startDate: new Date(),
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      planId = plan._id.toString();
    });

    describe('POST /api/study-planner/tasks', () => {
      it('should create a task', async () => {
        const taskData = {
          planId,
          title: 'Complete Chapter 1',
          description: 'Read and summarize chapter 1',
          scheduledDate: new Date().toISOString(),
          estimatedDuration: 60,
          priority: 'high',
        };

        const response = await request(app)
          .post('/api/study-planner/tasks')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(taskData)
          .expect(201);

        expect(response.body.success).toBe(true);
        expect(response.body.data.task).toBeDefined();
        expect(response.body.data.task.title).toBe(taskData.title);
      });
    });

    describe('GET /api/study-planner/tasks/today', () => {
      beforeEach(async () => {
        // Create today's task
        await StudyTask.create({
          userId,
          planId,
          title: 'Today Task',
          scheduledDate: new Date(),
        });
      });

      it('should get today\'s tasks', async () => {
        const response = await request(app)
          .get('/api/study-planner/tasks/today')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.tasks).toBeDefined();
        expect(Array.isArray(response.body.data.tasks)).toBe(true);
      });
    });

    describe('POST /api/study-planner/tasks/:id/complete', () => {
      let taskId;

      beforeEach(async () => {
        const task = await StudyTask.create({
          userId,
          planId,
          title: 'Complete Me',
          scheduledDate: new Date(),
        });
        taskId = task._id.toString();
      });

      it('should mark task as complete', async () => {
        const response = await request(app)
          .post(`/api/study-planner/tasks/${taskId}/complete`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ notes: 'Completed successfully', actualDuration: 45 })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.task.status).toBe('completed');
      });
    });
  });
});
