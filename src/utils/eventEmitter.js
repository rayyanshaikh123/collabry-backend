/**
 * Event Emitter
 * 
 * Centralized event bus for decoupled service communication.
 * Enables event-driven architecture for Tier-2/3 features.
 * 
 * Events:
 * - tasks.rescheduled: When adaptive scheduling redistributes tasks
 * - task.completed: When a user completes a task
 * - exam.phase.changed: When exam mode phase transitions
 * - behavior.profile.reliable: When user has enough data for ML predictions
 * - heatmap.updated: When daily stats are recalculated
 * - collaborative.session.created: When group study session is created
 */

const EventEmitter = require('events');

class AppEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(20); // Support multiple services listening
  }
  
  /**
   * Emit event with error handling
   */
  safeEmit(event, data) {
    try {
      this.emit(event, data);
    } catch (error) {
      console.error(`[EventEmitter] Error emitting ${event}:`, error);
    }
  }
}

module.exports = new AppEventEmitter();
