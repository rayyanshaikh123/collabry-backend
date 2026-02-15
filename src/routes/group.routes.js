const express = require('express');
const groupController = require('../controllers/group.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

// All routes require authentication
router.use(protect);

// Group CRUD
router.post('/', groupController.createGroup);
router.get('/', groupController.getUserGroups);
router.get('/:groupId', groupController.getGroup);
router.put('/:groupId', groupController.updateGroup);
router.delete('/:groupId', groupController.deleteGroup);

// Member management
router.post('/:groupId/members', groupController.addMember);
router.delete('/:groupId/members/:memberId', groupController.removeMember);
router.post('/:groupId/leave', groupController.leaveGroup);

// Admin management
router.put('/:groupId/admins/:memberId', groupController.makeAdmin);
router.delete('/:groupId/admins/:memberId', groupController.removeAdmin);

// Invite code
router.post('/join', groupController.joinWithCode);
router.post('/:groupId/invite-code/regenerate', groupController.regenerateInviteCode);

module.exports = router;
