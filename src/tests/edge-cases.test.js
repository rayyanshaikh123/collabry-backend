/**
 * Edge Case Testing Suite for Study Planner
 * 
 * Tests critical edge cases and stress scenarios to ensure scheduler robustness.
 * Run with: npm test -- edge-cases.test.js
 * 
 * @tier Production Testing
 * @priority CRITICAL
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const StudyPlan = require('../models/StudyPlan');
const StudyTask = require('../models/StudyTask.ENHANCED');
const StudyEvent = require('../models/StudyEvent');
const User = require('../models/User');

describe('Edge Case Testing Suite', () => {
  let authToken;
  let userId;
  let planId;

  beforeAll(async () => {
    // Setup test database connection
    await mongoose.connect(process.env.TEST_DB_URI || 'mongodb://localhost:27017/collabry-test');
    
    // Create test user
    const user = await User.create({
      email: 'edgecase@test.com',
      password: 'Test123!',
      name: 'Edge Case Tester'
    });
    userId = user._id;
    
    // Get auth token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'edgecase@test.com', password: 'Test123!' });
    authToken = loginRes.body.token;
  });

  afterAll(async () => {
    // Cleanup
    await User.deleteMany({ email: 'edgecase@test.com' });
    await StudyPlan.deleteMany({ userId });
    await StudyTask.deleteMany({ userId });
    await StudyEvent.deleteMany({ userId });
    await mongoose.connection.close();
  });

  // ============================================================================
  // EDGE CASE 1: Timetable Change Mid-Plan
  // ============================================================================

  describe('Edge Case 1: Timetable Change Mid-Plan', () => {
    it('should handle new recurring class added mid-semester', async () => {
      // Create plan with tasks already scheduled
      const plan = await StudyPlan.create({
        userId,
        title: 'Semester Plan',
        subject: 'Computer Science',
        topics: ['Algorithms', 'Data Structures'],
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        dailyStudyHours: 4,
        weeklyTimetableBlocks: [] // Initially no classes
      });
      planId = plan._id;

      // Auto-schedule tasks
      const scheduleRes = await request(app)
        .post(`/api/study-planner/plans/${planId}/auto-schedule`)
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(scheduleRes.status).toBe(200);
      const initialTaskCount = scheduleRes.body.allocated.length;

      // Student adds new class (Monday/Wednesday 10-12)
      plan.weeklyTimetableBlocks = [
        { dayOfWeek: 1, startTime: '10:00', endTime: '12:00', label: 'New CS Class' },
        { dayOfWeek: 3, startTime: '10:00', endTime: '12:00', label: 'New CS Class' }
      ];
      await plan.save();

      // Re-schedule to detect conflicts
      const conflictRes = await request(app)
        .post(`/api/study-planner/plans/${planId}/auto-schedule`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(conflictRes.status).toBe(200);
      expect(conflictRes.body.conflicts).toBeDefined();
      
      // System should detect and resolve conflicts
      if (conflictRes.body.conflicts.length > 0) {
        console.log(`✓ Detected ${conflictRes.body.conflicts.length} conflicts from timetable change`);
      }
    });

    it('should redistribute tasks when class is cancelled', async () => {
      // Mark Monday class as cancelled (free time available)
      const plan = await StudyPlan.findById(planId);
      plan.weeklyTimetableBlocks = plan.weeklyTimetableBlocks.filter(
        block => !(block.dayOfWeek === 1 && block.startTime === '10:00')
      );
      await plan.save();

      // System should utilize newly available slot
      const rescheduleRes = await request(app)
        .post(`/api/study-planner/scheduling/adaptive-reschedule`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ planId, reason: 'class_cancelled' });

      expect(rescheduleRes.status).toBe(200);
      // Should move some tasks to the freed slot
    });
  });

  // ============================================================================
  // EDGE CASE 2: Emergency Deadline (Sudden Assignment)
  // ============================================================================

  describe('Edge Case 2: Emergency Deadline Injection', () => {
    it('should compress schedule when urgent deadline appears', async () => {
      const plan = await StudyPlan.create({
        userId,
        title: 'Regular Study Plan',
        subject: 'Mathematics',
        topics: ['Calculus', 'Linear Algebra', 'Statistics'],
        startDate: new Date(),
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        dailyStudyHours: 3
      });

      // Create 20 pending tasks
      const tasks = [];
      for (let i = 0; i < 20; i++) {
        tasks.push({
          userId,
          planId: plan._id,
          title: `Task ${i + 1}`,
          topic: 'Calculus',
          duration: 60,
          priority: 'medium',
          difficulty: 'medium',
          scheduledDate: new Date(Date.now() + i * 24 * 60 * 60 * 1000),
          status: 'pending'
        });
      }
      await StudyTask.insertMany(tasks);

      // Emergency: Assignment due in 2 days!
      const emergencyRes = await request(app)
        .post(`/api/study-planner/plans/${plan._id}/execute-strategy`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          mode: 'emergency',
          urgentDeadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
        });

      expect(emergencyRes.status).toBe(200);
      // Emergency mode should compress and prioritize
      expect(emergencyRes.body.compressed).toBe(true);
    });
  });

  // ============================================================================
  // EDGE CASE 3: Missed Task Cascade (5+ Days Absent)
  // ============================================================================

  describe('Edge Case 3: Extended Absence Recovery', () => {
    it('should redistribute 5 days of missed tasks without overload', async () => {
      const plan = await StudyPlan.create({
        userId,
        title: 'Missed Tasks Plan',
        subject: 'Physics',
        topics: ['Mechanics', 'Thermodynamics'],
        startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // Started 10 days ago
        endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        dailyStudyHours: 3
      });

      // Create 25 missed tasks (5 days * 5 tasks/day)
      const missedTasks = [];
      for (let day = 0; day < 5; day++) {
        for (let task = 0; task < 5; task++) {
          missedTasks.push({
            userId,
            planId: plan._id,
            title: `Missed Task Day ${day + 1} #${task + 1}`,
            topic: 'Mechanics',
            duration: 45,
            priority: 'high',
            difficulty: 'medium',
            scheduledDate: new Date(Date.now() - (5 - day) * 24 * 60 * 60 * 1000),
            status: 'pending' // Still pending, not completed
          });
        }
      }
      await StudyTask.insertMany(missedTasks);

      // Trigger adaptive redistribution
      const redistributeRes = await request(app)
        .post('/api/study-planner/scheduling/adaptive-reschedule')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          planId: plan._id,
          mode: 'redistribute_missed'
        });

      expect(redistributeRes.status).toBe(200);
      expect(redistributeRes.body.redistributed).toBeGreaterThan(0);
      
      // Verify cognitive load limits (max 4 tasks/day)
      const rescheduledTasks = await StudyTask.find({
        planId: plan._id,
        scheduledDate: { $gte: new Date() }
      });

      const tasksPerDay = {};
      rescheduledTasks.forEach(task => {
        const day = task.scheduledDate.toISOString().split('T')[0];
        tasksPerDay[day] = (tasksPerDay[day] || 0) + 1;
      });

      Object.values(tasksPerDay).forEach(count => {
        expect(count).toBeLessThanOrEqual(4); // Cognitive load limit
      });
    });
  });

  // ============================================================================
  // EDGE CASE 4: Multiple Exams Same Week
  // ============================================================================

  describe('Edge Case 4: Exam Cluster Stress Test', () => {
    it('should prioritize multiple exams intelligently', async () => {
      const now = new Date();
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Create 3 plans with exams in the same week
      const plans = await Promise.all([
        StudyPlan.create({
          userId,
          title: 'Physics Exam Prep',
          subject: 'Physics',
          topics: ['Waves', 'Optics'],
          startDate: now,
          endDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
          examDate: in7Days,
          examMode: true,
          dailyStudyHours: 3
        }),
        StudyPlan.create({
          userId,
          title: 'Math Exam Prep',
          subject: 'Mathematics',
          topics: ['Integrals', 'Derivatives'],
          startDate: now,
          endDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
          examDate: new Date(in7Days.getTime() + 1 * 24 * 60 * 60 * 1000),
          examMode: true,
          dailyStudyHours: 3
        }),
        StudyPlan.create({
          userId,
          title: 'Chemistry Exam Prep',
          subject: 'Chemistry',
          topics: ['Organic', 'Inorganic'],
          startDate: now,
          endDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
          examDate: new Date(in7Days.getTime() + 2 * 24 * 60 * 60 * 1000),
          examMode: true,
          dailyStudyHours: 3
        })
      ]);

      // Auto-schedule all three
      const scheduleResults = await Promise.all(
        plans.map(plan =>
          request(app)
            .post(`/api/study-planner/plans/${plan._id}/auto-strategy`)
            .set('Authorization', `Bearer ${authToken}`)
        )
      );

      scheduleResults.forEach(res => {
        expect(res.status).toBe(200);
      });

      // Verify total daily hours don't exceed cognitive limits
      const allTasks = await StudyTask.find({
        userId,
        scheduledDate: { $gte: now, $lte: in7Days }
      });

      const dailyHours = {};
      allTasks.forEach(task => {
        const day = task.scheduledDate.toISOString().split('T')[0];
        dailyHours[day] = (dailyHours[day] || 0) + (task.duration / 60);
      });

      Object.values(dailyHours).forEach(hours => {
        expect(hours).toBeLessThanOrEqual(8); // Max 8 hours/day even in emergency
      });
    });
  });

  // ============================================================================
  // EDGE CASE 5: Plan Extends Past EndDate (Overflow)
  // ============================================================================

  describe('Edge Case 5: Schedule Overflow Protection', () => {
    it('should reject schedule extension beyond endDate', async () => {
      const plan = await StudyPlan.create({
        userId,
        title: 'Short Duration Plan',
        subject: 'History',
        topics: Array(50).fill(0).map((_, i) => `Topic ${i + 1}`), // 50 topics!
        startDate: new Date(),
        endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // Only 5 days
        dailyStudyHours: 2 // Low hours
      });

      const scheduleRes = await request(app)
        .post(`/api/study-planner/plans/${plan._id}/auto-schedule`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(scheduleRes.status).toBe(200);
      expect(scheduleRes.body.warnings).toBeDefined();
      expect(scheduleRes.body.warnings.some(w => w.includes('insufficient time'))).toBe(true);
      
      // Should NOT create tasks beyond endDate
      const tasks = await StudyTask.find({ planId: plan._id });
      tasks.forEach(task => {
        expect(new Date(task.scheduledDate)).toBeLessThanOrEqual(new Date(plan.endDate));
      });
    });
  });

  // ============================================================================
  // EDGE CASE 6: Concurrent Plan Updates
  // ============================================================================

  describe('Edge Case 6: Concurrent Modification Safety', () => {
    it('should handle simultaneous schedule updates gracefully', async () => {
      const plan = await StudyPlan.create({
        userId,
        title: 'Concurrent Test Plan',
        subject: 'Biology',
        topics: ['Genetics', 'Evolution'],
        startDate: new Date(),
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        dailyStudyHours: 3
      });

      // Simulate 3 simultaneous auto-schedule calls
      const promises = [
        request(app)
          .post(`/api/study-planner/plans/${plan._id}/auto-schedule`)
          .set('Authorization', `Bearer ${authToken}`),
        request(app)
          .post(`/api/study-planner/plans/${plan._id}/auto-schedule`)
          .set('Authorization', `Bearer ${authToken}`),
        request(app)
          .post(`/api/study-planner/plans/${plan._id}/auto-schedule`)
          .set('Authorization', `Bearer ${authToken}`)
      ];

      const results = await Promise.allSettled(promises);
      
      // At least one should succeed
      const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.status === 200);
      expect(succeeded.length).toBeGreaterThan(0);

      // No duplicate tasks should be created
      const tasks = await StudyTask.find({ planId: plan._id });
      const titles = tasks.map(t => t.title);
      const uniqueTitles = new Set(titles);
      expect(uniqueTitles.size).toBe(titles.length); // No duplicates
    });
  });

  // ============================================================================
  // EDGE CASE 7: Legacy Task Migration
  // ============================================================================

  describe('Edge Case 7: Legacy Schema Compatibility', () => {
    it('should handle tasks created before schedulingMetadata field', async () => {
      const plan = await StudyPlan.create({
        userId,
        title: 'Legacy Plan',
        subject: 'Literature',
        topics: ['Shakespeare', 'Poetry'],
        startDate: new Date(),
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        dailyStudyHours: 2
      });

      // Create tasks WITHOUT schedulingMetadata (simulate old schema)
      await StudyTask.collection.insertMany([
        {
          userId: mongoose.Types.ObjectId(userId),
          planId: mongoose.Types.ObjectId(plan._id),
          title: 'Old Task 1',
          topic: 'Shakespeare',
          duration: 60,
          priority: 'medium',
          difficulty: 'medium',
          scheduledDate: new Date(),
          status: 'pending'
          // NOTE: No schedulingMetadata field!
        }
      ]);

      // Auto-schedule should handle gracefully
      const res = await request(app)
        .post(`/api/study-planner/plans/${plan._id}/auto-schedule`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      
      // Verify schedulingMetadata was initialized
      const task = await StudyTask.findOne({ planId: plan._id, title: 'Old Task 1' });
      expect(task.schedulingMetadata).toBeDefined();
      expect(task.schedulingMetadata.isAutoScheduled).toBeDefined();
    });
  });

  // ============================================================================
  // STRESS TEST: Maximum Load
  // ============================================================================

  describe('Stress Test: Maximum Realistic Load', () => {
    it('should handle 100 tasks across 5 plans without timeout', async () => {
      const plans = await Promise.all(
        Array(5).fill(0).map((_, i) =>
          StudyPlan.create({
            userId,
            title: `Stress Plan ${i + 1}`,
            subject: `Subject ${i + 1}`,
            topics: Array(20).fill(0).map((_, j) => `Topic ${j + 1}`),
            startDate: new Date(),
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            dailyStudyHours: 3
          })
        )
      );

      const start = Date.now();
      
      const scheduleResults = await Promise.all(
        plans.map(plan =>
          request(app)
            .post(`/api/study-planner/plans/${plan._id}/auto-schedule`)
            .set('Authorization', `Bearer ${authToken}`)
            .timeout(30000) // 30s timeout
        )
      );

      const duration = Date.now() - start;

      scheduleResults.forEach(res => {
        expect(res.status).toBe(200);
      });

      console.log(`✓ Scheduled 100 tasks across 5 plans in ${duration}ms`);
      expect(duration).toBeLessThan(30000); // Should complete in < 30s
    });
  });
});
