const asyncHandler = require('../utils/asyncHandler');
const groupService = require('../services/group.service');

class GroupController {
  // Create group
  createGroup = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const group = await groupService.createGroup(userId, req.body);

    res.status(201).json({
      message: 'Group created successfully',
      group,
    });
  });

  // Get user's groups
  getUserGroups = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const groups = await groupService.getUserGroups(userId);

    res.json({ groups, count: groups.length });
  });

  // Get group by ID
  getGroup = asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const userId = req.user._id;

    const group = await groupService.getGroupById(groupId, userId);

    res.json({ group });
  });

  // Update group
  updateGroup = asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const userId = req.user._id;

    const group = await groupService.updateGroup(groupId, userId, req.body);

    res.json({
      message: 'Group updated successfully',
      group,
    });
  });

  // Delete group
  deleteGroup = asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const userId = req.user._id;

    const result = await groupService.deleteGroup(groupId, userId);

    res.json(result);
  });

  // Add member
  addMember = asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const { memberId } = req.body;
    const userId = req.user._id;

    const group = await groupService.addMember(groupId, userId, memberId);

    res.json({
      message: 'Member added successfully',
      group,
    });
  });

  // Remove member
  removeMember = asyncHandler(async (req, res) => {
    const { groupId, memberId } = req.params;
    const userId = req.user._id;

    const group = await groupService.removeMember(groupId, userId, memberId);

    res.json({
      message: 'Member removed successfully',
      group,
    });
  });

  // Make admin
  makeAdmin = asyncHandler(async (req, res) => {
    const { groupId, memberId } = req.params;
    const userId = req.user._id;

    const group = await groupService.makeAdmin(groupId, userId, memberId);

    res.json({
      message: 'Member promoted to admin',
      group,
    });
  });

  // Remove admin
  removeAdmin = asyncHandler(async (req, res) => {
    const { groupId, memberId } = req.params;
    const userId = req.user._id;

    const group = await groupService.removeAdmin(groupId, userId, memberId);

    res.json({
      message: 'Admin role removed',
      group,
    });
  });

  // Join with invite code
  joinWithCode = asyncHandler(async (req, res) => {
    const { inviteCode } = req.body;
    const userId = req.user._id;

    const group = await groupService.joinGroupWithCode(userId, inviteCode);

    res.json({
      message: 'Successfully joined group',
      group,
    });
  });

  // Regenerate invite code
  regenerateInviteCode = asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const userId = req.user._id;

    const result = await groupService.regenerateInviteCode(groupId, userId);

    res.json(result);
  });

  // Leave group
  leaveGroup = asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const userId = req.user._id;

    const result = await groupService.leaveGroup(groupId, userId);

    res.json({
      message: 'Left group successfully',
      ...result,
    });
  });
}

module.exports = new GroupController();
