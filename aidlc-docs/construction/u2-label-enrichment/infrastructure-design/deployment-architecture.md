# Deployment Architecture — U2: Label Enrichment

**Date**: 2026-08-31 · **Stage**: CONSTRUCTION — Infrastructure Design, Unit U2
**Companion**: [`infrastructure-design.md`](infrastructure-design.md)

---

## Topology

```
  ┌─ HOST (the real deployment, Q2 = A) ─────────────────────────────────┐
  │                                                                      │
  │   npm start ──▶ node dist/server.js                                  │
  │                   │                                                  │
  │                   ├── spawns ──▶ .mcp-server/build/index.js (stdio)  │
  │                   │                                                  │
  │                   ├── reads ───▶ secrets/spotify-config.json         │
  │                   ├── reads ───▶ secrets/musicbrainz.json      ← NEW │
  │                   │                                                  │
  │                   ├── writes ──▶ data/history.db (+ -wal, -shm)      │
  │                   │              data/snapshots/                     │
  │                   │                                                  │
  │   listens 127.0.0.1:3000 ── localGuard: loopback peer only           │
  │                   │                                                  │
  │                   ├──▶ api.spotify.com        (existing)             │
  │                   └──▶ musicbrainz.org        ← NEW, ≤1 req/sec      │
  └──────────────────────────────────────────────────────────────────────┘

  ┌─ CONTAINER (kept correct, still cannot serve its UI) ────────────────┐
  │   compose.yaml · restart: unless-stopped                             │
  │   ⚠️ open item 1 — published-port traffic arrives from the Docker     │
  │      bridge gateway, so localGuard refuses every request             │
  └──────────────────────────────────────────────────────────────────────┘
```

**U2 adds one outbound arrow and one input file.** Everything else is unchanged.

---

## `compose.yaml` additions

Kept current so the two deployments do not drift, even though the container is unverified.

```yaml
    environment:
      # ... existing U0/U1 settings unchanged ...

      # -- U2: label enrichment -------------------------------------------------
      # TTLs are MEASUREMENT parameters, tunable like COMPLETION_THRESHOLD.
      # An unknown is re-tried because MusicBrainz's completeness changes; a resolved
      # label is re-checked because the underlying fact can change (BR-13).
      LABEL_TTL_UNKNOWN_DAYS: 30
      LABEL_TTL_RESOLVED_DAYS: 90

      # Backfill pacing. Bounded per sweep so a backlog cannot monopolise the
      # single 1 req/sec queue (P-1, P-5).
      LABEL_BACKFILL_INTERVAL_HOURS: 6
      LABEL_BACKFILL_BATCH: 25

      # Overridable so BR-1.2's regression test can point at a fixture stub. The
      # two-call chain must stay two calls: `inc=` is silently ignored on the ISRC
      # endpoint, and a test asserting "no releases" would pass against the bug.
      MUSICBRAINZ_BASE_URL: https://musicbrainz.org/ws/2

      # NOTE: request spacing (1 req/sec, NFR-15) and retry policy are NOT settings.
      # They are compliance and correctness values; a knob here would only ever be
      # used to violate the policy.

    volumes:
      - ./secrets/spotify-config.json:/opt/spotify-mcp/spotify-config.json:rw
      - ./data:/data:rw
      # NFR-14 contact address. Read-only: unlike the Spotify config, nothing
      # rewrites this file.
      - ./secrets/musicbrainz.json:/app/secrets/musicbrainz.json:ro     # NEW
```

**No change to `ports:`, `networks:`, or the `HOST` / `LOCAL_ONLY` settings.** U2 adds no inbound
surface, and the deployment decision (Q2 = A) explicitly excludes touching the guard.

### The new mount is read-only, and the existing one is not

`spotify-config.json` is mounted `rw` because the MCP server rewrites it on token refresh.
`musicbrainz.json` is mounted `ro` because nothing writes it. Copying the `rw` out of habit would
grant a write capability with no use — the kind of detail that is free to get right now and awkward
to notice later.

---

## Host equivalents

`config.ts` already resolves defaults differently on host and in container (`inContainer`). U2
follows the same pattern, so `npm start` needs **no new flags**:

| Setting | Host default | Container |
|---|---|---|
| `secrets/musicbrainz.json` | `<projectRoot>/secrets/musicbrainz.json` | `/app/secrets/musicbrainz.json` |
| TTLs, backfill, base URL | Same defaults, from `process.env` | Set explicitly in `compose.yaml` |

The container values in `compose.yaml` are **the same as the code defaults**, stated explicitly so
the deployment is self-describing rather than implying the code says something different.

---

## Startup sequence

Order matters, and one step is new.

```
1. migrate()                      002 applied before anything writes    (existing)
2. load secrets/spotify-config    fail closed if missing                (existing)
3. load secrets/musicbrainz.json  fail closed if missing or no contact  ← NEW
4. spawn MCP server               stdio                                 (existing)
5. build LikedSetCache            12 requests, Spotify                   (U2)
6. start MusicBrainzQueue         idle until work arrives                (U2)
7. run backfill startup sweep     LOW priority, bounded batch            (U2, P-5/Q3=C)
8. subscribe to tick              recording begins                       (existing)
```

**Step 3 fails closed.** No anonymous fallback: NFR-14 compliance is a choice this project made,
and traffic that is unidentified while believed compliant is worse than a refusal to start.

**Step 7 is bounded and low priority**, so a large backlog cannot delay step 8. Recording must not
wait on enrichment — the same principle as NFR-16 applied to startup rather than to the display.

---

## Failure and restart behaviour

| Event | Result |
|---|---|
| `secrets/musicbrainz.json` missing | **Startup error.** No anonymous `User-Agent` fallback |
| MusicBrainz unreachable | Labels stay `pending`, then `error`. **Display, recording and export unaffected** |
| Process restart | In-memory queue lost by design; startup sweep re-derives the work from the database (P-5) |
| Restart mid-grace-window | Pending liked re-checks flushed on graceful shutdown; an ungraceful kill loses at most one `liked-during` upgrade (P-8) |
| Container rebuild | `./data` bind mount survives (NFR-11, unchanged from U1) |
| Host terminal closed | Scheduled sweeps stop. **Timeliness degrades, correctness does not** — the next startup sweep catches up |

---

## Verification owed at Build and Test

Recorded here so it is not lost between stages.

- [ ] **Container egress to `musicbrainz.org`** (Q3 = A) — from inside the container, one request
      asserting `200` and the expected `User-Agent`. Assumed working; not yet observed
- [ ] **`secrets/musicbrainz.json` fails closed** when absent, and the error names the file
- [ ] **The read-only mount is genuinely read-only** — a write attempt fails
- [ ] **BR-1.2's two-call chain** tested against a recording known to have many releases, via
      `MUSICBRAINZ_BASE_URL` pointed at a stub. A test asserting "no releases" would pass against
      the `inc=`-ignored bug, so the fixture must be one where the correct answer is known to be
      non-empty
- [ ] **No new inbound port** — `netstat`/`ss` shows the same single listener as U1

---

## What is deliberately absent

| Not present | Why |
|---|---|
| A second container or sidecar | The queue is in-process; there is nothing to isolate |
| A message broker | P-5 — the database is the queue of record |
| An external cache | Single process, and the tables must be durable for BR-8.7 anyway |
| A reverse proxy / API gateway | One local listener, loopback only |
| Egress restrictions / allow-lists | Would be defence in depth on a single-user local tool; the outbound destination is one well-known host and the code has exactly one place that calls it |
| Secret management infrastructure | Two files in a gitignored directory, on one machine |
