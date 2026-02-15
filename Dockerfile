# ================================
# Backend Dockerfile (Express.js)
# Production-optimized build
# ================================

# --- Dependencies Stage ---
FROM node:20-alpine AS deps

WORKDIR /app

# Install build tools for native modules (bcrypt, etc.)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# --- Production Stage ---
FROM node:20-alpine AS runner

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S express -u 1001

# Install runtime dependencies
RUN apk add --no-cache curl

# Copy production dependencies from builder
COPY --from=deps --chown=express:nodejs /app/node_modules ./node_modules

# Copy application source
COPY --chown=express:nodejs src ./src
COPY --chown=express:nodejs package.json ./

# Create uploads directory with proper permissions
RUN mkdir -p /app/uploads && \
    chown -R express:nodejs /app/uploads

# Switch to non-root user
USER express

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000

# Memory optimization - prevent OOM in containers
ENV NODE_OPTIONS="--max-old-space-size=512"

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

# Start Express server
CMD ["node", "src/server.js"]
