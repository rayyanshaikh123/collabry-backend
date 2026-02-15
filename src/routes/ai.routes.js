/**
 * AI Engine Proxy Routes
 * Forwards requests to the AI engine server
 */
const express = require('express');
const axios = require('axios');
const router = express.Router();
const { protect } = require('../middlewares/auth.middleware');
const { checkAIUsageLimit, trackAIUsage, checkFileUploadLimit, checkStorageLimit } = require('../middleware/usageEnforcement');

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8000';

const getSafeErrorData = (error) => {
  const data = error?.response?.data;
  if (!data) return undefined;
  // Avoid circular structures from streams/sockets
  if (typeof data === 'object' && typeof data.pipe === 'function') {
    return undefined;
  }
  return data;
};

/**
 * Proxy middleware for AI engine requests
 */
const proxyToAI = async (req, res) => {
  try {
    // Special handling: /health is at root level, everything else needs /ai prefix
    const path = req.path === '/health' ? '/health' : `/ai${req.path}`;
    const queryString = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
    const url = `${AI_ENGINE_URL}${path}${queryString}`;
    
    console.log(`Proxying to AI engine: ${url}`);
    
    // Get auth token from request
    const token = req.headers.authorization;
    
    // Check if this is a streaming endpoint
    const isStreaming = req.path.includes('/stream');
    
    if (isStreaming) {
      // Stream response directly without wrapping
      const config = {
        method: req.method,
        url,
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: token }),
        },
        ...(req.method !== 'GET' && req.method !== 'HEAD' && { data: req.body }),
        responseType: 'stream'
      };
      
      const response = await axios(config);
      
      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // Pipe the stream directly
      response.data.pipe(res);
      
      return;
    }
    
    // Non-streaming: Forward request normally
    const config = {
      method: req.method,
      url,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: token }),
      },
      ...(req.method !== 'GET' && req.method !== 'HEAD' && { data: req.body }),
    };

    const response = await axios(config);
    
    // Return response in standard API format
    res.status(response.status).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    console.error('AI Proxy Error:', error.message);
    
    if (error.response) {
      const safeData = getSafeErrorData(error);
      // Forward error from AI engine
      res.status(error.response.status).json({
        success: false,
        message: safeData?.message || safeData?.detail || 'AI engine error',
        error: safeData,
      });
    } else {
      // Network or other error
      res.status(503).json({
        success: false,
        message: 'AI engine unavailable',
        error: error.message,
      });
    }
  }
};

/**
 * Creates a proxy handler that tracks AI usage after successful requests
 */
const createTrackedProxyHandler = (questionType = 'chat') => {
  return async (req, res) => {
    const userId = req.user?.id || req.user?._id;
    
    try {
      // Special handling: /health is at root level, everything else needs /ai prefix
      const path = req.path === '/health' ? '/health' : `/ai${req.path}`;
      const queryString = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
      const url = `${AI_ENGINE_URL}${path}${queryString}`;
      
      console.log(`Proxying to AI engine: ${url}`);
      
      // Get auth token from request
      const token = req.headers.authorization;
      
      // Check if this is a streaming endpoint
      const isStreaming = req.path.includes('/stream');
      
      if (isStreaming) {
        // Stream response directly without wrapping
        const config = {
          method: req.method,
          url,
          headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: token }),
          },
          ...(req.method !== 'GET' && req.method !== 'HEAD' && { data: req.body }),
          responseType: 'stream'
        };
        
        const response = await axios(config);
        
        // Track usage for streaming requests
        if (userId) {
          trackAIUsage(userId, 0, 'basic', questionType);
        }
        
        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        // Add remaining questions to headers
        if (req.remainingQuestions !== undefined) {
          res.setHeader('X-Remaining-Questions', req.remainingQuestions - 1);
        }
        
        // Pipe the stream directly
        response.data.pipe(res);
        
        return;
      }
      
      // Non-streaming: Forward request normally
      const config = {
        method: req.method,
        url,
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: token }),
        },
        ...(req.method !== 'GET' && req.method !== 'HEAD' && { data: req.body }),
      };

      const response = await axios(config);
      
      // Track usage for successful requests
      if (userId) {
        const tokens = response.data?.usage?.total_tokens || 0;
        trackAIUsage(userId, tokens, 'basic', questionType);
      }
      
      // Return response in standard API format with usage info
      res.status(response.status).json({
        success: true,
        data: response.data,
        usage: {
          remainingQuestions: req.remainingQuestions !== undefined ? req.remainingQuestions - 1 : 'unlimited',
          plan: req.userPlan,
        },
      });
    } catch (error) {
      console.error('AI Proxy Error:', error.message);
      
      if (error.response) {
        const safeData = getSafeErrorData(error);
        // Forward error from AI engine
        res.status(error.response.status).json({
          success: false,
          message: safeData?.message || safeData?.detail || 'AI engine error',
          error: safeData,
        });
      } else {
        // Network or other error
        res.status(503).json({
          success: false,
          message: 'AI engine unavailable',
          error: error.message,
        });
      }
    }
  };
};

// Public routes (no auth)
router.get('/health', proxyToAI);
router.get('/usage/stats', proxyToAI);

// Protected routes (require auth)
router.get('/usage/me', protect, proxyToAI);
router.get('/usage/global', protect, proxyToAI);
router.get('/usage/realtime', protect, proxyToAI);
router.get('/usage/user/:userId', protect, proxyToAI);

// Session routes
router.get('/sessions', protect, proxyToAI);
router.post('/sessions', protect, proxyToAI);
router.get('/sessions/:id', protect, proxyToAI);
router.delete('/sessions/:id', protect, proxyToAI);
router.get('/sessions/:id/messages', protect, proxyToAI);
router.post('/sessions/:id/messages', protect, proxyToAI);
router.delete('/sessions/:id/messages', protect, proxyToAI);
router.post('/sessions/:id/chat/stream', protect, checkAIUsageLimit, createTrackedProxyHandler('chat'));
router.get('/sessions/:id/chat/stream', protect, checkAIUsageLimit, createTrackedProxyHandler('chat'));
router.post('/sessions/:id/chat', protect, checkAIUsageLimit, createTrackedProxyHandler('chat'));

// AI operation routes - with usage enforcement
router.post('/chat', protect, checkAIUsageLimit, createTrackedProxyHandler('chat'));
router.post('/chat/stream', protect, checkAIUsageLimit, createTrackedProxyHandler('chat'));
router.post('/summarize', protect, checkAIUsageLimit, createTrackedProxyHandler('summarize'));
router.post('/summarize/stream', protect, checkAIUsageLimit, createTrackedProxyHandler('summarize'));
router.post('/qa', protect, checkAIUsageLimit, createTrackedProxyHandler('chat'));
router.post('/qa/stream', protect, checkAIUsageLimit, createTrackedProxyHandler('chat'));
router.post('/mindmap', protect, checkAIUsageLimit, createTrackedProxyHandler('other'));
router.post('/upload', protect, checkFileUploadLimit, checkStorageLimit, proxyToAI);
router.post('/generate-study-plan', protect, checkAIUsageLimit, createTrackedProxyHandler('study-copilot'));

module.exports = router;
