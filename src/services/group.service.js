const Group = require('../models/Group');
const User = require('../models/User');
const crypto = require('crypto');
const { getLimitsForTier, isUnlimited } = require('../config/plans');
const { getUserPlan } = require('../middleware/usageEnforcement');

class GroupService {
  // Create group
  async createGroup(userId, { name, description, avatar, isPrivate }) {
    const group = await Group.create({
      name,
      description,
      avatar,
      isPrivate,
      creator: userId,
      admins: [userId],
      members: [
        {
          user: userId,
          role: 'admin',
        },
      ],
      inviteCode: crypto.randomBytes(8).toString('hex'),
    });

    return await group.populate('creator', 'name email avatar');
  }

  // Get user's groups
  async getUserGroups(userId) {
    const groups = await Group.find({
      'members.user': userId,
    })
      .populate('creator', 'name email avatar')
      .populate('members.user', 'name email avatar')
      .sort({ updatedAt: -1 });

    return groups;
  }

  // Get group by ID
  async getGroupById(groupId, userId) {
    const group = await Group.findById(groupId)
      .populate('creator', 'name email avatar')
      .populate('admins', 'name email avatar')
      .populate('members.user', 'name email avatar');

    if (!group) {
      throw new Error('Group not found');
    }

    // Check if user is a member
    const isMember = group.members.some(
      (member) => member.user._id.toString() === userId.toString()
    );

    if (!isMember && group.isPrivate) {
      throw new Error('Not authorized to view this group');
    }

    return group;
  }

  // Update group
  async updateGroup(groupId, userId, updates) {
    const group = await Group.findById(groupId);

    if (!group) {
      throw new Error('Group not found');
    }

    // Check if user is admin
    const isAdmin = group.admins.some((admin) => admin.toString() === userId.toString());

    if (!isAdmin) {
      throw new Error('Only admins can update group');
    }

    // Update allowed fields
    const allowedUpdates = ['name', 'description', 'avatar', 'isPrivate', 'settings'];
    Object.keys(updates).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        if (key === 'settings') {
          group.settings = { ...group.settings, ...updates.settings };
        } else {
          group[key] = updates[key];
        }
      }
    });

    await group.save();

    return await group.populate('creator admins members.user', 'name email avatar');
  }

  // Delete group
  async deleteGroup(groupId, userId) {
    const group = await Group.findById(groupId);

    if (!group) {
      throw new Error('Group not found');
    }

    // Only creator can delete
    if (group.creator.toString() !== userId.toString()) {
      throw new Error('Only creator can delete group');
    }

    await group.deleteOne();

    return { message: 'Group deleted successfully' };
  }

  // Add member to group
  async addMember(groupId, userId, memberId) {
    const group = await Group.findById(groupId);

    if (!group) {
      throw new Error('Group not found');
    }

    // Check if user can add members
    const isAdmin = group.admins.some((admin) => admin.toString() === userId.toString());
    const isMember = group.members.some(
      (member) => member.user.toString() === userId.toString()
    );

    if (!isAdmin && (!isMember || !group.settings.allowMemberInvite)) {
      throw new Error('Not authorized to add members');
    }

    // Check if already a member
    const alreadyMember = group.members.some(
      (member) => member.user.toString() === memberId.toString()
    );

    if (alreadyMember) {
      throw new Error('User is already a member');
    }

    // Check if user exists
    const user = await User.findById(memberId);
    if (!user) {
      throw new Error('User not found');
    }

    // Enforce group member limit based on group creator's plan
    const creatorPlan = await getUserPlan(group.creator);
    const limits = getLimitsForTier(creatorPlan);
    if (!isUnlimited(limits.groupMembers) && group.members.length >= limits.groupMembers) {
      throw new Error(`Group member limit reached (${limits.groupMembers} for ${creatorPlan} plan). The group owner needs to upgrade.`);
    }

    group.members.push({
      user: memberId,
      role: 'member',
    });

    await group.save();

    return await group.populate('members.user', 'name email avatar');
  }

  // Remove member from group
  async removeMember(groupId, userId, memberId) {
    const group = await Group.findById(groupId);

    if (!group) {
      throw new Error('Group not found');
    }

    // Check authorization
    const isAdmin = group.admins.some((admin) => admin.toString() === userId.toString());
    const isSelf = userId.toString() === memberId.toString();

    if (!isAdmin && !isSelf) {
      throw new Error('Not authorized to remove members');
    }

    // Cannot remove creator
    if (group.creator.toString() === memberId.toString()) {
      throw new Error('Cannot remove group creator');
    }

    // Remove member
    group.members = group.members.filter(
      (member) => member.user.toString() !== memberId.toString()
    );

    // Remove from admins if present
    group.admins = group.admins.filter((admin) => admin.toString() !== memberId.toString());

    await group.save();

    return await group.populate('members.user admins', 'name email avatar');
  }

  // Make member admin
  async makeAdmin(groupId, userId, memberId) {
    const group = await Group.findById(groupId);

    if (!group) {
      throw new Error('Group not found');
    }

    // Only creator can make admins
    if (group.creator.toString() !== userId.toString()) {
      throw new Error('Only creator can assign admins');
    }

    // Check if member exists
    const member = group.members.find(
      (m) => m.user.toString() === memberId.toString()
    );

    if (!member) {
      throw new Error('User is not a member of this group');
    }

    // Check if already admin
    const isAdmin = group.admins.some((admin) => admin.toString() === memberId.toString());

    if (isAdmin) {
      throw new Error('User is already an admin');
    }

    // Add to admins
    group.admins.push(memberId);
    member.role = 'admin';

    await group.save();

    return await group.populate('admins members.user', 'name email avatar');
  }

  // Remove admin role
  async removeAdmin(groupId, userId, memberId) {
    const group = await Group.findById(groupId);

    if (!group) {
      throw new Error('Group not found');
    }

    // Only creator can remove admins
    if (group.creator.toString() !== userId.toString()) {
      throw new Error('Only creator can remove admins');
    }

    // Cannot remove creator
    if (group.creator.toString() === memberId.toString()) {
      throw new Error('Cannot remove creator admin role');
    }

    // Remove from admins
    group.admins = group.admins.filter((admin) => admin.toString() !== memberId.toString());

    // Update member role
    const member = group.members.find(
      (m) => m.user.toString() === memberId.toString()
    );

    if (member) {
      member.role = 'member';
    }

    await group.save();

    return await group.populate('admins members.user', 'name email avatar');
  }

  // Join group with invite code
  async joinGroupWithCode(userId, inviteCode) {
    const group = await Group.findOne({ inviteCode });

    if (!group) {
      throw new Error('Invalid invite code');
    }

    // Check if already a member
    const alreadyMember = group.members.some(
      (member) => member.user.toString() === userId.toString()
    );

    if (alreadyMember) {
      throw new Error('Already a member of this group');
    }

    // Enforce group member limit based on group creator's plan
    const creatorPlan = await getUserPlan(group.creator);
    const limits = getLimitsForTier(creatorPlan);
    if (!isUnlimited(limits.groupMembers) && group.members.length >= limits.groupMembers) {
      throw new Error(`Group member limit reached (${limits.groupMembers} for ${creatorPlan} plan). The group owner needs to upgrade.`);
    }

    group.members.push({
      user: userId,
      role: 'member',
    });

    await group.save();

    return await group.populate('creator members.user', 'name email avatar');
  }

  // Regenerate invite code
  async regenerateInviteCode(groupId, userId) {
    const group = await Group.findById(groupId);

    if (!group) {
      throw new Error('Group not found');
    }

    // Check if user is admin
    const isAdmin = group.admins.some((admin) => admin.toString() === userId.toString());

    if (!isAdmin) {
      throw new Error('Only admins can regenerate invite code');
    }

    group.inviteCode = crypto.randomBytes(8).toString('hex');
    await group.save();

    return { inviteCode: group.inviteCode };
  }

  // Leave group
  async leaveGroup(groupId, userId) {
    return await this.removeMember(groupId, userId, userId);
  }
}

module.exports = new GroupService();
