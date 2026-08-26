# syntax=docker/dockerfile:1

# Single-container topology (Question 3, option A): the web app spawns the MCP server as a
# stdio child process, so both live in one image. If option B (two containers + bridge) is
# chosen, this splits into two Dockerfiles.

ARG NODE_VERSION=22
ARG MCP_SERVER_REF=main

# ---------------------------------------------------------------------------
# Stage 1: build marcelmarais/spotify-mcp-server from source
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS mcp-build
ARG MCP_SERVER_REF

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Fetch by ref, where the ref may be a commit SHA.
#
# `git clone --branch` only accepts branch and tag names — it fails with exit 128 on a raw SHA,
# which is exactly what pinning for R7 produced. Fetching an explicit ref into an empty repo
# works for a SHA, a branch or a tag alike, and keeps the shallow depth.
WORKDIR /opt/spotify-mcp
RUN git init -q . \
 && git remote add origin https://github.com/marcelmarais/spotify-mcp-server.git \
 && git fetch --depth 1 origin "${MCP_SERVER_REF}" \
 && git checkout -q FETCH_HEAD

WORKDIR /opt/spotify-mcp
RUN npm install && npm run build && npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage 2: build the web app
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS app-build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage 3: runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    MCP_SERVER_ENTRYPOINT=/opt/spotify-mcp/build/index.js \
    MCP_SERVER_CWD=/opt/spotify-mcp

WORKDIR /app

COPY --from=mcp-build /opt/spotify-mcp/build /opt/spotify-mcp/build
COPY --from=mcp-build /opt/spotify-mcp/node_modules /opt/spotify-mcp/node_modules
COPY --from=mcp-build /opt/spotify-mcp/package.json /opt/spotify-mcp/package.json

COPY --from=app-build /app/node_modules ./node_modules
COPY --from=app-build /app/dist ./dist
COPY package.json ./
COPY public ./public

# The MCP server writes refreshed OAuth tokens back to spotify-config.json, so its directory
# must be writable by the runtime user.
RUN chown -R node:node /opt/spotify-mcp

# Bind-mounted host directories arrive root-owned, so the unprivileged user cannot create the
# database inside them. The entrypoint starts as root purely to fix ownership of the mount
# points, then drops to `node` via setpriv. Root never runs the application.
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# NOTE: no `USER node` here — the entrypoint drops privileges itself. Setting it would leave the
# bind mount unwritable, which is the defect this replaced (found in U1 Build and Test).
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
