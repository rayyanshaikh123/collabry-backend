# Backend Deployment Guide

This guide provides comprehensive instructions for deploying the Collabry backend API in various environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Database Configuration](#database-configuration)
- [Deployment Platforms](#deployment-platforms)
  - [Railway](#railway)
  - [Render](#render)
  - [AWS EC2](#aws-ec2)
  - [DigitalOcean](#digitalocean)
  - [Docker](#docker)
- [Post-Deployment](#post-deployment)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- Node.js 18+ runtime environment
- MongoDB 5.0+ database (local or cloud)
- Redis 6.0+ instance (for rate limiting and caching)
- SSL certificate (for HTTPS in production)
- Domain name (optional but recommended)

## Environment Setup

### Required Environment Variables

Create a `.env` file with the following variables:

```env
# Environment
NODE_ENV=production

# Server
PORT=5000

# MongoDB (use MongoDB Atlas for production)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/collabry?retryWrites=true&w=majority

# Redis (use Redis Cloud for production)
REDIS_URL=redis://default:password@redis-host:port

# CORS - Frontend URL (IMPORTANT: Set explicitly, no wildcards!)
CORS_ORIGIN=https://yourdomain.com
FRONTEND_URL=https://yourdomain.com

# JWT Secrets (GENERATE UNIQUE SECRETS!)
JWT_ACCESS_SECRET=<64-character-random-string>
JWT_REFRESH_SECRET=<64-character-random-string>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# AI Engine
AI_ENGINE_URL=https://your-ai-engine.com

# Email Configuration
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

### Generate Secure Secrets

```bash
# Generate JWT secrets
node scripts/generate-jwt-secrets.js

# Or manually with Node.js
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## Database Configuration

### MongoDB Atlas Setup

1. **Create MongoDB Atlas Account**
   - Sign up at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
   - Create a new cluster (M0 tier is free)

2. **Configure Network Access**
   - Go to Network Access → Add IP Address
   - For development: Add your current IP
   - For production: Add deployment server IPs or allow all (0.0.0.0/0)

3. **Create Database User**
   - Go to Database Access → Add New Database User
   - Choose password authentication
   - Save credentials securely

4. **Get Connection String**
   - Click "Connect" on your cluster
   - Choose "Connect your application"
   - Copy connection string:
     ```
     mongodb+srv://username:password@cluster.mongodb.net/collabry
     ```

### Redis Cloud Setup

1. **Create Redis Cloud Account**
   - Sign up at [redis.com/try-free](https://redis.com/try-free/)
   - Create a new database (30MB is free)

2. **Get Connection URL**
   - Go to your database → Configuration
   - Copy the Public Endpoint:
     ```
     redis://default:password@endpoint:port
     ```

## Deployment Platforms

### Railway

Railway offers simple deployment with automatic builds from Git.

#### Setup

1. **Install Railway CLI**
   ```bash
   npm install -g @railway/cli
   railway login
   ```

2. **Create New Project**
   ```bash
   cd backend
   railway init
   railway link
   ```

3. **Add Environment Variables**
   ```bash
   # Set variables one by one
   railway variables set NODE_ENV=production
   railway variables set PORT=5000
   railway variables set MONGODB_URI="mongodb+srv://..."
   railway variables set REDIS_URL="redis://..."
   
   # Or upload from .env
   railway variables set --file .env.production
   ```

4. **Deploy**
   ```bash
   railway up
   ```

#### Railway Configuration

Create `railway.json` (optional):

```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Render

Render provides free tier for web services with auto-deploy from GitHub.

#### Setup

1. **Create Web Service**
   - Go to [render.com](https://render.com)
   - New → Web Service
   - Connect your GitHub repository
   - Select `backend` directory

2. **Configure Build**
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node

3. **Add Environment Variables**
   - Add all required variables from [Environment Setup](#environment-setup)
   - Use Render's environment variables UI

4. **Deploy**
   - Click "Create Web Service"
   - Automatic deployments on every push to main branch

#### render.yaml

```yaml
services:
  - type: web
    name: collabry-backend
    env: node
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 5000
      - key: MONGODB_URI
        sync: false
      - key: REDIS_URL
        sync: false
      - key: JWT_ACCESS_SECRET
        generateValue: true
      - key: JWT_REFRESH_SECRET
        generateValue: true
    healthCheckPath: /health
```

### AWS EC2

Deploy on AWS EC2 for full control and scalability.

#### Setup

1. **Launch EC2 Instance**
   ```bash
   # Ubuntu 22.04 LTS
   # t2.micro for testing, t2.small+ for production
   # Security group: Allow HTTP (80), HTTPS (443), SSH (22)
   ```

2. **Connect and Install Dependencies**
   ```bash
   ssh -i your-key.pem ubuntu@your-ec2-ip
   
   # Update system
   sudo apt update && sudo apt upgrade -y
   
   # Install Node.js 18
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt install -y nodejs
   
   # Install PM2
   sudo npm install -g pm2
   
   # Install Nginx
   sudo apt install -y nginx
   ```

3. **Deploy Application**
   ```bash
   # Clone repository
   git clone https://github.com/yourusername/collabry.git
   cd collabry/backend
   
   # Install dependencies
   npm install --production
   
   # Create .env file
   nano .env
   # Paste environment variables
   
   # Start with PM2
   pm2 start src/server.js --name collabry-backend
   pm2 save
   pm2 startup
   ```

4. **Configure Nginx Reverse Proxy**
   ```bash
   sudo nano /etc/nginx/sites-available/collabry
   ```

   ```nginx
   server {
       listen 80;
       server_name api.yourdomain.com;

       location / {
           proxy_pass http://localhost:5000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
       }

       # WebSocket support for Socket.IO
       location /socket.io {
           proxy_pass http://localhost:5000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
       }
   }
   ```

   ```bash
   # Enable site
   sudo ln -s /etc/nginx/sites-available/collabry /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

5. **Setup SSL with Let's Encrypt**
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d api.yourdomain.com
   ```

### DigitalOcean

Similar to AWS EC2 setup with DigitalOcean Droplets.

#### One-Click App

1. Create Droplet with Node.js one-click app
2. Follow similar steps as AWS EC2
3. Use DigitalOcean's Managed MongoDB/Redis for databases

### Docker

Deploy using Docker for containerized environments.

#### Dockerfile

Already included in the project:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

EXPOSE 5000

CMD ["node", "src/server.js"]
```

#### Build and Run

```bash
# Build image
docker build -t collabry-backend .

# Run container
docker run -d \
  --name collabry-backend \
  -p 5000:5000 \
  --env-file .env \
  collabry-backend

# Or use Docker Compose
docker-compose up -d
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  backend:
    build: .
    ports:
      - "5000:5000"
    environment:
      - NODE_ENV=production
      - PORT=5000
      - MONGODB_URI=${MONGODB_URI}
      - REDIS_URL=${REDIS_URL}
      - JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
      - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
    restart: unless-stopped
    depends_on:
      - mongodb
      - redis

  mongodb:
    image: mongo:5
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db
    restart: unless-stopped

  redis:
    image: redis:6-alpine
    ports:
      - "6379:6379"
    restart: unless-stopped

volumes:
  mongodb_data:
```

## Post-Deployment

### Create Admin User

```bash
# SSH into server or use platform console
cd backend
node scripts/createAdmin.js
```

### Health Check

Verify deployment:

```bash
# Health endpoint
curl https://api.yourdomain.com/health

# Should return:
# {"success": true, "message": "Server is healthy", ...}
```

### Test Authentication

```bash
# Register test user
curl -X POST https://api.yourdomain.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","password":"password123"}'

# Login
curl -X POST https://api.yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

## Monitoring

### PM2 Monitoring

```bash
# View logs
pm2 logs collabry-backend

# Monitor resources
pm2 monit

# View status
pm2 status
```

### Application Logs

Set up centralized logging:

```javascript
// Add to src/server.js
const winston = require('winston');
const logger = winston.createLogger({
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

### Uptime Monitoring

Use services like:
- UptimeRobot (free)
- Pingdom
- New Relic
- Datadog

Configure health check: `https://api.yourdomain.com/health`

## Troubleshooting

### Common Issues

**Issue: Application won't start**

```bash
# Check logs
pm2 logs collabry-backend --lines 100

# Common causes:
# - Missing environment variables
# - MongoDB/Redis connection failure
# - Port already in use
```

**Issue: MongoDB connection timeout**

```bash
# Check connection string
echo $MONGODB_URI

# Verify IP whitelist in MongoDB Atlas
# Test connection:
mongo "mongodb+srv://user:pass@cluster.mongodb.net/collabry"
```

**Issue: Redis connection error**

```bash
# Test Redis connection
redis-cli -h your-redis-host -p 6379 -a your-password ping

# Should return: PONG
```

**Issue: CORS errors**

```bash
# Ensure CORS_ORIGIN matches frontend URL exactly
CORS_ORIGIN=https://yourdomain.com  # No trailing slash!

# Check app.js CORS configuration
```

**Issue: 502 Bad Gateway (Nginx)**

```bash
# Check if app is running
pm2 status

# Check Nginx error logs
sudo tail -f /var/log/nginx/error.log

# Verify proxy_pass port matches app port
```

**Issue: SSL certificate not renewing**

```bash
# Test renewal
sudo certbot renew --dry-run

# Force renewal
sudo certbot renew --force-renewal
```

### Performance Optimization

1. **Enable Compression**
   ```javascript
   const compression = require('compression');
   app.use(compression());
   ```

2. **Use PM2 Cluster Mode**
   ```bash
   pm2 start src/server.js -i max --name collabry-backend
   ```

3. **Redis Caching**
   - Cache frequent database queries
   - Store session data in Redis
   - Implement cache invalidation strategies

4. **Database Indexing**
   ```javascript
   // Ensure indexes on frequently queried fields
   UserSchema.index({ email: 1 });
   NotebookSchema.index({ user: 1, createdAt: -1 });
   ```

## Security Checklist

- [ ] HTTPS enabled with valid SSL certificate
- [ ] Environment variables secured (never in code)
- [ ] JWT secrets are strong and unique
- [ ] CORS restricted to specific origins
- [ ] Rate limiting configured
- [ ] MongoDB authentication enabled
- [ ] Redis password protected
- [ ] Regular dependency updates (`npm audit`)
- [ ] Firewall configured (only necessary ports open)
- [ ] Regular database backups
- [ ] Error messages don't leak sensitive info
- [ ] Admin user password is strong

## Backup Strategy

### MongoDB Backup

```bash
# Create backup
mongodump --uri="mongodb+srv://..." --out=/backups/$(date +%Y%m%d)

# Restore backup
mongorestore --uri="mongodb+srv://..." /backups/20240213
```

### Automated Backups

Set up cron job:

```bash
crontab -e

# Daily backup at 2 AM
0 2 * * * mongodump --uri="$MONGODB_URI" --out=/backups/$(date +\%Y\%m\%d)

# Weekly cleanup (keep last 30 days)
0 3 * * 0 find /backups -type d -mtime +30 -exec rm -rf {} +
```

## Scaling

### Horizontal Scaling

1. **Use PM2 Cluster Mode**
   ```bash
   pm2 start src/server.js -i max
   ```

2. **Load Balancer**
   - Use Nginx as load balancer
   - Or cloud load balancers (AWS ALB, DigitalOcean Load Balancer)

3. **Session Persistence**
   - Store sessions in Redis (not in-memory)
   - Ensure stateless application design

### Vertical Scaling

- Upgrade server resources (CPU, RAM)
- Monitor with `pm2 monit` and adjust as needed

---

For frontend deployment, see `../frontend/DEPLOYMENT.md`.
For AI engine deployment, see `../ai-engine/DEPLOYMENT.md`.
