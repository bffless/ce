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
RUN pnpm install --frozen-lockfile

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

# Install pnpm, netcat for health checks, and build tools for native modules
RUN npm install -g pnpm && \
    apk add --no-cache netcat-openbsd python3 make g++ && \
    ln -sf python3 /usr/bin/python

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/backend/package.json ./apps/backend/

# Install production dependencies for backend only
# Rebuild native modules (like bcrypt) for Alpine Linux
# Note: bcrypt needs to be rebuilt for Alpine's musl libc
RUN pnpm install --prod --frozen-lockfile --filter backend

# Rebuild bcrypt for Alpine Linux (native bindings must match the runtime)
RUN cd apps/backend && \
    if [ -d "node_modules/bcrypt" ]; then \
      cd node_modules/bcrypt && npm rebuild; \
    elif [ -d "../../node_modules/bcrypt" ]; then \
      cd ../../node_modules/bcrypt && npm rebuild; \
    fi

# Remove build tools to reduce image size (bcrypt is already built)
RUN apk del python3 make g++ || true

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

