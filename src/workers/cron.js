/**
 * Cron Worker Service
 * Runs background jobs separately from API service
 * Should only run as a single instance (replicas: 1)
 */

const connectDB = require('../config/db');
const config = require('../config/env');
const { startNotificationScheduler, stopNotificationScheduler } = require('../services/notificationScheduler');
const { startSubscriptionExpiryJob, stopSubscriptionExpiryJob } = require('../jobs/subscriptionExpiry');
const { startRecycleBinCleanupJob, stopRecycleBinCleanupJob } = require('../jobs/recycleBinCleanup');

console.log('🔧 Starting Cron Worker Service...');

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION in worker! 💥');
  console.error(err.name, err.message);
  console.error(err.stack);
  shutdownGracefully(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION in worker! 💥');
  console.error(err.name, err.message);
  console.error(err.stack);
  shutdownGracefully(1);
});

// Graceful shutdown handler
function shutdownGracefully(exitCode = 0) {
  console.log('🛑 Stopping cron jobs...');
  
  stopNotificationScheduler();
  stopSubscriptionExpiryJob();
  stopRecycleBinCleanupJob();
  
  setTimeout(() => {
    console.log('👋 Cron worker shut down gracefully');
    process.exit(exitCode);
  }, 2000); // Give jobs 2 seconds to complete current tasks
}

// SIGTERM handler (from Docker/Kubernetes)
process.on('SIGTERM', () => {
  console.log('📡 SIGTERM received in worker');
  shutdownGracefully(0);
});

// SIGINT handler (Ctrl+C)
process.on('SIGINT', () => {
  console.log('📡 SIGINT received in worker');
  shutdownGracefully(0);
});

// Initialize worker
async function startWorker() {
  try {
    // Connect to database
    await connectDB();
    console.log('✅ Worker connected to MongoDB');
    
    // Start all scheduled jobs
    console.log('⏰ Starting notification scheduler...');
    startNotificationScheduler();
    
    console.log('⏰ Starting subscription expiry job...');
    startSubscriptionExpiryJob();
    
    console.log('⏰ Starting recycle bin cleanup job...');
    startRecycleBinCleanupJob();
    
    console.log(`✅ Cron Worker running in ${config.env} mode`);
    console.log('📊 Active jobs:');
    console.log('   - Notification Scheduler');
    console.log('   - Subscription Expiry Monitor');
    console.log('   - Recycle Bin Cleanup (30-day purge)');
    
  } catch (error) {
    console.error('❌ Worker failed to start:', error);
    process.exit(1);
  }
}

// Start the worker
startWorker();
