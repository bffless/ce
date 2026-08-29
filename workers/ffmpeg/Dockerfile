FROM node:20-alpine
# Same ffmpeg package line as docker/backend.Dockerfile so flags/versions match the local executor.
# font-noto is NOT optional: ffmpeg's `drawtext` (the frames op's `draw` block) takes no explicit
# fontfile=, so it resolves a family through fontconfig. Alpine ships no fonts, and without one the
# filter fails to initialise with "Cannot find a valid font for the family Sans" — which CE catches
# and retries un-drawn, so sheets still come back, silently unlabelled (`drawn: false`).
# Measured on ghcr.io/bffless/ce-ffmpeg-worker:preview-2026-08-17-305246f7d910 (2026-08-29):
# fc-list found 0 fonts and every labelled still failed; adding font-noto made the same argv render.
RUN apk add --no-cache ffmpeg font-noto
ARG VERSION=dev
ENV WORKER_VERSION=$VERSION PORT=8080 NODE_ENV=production
WORKDIR /app
COPY package.json server.mjs job.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
