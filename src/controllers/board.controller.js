const boardService = require('../services/board.service');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const notificationService = require('../services/notification.service');
const { getIO } = require('../socket');
const { emitNotificationToUser } = require('../socket/notificationNamespace');

/**
 * @desc    Create a new board
 * @route   POST /api/boards
 * @access  Private
 */
exports.createBoard = asyncHandler(async (req, res) => {
  const board = await boardService.createBoard(req.user._id, req.body);

  res.status(201).json({
    success: true,
    data: board
  });
});

/**
 * @desc    Get all boards for current user
 * @route   GET /api/boards
 * @access  Private
 */
exports.getBoards = asyncHandler(async (req, res) => {
  const options = {
    includeArchived: req.query.includeArchived === 'true',
    isPublic: req.query.isPublic ? req.query.isPublic === 'true' : null,
    limit: parseInt(req.query.limit) || 50,
    skip: parseInt(req.query.skip) || 0,
    sortBy: req.query.sortBy || 'lastActivity',
    sortOrder: req.query.sortOrder || 'desc'
  };

  const result = await boardService.getUserBoards(req.user._id, options);

  res.json({
    success: true,
    count: result.boards.length,
    total: result.total,
    data: result.boards
  });
});

/**
 * @desc    Get a single board
 * @route   GET /api/boards/:id
 * @access  Private
 */
exports.getBoard = asyncHandler(async (req, res) => {
  const board = await boardService.getBoardById(req.params.id, req.user._id);

  res.json({
    success: true,
    data: board
  });
});

/**
 * @desc    Update board metadata
 * @route   PATCH /api/boards/:id
 * @access  Private (Owner only)
 */
exports.updateBoard = asyncHandler(async (req, res) => {
  const board = await boardService.updateBoard(
    req.params.id,
    req.user._id,
    req.body
  );

  res.json({
    success: true,
    data: board
  });
});

/**
 * @desc    Delete a board
 * @route   DELETE /api/boards/:id
 * @access  Private (Owner only)
 */
exports.deleteBoard = asyncHandler(async (req, res) => {
  const result = await boardService.deleteBoard(req.params.id, req.user._id);

  res.json({
    success: true,
    message: result.message
  });
});

/**
 * @desc    Archive/Unarchive a board
 * @route   PATCH /api/boards/:id/archive
 * @access  Private (Owner only)
 */
exports.archiveBoard = asyncHandler(async (req, res) => {
  const archive = req.body.archive !== false; // Default to true
  const board = await boardService.archiveBoard(req.params.id, req.user._id, archive);

  res.json({
    success: true,
    data: board
  });
});

/**
 * @desc    Duplicate a board
 * @route   POST /api/boards/:id/duplicate
 * @access  Private
 */
exports.duplicateBoard = asyncHandler(async (req, res) => {
  const board = await boardService.duplicateBoard(
    req.params.id,
    req.user._id,
    req.body.title
  );

  res.status(201).json({
    success: true,
    data: board
  });
});

/**
 * @desc    Add member to board
 * @route   POST /api/boards/:id/members
 * @access  Private (Owner only)
 */
exports.addMember = asyncHandler(async (req, res) => {
  const { userId, role } = req.body;

  if (!userId) {
    throw new AppError('User ID is required', 400);
  }

  const board = await boardService.addMember(req.params.id, req.user._id, {
    userId,
    role: role || 'editor'
  });

  // Send notification to the added member
  try {
    const User = require('../models/User');
    const addedUser = await User.findById(userId);
    const invitedBy = await User.findById(req.user._id);

    if (addedUser && invitedBy) {
      const notification = await notificationService.notifyBoardMemberJoined(
        userId,
        board,
        invitedBy
      );

      const io = getIO();
      emitNotificationToUser(io, userId, notification);
    }
  } catch (err) {
    console.error('Failed to send notification:', err);
  }

  res.json({
    success: true,
    data: board
  });
});

/**
 * @desc    Remove member from board
 * @route   DELETE /api/boards/:id/members/:userId
 * @access  Private (Owner only)
 */
exports.removeMember = asyncHandler(async (req, res) => {
  const board = await boardService.removeMember(
    req.params.id,
    req.user._id,
    req.params.userId
  );

  res.json({
    success: true,
    data: board
  });
});

/**
 * @desc    Update member role
 * @route   PATCH /api/boards/:id/members/:userId
 * @access  Private (Owner only)
 */
exports.updateMemberRole = asyncHandler(async (req, res) => {
  const { role } = req.body;

  if (!role) {
    throw new AppError('Role is required', 400);
  }

  const board = await boardService.updateMemberRole(
    req.params.id,
    req.user._id,
    req.params.userId,
    role
  );

  res.json({
    success: true,
    data: board
  });
});

/**
 * @desc    Invite member by email
 * @route   POST /api/boards/:id/invite
 * @access  Private (Owner/Editor)
 */
exports.inviteMember = asyncHandler(async (req, res) => {
  const { email, role = 'editor' } = req.body;

  const result = await boardService.inviteMemberByEmail(
    req.params.id,
    req.user._id,
    email,
    role
  );

  // Send notification to the invited user
  try {
    const User = require('../models/User');
    const invitedUser = await User.findOne({ email });
    const invitedBy = await User.findById(req.user._id);

    if (invitedUser && invitedBy) {
      const Board = require('../models/Board');
      const board = await Board.findById(req.params.id);

      const notification = await notificationService.notifyBoardInvitation(
        invitedUser._id,
        board,
        invitedBy
      );

      const io = getIO();
      emitNotificationToUser(io, invitedUser._id, notification);
    }
  } catch (err) {
    console.error('Failed to send notification:', err);
  }

  res.json({
    success: true,
    message: 'Invitation sent successfully',
    data: result
  });
});

/**
 * @desc    Search boards
 * @route   GET /api/boards/search
 * @access  Private
 */
exports.searchBoards = asyncHandler(async (req, res) => {
  const { q } = req.query;

  if (!q) {
    throw new AppError('Search query is required', 400);
  }

  const options = {
    limit: parseInt(req.query.limit) || 20,
    skip: parseInt(req.query.skip) || 0
  };

  const boards = await boardService.searchBoards(req.user._id, q, options);

  res.json({
    success: true,
    count: boards.length,
    data: boards
  });
});
