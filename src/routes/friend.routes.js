const express = require('express');
const friendController = require('../controllers/friend.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

// All routes require authentication
router.use(protect);

// Friend requests
router.post('/requests', friendController.sendRequest);
router.get('/requests/pending', friendController.getPendingRequests);
router.get('/requests/sent', friendController.getSentRequests);
router.put('/requests/:requestId/accept', friendController.acceptRequest);
router.put('/requests/:requestId/reject', friendController.rejectRequest);
router.delete('/requests/:requestId', friendController.cancelRequest);

// Friends
router.get('/', friendController.getFriends);
router.delete('/:friendshipId', friendController.removeFriend);
router.put('/:friendshipId/block', friendController.blockFriend);
router.put('/:friendshipId/unblock', friendController.unblockFriend);

// Search users
router.get('/search', friendController.searchUsers);

module.exports = router;
