# Infrastructure Design — U2: Label Enrichment

**Date**: 2026-08-31 · **Stage**: CONSTRUCTION — Infrastructure Design, Unit U2
**Decisions**: Q1 = B (`secrets/musicbrainz.json`) · Q2 = A (host deployment) · Q3 = A (verify
egress at Build and Test) · Q4 = D (TTLs tunable, rate limit fixed, base URL configurable) ·
Q5 = A (coverage as a diagnostics section)

---

## The whole delta

U1 needed somewhere durable for a database. **U2 needs a way out of the machine, and one secret
that is not a credential.** That is the entire infrastructure change.

| | Change |
|---|---|
| **Inbound** | **None.** No new port, no new listener, no new route reachable from outside the existing `localGuard` |
| **Outbound** | **New.** `https://musicbrainz.org` — the first non-Spotify destination |
| **Compute** | None. One Node process, and one that spends its life waiting at 1 req/sec |
| **Storage** | Six tables in the existing SQLite file on the existing `./data` mount |
| **Config** | Eight env vars, plus one gitignored file |

**No new process, no new container, no broker, no external cache.** The queue is in-process and
deliberately non-durable (P-5).

---

## The contact address — `secrets/musicbrainz.json`

**Decision Q1 = B.** NFR-14 requires a `User-Agent` carrying a real contact address; the repository
is public and `compose.yaml` is tracked. The value therefore cannot live in `compose.yaml`.

```json
{
  "contact": "you@example.com",
  "appName": "SpotifyNowPlaying",
  "appVersion": "0.1.0"
}
```

Placed beside the existing credential file, which `.gitignore` already covers:

```
secrets/*
!secrets/spotify-config.example.json
```

**A committed `secrets/musicbrainz.example.json` follows the pattern already established** by
`spotify-config.example.json`, so the shape is discoverable without the value being present.

### Why not `.env`

`.env` is idiomatic Docker, and `node --env-file-if-exists=.env` was **verified working on Node
22.17.0** here — it prints a notice and continues when the file is absent, so it would not have
broken `npm start`. It was rejected for a project-shaped reason rather than a technical one: this
project already has exactly one place where uncommittable things live, and adding a second means
two places to check before publishing. `secrets/` is already gitignored, already bind-mounted, and
already the answer to "where do the things I must not commit go".

### Why not extend `spotify-config.json`

That file is written by `npm run auth` and **rewritten by the MCP server on every token refresh**.
A hand-added field sits in a file a process we do not control overwrites on a schedule. The failure
would be silent and intermittent — the worst combination.

### Fail closed

A missing or contact-less `secrets/musicbrainz.json` is a **startup configuration error**, surfaced
the way missing Spotify credentials already are. It must never fall back to an anonymous or
placeholder `User-Agent`: NFR-14 is a policy we are choosing to honour, and sending unidentified
traffic while believing we are compliant is worse than refusing to start.

---

## Configuration surface

**Decision Q4 = D.** The split is deliberate: **measurement parameters are tunable; compliance
values are not.**

| Setting | Default | Tunable? | Why |
|---|---|---|---|
| `LABEL_TTL_UNKNOWN_DAYS` | `30` | ✅ | Measurement parameter — governs coverage recovery (P-3) |
| `LABEL_TTL_RESOLVED_DAYS` | `90` | ✅ | Measurement parameter — governs change detection (BR-13) |
| `LABEL_BACKFILL_INTERVAL_HOURS` | `6` | ✅ | Operational pacing |
| `LABEL_BACKFILL_BATCH` | `25` | ✅ | Bounds a sweep so a backlog cannot monopolise the queue |
| `MUSICBRAINZ_BASE_URL` | `https://musicbrainz.org/ws/2` | ✅ | **For stubbing in tests** — see below |
| **Request spacing** | 1 req/sec | ❌ **fixed** | NFR-15 is policy. A setting whose only use is to violate it |
| **Retry policy** | 3 attempts, backoff, pause on repeated `503` | ❌ fixed | P-4. Correctness, not preference |
| `MUSICBRAINZ_CONTACT` | — | via `secrets/` | Not an env var (Q1 = B) |

**The TTLs sit beside `COMPLETION_THRESHOLD` for a reason.** U1's threshold being a setting rather
than a constant is the only reason the live-verification finding is actionable — the data can be
reclassified rather than re-collected. The TTLs are the same kind of value: they shape what the
dataset contains, and R2 means they will need revisiting once there is real coverage data.

**A configurable rate limit would be a setting whose only function is non-compliance.** There is no
legitimate value other than 1 req/sec, and exposing it invites someone (including a future us) to
raise it while debugging and forget. It stays a constant in code.

### `MUSICBRAINZ_BASE_URL` exists to make BR-1.2 testable

BR-1.2 requires a regression test against a recording **known to have many releases**, because the
`inc=`-silently-ignored bug produces a response indistinguishable from absent data — a test
asserting "no releases" would pass against the bug. Pointing that test at a fixture stub is more
reliable than depending on MusicBrainz's live catalogue and rate limit in CI.

---

## Networking

**Outbound only, one new host.**

```
                     ┌─────────────────────────────┐
   browser ─────────▶│  app  (127.0.0.1:3000)      │
   (loopback only)   │  localGuard: loopback peer  │
                     └──────┬───────────────┬──────┘
                            │               │
                   api.spotify.com    musicbrainz.org      ← NEW
                     (existing)        1 req/sec, P-1
```

| Property | Value |
|---|---|
| New inbound ports | **None** |
| New listeners | **None** |
| `/api/explain/{playId}` | Behind the **same** `localGuard` as every other route |
| Outbound destination | `musicbrainz.org` only |
| Outbound rate | ≤ 1 req/sec, single queue (P-1) |
| TLS | HTTPS, standard verification. No pinning, no custom CA |

**`localGuard` is untouched by U2.** The trace endpoint adds a route, not exposure — it is a read of
data the machine already holds, behind the control that already exists.

### Container egress — to be verified, not assumed

`compose.yaml` declares no `networks:` block, so the default bridge applies and egress is
unrestricted. That is almost certainly fine. It is nonetheless recorded as a **Build and Test
step** (Q3 = A) rather than an assumption, because this project has drawn wrong conclusions from
documentation four times, and the container has **already produced one silent networking failure**
in exactly this area — `localGuard` and the bridge gateway.

Check: from inside the container, one request to the MusicBrainz endpoint asserting a `200` and the
expected `User-Agent` round-trip.

---

## Storage

**No new infrastructure.** Six tables join the existing `history.db` on the existing `./data` bind
mount (host: `data/`, container: `/data`). Migration 002 is additive and forward-only.

### No retention policy — recorded as a decision

The versioned tables are **append-only and never pruned**:

- **BR-8.7** recomputes verdicts from stored candidates and votes with zero upstream requests
- **BR-12** re-runs the classifier over the same rows to build a trace

**Eviction would break both.** A retention policy here would quietly destroy the two capabilities
the storage exists for, in exchange for space the measurements say is not needed: ~4,000 rows per
quarter, against the ~3,600 rows/day `observation` already absorbs (1,296 rows for 71 plays,
measured 2026-08-31).

### The backup story is unchanged and still matters

`data/` remains the only irreplaceable artefact. FR-56's dated snapshots (`SNAPSHOT_KEEP=14`)
continue to cover the `play` table. **Label data is regenerable** — it can be re-resolved from
MusicBrainz — so it does not change the backup calculus, but the versioned *history* of what was
believed when is not regenerable, since re-resolving today produces today's answer.

---

## Monitoring

**Decision Q5 = A.** `/api/diagnostics` gains a `coverage` block alongside `steps`; the dialog gains
a second section rendering it as a table, beside the resolution trace.

```
GET /api/diagnostics
  { ranAt, ok, steps: [...],
    coverage: {                                    ← new
      asOf, total, resolved, pending,
      unknownByReason: { noIsrc, notFound, noEligibleCandidate, error },
      byReleaseYear: [...] } }
```

**Coverage is a measurement, not a health check**, and the existing renderer only speaks
`ok`/`fail`/`skip`. Rendering a 58% coverage rate as a green tick would present the instrument R2 is
measured with as a verdict about system health. `byReleaseYear` is the field that keeps the recency
bias visible (BR-10.3); a single aggregate would hide it completely.

**`asOf` is required, not decorative.** Under BR-13 the same query run twice can legitimately
differ, so a coverage figure without a timestamp is not interpretable.

NFR-24 — keep diagnostics authoritative as subsystems are added — is satisfied by extension rather
than by a parallel mechanism.

---

## Deployment target

**Decision Q2 = A. `npm start` on the host remains the real deployment.**

`compose.yaml` is kept correct and complete for U2, but the container **still cannot serve its UI**
(open item 1, unchanged since 2026-08-26). U2 does not touch `localGuard` and does not change the
security posture.

**Why the guard was not fixed here even though U2 makes the container more attractive.** U2 is the
first unit that wants a long-running unattended process — scheduled sweeps, TTL re-resolution, the
30-second grace window — and `restart: unless-stopped` is exactly what the container was for. That
makes the container *more* appealing, which is precisely why the change was not bundled in:
relaxing the single control NFR-07's no-authentication decision rests on, inside a unit about label
enrichment, is how a security posture gets changed as a side effect. It stays a standalone decision.

**Consequence to accept honestly:** on the host, the scheduled work runs only while the terminal is
open. Backfill is designed for exactly this (P-5 — the database is the queue of record, and a
startup sweep catches up), so intermittent running degrades *timeliness*, not correctness.
