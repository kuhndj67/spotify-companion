# Build and Test Summary — U1

**Date**: 2026-08-26 · **Stage**: CONSTRUCTION — Build and Test

---

## Build status

| | |
|---|---|
| **Build tool** | npm + tsc (Node 22.17.0) |
| **Typecheck** | ✅ clean, `src` and `test` |
| **Compile** | ✅ clean → `dist/` |
| **Container image** | ✅ `spotify-now-playing:0.1.0` — **after two fixes** |

---

## Test execution

### Unit and property tests

| | |
|---|---|
| **Total** | **193** |
| **Passed** | **193** |
| **Failed** | 0 |
| **Coverage** | **99.41% line · 93.00% branch** |
| **Status** | ✅ Pass |

Grew from 100 → 193 across U1. Property tests cover P-1 … P-11 plus the purity check.

### Integration tests

| | |
|---|---|
| **Automated scenarios** | 9, all passing |
| **Container deployment** | ✅ verified (build, mount, migration, backfill, privilege drop) |
| **Live playback recording** | ⏳ **not verified — nothing was playing** |
| **Status** | ⚠️ Pass with one item outstanding |

### Performance tests

**Not applicable, deliberately.** One user, one process, ~200 plays/day, ~200 write transactions/day.
There is no load to test. The single performance constraint — history work must never delay the
display — is structural (batched writes, streamed export, degraded mode) rather than something a
load test would reveal.

### Security tests

| | |
|---|---|
| **Access control** | ✅ Host/Origin/DNS-rebinding rejected, host and container |
| **Credential handling** | ✅ absent from exports, database, logs |
| **U1 exposure change** | ✅ none — download rides the existing listener |
| **Status** | ⚠️ Pass, with one **open decision** (below) |

---

## Findings

### 1. ✅ Fixed — the R7 SHA pin broke the container build

`git clone --depth 1 --branch "$MCP_SERVER_REF"` fails with exit 128 on a commit SHA; `--branch`
accepts only branch and tag names. **Pinning the ref to close R7 broke the build in the same
change.**

Fixed: `git init` + `git fetch --depth 1 origin <ref>` + `git checkout FETCH_HEAD`, which handles
a SHA, branch or tag identically and keeps the shallow depth.

> **Nearly missed.** The build ran as `docker compose build 2>&1 | tail -25`, so the reported exit
> code was `tail`'s, not the build's — it read as success. The failure was visible only in the log
> text. Recorded in the build instructions.

### 2. ✅ Fixed — the bind mount was unwritable by the container user

The image ran as `node` (uid 1000); the Windows bind mount arrived root-owned `755`. Result:
`History: DISABLED — unable to open database file`.

**This is exactly the failure the infrastructure design named as most likely**, and it is why
startup probes writability instead of assuming it — the app degraded to display-only and said so,
rather than failing later at the first play boundary.

Fixed: `scripts/docker-entrypoint.sh` starts as root, `chown`s only the mount points, then drops
to `node` via `setpriv`. Verified afterwards: `/data` owned `1000:1000`; PID 1 is
`node dist/server.js` running as Uid 1000; the app is not running as root.

### 3. ⚠️ **OPEN — the local-only guard rejects all published-port traffic**

**Pre-existing (U0). Blocks containerised deployment. Not fixed here.**

`localGuard` requires a loopback peer address. Traffic reaching a container through a published
port arrives from the Docker bridge gateway, so every request is refused.

Proven both directions: the same `/api/health` request **succeeds from inside the container**
(`{"status":"ok","mcp":"connected","toolCount":30}`) and is **refused from the host** via the
published port.

**The containerised deployment has never been able to serve its UI.** The app is healthy; only the
guard blocks it, and it fails closed.

Not fixed because any change relaxes the single control the no-authentication decision rests on —
a posture question for the user, consistent with how §3.5 route C and wishlist W-1 were handled.
Options and the argument on each side are in `security-test-instructions.md`.

**Works today**: `npm start` on the host, where the peer address genuinely is loopback.

### 4. ✅ Fixed — an integration test modelled the sparse stream wrongly

The first version fed the "change-suppressed" observer a first *and last* sample and passed for
the wrong reason. A real change-suppressed stream yields roughly one sample at track start, since
`signature()` excludes progress. Corrected, and the corrected test now demonstrates the actual
defect: a fully played track would be recorded as `unknown`.

Second instance in this unit of a test modelling an impossible state and looking green.

---

## Overall status

| | |
|---|---|
| **Build** | ✅ Success |
| **Unit tests** | ✅ 193/193 |
| **Integration** | ⚠️ Pass; live playback recording outstanding |
| **Security** | ⚠️ Pass; one open decision blocking container use |
| **Ready for Operations** | **No — U1 is one of five units.** U2–U5 remain |

---

## Outstanding

| # | Item | Owner |
|---|---|---|
| 1 | **Verify live playback recording** — the 8 manual scenarios. Needs music playing | Next session with playback |
| 2 | **Decide on the container guard** (option A/B/C) | User |
| 3 | Backfilled plays carry no ISRC — `recently-played` returns no `external_ids` | U2 design |
| 4 | R11 queue lookahead during playback | U5 |

**Nothing blocks starting U2.** Items 1 and 2 concern deployment and verification, not the
correctness of what U1 built — and U1 runs correctly on the host today.
