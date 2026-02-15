#!/usr/bin/env node

/**
 * JWT Secret Generator
 * 
 * Generates cryptographically secure random secrets for JWT tokens.
 * Run this script to generate new secrets for your .env file.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

console.log('\n🔐 JWT Secret Generator\n');
console.log('═'.repeat(60));

// Generate two different secure secrets
const accessSecret = crypto.randomBytes(64).toString('hex');
const refreshSecret = crypto.randomBytes(64).toString('hex');

console.log('\n✅ Generated secure JWT secrets:\n');
console.log('JWT_ACCESS_SECRET:');
console.log(accessSecret);
console.log('\nJWT_REFRESH_SECRET:');
console.log(refreshSecret);
console.log('\n' + '═'.repeat(60));
console.log('\n📋 Copy these to your .env file:');
console.log('\n---');
console.log(`JWT_ACCESS_SECRET=${accessSecret}`);
console.log(`JWT_REFRESH_SECRET=${refreshSecret}`);
console.log('---\n');

// Check if .env exists and offer to update it
const envPath = path.join(__dirname, '..', '.env');
const envExists = fs.existsSync(envPath);

if (envExists) {
  console.log('💡 .env file found. To update automatically, run:');
  console.log('   node scripts/update-env-secrets.js\n');
} else {
  console.log('⚠️  No .env file found. Create one from .env.example first.\n');
}

console.log('🔒 SECURITY REMINDERS:');
console.log('   • Never commit these secrets to git');
console.log('   • Use different secrets for dev/staging/production');
console.log('   • Rotate secrets periodically');
console.log('   • Keep secrets in environment variables or secret managers\n');
