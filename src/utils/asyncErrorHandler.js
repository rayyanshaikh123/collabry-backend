/**
 * Async Error Handling Utilities
 * 
 * Provides standardized async/await error handling patterns, retry logic,
 * and circuit breaker patterns for resilient service operations.
 * 
 * @tier Production Resilience
 * @priority HIGH
 */

const logger = require('./logger');
const AppError = require('./AppError');

class AsyncErrorHandler {
  /**
   * Wrap async controller methods with standardized error handling
   * @param {Function} fn - Async controller function
   * @returns {Function} Wrapped function
   */
  catchAsync(fn) {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch((error) => {
        logger.error(`[AsyncError] ${req.method} ${req.path}:`, {
          error: error.message,
          stack: error.stack,
          userId: req.user?.id,
          body: req.body
        });
        next(error);
      });
    };
  }

  /**
   * Wrap async service methods with error handling and logging
   * @param {Function} fn - Async service function
   * @param {string} serviceName - Name of the service for logging
   * @returns {Function} Wrapped function
   */
  wrapService(fn, serviceName) {
    return async (...args) => {
      try {
        const result = await fn(...args);
        return { success: true, data: result, error: null };
      } catch (error) {
        logger.error(`[${serviceName}] Operation failed:`, {
          error: error.message,
          stack: error.stack,
          args: args.map(a => typeof a === 'object' ? JSON.stringify(a).substring(0, 100) : a)
        });
        return { success: false, data: null, error: error.message };
      }
    };
  }

  /**
   * Retry async operation with exponential backoff
   * @param {Function} fn - Async function to retry
   * @param {Object} options - Retry configuration
   * @returns {Promise} Result of successful attempt
   */
  async retryWithBackoff(fn, options = {}) {
    const {
      maxRetries = 3,
      initialDelay = 1000,
      maxDelay = 10000,
      backoffMultiplier = 2,
      shouldRetry = (error) => true,
      onRetry = (attempt, error) => {}
    } = options;

    let lastError;
    let delay = initialDelay;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt === maxRetries || !shouldRetry(error)) {
          throw error;
        }

        logger.warn(`[RetryBackoff] Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        onRetry(attempt, error);

        await this._sleep(delay);
        delay = Math.min(delay * backoffMultiplier, maxDelay);
      }
    }

    throw lastError;
  }

  /**
   * Execute multiple async operations with timeout
   * @param {Array<Promise>} promises - Array of promises
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<Array>} Results or timeout error
   */
  async withTimeout(promises, timeoutMs = 30000) {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new AppError('Operation timeout', 408)), timeoutMs)
    );

    try {
      return await Promise.race([
        Promise.all(promises),
        timeout
      ]);
    } catch (error) {
      logger.error('[WithTimeout] Operation timed out or failed:', error);
      throw error;
    }
  }

  /**
   * Execute async operation with circuit breaker pattern
   * Prevents cascading failures by failing fast after threshold
   * 
   * @param {Function} fn - Async function to execute
   * @param {string} circuitName - Name of the circuit for tracking
   * @param {Object} options - Circuit breaker config
   * @returns {Promise} Result or circuit open error
   */
  async withCircuitBreaker(fn, circuitName, options = {}) {
    const {
      failureThreshold = 5,
      successThreshold = 2,
      timeout = 30000,
      resetTimeout = 60000
    } = options;

    if (!this._circuits) {
      this._circuits = {};
    }

    if (!this._circuits[circuitName]) {
      this._circuits[circuitName] = {
        state: 'CLOSED', // CLOSED | OPEN | HALF_OPEN
        failureCount: 0,
        successCount: 0,
        lastFailureTime: null,
        nextAttemptTime: null
      };
    }

    const circuit = this._circuits[circuitName];
    const now = Date.now();

    // Check if circuit is OPEN
    if (circuit.state === 'OPEN') {
      if (now < circuit.nextAttemptTime) {
        throw new AppError(`Circuit breaker ${circuitName} is OPEN`, 503);
      }
      // Transition to HALF_OPEN
      circuit.state = 'HALF_OPEN';
      circuit.successCount = 0;
      logger.info(`[CircuitBreaker] ${circuitName} transitioning to HALF_OPEN`);
    }

    try {
      const result = await this.withTimeout([fn()], timeout);
      
      // Success handling
      if (circuit.state === 'HALF_OPEN') {
        circuit.successCount++;
        if (circuit.successCount >= successThreshold) {
          circuit.state = 'CLOSED';
          circuit.failureCount = 0;
          logger.info(`[CircuitBreaker] ${circuitName} CLOSED (recovered)`);
        }
      } else {
        circuit.failureCount = Math.max(0, circuit.failureCount - 1);
      }

      return result[0];
    } catch (error) {
      circuit.failureCount++;
      circuit.lastFailureTime = now;

      if (circuit.failureCount >= failureThreshold) {
        circuit.state = 'OPEN';
        circuit.nextAttemptTime = now + resetTimeout;
        logger.error(`[CircuitBreaker] ${circuitName} OPEN after ${circuit.failureCount} failures`);
      }

      throw error;
    }
  }

  /**
   * Safe async iteration with error recovery
   * Continues processing even if individual items fail
   * 
   * @param {Array} items - Items to process
   * @param {Function} fn - Async processor function
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Results with successes and failures
   */
  async safeMap(items, fn, options = {}) {
    const {
      concurrency = 5,
      stopOnError = false,
      onItemError = (item, error) => {}
    } = options;

    const results = [];
    const errors = [];

    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      
      const batchResults = await Promise.allSettled(
        batch.map(async (item, index) => {
          try {
            return await fn(item, i + index);
          } catch (error) {
            onItemError(item, error);
            if (stopOnError) throw error;
            return null;
          }
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          errors.push(result.reason);
        }
      }

      if (stopOnError && errors.length > 0) {
        break;
      }
    }

    return {
      results: results.filter(r => r !== null),
      errors,
      totalProcessed: items.length,
      successCount: results.filter(r => r !== null).length,
      errorCount: errors.length
    };
  }

  /**
   * Graceful degradation wrapper
   * Returns fallback value if operation fails
   * 
   * @param {Function} fn - Async function
   * @param {*} fallbackValue - Value to return on error
   * @param {string} operationName - Name for logging
   * @returns {Promise} Result or fallback
   */
  async withFallback(fn, fallbackValue, operationName = 'operation') {
    try {
      return await fn();
    } catch (error) {
      logger.warn(`[Fallback] ${operationName} failed, using fallback:`, error.message);
      return fallbackValue;
    }
  }

  /**
   * Debounced async execution
   * Prevents rapid repeated calls
   * 
   * @param {Function} fn - Async function
   * @param {number} delay - Debounce delay in ms
   * @returns {Function} Debounced function
   */
  debounce(fn, delay = 300) {
    let timeout;
    return (...args) => {
      return new Promise((resolve, reject) => {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
          try {
            resolve(await fn(...args));
          } catch (error) {
            reject(error);
          }
        }, delay);
      });
    };
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new AsyncErrorHandler();
