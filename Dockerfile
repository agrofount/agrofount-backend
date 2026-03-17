# -------------------------------
# Stage 1: Build
# -------------------------------
FROM node:20-slim AS builder

WORKDIR /app

# Install build tools + sharp deps
RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  libvips-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

# -------------------------------
# Stage 2: Production
# -------------------------------
FROM node:20-slim AS production

WORKDIR /app

RUN apt-get update && apt-get install -y libvips-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

EXPOSE 3000

CMD ["npm", "run", "start:prod"]