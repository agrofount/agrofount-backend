# -------------------------------
# Stage 1: Build
# -------------------------------
FROM node:24.14.0-alpine AS builder

WORKDIR /app

# Install build tools
RUN apk add --no-cache python3 make g++

# Copy dependency files
COPY package*.json ./

# Install ALL dependencies (including devDeps for build)
RUN npm ci

# Copy the rest of the source code
COPY . .

# Build the NestJS app
RUN npm run build

# -------------------------------
# Stage 2: Production
# -------------------------------
FROM node:24.14.0-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

RUN apk upgrade --no-cache && apk add --no-cache dumb-init

# Copy only package files first
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy built app from builder stage
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node package*.json ./

USER node

# Expose app port
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/live || exit 1

# Start the app
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
