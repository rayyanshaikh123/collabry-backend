/**
 * StrategyFactory - Strategy Pattern Factory
 * 
 * Factory for creating scheduling strategy instances.
 * Provides centralized strategy instantiation and validation.
 */

const BalancedStrategy = require('./BalancedStrategy');
const AdaptiveStrategy = require('./AdaptiveStrategy');
const EmergencyStrategy = require('./EmergencyStrategy');

class StrategyFactory {
  /**
   * Get strategy instance by mode name
   * @param {String} mode - Strategy mode ('balanced', 'adaptive', 'emergency')
   * @returns {BaseStrategy} Strategy instance
   */
  static getStrategy(mode) {
    switch (mode.toLowerCase()) {
      case 'balanced':
        return new BalancedStrategy();
      
      case 'adaptive':
        return new AdaptiveStrategy();
      
      case 'emergency':
        return new EmergencyStrategy();
      
      default:
        throw new Error(`Unknown strategy mode: ${mode}. Valid modes: balanced, adaptive, emergency`);
    }
  }

  /**
   * Get all available strategies
   * @returns {Array<Object>} Strategy metadata
   */
  static getAllStrategies() {
    return [
      new BalancedStrategy().getMetadata(),
      new AdaptiveStrategy().getMetadata(),
      new EmergencyStrategy().getMetadata()
    ];
  }

  /**
   * Validate strategy mode
   * @param {String} mode - Strategy mode
   * @returns {Boolean} True if valid
   */
  static isValidMode(mode) {
    return ['balanced', 'adaptive', 'emergency'].includes(mode.toLowerCase());
  }
}

module.exports = StrategyFactory;
