/**
 * Plan Hydration Test Suite
 * 
 * Tests for the Plan Hydrator utility that ensures all StudyPlan documents
 * have required scheduling fields before strategy execution.
 * 
 * This prevents the "Cannot read properties of undefined (reading 'dailyStudyHours')"
 * runtime error that occurs with legacy or AI-generated plans.
 */

const { 
  hydrateStudyPlan, 
  validateHydratedPlan,
  getPlannerConfig,
  PLANNER_DEFAULTS 
} = require('../../../src/services/strategies/planHydrator');

describe('Plan Hydrator', () => {
  
  describe('hydrateStudyPlan', () => {
    
    it('should throw error for null plan', () => {
      expect(() => hydrateStudyPlan(null)).toThrow('Cannot hydrate null or undefined plan');
    });
    
    it('should throw error for undefined plan', () => {
      expect(() => hydrateStudyPlan(undefined)).toThrow('Cannot hydrate null or undefined plan');
    });
    
    it('should throw error for plan without _id', () => {
      const plan = { userId: 'user123' };
      expect(() => hydrateStudyPlan(plan)).toThrow('Plan must have an _id field');
    });
    
    it('should throw error for plan without userId', () => {
      const plan = { _id: 'plan123' };
      expect(() => hydrateStudyPlan(plan)).toThrow('Plan must have a userId field');
    });
    
    it('should add missing dailyStudyHours with default', () => {
      const plan = {
        _id: 'plan123',
        userId: 'user123',
        status: 'active'
      };
      
      const hydrated = hydrateStudyPlan(plan);
      
      expect(hydrated.dailyStudyHours).toBe(PLANNER_DEFAULTS.dailyStudyHours);
    });
    
    it('should preserve existing dailyStudyHours', () => {
      const plan = {
        _id: 'plan123',
        userId: 'user123',
        dailyStudyHours: 6,
        status: 'active'
      };
      
      const hydrated = hydrateStudyPlan(plan);
      
      expect(hydrated.dailyStudyHours).toBe(6);
    });
    
    it('should handle legacy plan missing all scheduler fields', () => {
      const legacyPlan = {
        _id: 'legacy123',
        userId: 'user456',
        title: 'Old Plan',
        // Missing: dailyStudyHours, status, difficulty, preferredTimeSlots
      };
      
      const hydrated = hydrateStudyPlan(legacyPlan);
      
      expect(hydrated.dailyStudyHours).toBe(PLANNER_DEFAULTS.dailyStudyHours);
      expect(hydrated.status).toBe(PLANNER_DEFAULTS.status);
      expect(hydrated.difficulty).toBe(PLANNER_DEFAULTS.difficulty);
      expect(hydrated.preferredTimeSlots).toEqual(PLANNER_DEFAULTS.preferredTimeSlots);
    });
    
    it('should extract dailyStudyHours from nested config if present', () => {
      const plan = {
        _id: 'plan123',
        userId: 'user123',
        config: {
          dailyStudyHours: 8
        }
      };
      
      const hydrated = hydrateStudyPlan(plan);
      
      expect(hydrated.dailyStudyHours).toBe(8);
    });
    
    it('should not modify plan if all fields present', () => {
      const completePlan = {
        _id: 'complete123',
        userId: 'user789',
        dailyStudyHours: 5,
        status: 'active',
        difficulty: 'advanced',
        preferredTimeSlots: ['morning', 'evening'],
        examMode: true
      };
      
      const hydrated = hydrateStudyPlan(completePlan);
      
      expect(hydrated.dailyStudyHours).toBe(5);
      expect(hydrated.status).toBe('active');
      expect(hydrated.difficulty).toBe('advanced');
    });
    
  });
  
  describe('validateHydratedPlan', () => {
    
    it('should pass validation for properly hydrated plan', () => {
      const plan = {
        _id: 'plan123',
        userId: 'user123',
        dailyStudyHours: 4,
        status: 'active'
      };
      
      expect(() => validateHydratedPlan(plan)).not.toThrow();
    });
    
    it('should fail validation if dailyStudyHours still missing', () => {
      const plan = {
        _id: 'plan123',
        userId: 'user123',
        status: 'active'
        // Missing: dailyStudyHours
      };
      
      expect(() => validateHydratedPlan(plan))
        .toThrow('Plan hydration failed: Missing required fields after hydration');
    });
    
    it('should fail validation for invalid dailyStudyHours type', () => {
      const plan = {
        _id: 'plan123',
        userId: 'user123',
        dailyStudyHours: 'invalid',
        status: 'active'
      };
      
      expect(() => validateHydratedPlan(plan))
        .toThrow('has invalid dailyStudyHours');
    });
    
    it('should fail validation for zero dailyStudyHours', () => {
      const plan = {
        _id: 'plan123',
        userId: 'user123',
        dailyStudyHours: 0,
        status: 'active'
      };
      
      expect(() => validateHydratedPlan(plan))
        .toThrow('has invalid dailyStudyHours');
    });
    
    it('should fail validation for negative dailyStudyHours', () => {
      const plan = {
        _id: 'plan123',
        userId: 'user123',
        dailyStudyHours: -2,
        status: 'active'
      };
      
      expect(() => validateHydratedPlan(plan))
        .toThrow('has invalid dailyStudyHours');
    });
    
  });
  
  describe('getPlannerConfig', () => {
    
    it('should extract normalized config from plan', () => {
      const plan = {
        _id: 'plan123',
        userId: 'user123',
        dailyStudyHours: 6,
        maxSessionLength: 120,
        breakDuration: 20,
        preferredTimeSlots: ['morning'],
        difficulty: 'advanced',
        examMode: true,
        examDate: new Date('2026-03-01')
      };
      
      const config = getPlannerConfig(plan);
      
      expect(config).toEqual({
        dailyStudyHours: 6,
        maxSessionLength: 120,
        breakDuration: 20,
        preferredTimeSlots: ['morning'],
        difficulty: 'advanced',
        examMode: true,
        examDate: plan.examDate
      });
    });
    
    it('should apply defaults for missing optional fields', () => {
      const minimalPlan = {
        _id: 'plan123',
        userId: 'user123',
        dailyStudyHours: 4
      };
      
      const config = getPlannerConfig(minimalPlan);
      
      expect(config.maxSessionLength).toBe(PLANNER_DEFAULTS.maxSessionLength);
      expect(config.breakDuration).toBe(PLANNER_DEFAULTS.breakDuration);
      expect(config.preferredTimeSlots).toEqual([]);
      expect(config.difficulty).toBe(PLANNER_DEFAULTS.difficulty);
      expect(config.examMode).toBe(false);
      expect(config.examDate).toBeNull();
    });
    
  });
  
  describe('Integration: Strategy Execution Protection', () => {
    
    it('should prevent strategy execution failure with legacy plan', () => {
      // Simulate legacy plan from database (missing dailyStudyHours)
      const legacyPlan = {
        _id: 'legacy123',
        userId: 'user456',
        title: 'Legacy Study Plan',
        status: 'active',
        // Missing: dailyStudyHours (field didn't exist in old schema)
      };
      
      // Hydrate the plan
      const hydrated = hydrateStudyPlan(legacyPlan);
      
      // Validate it's now safe for execution
      expect(() => validateHydratedPlan(hydrated)).not.toThrow();
      
      // Verify strategy can access dailyStudyHours without error
      const dailyHours = hydrated.dailyStudyHours;
      expect(dailyHours).toBe(PLANNER_DEFAULTS.dailyStudyHours);
    });
    
    it('should prevent strategy execution failure with AI-generated plan', () => {
      // Simulate AI-generated plan that bypassed defaults
      const aiPlan = {
        _id: 'ai123',
        userId: 'user789',
        title: 'AI Generated Plan',
        generatedByAI: true,
        status: 'active',
        // AI might not set all fields correctly
      };
      
      // Hydrate the plan
      const hydrated = hydrateStudyPlan(aiPlan);
      
      // Validate it's now safe for execution
      expect(() => validateHydratedPlan(hydrated)).not.toThrow();
      
      // Verify critical fields exist
      expect(hydrated.dailyStudyHours).toBeDefined();
      expect(typeof hydrated.dailyStudyHours).toBe('number');
      expect(hydrated.dailyStudyHours).toBeGreaterThan(0);
    });
    
  });
  
});

/**
 * REGRESSION TEST
 * 
 * This test ensures the specific bug:
 * "Cannot read properties of undefined (reading 'dailyStudyHours')"
 * can never occur again.
 */
describe('Regression: dailyStudyHours undefined error', () => {
  
  it('should never throw undefined error after hydration', () => {
    // Create plan missing dailyStudyHours (the bug scenario)
    const problematicPlan = {
      _id: 'problem123',
      userId: 'user999',
      status: 'active',
      examDate: new Date('2026-03-15'),
      examMode: true
      // Missing: dailyStudyHours
    };
    
    // Hydrate the plan
    const hydrated = hydrateStudyPlan(problematicPlan);
    
    // This should NOT throw "Cannot read properties of undefined"
    expect(() => {
      const hours = hydrated.dailyStudyHours;
      const calculation = hours * 2; // Simulate strategy calculation
      expect(calculation).toBeGreaterThan(0);
    }).not.toThrow();
  });
  
});
