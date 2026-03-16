# -------------------------------
# Stage 1: Build
# -------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools
RUN apk add --no-cache python3 make g++

# Copy dependency files
COPY package*.json ./

# Install ALL dependencies (including devDeps for build)
RUN npm install

# Copy the rest of the source code
COPY . .

# Build the NestJS app
RUN npm run build

# -------------------------------
# Stage 2: Production
# -------------------------------
FROM node:20-alpine AS production

WORKDIR /app

# Copy only package files first
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy built app from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Expose app port
EXPOSE 3000

# Start the app
CMD ["npm", "run", "start:prod"]