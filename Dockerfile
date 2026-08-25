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

WORKDIR /opt
RUN git clone --depth 1 --branch "${MCP_SERVER_REF}" \
      https://github.com/marcelmarais/spotify-mcp-server.git spotify-mcp

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

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
