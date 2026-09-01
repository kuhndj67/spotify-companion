# Integration Test Instructions

**Date**: 2026-08-26 · **Stage**: CONSTRUCTION — Build and Test

---

## Purpose

Unit tests prove each component in isolation. These prove the pieces fit:

```
tick stream → PlayObserver → outcomeClassifier → SqliteHistoryRepository → ExportService
```

Automated integration tests live in `test/historyIntegration.test.ts` and run in CI. Manual
scenarios below cover what cannot be automated: a live account and a real container.

---

## Automated — `test/historyIntegration.test.ts`

```bash
npm test
```

| Scenario | Asserts |
|---|---|
| A listening session end to end | Completion, skip and interruption recorded correctly in one run |
| Trail retention | Stored trail length matches `observationCount`; verdicts recomputable (FR-20) |
| **Change-suppressed stream** | A completed track would be recorded as `unknown` — proves why the observer must consume `tick` |
| Recording → export | Exported rows match what was recorded; `unknown` visible |
| Incremental export | `since` returns only newer plays (FR-52) |
| JSON export | Parses; carries coverage and `exported_count` |
| Empty history | Well-formed output rather than an error |
| Restart | History survives reopening; migration does not re-run (NFR-11) |
| Shutdown flush | In-progress play stored as `unknown`, not lost |

### The one worth understanding

**"a change-suppressed stream would record a completed track as SKIPPED"** encodes why the
`tick`/`change` distinction matters. `signature()` covers trackId, isPlaying, device, volume,
shuffle, repeat and enrichment arrival — deliberately **not** progress. A track played start to
finish with no other state change emits `change` essentially once, at the start, so the observer's
last sample would sit near progress 0 and a full listen would score as nothing.

The first version of this test modelled the sparse stream wrongly (first *and last* sample) and
passed for the wrong reason. Worth remembering: a test that models an impossible state proves
nothing while looking green.

---

## Manual — live playback recording ⏳ **NOT YET VERIFIED**

Cannot be automated; requires music actually playing. **Still outstanding.**

**Setup**: app running, Spotify playing on any device.

| # | Steps | Expected |
|---|---|---|
| 1 | Let a track play to the end | `outcome = completed`, ratio ≥ 0.90 |
| 2 | Skip a track ~20 s in | `outcome = skipped`, `skip_source = user` |
| 3 | Pause mid-track, leave until the device idles | `outcome = unknown`, `saw_pause = true` |
| 4 | Rewind mid-track, keep listening | One record; `rewound = true`; ratio raised |
| 5 | Replay a track immediately | **One** record, ratio ≈ 2.0 — not two records |
| 6 | Seek forward, then let it finish | Listened time not inflated past wall-clock |
| 7 | Restart the app mid-track | Play stored as `unknown`, `close_reason = app-shutdown` |
| 8 | Export and inspect | Every play present; `unknown` rendered as the token |

**Verify with**:
```bash
curl -s 'http://127.0.0.1:3000/api/history/coverage'
curl -s 'http://127.0.0.1:3000/api/history/export?format=csv' | head -20
```

---

## Manual — container deployment ✅ **VERIFIED 2026-08-26**

```bash
docker compose build
docker compose up -d
docker compose logs -f
```

| Check | Result |
|---|---|
| Image builds with the pinned SHA | ✅ after the Dockerfile fetch fix |
| Migration runs on a fresh mount | ✅ `schema v1` |
| **Bind mount writable** | ✅ after the entrypoint fix; `/data` owned `1000:1000` |
| Host `./data` populated from inside the container | ✅ `history.db`, `-wal`, `-shm`, `snapshots/` |
| App runs unprivileged | ✅ PID 1 = `node dist/server.js`, Uid 1000 |
| Backfill against the live account | ✅ 50 plays inserted |
| MCP subprocess connects | ✅ 30 tools |
| **UI reachable from the host** | ❌ **BLOCKED — see below** |

### ⚠️ Blocking defect: the local-only guard rejects all published-port traffic

**Pre-existing (U0), surfaced here because the container was exercised for the first time.**

`localGuard` requires `req.socket.remoteAddress` to be loopback. Traffic reaching a container
through a published port arrives from the **Docker bridge gateway**, not `127.0.0.1`, so every
request is refused with *"This application only accepts local connections."*

Proven both ways:

```bash
# From inside the container — true loopback — succeeds:
docker exec <c> node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"
# -> {"status":"ok","mcp":"connected","toolCount":30}

# From the host via the published port — refused:
curl http://127.0.0.1:3100/api/health
# -> This application only accepts local connections.
```

**The containerised deployment has therefore never been able to serve its UI.** The app itself is
healthy; only the guard blocks it. It fails closed, which is the safe direction.

`compose.yaml` records the original assumption — *"LOCAL_ONLY rejects anything non-loopback that
arrives anyway"* — which turns out to reject the legitimate path too.

**Not fixed here**: the change touches the single control the no-authentication decision (NFR-07)
rests on, so it belongs to the user, not to this stage. See `security-test-instructions.md` for
the options.

**Workaround today**: run on the host with `npm start`, where the peer address genuinely is
loopback and the guard behaves as designed.

---

## U2 — live MusicBrainz  ✅ **VERIFIED 2026-09-01**

Run against the real service with the shipped code, over the 19 distinct ISRCs actually in
`history.db`. Full results in [`u2-build-and-test-summary.md`](u2-build-and-test-summary.md).

### BR-1.2 — the chain must stay two calls

```bash
# Any recording KNOWN to have many releases. A "no releases" assertion would pass against the
# inc=-silently-ignored bug, so the fixture must be one where the answer cannot be zero.
curl -s -A "SpotifyNowPlaying/0.1.0 ( you@example.com )" \
  "https://musicbrainz.org/ws/2/isrc/USSM10211587?fmt=json"      # -> recording id
curl -s -A "SpotifyNowPlaying/0.1.0 ( you@example.com )" \
  "https://musicbrainz.org/ws/2/release?recording=<id>&inc=labels&limit=100&fmt=json"
```

**Result**: 44 releases for Audioslave, 50 for Slipknot. ✅

### Rate limiting

**Result**: 0.46 req/sec measured; 0 throttles **after** bounded retry was added. Before it, 6 of
19 tracks took a `503` at 1200 ms spacing — wider than the policy floor. ⚠️ **Do not assume 1
req/sec spacing alone is sufficient; the retry is load-bearing.**

### End-to-end through the running app

```bash
npm start
# watch: "Labels: SpotifyNowPlaying/0.1.0 ( … )" then "[labels] startup sweep: N resolved"
curl -s localhost:3000/api/diagnostics | jq '.coverage'
curl -s localhost:3000/api/explain/<playId> | jq '.release.summary'
```

**Result**: 13 resolutions, 15 artist resolutions, 0 errors, 3 contested, **8 plays where the
release and artist verdicts legitimately disagree**. ✅

### Container egress ✅ **VERIFIED 2026-09-01**

```bash
docker run --rm --network bridge curlimages/curl -s -o /dev/null -w "%{http_code}\n" \
  -A "SpotifyNowPlaying/0.1.0 ( you@example.com )" \
  "https://musicbrainz.org/ws/2/isrc/USSM10211587?fmt=json"
```

**Result**: `HTTP 200 in 0.373s`. No `networks:` configuration needed. ✅

### ⏳ Still owed — liked-status capture

The saved-track set loads (600 tracks cached), but **no play has closed during a session with
labels enabled**, so the 30-second grace window has never fired against real listening and no
`liked_transition` has been written. Verify by playing a track to completion with `npm start`
running, then:

```sql
SELECT liked_at_start, liked_at_end, liked_added_at, liked_transition
FROM play ORDER BY started_at DESC LIMIT 5;
```

`NULL` must never appear as `0` — an unavailable saved-track set records `unknown`, not a choice.

---

## Cleanup

```bash
docker compose down
rm -rf data/          # only if you want to discard collected history
```
