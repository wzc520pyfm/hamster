# syntax=docker/dockerfile:1
# Control-plane API + isolation broker. The broker needs a Docker *client* to talk to
# the host docker.sock (mounted only on this service). The model worker (agent /
# broker-created desktop) never receives docker.sock.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

# Docker CLI only (static binary) so `execFile('docker', ...)` works against the
# mounted sock. No dockerd. No privileged flag. No host-pid / host-network.
ARG DOCKER_CLI_VERSION=27.3.1
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && ARCH="$(dpkg --print-architecture)" \
  && case "$ARCH" in \
       amd64) DARCH=x86_64 ;; \
       arm64) DARCH=aarch64 ;; \
       *) DARCH="$ARCH" ;; \
     esac \
  && curl -fsSL "https://download.docker.com/linux/static/stable/${DARCH}/docker-${DOCKER_CLI_VERSION}.tgz" \
       | tar -xz --strip-components=1 -C /usr/local/bin docker/docker \
  && chmod +x /usr/local/bin/docker \
  && docker --version \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json index.js ./
COPY src ./src
EXPOSE 8080
# Root is required so the broker can use the host-mounted docker.sock regardless of
# the host docker group gid. Isolation still holds: agent and desktop never get the sock.
USER root
CMD ["node", "index.js"]
