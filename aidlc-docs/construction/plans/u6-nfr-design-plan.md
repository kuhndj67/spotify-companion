# NFR Design Plan — U6: User-Data Lifecycle

**Date**: 2026-10-07 · **Stage**: CONSTRUCTION — NFR Design, Unit U6
**Status**: ✅ **ALL 10 ANSWERED (2026-10-07), every one A as recommended.** Settled reading §5.1. Deliverables: `nfr-design/nfr-design-patterns.md` (**P-38…P-48**) and `nfr-design/logical-components.md` (**LC-32…LC-39**, **PBT-51…PBT-58**) — ✅ **APPROVED 2026-10-07**. Nothing is designed until they are answered.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: U6 Functional Design (approved 2026-10-07) — `business-rules.md` **BR-44…BR-52**,
`business-logic-model.md`, `domain-entities.md`, `frontend-components.md` · requirements **FR-57…FR-64**,
**NFR-28**, **NFR-29** (bounds the ingest routes) · probes of 2026-10-07 (online backup, restart-on-exit)

**NFR Requirements: SKIPPED**, as for U1–U5 — the execution plan sets it to SKIP for every unit, and U6's
non-functional needs are already in `requirements.md` and the FD's rules (user, 2026-10-07).

> **U6 is the first unit that accepts a file from outside and lets it replace the corpus.** Its NFR bias is
> the FD's: every ingest check is an **allowlist**, every check runs **before** anything irreversible, and
> every irreversible step keeps a way back. **A restore that is refused can be retried. A restore that
> should have been refused cannot be undone** — except by BR-49's one previous database, which is the last
> line, not the plan.

---

## 1. Unit context

| | |
|---|---|
| **Requirements** | FR-57 … FR-64 |
| **NFRs in play** | **NFR-01…04** (local-only — the ingest routes stay behind it), **NFR-05** (credentials never in logs/UI/DB), **NFR-11** (persistence survives rebuilds), **NFR-13** (degrade, never crash), **NFR-20/21** (property tests, logged seeds), **NFR-24** (diagnostics authoritative), **NFR-28** (no credentials in the repo — and none in an archive), **NFR-29** (off-machine access — ⚠️ ingest routes must not be reachable off-machine before it is built, in U9) |
| **Adds** | `src/maintenance/` (backup, staging, startup swap, sweep) · `src/ingest/` (FR-64's one admission path) · `src/backup/` (the verifier, **moved** from `scripts/`) · the Settings pop-up |
| **Allocates** | **P-38 …** · **LC-32 …** · **PBT-51 …** (U5 ended at P-37, LC-31, PBT-50) |
| **Schema** | ⚠️ **None.** A migration here means the design is wrong |

---

## 2. Facts measured for this plan — 2026-10-07

| | |
|---|---|
| Live database | `history.db` **4.5 MB** + `-wal` **4.1 MB** (977+ plays) |
| `backup()` copy → gzip | **5.0 MB → 1.6 MB** (≈3.1×), from the 901-play scratch copy |
| `backup()` duration | **145 ms** under 281 concurrent same-connection writes (probe, 2026-10-07) |
| App start → listening | **0.5 s** (container `StartedAt` 21:02:47.647 → *listening* 21:02:48.162, 2026-10-05) |
| App start → recent plays re-imported | **0.9 s** (`[backfill] 1 inserted, 49 already known`) |
| Docker stop → start overhead | ⚠️ **Not measured** — the live container was not restarted for this |
| `restart: unless-stopped` + `exit(0)` | ✅ restarts (throwaway container, 5× in 20 s) |
| `tar` (npm) | **7.5.22**, licence **BlueOak-1.0.0** (permissive), **5** transitive dependencies, Node ≥ 18 |
| `busboy` (multipart parser) | 1.6.0 — only needed if uploads are multipart (Q3) |
| What the image ships | `dist/` only — **no `scripts/`** (`Dockerfile:64–67`) |
| Scripts already importing `src/` TypeScript | `reclassify`, `reporting:build`, `check:rules-schema` — all via **`node --import tsx`** |
| `localGuard.isAllowedOrigin` | **Admits a missing `Origin`** — BR-46.2 needs ingest routes to be stricter |

### ⚠️ A finding that shapes Q10: the NAS cannot host U6's exit test yet

U6's exit criterion is *"backed up on one machine, restored on another, and the restored app runs."* But a
browser on another machine is **refused by `localGuard`** (loopback `Host` required) until **U9** builds
NFR-29. So *Restore backup* — a browser action — **cannot be performed against the NAS before U9**. The
cross-machine half of the criterion needs a decision (Q10), not an assumption.

---

## 3. What this stage must produce

- `construction/u6-data-lifecycle/nfr-design/nfr-design-patterns.md` — **P-38 …**
- `construction/u6-data-lifecycle/nfr-design/logical-components.md` — **LC-32 …** and the property
  obligations **PBT-51 …**

## 4. Plan

- [ ] Answer Q1–Q10 (§5); resolve any ambiguity with follow-ups before writing
- [ ] Settle the reading in §5.1
- [ ] Allocate patterns P-38… (ingest, archive reading, swap journal, single writer, cleanup)
- [ ] Allocate logical components LC-32… (admission path, archive reader, verifier, maintenance service, startup restorer, sweeper, Settings UI)
- [ ] Allocate property obligations PBT-51…, each with a **negative control** (W-6.3)
- [ ] Record the dependency decision(s) with licence and transitive count
- [ ] Update `HANDOFF.md`, `aidlc-state.md`; log in `audit.md`

---

## 5. Questions

### Question 1 — Security · Tech stack — Which archive library, if any?

BR-45.1 settled *gzip-compressed tar* and named the `tar` package. This confirms the dependency, because it
is the first new **runtime** dependency since U0 (today: `express`, `ws`, the MCP SDK).

A) **`tar`** — maintained by npm's author, used by npm itself; BlueOak-1.0.0 (permissive); 5 transitive deps ⭐ *recommended*

B) **Hand-written minimal tar reader/writer** (~150 lines; tar's format is simple). No dependency — ⚠️ but a hand-rolled parser **of untrusted input**, which is where this class of bug lives

C) A zip library instead (e.g. `yazl`/`yauzl`) — friendlier to double-click on Windows; one or two deps

X) Other (please describe after [Answer]: tag below)

⚠️ BlueOak-1.0.0 is a permissive licence; **its compatibility with GPL-3.0 (NFR-32) will be confirmed** as
part of this stage rather than assumed.

[Answer]:
A
---

### Question 2 — Security — Does the library write files, or does our code?

`tar` has a history of **path-traversal and symlink advisories in its extract-to-disk path** (2021). BR-46
already forbids every shape those exploited — but *how* the archive is read decides whether those rules are
the only defence.

A) **Parse, never extract** — use the library only as a **stream parser**. Our code checks each entry against the allowlist and writes it to a **fixed name we choose** (`history.db`, `manifest.json`, `rules.json`). The library never touches the filesystem ⭐ *recommended*

B) Let the library extract into the work directory, with its `filter` option enforcing the allowlist

X) Other (please describe after [Answer]: tag below)

⚠️ A removes the whole advisory class **structurally**: a symlink or `../` entry has nowhere to land,
because no entry name is ever used as a path (BR-46.5).

[Answer]:
A
---

### Question 3 — Security · Tech stack — How does the upload travel?

A) **The file is the request body** (`Content-Type: application/gzip`, sent with `fetch`). Streamed straight to the work directory with the size cap counted as bytes arrive. **No new dependency** ⭐ *recommended*

B) Multipart form upload, parsed with `busboy` (or `multer`). A second parser of untrusted input, and a dependency

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 4 — Logical components — Where does the moved verifier live, and how do the scripts reach it?

BR-47.1 moves the 8-check verifier from `scripts/restore-history.mjs` into `src/` so the app and the
developer scripts share **one** copy. But the image ships `dist/` only, and the scripts run on the host with
plain `node`.

A) **`src/backup/verifier.ts`**; the `db:*` scripts switch to **`node --import tsx`**, the pattern `reclassify`, `reporting:build` and `check:rules-schema` already use. `npm run smoke` updated so it loads them the same way ⭐ *recommended*

B) Keep the verifier as plain JavaScript (`src/backup/verifier.mjs`) importable by both without `tsx`

C) Scripts import the compiled `dist/` output (requires a build before any script runs)

X) Other (please describe after [Answer]: tag below)

⚠️ Whichever: `npm run smoke` must still pass afterwards — **this unit edits the guard that guards it**.

[Answer]:
A
---

### Question 5 — Resilience — How does the startup swap recover from a crash part-way through?

BR-48.5 is five steps (re-verify → current aside → staged in → clean up → open). Power loss or a kill can
land between any two.

A) **A swap journal**: before each step, write `restore-pending/journal.json` with the step about to run. At startup, the journal says exactly where it stopped, and every step is written so that **re-running it is safe** ⭐ *recommended*

B) Infer the state from which files exist (`previous/` present? `restore-pending/history.db` present?)

X) Other (please describe after [Answer]: tag below)

⚠️ B looks simpler and has an ambiguous state: after step 2, *"`history.db` missing, `previous/` present"*
reads the same whether the swap is half done or the user deleted a file. A journal turns *guess* into *read*.

[Answer]:
A
---

### Question 6 — Performance — Size limits

BR-46.4/46.10 set placeholder caps. Today's archive is **1.6 MB** compressed, **5 MB** expanded.

A) **≈ 40× headroom**: upload **64 MB**, expanded **256 MB**. Diagnostics shows the current size against the cap, so growth is visible long before it binds ⭐ *recommended*

B) Keep the FD's placeholders: upload **256 MB**, expanded **1 GB**

C) Tighter: upload **16 MB**, expanded **64 MB** — ⚠️ the corpus has grown ~30% a week while the app is in active use

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 7 — Availability — What does the UI do while the app restarts to apply a restore?

Measured: the app is listening **0.5 s** after its container starts. Docker's stop/start overhead is **not**
measured.

A) Show *Restarting…*, reconnect as today, and if the app has **not come back within 60 s**, say so plainly — *"The app has not come back. Check that its container is running."* — rather than spinning forever. **Measure the real restart time during Build & Test** ⭐ *recommended*

B) Show *Restarting…* with no timeout

X) Other (please describe after [Answer]: tag below)

⚠️ B repeats the 2026-09-05 shape: a UI sitting on *reconnecting…* indefinitely reads as *Spotify is down*.

[Answer]:
A
---

### Question 8 — Security — Where do the extra ingest checks live?

BR-46.2 (an `Origin` **required**) and BR-46.3 (the custom ingest header) are **stricter** than the app-wide
policy, which admits a missing `Origin`.

A) **A single `ingestGuard` used by every ingest route**, applied **after** `decideAccess` — the app-wide rule stays exactly as it is, and the stricter rule is written once ⭐ *recommended*

B) Add an *ingest* flag to `decideAccess` itself

X) Other (please describe after [Answer]: tag below)

⚠️ B touches the one function the WebSocket incident taught this project to change least; and the
WebSocket never ingests, so the flag would exist for one caller. A keeps `localGuard.test.ts`'s structural
pin untouched.

[Answer]:
A
---

### Question 9 — Testing — Property obligations and negative controls

Proposed PBT-51… (each ships with a **negative control** proving it can fail — W-6.3):

| | Property | Negative control |
|---|---|---|
| a | For **any** generated archive, nothing is ever written outside the work directory | An archive containing `../x`, an absolute path, a symlink and a hard link — all refused |
| b | Any entry not on the allowlist refuses the **whole** archive | A valid backup plus one extra file → refused |
| c | `backup → restore` round-trips: counts and sha256 identical | A one-row deletion → `mismatch` |
| d | The verifier refuses any database containing a trigger or view | A real backup with one `CREATE TRIGGER` added → refused |
| e | Killing the startup swap **at every step** leaves an app that starts on a database that passes `integrity_check`, and never an empty one | A swap with the journal deleted mid-way → still recovers |
| f | Credentials and `state/` never appear in an archive, whatever files exist | A `secrets/` and `state/` file planted beside `config/` → absent from the archive |

A) **All six** ⭐ *recommended*

B) A subset (name which after [Answer]:)

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 10 — Verification — How is "restored on another machine" proven before U9 exists?

See §2's finding: until U9, a browser on another machine is refused, so the NAS cannot run *Restore backup*.

A) **Split the criterion.** U6 proves it on **a second installation on this machine** (a separate Compose project, own `data/`, own port, empty corpus): backup from the live app → restore into the second → it runs with the same counts. The **cross-machine** half moves to **U9's exit criteria**, where the NAS deployment restores the real corpus ⭐ *recommended*

B) Use **another physical machine** you own now, with Docker and a local browser (which one?)

C) Hold U6 open until U9 can run it

X) Other (please describe after [Answer]: tag below)

⚠️ A's second installation must have its **own Spotify registration or be stopped before it polls** — two
deployments polling one registration is the U9-b question.

[Answer]: A — *recorded from the user's reply in conversation, 2026-10-07: "Agree with splitting the test to allow it to be locally checked at U6 and then remotely checked with U9."*

---

## 5.1 Settled — the specification the deliverables were written from

| Q | Settled | Pattern / component |
|---|---|---|
| 1 | `tar` 7.5.22 — **BlueOak-1.0.0**, which its publisher (Blue Oak Council) states can be combined and distributed with GPLv3 software; OSI-approved 2024. **Compatible with NFR-32** — confirmed, as Q1 required | P-39 |
| 2 | **Parse, never extract** — our code writes fixed names; no archive name is ever a path | P-39, LC-33 |
| 3 | **The body is the file** — raw `application/gzip` body, cap counted while streaming; no multipart parser | P-41 |
| 4 | Verifier → `src/backup/`; `db:*` scripts run with `node --import tsx`; `smoke` updated | LC-34 |
| 5 | **Journal** before each swap step; every step idempotent | P-43, LC-37 |
| 6 | Caps **64 MB** upload / **256 MB** expanded; headroom shown in Diagnostics | P-46 |
| 7 | *Restarting…* with a **60 s** *not back* message; restart time measured in Build & Test | P-47 |
| 8 | A separate **`ingestGuard`** after `decideAccess`; `decideAccess` untouched | P-42, LC-32 |
| 9 | All six properties, each with a negative control (+ PBT-57/58 for the guard and the cap) | PBT-51…58 |
| 10 | Exit test **split**: second installation on this machine in U6; the NAS in U9 | P-48 |

> ⚠️ The candidate list below was renumbered in the deliverable: the plan's P-38…P-44 became **P-38…P-48**
> (four patterns added: P-41 body-is-the-file, P-46 headroom, P-47 restart, P-48 split verification).

## 6. Candidate patterns, for `nfr-design-patterns.md`

| | Candidate |
|---|---|
| P-38 | **One writer does maintenance** — backup on the app's own connection; restore applied before the database opens. Never a second process (supersedes the script-side writer-guard for the user path) |
| P-39 | **Parse, never extract** (if Q2 = A) — untrusted names are never paths |
| P-40 | **Validate fully, then act** — ingest and apply are separate steps; nothing outside the work directory changes until a verified file is confirmed |
| P-41 | **Journal before each irreversible step** (if Q5 = A) — recovery reads, never guesses |
| P-42 | **Stricter guard composed after the general one** (if Q8 = A) — the app-wide rule stays untouched |
| P-43 | **Cleanup is a property of every path** — `finally` plus a startup sweep; a crash leaves nothing that survives the next start except an applicable, journaled restore |
| P-44 | **Allowlist what travels** — archive contents and ingest entries are named, never filtered by exclusion |

## 7. Out of scope for U6 NFR Design

| | Why |
|---|---|
| Off-machine reachability of the ingest routes | **NFR-29, U9** |
| Rules / credentials ingest | **U7** — it reuses this unit's admission path |
| Scheduled or off-site backups | **W-9** |
| The developer `data/backup-*` facility's behaviour | Unchanged, beyond importing the moved verifier (Q4) |
