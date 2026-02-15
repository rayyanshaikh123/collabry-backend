const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables from .env file
// Primary: backend/.env
// Fallback: repo-root .env (for legacy setups)
// __dirname is: backend/src/config
const backendEnvPath = path.join(__dirname, '../../.env');
const rootEnvPath = path.join(__dirname, '../../../.env');

if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath });
  console.log(`ℹ️  Loaded environment from: ${backendEnvPath}`);
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
  console.log(`ℹ️  Loaded environment from: ${rootEnvPath}`);
} else {
  console.warn('⚠️  No .env file found. Expected one of:');
  console.warn(`   - ${backendEnvPath}`);
  console.warn(`   - ${rootEnvPath}`);
}

// Environment validation function
const validateEnvironment = () => {
  const requiredEnvVars = [
    'MONGODB_URI',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error('❌ CRITICAL ERROR: Missing required environment variables:');
    missingVars.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    console.error('\n📝 Please create a .env file based on .env.example and set all required variables.');
    console.error('\n⚠️  SECURITY WARNING: Never use default values for JWT secrets in production!\n');
    process.exit(1);
  }

  // Security warnings for production
  if (process.env.NODE_ENV === 'production') {
    // Check JWT secret strength
    if (process.env.JWT_ACCESS_SECRET.length < 32) {
      console.warn('⚠️  WARNING: JWT_ACCESS_SECRET should be at least 32 characters long for production!');
    }
    if (process.env.JWT_REFRESH_SECRET.length < 32) {
      console.warn('⚠️  WARNING: JWT_REFRESH_SECRET should be at least 32 characters long for production!');
    }

    // Check for default/example values
    const dangerousValues = ['your-super-secret', 'change-this', 'example', 'test'];
    const accessSecretLower = process.env.JWT_ACCESS_SECRET.toLowerCase();
    const refreshSecretLower = process.env.JWT_REFRESH_SECRET.toLowerCase();

    if (dangerousValues.some(val => accessSecretLower.includes(val) || refreshSecretLower.includes(val))) {
      console.error('❌ CRITICAL: JWT secrets appear to be using example/default values in production!');
      console.error('   Generate secure secrets using: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
      process.exit(1);
    }

    // Check CORS configuration
    if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*') {
      console.error('❌ CRITICAL: CORS_ORIGIN must be explicitly set in production (no wildcards)!');
      process.exit(1);
    }
  }

  console.log('✅ Environment validation passed');
};

// Run validation
validateEnvironment();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  mongodb: {
    uri: process.env.MONGODB_URI,
    options: {},
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379', // Shorthand for compatibility
  cors: {
    origin: function (origin, callback) {
      // PERFORMANCE: In development, be more permissive with origins
      if (process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }

      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        config.frontendUrl
      ];

      if (allowedOrigins.includes(origin) || allowedOrigins.some(o => origin.startsWith(o))) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 
      'Authorization', 
      'X-Requested-With', 
      'Accept', 
      'x-csrf-token',
      'X-CSRF-Token',
      'X-CSRF-TOKEN'
    ],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  email: {
    resendApiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
    fromName: process.env.EMAIL_FROM_NAME || 'Collabry',
  },
  // Remove trailing slashes from frontend URL to ensure CORS works correctly
  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, ''),
};

module.exports = config;
