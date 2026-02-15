/**
 * Migration script to add BYOK fields to existing users
 * Run this once after deploying the BYOK feature
 */
const mongoose = require('mongoose');
require('dotenv').config();

async function migrate() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const User = require('../src/models/User');
    
    console.log('🔄 Adding BYOK fields to existing users...');
    
    // Find users that don't have the BYOK fields
    const usersToUpdate = await User.find({
      $or: [
        { apiKeys: { $exists: false } },
        { byokSettings: { $exists: false } }
      ]
    });
    
    console.log(`📊 Found ${usersToUpdate.length} users to update`);
    
    let updated = 0;
    
    for (const user of usersToUpdate) {
      try {
        // Add default BYOK fields if they don't exist
        if (!user.apiKeys) {
          user.apiKeys = new Map();
        }
        
        if (!user.byokSettings) {
          user.byokSettings = {
            enabled: false,
            activeProvider: null,
            fallbackToSystem: true
          };
        }
        
        await user.save();
        updated++;
        
        if (updated % 100 === 0) {
          console.log(`   ✓ Updated ${updated} users...`);
        }
      } catch (error) {
        console.error(`   ❌ Failed to update user ${user._id}:`, error.message);
      }
    }
    
    console.log(`✅ Migration completed: Updated ${updated} users`);
    
    // Disconnect
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrate();
