# -------------------------------
# Stage 1: Build
# -------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git

# Copy dependency files
COPY package*.json ./

# Install ALL dependencies
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# -------------------------------
# Stage 2: Production
# -------------------------------
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache \
    python3 \
    dumb-init \
    libstdc++

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies with build tools available
# This ensures native modules are compiled for the production environment
RUN apk add --no-cache --virtual .build-deps \
        python3 make g++ && \
    npm install --omit=dev && \
    apk del .build-deps

# Copy built app (but not node_modules)
COPY --from=builder /app/dist ./dist

# Copy any additional assets
COPY --from=builder /app/public ./public

# Set environment
ENV NODE_ENV=production \
    PORT=3000

USER nodejs

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]