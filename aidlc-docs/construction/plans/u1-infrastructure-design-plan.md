# Infrastructure Design Plan — U1: Listening History & Export

**Date**: 2026-08-25 · **Stage**: CONSTRUCTION — Infrastructure Design, Unit U1

---

## Scope

Marked **EXECUTE (narrow)** in the execution plan. U1 adds exactly one infrastructure concern:
**somewhere durable for the database to live**.

### Categories evaluated

| Category | Applicability |
|---|---|
| **Deployment environment** | **Settled.** Rancher Desktop, Docker Compose, single container (Q3 = A). No cloud provider is involved — this runs on one laptop |
| **Compute** | **Settled.** One Node process in one container. No sizing or scaling decision exists |
| **Storage** | **The live question.** Where the SQLite file lives, and how it survives a rebuild |
| **Messaging** | **Not applicable.** In-process events only; no queue, broker, or async infrastructure |
| **Networking** | **No change.** Download-only export adds no listener, no port, no exposure. `127.0.0.1` binding stands |
| **Monitoring** | **Existing mechanism extended.** The diagnostics endpoint gains steps; no observability stack is introduced for a single-user local tool |
| **Shared infrastructure** | **Not applicable.** Single tenant, single deployable |

Also in scope: **R7**, pinning `MCP_SERVER_REF`, which the execution plan assigned to this stage.

---

## Questions

### Question 3 — Where does the database live?

The container needs a path that survives `compose up --build`. NFR-11 requires a rebuild never to
destroy history.

A) **Bind mount to `./data/`** in the project directory — the file is directly visible on the host.
   Easy to copy, back up, or open in a SQLite browser. Consistent with how `secrets/` is already
   mounted. Must be gitignored

B) **Named Docker volume** — managed by the container runtime, isolated from the project tree.
   Tidier, but the file is awkward to reach for backup or inspection, especially under Rancher
   Desktop

C) **Bind mount to a path outside the project** (e.g. a documents folder) — separates irreplaceable
   data from the code tree entirely, so deleting or re-cloning the repo cannot touch it

X) Other (please describe after [Answer]: tag below)

[Answer]: A — bind mount to `./data/`, gitignored.

---

### Question 4 — Backups

This is worth raising explicitly rather than assuming.

**Listening history is the only artefact in this project that cannot be regenerated.** Code can be
rewritten, enrichment re-fetched, labels re-resolved. Months of play records cannot. A deleted
volume, a corrupted file, or an `rm -rf` in the project directory ends the dataset the whole
project exists to build.

A) **Out of scope for U1** — rely on the export download (US-25) as the manual backup mechanism.
   The user exports when they think of it

B) **Automatic periodic export to the data directory** — the app writes a dated CSV/JSON snapshot
   on a schedule, so a backup exists without anyone remembering to make one

C) **Document a backup procedure**, implement nothing — the design records what to copy and how,
   and the user runs it

X) Other (please describe after [Answer]: tag below)

[Answer]: B — automatic periodic export to the data directory.

**Answer analysis**: both unambiguous. Q4 = B introduces capability not covered by FR-49–54, which
describe user-initiated export only. Recorded as **FR-56** rather than smuggled in as an
implementation detail.

---

## Recommendations

- **Q3 = A.** Directness matters more than tidiness for data you will want to inspect, copy and
  point analysis tools at. It also matches the existing `secrets/` bind mount, so there is one
  convention rather than two. C is genuinely safer against an accidental repo deletion, but adds a
  machine-specific absolute path to `compose.yaml` — worth it only if that risk feels real.
- **Q4 = B.** A relies on remembering, and the failure mode is discovering months later that
  nothing was ever exported. The mechanism already exists — export is being built in this very
  unit — so scheduling it is small work for the one asset that cannot be reconstructed.

---

## R7 — Pin `MCP_SERVER_REF`

`compose.yaml` currently builds the MCP server from `main`, unpinned. Upstream declares no
license and no release tags, so `main` can move and change the `getNowPlaying` output the parser
depends on.

**Resolved 2026-08-25.** Current `main` head:

```
7b5fde6309a52a7874768c63deda7880ee85935b   (2026-08-21)
"fix: add offset param to getMyPlaylists (#72)"
```

**Action**: set `MCP_SERVER_REF: 7b5fde6309a52a7874768c63deda7880ee85935b` in `compose.yaml`.
Closes R7. The CI Docker-build job then becomes a genuine drift detector — it builds a known
commit, so a failure means our change broke, not that upstream moved underneath us.

---

## Execution Checklist

- [x] Confirm answers; analyse for ambiguity
- [x] Generate `infrastructure-design/infrastructure-design.md`
- [x] Generate `infrastructure-design/deployment-architecture.md`
- [x] Specify the `compose.yaml` changes
- [x] Confirm no networking or exposure change
- [x] Record the R7 pinning action
- [x] Update `aidlc-state.md`; log in `audit.md`
