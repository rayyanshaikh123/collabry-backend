const asyncHandler = require('../utils/asyncHandler');
const friendService = require('../services/friend.service');

class FriendController {
  // Send friend request
  sendRequest = asyncHandler(async (req, res) => {
    const { toUserId, message } = req.body;
    const fromUserId = req.user._id;

    const request = await friendService.sendFriendRequest(fromUserId, toUserId, message);

    res.status(201).json({
      message: 'Friend request sent successfully',
      request,
    });
  });

  // Accept friend request
  acceptRequest = asyncHandler(async (req, res) => {
    const { requestId } = req.params;
    const userId = req.user._id;

    const result = await friendService.acceptFriendRequest(requestId, userId);

    res.json({
      message: 'Friend request accepted',
      ...result,
    });
  });

  // Reject friend request
  rejectRequest = asyncHandler(async (req, res) => {
    const { requestId } = req.params;
    const userId = req.user._id;

    const request = await friendService.rejectFriendRequest(requestId, userId);

    res.json({
      message: 'Friend request rejected',
      request,
    });
  });

  // Cancel sent friend request
  cancelRequest = asyncHandler(async (req, res) => {
    const { requestId } = req.params;
    const userId = req.user._id;

    const result = await friendService.cancelFriendRequest(requestId, userId);

    res.json(result);
  });

  // Get pending requests
  getPendingRequests = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const requests = await friendService.getPendingRequests(userId);

    res.json({ requests });
  });

  // Get sent requests
  getSentRequests = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const requests = await friendService.getSentRequests(userId);

    res.json({ requests });
  });

  // Get friends list
  getFriends = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const friends = await friendService.getFriends(userId);

    res.json({ friends, count: friends.length });
  });

  // Remove friend
  removeFriend = asyncHandler(async (req, res) => {
    const { friendshipId } = req.params;
    const userId = req.user._id;

    const result = await friendService.removeFriend(friendshipId, userId);

    res.json(result);
  });

  // Search users
  searchUsers = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const users = await friendService.searchUsers(userId, q.trim());

    res.json({ users, count: users.length });
  });

  // Block friend
  blockFriend = asyncHandler(async (req, res) => {
    const { friendshipId } = req.params;
    const userId = req.user._id;

    const friendship = await friendService.blockFriend(friendshipId, userId);

    res.json({
      message: 'Friend blocked successfully',
      friendship,
    });
  });

  // Unblock friend
  unblockFriend = asyncHandler(async (req, res) => {
    const { friendshipId } = req.params;
    const userId = req.user._id;

    const friendship = await friendService.unblockFriend(friendshipId, userId);

    res.json({
      message: 'Friend unblocked successfully',
      friendship,
    });
  });
}

module.exports = new FriendController();
