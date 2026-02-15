const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const { globalLimiter, authLimiter } = require('./middlewares/rateLimiter');
const config = require('./config/env');
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const adminRoutes = require('./routes/admin.routes');
const reportRoutes = require('./routes/report.routes');
const visualAidsRoutes = require('./routes/visualAids.routes');
const boardRoutes = require('./routes/board.routes');
const aiRoutes = require('./routes/ai.routes');
const notebookRoutes = require('./routes/notebook.routes');
const studyPlannerRoutes = require('./routes/studyPlanner.routes');
const friendRoutes = require('./routes/friend.routes');
const groupRoutes = require('./routes/group.routes');
const chatRoutes = require('./routes/chat.routes');
const notificationRoutes = require('./routes/notification.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const webhookRoutes = require('./routes/webhook.routes');
const invoiceRoutes = require('./routes/invoice.routes');
const usageRoutes = require('./routes/usage.routes');
const couponRoutes = require('./routes/coupon.routes');
const gamificationRoutes = require('./routes/gamification.routes');
const focusRoutes = require('./routes/focus.routes');
const recycleBinRoutes = require ('./routes/recycleBin.routes');
const apiKeyRoutes = require('./routes/apiKey.routes');

const { notFound, errorHandler } = require('./middlewares/errorHandler');
const { ensureCsrfToken, verifyCsrfToken } = require('./middlewares/csrf.middleware');

const app = express();

// CORS must be FIRST to handle preflight OPTIONS requests
app.use(cors(config.cors));

// Security: Helmet middleware for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// Security: Rate limiting (Redis-based for multi-replica support)
app.use('/api/', globalLimiter);

// Webhook routes BEFORE express.json() middleware
// Razorpay webhooks need raw body for signature verification
app.use('/api/webhooks', webhookRoutes);

// Middleware
app.use(cookieParser()); // Parse cookies (required for httpOnly refresh token)
app.use(express.json({ limit: '50mb' })); // Increase limit for large file uploads
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('dev'));

// CSRF Protection (double-submit cookie)
// Ensures a CSRF cookie is set on every response, then verifies it on mutating requests
app.use(ensureCsrfToken);
app.use(verifyCsrfToken({
  excludePaths: [
    '/api/webhooks', // Razorpay webhooks don't have CSRF cookies
    '/api/auth/refresh', // Refresh uses httpOnly cookie — CSRF not needed
    '/api/auth/login', // First request — user doesn't have CSRF token yet
    '/api/auth/register', // First request — user doesn't have CSRF token yet
  ],
}));

// Routes
app.use('/health', healthRoutes);

// Auth routes with stricter rate limiting
app.use('/api/auth', authLimiter, authRoutes);

app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/visual-aids', visualAidsRoutes);
app.use('/api/boards', boardRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/notebook', notebookRoutes);
app.use('/api/study-planner', studyPlannerRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/gamification', gamificationRoutes);
app.use('/api/focus', focusRoutes);
app.use('/api/recycle-bin', recycleBinRoutes);
app.use('/api/apikeys', apiKeyRoutes);


// Root route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to Collabry API',
    version: '1.0.0',
  });
});

// Error handling - must be last
app.use(notFound);
app.use(errorHandler);

module.exports = app;
