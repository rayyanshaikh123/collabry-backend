const focusService = require('../services/focus.service');
const { validationResult } = require('express-validator');

/**
 * Get all sessions for authenticated user
 * GET /api/focus/sessions
 */
exports.getSessions = async (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      type: req.query.type,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: req.query.limit,
      skip: req.query.skip
    };

    const result = await focusService.getSessions(req.user.id, filters);

    res.json({
      success: true,
      data: result.sessions,
      pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single session by ID
 * GET /api/focus/sessions/:id
 */
exports.getSession = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const session = await focusService.getSession(req.params.id, req.user.id);

    res.json({
      success: true,
      data: session
    });
  } catch (error) {
    if (error.message === 'Session not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

/**
 * Start new focus session
 * POST /api/focus/sessions
 */
exports.startSession = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { type, duration, pomodoroNumber } = req.body;

    const session = await focusService.startSession(req.user.id, {
      type,
      duration,
      pomodoroNumber
    });

    res.status(201).json({
      success: true,
      data: session,
      message: 'Focus session started successfully'
    });
  } catch (error) {
    if (error.message.includes('already have an active session')) {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

/**
 * Update session
 * PATCH /api/focus/sessions/:id
 */
exports.updateSession = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const session = await focusService.updateSession(
      req.params.id,
      req.user.id,
      req.body
    );

    res.json({
      success: true,
      data: session,
      message: 'Session updated successfully'
    });
  } catch (error) {
    if (error.message === 'Session not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

/**
 * Pause active session
 * POST /api/focus/sessions/:id/pause
 */
exports.pauseSession = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const session = await focusService.pauseSession(req.params.id, req.user.id);

    res.json({
      success: true,
      data: session,
      message: 'Session paused'
    });
  } catch (error) {
    if (error.message === 'Active session not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

/**
 * Resume paused session
 * POST /api/focus/sessions/:id/resume
 */
exports.resumeSession = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const session = await focusService.resumeSession(req.params.id, req.user.id);

    res.json({
      success: true,
      data: session,
      message: 'Session resumed'
    });
  } catch (error) {
    if (error.message === 'Paused session not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

/**
 * Complete session
 * POST /api/focus/sessions/:id/complete
 */
exports.completeSession = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { notes, distractions } = req.body;

    const result = await focusService.completeSession(
      req.params.id,
      req.user.id,
      { notes, distractions }
    );

    res.json({
      success: true,
      data: result,
      message: 'Session completed successfully'
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

/**
 * Cancel session
 * POST /api/focus/sessions/:id/cancel
 */
exports.cancelSession = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const session = await focusService.cancelSession(req.params.id, req.user.id);

    res.json({
      success: true,
      data: session,
      message: 'Session cancelled'
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

/**
 * Get focus settings
 * GET /api/focus/settings
 */
exports.getSettings = async (req, res, next) => {
  try {
    const settings = await focusService.getSettings(req.user.id);

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update focus settings
 * PATCH /api/focus/settings
 */
exports.updateSettings = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const settings = await focusService.updateSettings(req.user.id, req.body);

    res.json({
      success: true,
      data: settings,
      message: 'Settings updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get focus statistics
 * GET /api/focus/stats
 */
exports.getStats = async (req, res, next) => {
  try {
    const period = req.query.period || 'all';
    const stats = await focusService.getStats(req.user.id, period);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
};
