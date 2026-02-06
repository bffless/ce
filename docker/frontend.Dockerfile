# Build stage
FROM node:20-alpine AS builder

# Build argument for API URL (empty for relative URLs through nginx proxy)
ARG VITE_API_URL=

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/frontend/package.json ./apps/frontend/

# Copy frontend source code (dockerignore will exclude node_modules)
COPY apps/frontend ./apps/frontend

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build the application with production API URL
WORKDIR /app/apps/frontend
RUN echo "VITE_API_URL=${VITE_API_URL}" > .env.production && \
    echo "Building with VITE_API_URL=${VITE_API_URL}" && \
    pnpm build

# Production stage - just copy dist files
FROM node:20-alpine

WORKDIR /app

# Copy built files
COPY --from=builder /app/apps/frontend/dist ./dist

# Keep container running (nginx will serve these files via volume)
CMD ["tail", "-f", "/dev/null"]

