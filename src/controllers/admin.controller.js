const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');
const boardService = require('../services/board.service');
const PlatformSettings = require('../models/PlatformSettings');
const AppError = require('../utils/AppError');

/**
 * @desc    Get admin dashboard data
 * @route   GET /api/admin/dashboard
 * @access  Private/Admin
 */
const getDashboard = asyncHandler(async (req, res) => {
  const totalUsers = await User.countDocuments();
  const activeUsers = await User.countDocuments({ isActive: true });

  res.status(200).json({
    success: true,
    message: 'Welcome to admin dashboard',
    data: {
      admin: req.user.name,
      stats: {
        totalUsers,
        activeUsers,
      },
    },
  });
});

/**
 * @desc    Get all users
 * @route   GET /api/admin/users
 * @access  Private/Admin
 */
const getAllUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = '', role = '', status = '' } = req.query;

  // Build query
  const query = {};
  
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }
  
  if (role) {
    query.role = role;
  }
  
  if (status) {
    query.isActive = status === 'active';
  }

  // Execute query with pagination
  const users = await User.find(query)
    .select('-password')
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .sort({ createdAt: -1 });

  const count = await User.countDocuments(query);

  res.status(200).json({
    success: true,
    data: {
      users,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      total: count,
    },
  });
});

/**
 * @desc    Get single user
 * @route   GET /api/admin/users/:id
 * @access  Private/Admin
 */
const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('-password');

  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Include today's usage data and plan limits
  const Usage = require('../models/Usage');
  const { getLimitsForTier } = require('../config/plans');
  const today = new Date().toISOString().split('T')[0];
  const todayUsage = await Usage.findOne({ user: user._id, date: today });
  const planLimits = getLimitsForTier(user.subscriptionTier || 'free');

  // Count user's total boards and notebooks
  const Board = require('../models/Board');
  const Notebook = require('../models/Notebook');
  const [boardCount, notebookCount] = await Promise.all([
    Board.countDocuments({ owner: user._id }),
    Notebook.countDocuments({ owner: user._id }),
  ]);

  res.status(200).json({
    success: true,
    data: {
      user,
      usage: {
        today: {
          aiQuestions: todayUsage?.aiQuestions || 0,
          fileUploads: todayUsage?.fileUploads || 0,
        },
        totals: {
          boards: boardCount,
          notebooks: notebookCount,
        },
        limits: planLimits,
      },
    },
  });
});

/**
 * @desc    Create new user
 * @route   POST /api/admin/users
 * @access  Private/Admin
 */
const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  // Validate input
  if (!name || !email || !password) {
    throw new AppError('Please provide name, email, and password', 400);
  }

  // Check if user exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new AppError('User with this email already exists', 400);
  }

  // Create user
  const user = await User.create({
    name,
    email,
    password,
    role: role || 'student',
  });

  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: { user: user.toJSON() },
  });
});

/**
 * @desc    Update user
 * @route   PUT /api/admin/users/:id
 * @access  Private/Admin
 */
const updateUser = asyncHandler(async (req, res) => {
  const { name, email, role, isActive, avatar } = req.body;

  const user = await User.findById(req.params.id);

  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Update fields
  if (name) user.name = name;
  if (email) user.email = email;
  if (role) user.role = role;
  if (typeof isActive !== 'undefined') user.isActive = isActive;
  if (avatar !== undefined) user.avatar = avatar;

  await user.save();

  res.status(200).json({
    success: true,
    message: 'User updated successfully',
    data: { user: user.toJSON() },
  });
});

/**
 * @desc    Delete user
 * @route   DELETE /api/admin/users/:id
 * @access  Private/Admin
 */
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Prevent deleting self
  if (user._id.toString() === req.user._id.toString()) {
    throw new AppError('Cannot delete your own account', 400);
  }

  await user.deleteOne();

  res.status(200).json({
    success: true,
    message: 'User deleted successfully',
  });
});

/**
 * @desc    Bulk update user status (enable/disable)
 * @route   PATCH /api/admin/users/bulk-status
 * @access  Private/Admin
 */
const bulkUpdateUserStatus = asyncHandler(async (req, res) => {
  const { userIds, isActive } = req.body;

  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new AppError('Please provide an array of user IDs', 400);
  }
  if (typeof isActive !== 'boolean') {
    throw new AppError('Please provide isActive as a boolean', 400);
  }

  // Prevent disabling self
  const adminId = req.user._id.toString();
  if (!isActive && userIds.includes(adminId)) {
    throw new AppError('Cannot disable your own account', 400);
  }

  const result = await User.updateMany(
    { _id: { $in: userIds } },
    { $set: { isActive } }
  );

  res.status(200).json({
    success: true,
    message: `${result.modifiedCount} user(s) ${isActive ? 'enabled' : 'disabled'} successfully`,
    data: { modifiedCount: result.modifiedCount },
  });
});

/**
 * @desc    Bulk delete users
 * @route   DELETE /api/admin/users/bulk
 * @access  Private/Admin
 */
const bulkDeleteUsers = asyncHandler(async (req, res) => {
  const { userIds } = req.body;

  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new AppError('Please provide an array of user IDs', 400);
  }

  // Prevent deleting self
  const adminId = req.user._id.toString();
  if (userIds.includes(adminId)) {
    throw new AppError('Cannot delete your own account', 400);
  }

  const result = await User.deleteMany({ _id: { $in: userIds } });

  res.status(200).json({
    success: true,
    message: `${result.deletedCount} user(s) deleted successfully`,
    data: { deletedCount: result.deletedCount },
  });
});

/**
 * @desc    Get all boards (Admin)
 * @route   GET /api/admin/boards
 * @access  Private/Admin
 */
const getAllBoards = asyncHandler(async (req, res) => {
  const options = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20,
    search: req.query.search || '',
    isPublic: req.query.isPublic ? req.query.isPublic === 'true' : null,
    isArchived: req.query.isArchived ? req.query.isArchived === 'true' : null,
    sortBy: req.query.sortBy || 'lastActivity',
    sortOrder: req.query.sortOrder || 'desc'
  };

  const result = await boardService.getAllBoards(options);

  res.status(200).json({
    success: true,
    data: result.boards,
    pagination: result.pagination
  });
});

/**
 * @desc    Get board analytics (Admin)
 * @route   GET /api/admin/boards/:id/analytics
 * @access  Private/Admin
 */
const getBoardAnalytics = asyncHandler(async (req, res) => {
  const analytics = await boardService.getBoardAnalytics(req.params.id);

  res.status(200).json({
    success: true,
    data: analytics
  });
});

/**
 * @desc    Suspend a board (Admin)
 * @route   PUT /api/admin/boards/:id/suspend
 * @access  Private/Admin
 */
const suspendBoard = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  if (!reason) {
    throw new AppError('Suspension reason is required', 400);
  }

  const board = await boardService.suspendBoard(req.params.id, reason);

  res.status(200).json({
    success: true,
    message: 'Board suspended successfully',
    data: board
  });
});

/**
 * @desc    Force delete a board (Admin)
 * @route   DELETE /api/admin/boards/:id/force
 * @access  Private/Admin
 */
const forceDeleteBoard = asyncHandler(async (req, res) => {
  const result = await boardService.forceDeleteBoard(req.params.id);

  res.status(200).json({
    success: true,
    message: result.message
  });
});

/**
 * @desc    Get board statistics (Admin)
 * @route   GET /api/admin/boards/stats
 * @access  Private/Admin
 */
const getBoardStats = asyncHandler(async (req, res) => {
  const stats = await boardService.getBoardStats();

  res.status(200).json({
    success: true,
    data: stats
  });
});

/**
 * @desc    Get platform settings (Admin)
 * @route   GET /api/admin/settings
 * @access  Private/Admin
 */
const getSettings = asyncHandler(async (req, res) => {
  const settings = await PlatformSettings.getSettings();

  res.status(200).json({
    success: true,
    data: settings
  });
});

/**
 * @desc    Update platform settings (Admin)
 * @route   PUT /api/admin/settings
 * @access  Private/Admin
 */
const updateSettings = asyncHandler(async (req, res) => {
  let settings = await PlatformSettings.getSettings();

  // Update settings
  Object.keys(req.body).forEach(key => {
    if (settings[key] !== undefined) {
      settings[key] = { ...settings[key], ...req.body[key] };
    }
  });

  settings.updatedBy = req.user._id;
  settings.updatedAt = new Date();

  await settings.save();

  res.status(200).json({
    success: true,
    message: 'Settings updated successfully',
    data: settings
  });
});

module.exports = {
  getDashboard,
  getAllUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  bulkUpdateUserStatus,
  bulkDeleteUsers,
  getAllBoards,
  getBoardAnalytics,
  suspendBoard,
  forceDeleteBoard,
  getBoardStats,
  getSettings,
  updateSettings,
};
