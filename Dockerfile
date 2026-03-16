# -------------------------------
# Stage 1: Build
# -------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools (minimal set)
RUN apk add --no-cache python3 make g++ && \
    npm config set cache /tmp/.npm

# Copy dependency files
COPY package*.json ./

# Install dependencies with optimizations
RUN npm ci --include=dev --prefer-offline --no-audit --no-fund && \
    npm cache clean --force

# Copy source code
COPY . .

# Build the application
RUN npm run build && \
    npm prune --omit=dev && \
    npm cache clean --force

# -------------------------------
# Stage 2: Production
# -------------------------------
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Set npm cache to tmp (will be cleaned up)
RUN npm config set cache /tmp/.npm

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev --prefer-offline --no-audit --no-fund && \
    npm cache clean --force && \
    rm -rf /tmp/.npm

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Change ownership and switch to non-root user
RUN chown -R nestjs:nodejs /app
USER nestjs

# Expose port
EXPOSE 3000

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start application
CMD ["node", "dist/main.js"]
