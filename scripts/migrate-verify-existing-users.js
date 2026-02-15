/**
 * Migration Script: Mark existing users as email-verified
 *
 * All users who registered before the email verification system was added
 * need `emailVerified: true` so they can continue logging in.
 *
 * Run: node scripts/migrate-verify-existing-users.js
 *
 * Safe to re-run — only updates users where emailVerified is false or missing.
 */

const mongoose = require('mongoose');
const config = require('../src/config/env');

const migrate = async () => {
  try {
    await mongoose.connect(config.mongodb.uri);
    console.log('✅ Connected to MongoDB');

    const result = await mongoose.connection.db.collection('users').updateMany(
      {
        $or: [
          { emailVerified: { $exists: false } },
          { emailVerified: false },
        ],
      },
      {
        $set: { emailVerified: true },
        $unset: {
          emailVerificationToken: '',
          emailVerificationExpires: '',
        },
      }
    );

    console.log(`✅ Migration complete: ${result.modifiedCount} users marked as email-verified`);
    console.log(`   (${result.matchedCount} matched, ${result.modifiedCount} modified)`);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
};

migrate();
