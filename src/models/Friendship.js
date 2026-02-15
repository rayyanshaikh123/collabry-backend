const mongoose = require('mongoose');

const friendshipSchema = new mongoose.Schema(
  {
    user1: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    user2: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'blocked'],
      default: 'active',
    },
    blockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to ensure uniqueness and efficient queries
friendshipSchema.index({ user1: 1, user2: 1 }, { unique: true });
friendshipSchema.index({ user1: 1, status: 1 });
friendshipSchema.index({ user2: 1, status: 1 });

// Helper method to get friend's ID
friendshipSchema.methods.getFriendId = function (userId) {
  return this.user1.toString() === userId.toString() ? this.user2 : this.user1;
};

const Friendship = mongoose.model('Friendship', friendshipSchema);

module.exports = Friendship;
