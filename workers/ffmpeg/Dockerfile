FROM node:20-alpine
# Same ffmpeg package line as docker/backend.Dockerfile so flags/versions match the local executor.
RUN apk add --no-cache ffmpeg
ARG VERSION=dev
ENV WORKER_VERSION=$VERSION PORT=8080 NODE_ENV=production
WORKDIR /app
COPY package.json server.mjs job.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
