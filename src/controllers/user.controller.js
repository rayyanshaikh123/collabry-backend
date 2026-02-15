const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { logAuthEvent } = require('../utils/auditLogger');

/**
 * @desc    Get current user profile
 * @route   GET /api/users/me
 * @access  Private (Auth required)
 */
const getProfile = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      user: req.user,
    },
  });
});

/**
 * @desc    Update user profile
 * @route   PATCH /api/users/me
 * @access  Private
 */
const updateProfile = asyncHandler(async (req, res) => {
  const { name, avatar } = req.body;
  
  const updateFields = {};
  if (name) updateFields.name = name;
  if (avatar !== undefined) updateFields.avatar = avatar;

  const user = await User.findByIdAndUpdate(
    req.user._id,
    updateFields,
    { new: true, runValidators: true }
  );

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    data: { user },
  });
});

/**
 * @desc    Change user password
 * @route   POST /api/users/change-password
 * @access  Private
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Please provide current and new password',
    });
  }

  // Enforce same strength rules as registration
  if (newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      message: 'New password must be at least 8 characters',
    });
  }
  if (!/[A-Z]/.test(newPassword)) {
    return res.status(400).json({
      success: false,
      message: 'New password must contain at least one uppercase letter',
    });
  }
  if (!/[a-z]/.test(newPassword)) {
    return res.status(400).json({
      success: false,
      message: 'New password must contain at least one lowercase letter',
    });
  }
  if (!/[0-9]/.test(newPassword)) {
    return res.status(400).json({
      success: false,
      message: 'New password must contain at least one number',
    });
  }

  // Get user with password
  const user = await User.findById(req.user._id).select('+password');

  // Check current password
  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: 'Current password is incorrect',
    });
  }

  // Update password (pre-save hook sets passwordChangedAt)
  user.password = newPassword;
  await user.save();

  // Revoke ALL refresh tokens — force re-login on every device
  await RefreshToken.revokeAllForUser(req.user._id, 'password_change');

  logAuthEvent('password_change', {
    userId: req.user._id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.status(200).json({
    success: true,
    message: 'Password changed successfully. Please login again on all devices.',
  });
});

/**
 * @desc    Delete user account
 * @route   DELETE /api/users/me
 * @access  Private
 */
const deleteAccount = asyncHandler(async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({
      success: false,
      message: 'Please provide your password to confirm deletion',
    });
  }

  // Get user with password
  const user = await User.findById(req.user._id).select('+password');

  // Verify password
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: 'Password is incorrect',
    });
  }

  // Delete user
  await User.findByIdAndDelete(req.user._id);

  // TODO: Clean up related data (boards, plans, subscriptions, etc.)

  res.status(200).json({
    success: true,
    message: 'Account deleted successfully',
  });
});

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  deleteAccount,
};
