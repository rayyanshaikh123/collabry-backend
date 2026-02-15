/**
 *Logger Utility
 * 
 * Production-ready centralized logging with structured output
 * Compatible with Docker container logs and log aggregators
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'INFO'];
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SERVICE_NAME = 'collabry-backend';
const APP_VERSION = process.env.APP_VERSION || '1.0.0';
const HOSTNAME = process.env.HOSTNAME || require('os').hostname();

class Logger {
  /**
   * Format log message with timestamp and level
   * In production: JSON format for structured logging
   * In development: Human-readable format with colors
   */
  _format(level, message, meta = null) {
    const timestamp = new Date().toISOString();
    
    if (IS_PRODUCTION) {
      // Structured JSON logging for production (parseable by log aggregators)
      const logEntry = {
        timestamp,
        level,
        message,
        service: SERVICE_NAME,
        version: APP_VERSION,
        hostname: HOSTNAME,
        env: process.env.NODE_ENV,
        ...meta
      };
      return JSON.stringify(logEntry);
    } else {
      // Human-readable format for development
      const formatted = `[${timestamp}] [${level}] ${message}`;
      if (meta && Object.keys(meta).length > 0) {
        return `${formatted} ${JSON.stringify(meta)}`;
      }
      return formatted;
    }
  }
  
  /**
   * Log at DEBUG level
   */
  debug(message, meta = null) {
    if (CURRENT_LEVEL <= LOG_LEVELS.DEBUG) {
      console.log(this._format('DEBUG', message, meta));
    }
  }
  
  /**
   * Log at INFO level
   */
  info(message, meta = null) {
    if (CURRENT_LEVEL <= LOG_LEVELS.INFO) {
      console.log(this._format('INFO', message, meta));
    }
  }
  
  /**
   * Log at WARN level
   */
  warn(message, meta = null) {
    if (CURRENT_LEVEL <= LOG_LEVELS.WARN) {
      console.warn(this._format('WARN', message, meta));
    }
  }
  
  /**
   * Log at ERROR level
   */
  error(message, error = null) {
    if (CURRENT_LEVEL <= LOG_LEVELS.ERROR) {
      const meta = {};
      if (error) {
        meta.error_name = error.name;
        meta.error_message = error.message;
        if (error.stack) {
          meta.stack_trace = error.stack;
        }
      }
      console.error(this._format('ERROR', message, meta));
    }
  }
  
  /**
   * HTTP request logger middleware (production)
   */
  httpLogger() {
    return (req, res, next) => {
      const startTime = Date.now();
      
      // Log response on finish
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        const logData = {
          type: 'http_request',
          method: req.method,
          url: req.originalUrl || req.url,
          status: res.statusCode,
          duration_ms: duration,
          ip: req.ip || req.connection.remoteAddress,
          user_agent: req.get('user-agent'),
        };
        
        // Add user ID if authenticated
        if (req.user && req.user._id) {
          logData.user_id = req.user._id.toString();
        }
        
        // Log level based on status code
        if (res.statusCode >= 500) {
          this.error('HTTP Request Failed', logData);
        } else if (res.statusCode >= 400) {
          this.warn('HTTP Request', logData);
        } else if (duration > 3000) {
          // Log slow requests
          this.warn('Slow HTTP Request', logData);
        } else {
          this.info('HTTP Request', logData);
        }
      });
      
      next();
    };
  }
  
  /**
   * Log AI operations (for usage tracking)
   */
  logAIOperation(data) {
    this.info('AI Operation', {
      type: 'ai_operation',
      ...data
    });
  }
  
  /**
   * Log authentication events
   */
  logAuthEvent(event, data) {
    this.info(`Auth: ${event}`, {
      type: 'auth_event',
      event,
      ...data
    });
  }
  
  /**
   * Log slow database queries
   */
  logSlowQuery(collection, operation, duration) {
    if (duration > 1000) { // Log queries slower than 1s
      this.warn('Slow Database Query', {
        type: 'slow_query',
        collection,
        operation,
        duration_ms: duration
      });
    }
  }
  
  /**
   * Log security events
   */
  logSecurityEvent(event, data) {
    this.warn(`Security: ${event}`, {
      type: 'security_event',
      event,
      ...data
    });
  }
}

module.exports = new Logger();
