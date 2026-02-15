# Collabry Backend API

Production-ready Node.js + Express + MongoDB backend API for the Collabry collaborative learning platform.

## Overview

The Collabry backend provides a comprehensive REST API with real-time WebSocket support for collaborative features. Built with Express.js and MongoDB, it handles authentication, user management, study planning, notebooks, AI integration, gamification, subscriptions, and real-time collaboration.

## Features

### Core Functionality
- **Authentication & Authorization**: JWT-based auth with access/refresh tokens, role-based access control (RBAC)
- **User Management**: Profile management, friend system, groups
- **Study Tools**: 
  - Smart notebooks with markdown support
  - Study planner with tasks and schedules
  - Focus mode with Pomodoro sessions
  - Quiz generation and practice
- **AI Integration**: Proxy to AI Engine for Study Buddy AI assistant
- **Collaboration**:
  - Real-time collaborative whiteboard (Socket.IO)
  - Group chat and messaging
  - Shared study sessions
- **Gamification**: Points, achievements, leaderboards, streaks
- **Subscriptions**: Razorpay integration for premium features, usage tracking
- **Admin Panel**: User management, analytics, content moderation

### Technical Features
- **Security**: CSRF protection, rate limiting, helmet security headers, input validation
- **Performance**: Redis caching, connection pooling, query optimization
- **Scalability**: Horizontal scaling support, background job processing
- **Monitoring**: Comprehensive logging, error tracking, health checks
- **Testing**: Jest unit and integration tests

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Cache**: Redis (for rate limiting, sessions, caching)
- **Real-time**: Socket.IO
- **Authentication**: JWT (JSON Web Tokens)
- **Payments**: Razorpay
- **Validation**: Express Validator
- **Security**: Helmet, CORS, bcryptjs
- **Testing**: Jest, Supertest

## Prerequisites

- **Node.js** 18+ and npm
- **MongoDB** 5.0+ (local or Atlas)
- **Redis** 6.0+ (for rate limiting and caching)
- **AI Engine** running (for AI features)

## Installation

### 1. Clone and Install

```bash
cd backend
npm install
```

### 2. Environment Configuration

Create a `.env` file (copy from `.env.example`):

```bash
cp .env.example .env
```

**Required Environment Variables:**

```env
# Environment
NODE_ENV=development

# Server
PORT=5000

# MongoDB
MONGODB_URI=mongodb://localhost:27017/collabry
# Or Atlas: mongodb+srv://username:password@cluster.mongodb.net/collabry

# Redis (for rate limiting and caching)
REDIS_URL=redis://localhost:6379

# CORS - Frontend URL
CORS_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000

# JWT Secrets (GENERATE YOUR OWN!)
JWT_ACCESS_SECRET=your-super-secret-access-token-key-change-this
JWT_REFRESH_SECRET=your-super-secret-refresh-token-key-change-this
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# AI Engine
AI_ENGINE_URL=http://localhost:8000

# Email (for notifications)
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM=noreply@collabry.com
EMAIL_FROM_NAME=Collabry

# Razorpay (for subscriptions)
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

**Generate Secure JWT Secrets:**

```bash
node scripts/generate-jwt-secrets.js
```

### 3. Database Setup

```bash
# MongoDB will create database automatically on first connection
# Create admin user (one-time setup)
npm run create-admin
```

## Running the Application

### Development Mode

```bash
# Start with auto-reload (nodemon)
npm run dev
```

### Production Mode

```bash
# Start production server
npm start
```

### With Docker

```bash
# Build image
docker build -t collabry-backend .

# Run container
docker run -p 5000:5000 --env-file .env collabry-backend
```

## Project Structure

```
backend/
├── src/
│   ├── config/             # Configuration files
│   │   ├── db.js          # MongoDB connection
│   │   ├── env.js         # Environment config & validation
│   │   ├── redis.js       # Redis connection
│   │   ├── razorpay.js    # Razorpay client
│   │   └── plans.js       # Subscription plans
│   ├── models/            # Mongoose models
│   │   ├── User.js
│   │   ├── Notebook.js
│   │   ├── FocusSession.js
│   │   ├── Subscription.js
│   │   └── ...
│   ├── routes/            # Express routes
│   │   ├── auth.routes.js
│   │   ├── user.routes.js
│   │   ├── notebook.routes.js
│   │   └── ...
│   ├── controllers/       # Route handlers
│   │   ├── auth.controller.js
│   │   ├── user.controller.js
│   │   └── ...
│   ├── services/          # Business logic
│   │   ├── auth.service.js
│   │   ├── email.service.js
│   │   └── ...
│   ├── middlewares/       # Custom middleware
│   │   ├── auth.middleware.js    # JWT verification
│   │   ├── csrf.middleware.js    # CSRF protection
│   │   ├── rateLimiter.js        # Rate limiting
│   │   └── errorHandler.js       # Error handling
│   ├── utils/             # Utility functions
│   │   ├── jwt.js
│   │   ├── AppError.js
│   │   └── ...
│   ├── socket/            # Socket.IO setup
│   │   └── index.js
│   ├── jobs/              # Background jobs
│   │   ├── subscriptionExpiry.js
│   │   └── recycleBinCleanup.js
│   ├── app.js            # Express app configuration
│   └── server.js         # Server entry point
├── tests/                 # Jest tests
│   ├── auth/
│   ├── subscription/
│   └── ...
├── scripts/              # Utility scripts
│   ├── createAdmin.js
│   ├── generate-jwt-secrets.js
│   └── killPort.js
├── invoices/             # Generated invoices
├── uploads/              # User uploads
├── .env.example          # Environment template
├── .dockerignore
├── Dockerfile
├── package.json
└── README.md
```

## API Documentation

### Base URL

```
http://localhost:5000/api
```

### Authentication Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/register` | Register new user | No |
| POST | `/auth/login` | Login user | No |
| POST | `/auth/logout` | Logout user | Yes |
| POST | `/auth/refresh` | Refresh access token | Yes (Refresh Token) |
| POST | `/auth/forgot-password` | Request password reset | No |
| POST | `/auth/reset-password` | Reset password | No |
| GET | `/auth/verify-email/:token` | Verify email address | No |

### User Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/users/me` | Get current user profile | Yes |
| PATCH | `/users/me` | Update profile | Yes |
| DELETE | `/users/me` | Delete account | Yes |
| GET | `/users/:id` | Get user by ID | Yes |

### Notebook Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/notebook` | Get all notebooks | Yes |
| POST | `/notebook` | Create notebook | Yes |
| GET | `/notebook/:id` | Get notebook by ID | Yes |
| PATCH | `/notebook/:id` | Update notebook | Yes |
| DELETE | `/notebook/:id` | Delete notebook | Yes |

### Focus Mode Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/focus/sessions` | Get all focus sessions | Yes |
| POST | `/focus/sessions` | Start focus session | Yes |
| PATCH | `/focus/sessions/:id/pause` | Pause session | Yes |
| PATCH | `/focus/sessions/:id/resume` | Resume session | Yes |
| PATCH | `/focus/sessions/:id/complete` | Complete session | Yes |
| GET | `/focus/settings` | Get focus settings | Yes |
| PATCH | `/focus/settings` | Update settings | Yes |

### Subscription Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/subscriptions/plans` | Get available plans | No |
| POST | `/subscriptions/create-order` | Create Razorpay order | Yes |
| POST | `/subscriptions/verify-payment` | Verify and activate | Yes |
| GET | `/subscriptions/current` | Get active subscription | Yes |
| POST | `/subscriptions/cancel` | Cancel subscription | Yes |

### Admin Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/admin/dashboard` | Get admin stats | Admin |
| GET | `/admin/users` | List all users | Admin |
| PATCH | `/admin/users/:id` | Update user | Admin |
| DELETE | `/admin/users/:id` | Delete user | Admin |

**Full API documentation:** See [API.md](API.md) for complete endpoint details with request/response examples.

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Code Quality

```bash
# Lint code
npm run lint

# Format code
npm run format
```

### Database Scripts

```bash
# Create admin user
npm run create-admin

# Generate JWT secrets
npm run generate-jwt-secrets

# Migration (if needed)
node scripts/migrate-verify-existing-users.js
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for comprehensive deployment guides covering:
- Environment configuration
- Docker deployment
- Cloud platforms (Railway, Render, AWS, DigitalOcean)
- Database setup (MongoDB Atlas)
- Redis setup (Redis Cloud)
- SSL/HTTPS configuration
- Monitoring and logging

## Security

### Implemented Security Measures

- **Authentication**: JWT with access and refresh tokens
- **Password Security**: bcrypt hashing with salt rounds
- **CSRF Protection**: Double-submit cookie pattern
- **Rate Limiting**: Redis-based distributed rate limiting
- **Input Validation**: Express Validator on all endpoints
- **SQL Injection**: Prevented via Mongoose ODM parameterized queries
- **XSS Protection**: Helmet security headers, input sanitization
- **CORS**: Strict origin validation
- **Environment Secrets**: Never committed to version control

### Best Practices

1. **Never commit `.env` files** - Use `.env.example` as template
2. **Generate unique JWT secrets** - Use `scripts/generate-jwt-secrets.js`
3. **Use HTTPS in production** - Configure SSL certificates
4. **Keep dependencies updated** - Run `npm audit` regularly
5. **Monitor logs** - Set up centralized logging
6. **Backup database** - Regular MongoDB backups
7. **Validate all inputs** - Never trust user input

## Troubleshooting

### Common Issues

**Issue: Cannot connect to MongoDB**
```bash
# Check MongoDB is running
mongod --version

# Check connection string in .env
MONGODB_URI=mongodb://localhost:27017/collabry
```

**Issue: Redis connection error**
```bash
# Check Redis is running
redis-cli ping
# Should return: PONG

# Check Redis URL in .env
REDIS_URL=redis://localhost:6379
```

**Issue: JWT authentication fails**
```bash
# Regenerate JWT secrets
node scripts/generate-jwt-secrets.js

# Update .env with new secrets
```

**Issue: Port already in use**
```bash
# Kill process on port 5000
node scripts/killPort.js 5000
```

**Issue: CORS errors**
```bash
# Ensure frontend URL is in CORS_ORIGIN
CORS_ORIGIN=http://localhost:3000
```

## Contributing

1. Follow existing code structure and naming conventions
2. Write tests for new features
3. Run tests before committing: `npm test`
4. Update documentation for API changes
5. Follow security best practices

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | development | Environment mode |
| `PORT` | No | 5000 | Server port |
| `MONGODB_URI` | Yes | - | MongoDB connection string |
| `REDIS_URL` | Yes | - | Redis connection string |
| `CORS_ORIGIN` | Yes | * | Allowed CORS origins |
| `FRONTEND_URL` | Yes | - | Frontend application URL |
| `JWT_ACCESS_SECRET` | Yes | - | JWT access token secret |
| `JWT_REFRESH_SECRET` | Yes | - | JWT refresh token secret |
| `AI_ENGINE_URL` | Yes | - | AI Engine base URL |
| `EMAIL_SERVICE` | No | gmail | Email service provider |
| `EMAIL_USER` | Yes | - | Email account username |
| `EMAIL_PASSWORD` | Yes | - | Email account password |
| `RAZORPAY_KEY_ID` | Yes | - | Razorpay API key |
| `RAZORPAY_KEY_SECRET` | Yes | - | Razorpay API secret |

## Resources

- [Express.js Documentation](https://expressjs.com/)
- [MongoDB Documentation](https://docs.mongodb.com/)
- [Mongoose Documentation](https://mongoosejs.com/)
- [Socket.IO Documentation](https://socket.io/docs/)
- [JWT Best Practices](https://jwt.io/introduction)
- [Razorpay API Docs](https://razorpay.com/docs/api/)

## License

Proprietary - All rights reserved

---

For frontend documentation, see `../frontend/README.md`.
For AI engine documentation, see `../ai-engine/README.md`.

### Login
```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "password123"
}
```

### Protected Request
```bash
GET /api/users/me
Authorization: Bearer <access_token>
```

## Security Features

✅ JWT access & refresh tokens  
✅ Password hashing with bcrypt  
✅ Role-based authorization  
✅ Protected routes middleware  
✅ Environment-based configuration  
✅ Centralized error handling  
✅ Request validation  
✅ CORS enabled  

## User Model

- `name`: String (required, 2-50 chars)
- `email`: String (required, unique, validated)
- `password`: String (required, hashed, min 6 chars)
- `role`: Enum ['user', 'admin'] (default: 'user')
- `isActive`: Boolean (default: true)
- `timestamps`: createdAt, updatedAt

## Error Handling

The application includes centralized error handling middleware that:
- Catches all errors across the application
- Formats error responses consistently
- Logs errors in development mode
- Handles Mongoose-specific errors
- Removes stack traces in production

## License

ISC
