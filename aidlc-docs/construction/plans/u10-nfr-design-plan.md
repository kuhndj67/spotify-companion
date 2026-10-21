# NFR Design Plan — U10: Data Safety

**Date**: 2026-10-22 · **Stage**: CONSTRUCTION — NFR Design, Unit U10
**Status**: Q1 A · Q2 A · Q3 X with follow-ups Q3a–c (2026-10-22). ✅ **ALL ANSWERED.** Deliverables: `nfr-design/nfr-design-patterns.md` (**P-76…P-87**), `nfr-design/logical-components.md` (**LC-69…LC-80**, **PBT-79…PBT-89**).
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: U10 Functional Design (**approved 2026-10-22**): `business-rules.md` **BR-78…BR-86**,
`business-logic-model.md`, `domain-entities.md`, `frontend-components.md` · requirements **FR-76…81** · NFR-01…07
(local-only), NFR-13 (degrade, never crash), NFR-14 (MusicBrainz contact), NFR-20/21 (property tests, seeds logged)

**NFR Requirements: SKIPPED**, as for U1–U9.

> **U10's non-functional risk is a guard that believes it works.** The lock, the backup-before-change and the
> snapshot diagnostics all exist because an earlier guard was green for the wrong reason (`docker ps` blind to a host
> run; diagnostics `ok` for 18 days with nothing written). The bias of every pattern below: **each guard is seen to
> fail on a bad input, and each failure is visible where the user looks, not only where a developer looks.**

---

## 1. Unit context

| | |
|---|---|
| **Allocates** | **P-76 …** · **LC-69 …** · **PBT-79 …** (U9 ended at P-75, LC-68, PBT-78) |
| **Schema** | **v7 → v8**: one table for the last app version (BR-79.4). The first U10 start is therefore itself a migration, backed up by BR-79 |
| **Scalability** | **Not applicable, with reason**: one user, one database per deployment. The only growth is the kept-backup store, bounded by rotation (Q2 covers the disk) |
| **Performance** | One kept backup at startup when a change is due, plus one a day. No latency target beyond the existing health check (start period 10 s, three 30 s retries) |

## 2. Facts measured for this plan — 2026-10-22

| | |
|---|---|
| **Backup size** | `gzip` of a copy of `data/history.db` → **3.0 MB**. A lower bound for an archive: the WAL beside it holds a further **4.1 MB** of pages that a self-contained copy folds in. So ≈ 3–5 MB each today; 19 kept ≈ 60–100 MB, growing with plays |
| **Free space** | `D:` 1.0 TB free. A NAS or a small VM may have far less (U11) |
| **Write routes are already cross-site safe** | `decideAccess` refuses any request whose `Origin` is present and not loopback (`src/localGuard.ts:141`), on every route. `PUT /api/update-check` and `POST /api/backups` inherit it; no new mechanism |
| **Scripts share `src/`** | Writing scripts run under `tsx` and already import `src/backup/*.ts` (`scripts/backup-history.mjs:51`), so one lock module serves the app and the scripts. `restore-history.mjs` imports the `docker ps` guard from `backup-history.mjs`: that is the guard BR-78.7 replaces |
| **Host development runs** | `npm start` (`dist/server.js`) **and** `npm run dev` (`tsx watch`, restarts on every file change). Both are host runs, so both get `data-dev/` (BR-84) and take the lock; `dev`'s restarts must release it on the way out (BR-78.6) |
| **Stop grace** | Docker's default: SIGTERM, then SIGKILL after 10 s. A SIGKILL leaves the lock behind, which is what BR-78.3's watch exists for |

## 3. Patterns already implied by the FD (stated here, not asked)

- **Pure core, thin shell** (as U6–U9): every ⚙️ decision in BR-78…86 is a pure function with a property test; the
  file and network code around it is a few lines. Candidates: the lock verdict from two observations; backup due
  (79.1); rotation's delete list (80.4); scheduled due (81.1); backup health level (81.2); `decideUpdate` and the
  one-line rewrite that preserves every other byte (83.2–83.3); the newest-release choice (85.5); the release-page URL
  acceptance (85.6).
- **Positive controls**, each a test that must be seen to fail: a held lock refuses each writing script (78.7); a
  kept backup restores through the upload path (80.1); the update request carries no contact address with one
  configured (85.4); `/releases/latest` is never the URL (85.3); diagnostics is never `ok` with no backup (81.2).
- **Bounded outbound call**: the update check has a timeout, a response-size cap, follows redirects only within
  `api.github.com`, sends no credentials, and parses only four fields (85.6).
- **Write by temporary file and rename** in a **directory** mount for every new file (`state/update-check.json`, the
  kept backups, `update`'s `compose.yaml`). U9 measured that rename fails on a single-file mount; none of these is one.
- **One version comparison**: `compareSemVer` moves from `scripts/lib/releaseDecision.ts` to `src/` so the app, the
  image's `update` and the release script share it.
- **Logged, not silent**: every lock event (acquired, refused, taken over, lost, released) and every kept backup
  (kind, reason, size, duration, rotation) is one log line.
- **Recovery after a refusal is a restart** (FD): opening history mid-run would mean rewiring every observer after
  startup. The indicator says *restart the app once the other process has stopped*.

---

## 4. Questions

### Q1 — Resilience — The lock's timings

The stale window is how long a starting process watches a lock before taking it over. It is also how long recording
can be delayed after an unclean stop (a SIGKILL, a crash). The heartbeat must fire several times inside it, so a
briefly slow holder is never mistaken for a dead one.

| | Option |
|---|---|
| **A** | ⭐ **Heartbeat 5 s, stale window 30 s** (six missed heartbeats). An orderly restart (`docker compose up -d`, a release) releases the lock and waits for nothing; only an unclean stop costs up to 30 s, inside the health check's tolerance |
| **B** | **Heartbeat 2 s, stale window 10 s**. Faster after a crash; five missed heartbeats on a busy disk or a paused VM would be read as death |
| **C** | **Heartbeat 15 s, stale window 120 s**. Most tolerant of a slow host; a crash costs two minutes of plays, and the container may be marked unhealthy first |

[Answer]: **A** (owner, 2026-10-22, question prompt).

---

### Q2 — Resilience — Free disk space before a kept backup

A backup is written in `data/`, on the same disk as the live database. Filling that disk would break the database's
own writes, which is worse than a missing backup.

| | Option |
|---|---|
| **A** | ⭐ **Check first**: before each kept backup, require free space of at least **twice the database's size (with its WAL) plus 100 MB**. Short → a scheduled backup is skipped and diagnostics **fail** (*not enough disk space*); a before-change backup counts as failed, so BR-79.3 refuses the change. Nothing is deleted to make room |
| **B** | **No check**: the write fails when the disk is full, which already fails safe (built in `data/.work/`, verified before it counts). The disk reaches full before anything says so |

[Answer]: **A** (owner, 2026-10-22, question prompt).

---

### Q3 — Resilience / visibility — Where stopped backups show

The live defect went unnoticed for 18 days because the only signal was inside a diagnostics run nobody had reason to
open. The FD puts backup health in diagnostics and Settings (BR-81.2, 86.4).

| | Option |
|---|---|
| **A** | ⭐ **Also on the status bar, only when something is wrong**: a *Backups* indicator appears at **warn** or **fail** (glyph, label and detail as every indicator), and is absent while backups are healthy. The primary screen stays clean in the normal case |
| **B** | **Diagnostics and Settings only**, as the FD has it |

[Answer]: **X** (owner, 2026-10-22, question prompt): *"To keep the main screen clean (we're going to simplify it quite a bit when we get to UX/UI unit) lets include a "Status" indicator light/text with "check diagnostics page" as the pop up text. also maybe we should promote "Diagnostics" to a button between settings and rules?"*

Follow-ups (question prompt, same day), all the recommended option: **Q3a** the Status indicator reacts to U10's conditions now (backups stopped or failed, the lock held by another process, a failed before-change backup), built so later units add sources; whether today's five indicators fold into it is the UX/UI unit's decision. **Q3b** always visible: a light **and** text when healthy, and the pop-up *Check the Diagnostics page* at warn or fail. **Q3c** Diagnostics becomes a header button, **Settings · Diagnostics · Rules**, in U10, amending **FR-63** (same pop-up, same ids). Recorded in the FD (`frontend-components.md` §3a, BR-86.5–86.6).

---

## 5. Plan — after the answers

- [x] Collect answers; follow-ups if anything is ambiguous
- [x] `construction/u10-data-safety/nfr-design/nfr-design-patterns.md`: P-76… (the patterns above, the answers)
- [x] `…/nfr-design/logical-components.md`: LC-69… (writer lock, kept-backup store, backup scheduler, startup
      sequence, `update`, update checker, shared SemVer) and PBT-79… (the property obligations)
- [ ] `HANDOFF.md`, `aidlc-state.md`, `audit.md`; completion message; owner approval
