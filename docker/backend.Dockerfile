# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# Copy all package.json files to enable proper dependency resolution
COPY apps/backend/package.json ./apps/backend/

# Install dependencies for the entire workspace
# This ensures proper module resolution for monorepo in Docker
# The .npmrc configures pnpm to use hoisted node-linker for better Docker compatibility
# Note: --ignore-scripts prevents postinstall scripts from running native code
# which can crash under QEMU emulation for ARM64 cross-compilation
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy backend source files (excluding node_modules via .dockerignore)
# Copy specific files and directories to avoid conflicts with installed node_modules
COPY apps/backend/src ./apps/backend/src
COPY apps/backend/tsconfig.json ./apps/backend/
COPY apps/backend/nest-cli.json ./apps/backend/
COPY apps/backend/drizzle.config.ts ./apps/backend/
COPY apps/backend/drizzle ./apps/backend/drizzle

# Build the backend application from the workspace root
# Using workspace filter ensures proper module resolution
RUN pnpm --filter backend build

# Production stage
FROM node:20-alpine

# Install pnpm and netcat for health checks
# Note: No build tools needed - bcryptjs is pure JavaScript (no native modules)
RUN npm install -g pnpm && \
    apk add --no-cache netcat-openbsd

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/backend/package.json ./apps/backend/

# Install production dependencies for backend only
# Note: bcryptjs is pure JavaScript - no native module rebuilding needed
# --ignore-scripts prevents QEMU issues during ARM64 cross-compilation
RUN pnpm install --prod --frozen-lockfile --filter backend --ignore-scripts

# Copy built application and database migrations from builder
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/drizzle ./apps/backend/drizzle

# Copy nginx templates for dynamic domain configuration
COPY apps/backend/templates ./apps/backend/templates

# Copy entrypoint script
COPY docker/backend-entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Set working directory to backend
WORKDIR /app/apps/backend

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 3000

# Use entrypoint script to run migrations then start app
ENTRYPOINT ["/app/entrypoint.sh"]

