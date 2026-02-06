# Production stage - uses pre-built dist from CI
# This Dockerfile is used when the frontend is already built in CI
# Saves ~60s by skipping pnpm install and build

FROM node:20-alpine

WORKDIR /app

# Copy pre-built dist folder from build context
COPY apps/frontend/dist ./dist

# Keep container running (nginx will serve these files via volume)
CMD ["tail", "-f", "/dev/null"]
