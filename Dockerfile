# syntax=docker/dockerfile:1

# Single-container topology (Question 3, option A): the web app spawns the MCP server as a
# stdio child process, so both live in one image. If option B (two containers + bridge) is
# chosen, this splits into two Dockerfiles.

# U6 (IN-U6-1): the MINOR is pinned because `node:sqlite`'s `backup()` -- which in-app backup
# (P-38) depends on -- is absent from older 22.x releases. Patches still float, so security fixes
# arrive on rebuild. ⚠️ The startup capability check is what protects a HOST deployment (`npm start`),
# which this pin cannot reach.
ARG NODE_VERSION=22.23
# U9 (NFR-40): a CHECKED COPY of compose.yaml's pin (test/structure.u9.test.ts fails if they differ). Until
# 2026-10-18 this said `main`, and CI's `docker build .` passed no ref -- so CI built upstream's moving `main`, not
# the pin. With the guarded patch below tied to one exact upstream line, a moving default would break CI the day
# upstream edits that line.
ARG MCP_SERVER_REF=6065ce5cdef13ffeb43042e295bb788ce7ad00df

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

# U9 (LC-58, BR-69.1): the ONE divergence from upstream. Its config path is fixed next to its build, and it writes
# the file by temp + rename, which fails with EBUSY on a single-file bind mount (probed 2026-10-18). The patch lets
# SPOTIFY_CONFIG_PATH point it into the /app/secrets DIRECTORY mount. It refuses -- and so fails this build --
# unless upstream's line is found exactly once. Remove it when upstream accepts an equivalent override (BR-69.2).
COPY scripts/lib/patchConfigPath.ts /tmp/patchConfigPath.ts
RUN node /tmp/patchConfigPath.ts --file src/utils.ts && rm /tmp/patchConfigPath.ts

# U9 (LC-59, BR-68.3, Q1 = A): upstream declares Node >=26.8.1, so npm prints EBADENGINE warnings here; they are
# EXPECTED. This image stays on Node 22.23 for node:sqlite's backup(). Upstream's OWN suite runs below on 22.23 --
# so a future pin that really needs Node 26 fails this build, not the running app (113/113 passed, 2026-10-18).
# `npm ci`: upstream ships a lockfile since 6065ce5c's history (d7445af).
RUN npm ci && npm test && npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage 2: build the web app
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS app-build

WORKDIR /app
# U6 (IN-U6-2): `npm ci`, not `npm install` -- the lockfile is authoritative and a mismatch FAILS
# the build. `tar` is the first new runtime dependency since U0, and P-39's argument is about WHICH
# `tar` runs. The lockfile is named explicitly (no glob) so a missing one fails rather than skips.
COPY package.json package-lock.json ./
RUN npm ci

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
# U9 (BR-73.1): MIT requires the connector's copyright notice to travel with every copy of it.
COPY --from=mcp-build /opt/spotify-mcp/LICENSE /opt/spotify-mcp/LICENSE

COPY --from=app-build /app/node_modules ./node_modules
COPY --from=app-build /app/dist ./dist
COPY package.json ./
COPY public ./public
COPY LICENSE ./LICENSE

# U9 (BR-74.2/74.3, LC-68): what the *App only* commands need. `setup` copies these templates into the user's folder;
# `auth` is the same sign-in script a source install runs with `npm run auth` (dependency-free by design).
COPY compose.app.yaml /app/app-only/compose.app.yaml
COPY secrets/musicbrainz.example.json /app/app-only/musicbrainz.example.json
COPY config/rules.example.json /app/app-only/rules.example.json
COPY scripts/auth.mjs /app/scripts/auth.mjs
COPY scripts/lib/browserCommand.mjs scripts/lib/loopbackHost.mjs /app/scripts/lib/

# U9 (BR-73.3): both licence notices must be IN the image -- this app's GPL-3.0 and the connector's MIT. A missing or
# empty one fails the build here, before any image exists to publish.
RUN test -s /app/LICENSE && test -s /opt/spotify-mcp/LICENSE  || { echo 'LICENSE missing from the image (BR-73.3): /app/LICENSE and /opt/spotify-mcp/LICENSE are both required' >&2; exit 1; }

# U9 (BR-73.2, P-72): OCI labels. Local builds get placeholders; CI's publish job passes the real values.
ARG APP_VERSION=local
ARG VCS_REF=unknown
ARG BASE_DIGEST=unknown
LABEL org.opencontainers.image.title="spotify-companion"       org.opencontainers.image.licenses="GPL-3.0-or-later AND MIT"       org.opencontainers.image.source="https://github.com/kuhndj67/spotify-companion"       org.opencontainers.image.version="${APP_VERSION}"       org.opencontainers.image.revision="${VCS_REF}"       org.opencontainers.image.base.digest="${BASE_DIGEST}"

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
