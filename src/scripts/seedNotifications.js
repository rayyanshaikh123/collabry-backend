/**
 * Seed Test Notifications
 * Run: node src/scripts/seedNotifications.js <userId>
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Notification = require('../models/Notification');

const sampleNotifications = [
  {
    type: 'task_due_soon',
    title: 'Task Due Soon',
    message: 'Your assignment "React Components" is due in 2 hours!',
    priority: 'high',
    actionLink: '/dashboard',
    actionText: 'View Task',
  },
  {
    type: 'board_invitation',
    title: 'New Board Invitation',
    message: 'You have been invited to collaborate on "Math Study Group"',
    priority: 'medium',
    actionLink: '/study-board',
    actionText: 'View Board',
  },
  {
    type: 'streak_milestone',
    title: '🔥 Streak Milestone!',
    message: 'Congratulations! You\'ve reached a 7-day study streak!',
    priority: 'low',
    actionLink: '/focus',
    actionText: 'View Progress',
  },
  {
    type: 'daily_motivation',
    title: '💡 Study Tips for You',
    message: 'Based on your progress, we recommend reviewing JavaScript basics',
    priority: 'low',
    actionLink: '/study-notebook',
    actionText: 'Start Studying',
  },
  {
    type: 'system_announcement',
    title: '📊 Weekly Report Ready',
    message: 'Your weekly study analytics report is now available',
    priority: 'medium',
    actionLink: '/profile',
    actionText: 'View Report',
  },
];

async function seedNotifications(userId) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Connected to MongoDB');

    // Delete existing test notifications
    await Notification.deleteMany({ userId });
    console.log('✓ Cleared existing notifications');

    // Create new notifications
    const notifications = sampleNotifications.map(notif => ({
      ...notif,
      userId,
      isRead: Math.random() > 0.6, // 40% will be unread
      createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // Random time within last week
    }));

    await Notification.insertMany(notifications);
    console.log(`✓ Created ${notifications.length} test notifications`);
    console.log('Sample notifications:');
    notifications.forEach((n, i) => {
      console.log(`  ${i + 1}. [${n.priority}] ${n.title} - ${n.isRead ? 'READ' : 'UNREAD'}`);
    });

    const unreadCount = notifications.filter(n => !n.isRead).length;
    console.log(`\n✓ Total: ${notifications.length} | Unread: ${unreadCount}`); 

    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB');
  } catch (error) {
    console.error('✗ Error seeding notifications:', error);
    process.exit(1);
  }
}

// Get userId from command line argument
const userId = process.argv[2];

if (!userId) {
  console.error('Usage: node seedNotifications.js <userId>');
  console.error('Example: node seedNotifications.js 6960e662caaae380e65c8097');
  process.exit(1);
}

seedNotifications(userId);
