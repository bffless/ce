# Build stage
FROM node:20-alpine AS builder

# Build argument for API URL (empty for relative URLs through nginx proxy)
ARG VITE_API_URL=

# Install pnpm
# pnpm is PINNED to 9 to match every CI workflow (pnpm/action-setup version: 9) and the
# pnpm-9 lockfile. Unpinned, `npm install -g pnpm` installs pnpm 10+, which hard-fails the
# install with ERR_PNPM_IGNORED_BUILDS for @nestjs/core/bcrypt/sharp/browser-tabs-lock
# rather than running their build scripts. That bomb sat behind a cached layer and went off
# the first time an unrelated edit to this RUN line invalidated the cache (v0.4.36, #708).
RUN npm install -g pnpm@9

WORKDIR /app

# Copy package files
# .npmrc is required: it sets node-linker=hoisted so phantom deps used by the
# frontend (e.g. type-only `monaco-editor` imports via @monaco-editor/react)
# resolve inside the image. Without it pnpm defaults to isolated linking and
# `pnpm build` fails. Mirrors backend.Dockerfile.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc ./
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

