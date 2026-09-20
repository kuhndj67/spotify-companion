# Infrastructure Design Plan — U4: Rule Observability

**Date**: 2026-09-20 · **Stage**: CONSTRUCTION — Infrastructure Design, Unit U4
**NFR Design**: [`../u4-rule-observability/nfr-design/`](../u4-rule-observability/nfr-design/) — P-19…P-26, LC-13…LC-20
**Precedent**: U3's was *"one file, one mount"*. U4's is smaller still — **no new mount, no new volume, no new port.**

---

## What U4 needs from infrastructure

| | |
|---|---|
| New mounts | **None** — `./config` and `./data` both already exist |
| New ports | **None** — routes are added to the existing server |
| New volumes | **None** — the decision log lives in `history.db` (Q2 = A) |
| Schema | **Migration 005** — decision-log table + two columns on `play` |
| New env | 2–3 values, **Q2 settles which are settings and which are constants** |
| Container rebuild | **Yes** — new code |

---

## Facts established for this plan

### Migrations run automatically, at repository construction

`SqliteHistoryRepository` calls `migrate()` before any write (`SqliteHistoryRepository.ts:188`),
which runs at server startup. **Deploying U4 therefore runs migration 005 unattended** — and
because the container is on Rancher Desktop autostart, that could first happen at a boot nobody is
watching.

Each migration is wrapped in `BEGIN` / `COMMIT` with `ROLLBACK` on failure, so a partial migration
cannot be committed.

### ✅ Rollback to U3's image is safe — verified, not assumed

`migrate()` skips every migration whose `version <= currentVersion(db)`. Against a **v5** database,
U3's image finds nothing to apply, reports `from: 5, to: 5`, and runs normally. The extra table and
the two extra columns are simply unread.

**This matters because it is the actual safety net.** If U4 misbehaves, the recovery is `docker
compose up -d` on the previous image — no data surgery, no down-migration. Forward-only migrations
are safe here *because* 005 is purely additive.

> ⚠️ **That property holds only while migrations stay additive.** A future migration that
> *rewrites* or *drops* would break rollback silently — the old image would start happily against
> data it can no longer interpret.

### ⚠️ A failed migration degrades to display-only — and recording stops while the UI looks fine

`server.ts:42`: *"If … not migrated, `repository` stays null and the app runs display-only
(NFR-13)."* That is correct NFR-13 behaviour and it is **the dangerous shape**: the page loads, the
track displays, the WebSocket connects — and nothing is being recorded. On an unattended autostart
there is nobody to read the startup log. **Q4.**

### ⚠️ `compose.yaml` already anticipates U4, and anticipates it wrongly

The `./config` mount carries this comment:

> *"This becomes `:rw` at U4 when the editor needs to write — a deliberate one-word change, not a
> capability granted early out of habit."*

**U4 has no editor.** The UI is read-only by Application Design Q2 = A, and the reload button
*re-reads* rather than writes. The mount must stay **`:ro`** — but the comment invites the change,
and it is exactly the kind of instruction a later session follows without re-deriving. **Q3.**

A second comment on the same mount states the root-ownership hazard as fact; it was **measured not
to occur on this host** (2026-09-11) and CLAUDE.md was corrected, but `compose.yaml` was not.

---

## Plan

- [ ] Settle migration 005's deployment sequence and backup (Q1)
- [ ] Settle which new values are settings and which are constants (Q2)
- [ ] Settle the `./config` mount mode and correct its comments (Q3)
- [ ] Settle whether display-only degradation must be surfaced (Q4)
- [ ] Write `infrastructure-design.md`

---

## Questions

### Question 1 — Migration 005: how is it deployed?

Migration 004 was preceded by a manual backup — `data/backup-before-migration-004-20260906T231755Z/`
is still there. 005 is additive: `CREATE TABLE` plus two `ALTER TABLE … ADD COLUMN`, both O(1)
metadata operations in SQLite that do not rewrite rows.

- **A** — **Stop the container, back up `data/`, rebuild, start.** Matches the 004 precedent; the
  migration runs on a start you are watching.
- **B** — **Automatic pre-migration backup in code**, whenever a migration is about to apply.
  Removes the need to remember, at the cost of code that copies the irreplaceable file.
- **C** — **No backup.** Additive, transactional, and rollback-safe as verified above.

⚠️ The snapshot scheduler already writes dated exports every 24 h to `data/snapshots`, so there is
*a* recovery path regardless — but it is an export, not a database copy, and it has never been
restored from.

**Recommendation: A.** It matches precedent, costs one command, and puts the migration on a start
somebody is looking at rather than a reboot at 3am.

[Answer]:

---

### Question 2 — Which new values are settings, and which are constants?

The project already splits these deliberately: **measurement parameters** are environment settings
(`COMPLETION_THRESHOLD`, `LABEL_TTL_*`), **bounds and policies** are constants in code
(`MAX_PREDICATE_DEPTH`, `MAX_RULES`, the 1 req/sec spacing).

| Value | Proposed | Why |
|---|---|---|
| `RULES_POLL_INTERVAL_MS` = 5000 | **setting** | Operational cadence, exactly like the existing `POLL_INTERVAL_MS` |
| `ENRICHMENT_WAIT_MS` = 10000 | **setting** | ⭐ A **measurement parameter**, in the `COMPLETION_THRESHOLD` family — it is an admitted guess we expect to tune once `partialData` data exists |
| `DECISION_LOG_CAP` = 100000 | **constant** | A **bound**. *"A limit that can be raised from the environment will be raised at the moment it first refuses something"* |
| Back-test cap = 50000 | **constant** | Same reasoning |

⚠️ `ENRICHMENT_WAIT_MS` is the one that could go either way. It is a bound on waiting, which argues
constant — but it is also **the only number in U4 that we have openly admitted is unmeasured**, and
tuning it is the point of collecting `partialData`. Making it a setting means the tuning loop does
not need a rebuild.

**Recommendation: as tabled.**

[Answer]:

---

### Question 3 — `./config` mount mode

- **A** — **Stays `:ro`.** U4 has no editor; the reload button re-reads. Correct the comment so it
  points at the unit that actually needs `:rw`.
- **B** — Change to `:rw` now, in anticipation.

⚠️ **B grants a write capability nothing uses**, which is precisely what the comment beside the
`musicbrainz.json` mount warns against — *"copying the `rw` out of habit would grant a write
capability with no use."* The mount would be writable for a whole unit before anything writes.

**Recommendation: A**, plus two comment corrections: retarget the `:rw` note away from U4, and
soften the root-ownership claim to match what was measured on 2026-09-11.

[Answer]:

---

### Question 4 — Should display-only degradation be visible?

Today a failed migration or an unopenable database leaves `repository` null: the app serves the
display, records nothing, and says so **only in the startup log**. U4 adds a migration, which adds
an occasion for this to happen unattended.

- **A** — **Surface it in the UI** — a persistent banner: *"History recording is OFF — database
  unavailable."* Plus diagnostics.
- **B** — **Diagnostics only** (`/api/health` and the rules diagnostics module from P-25).
- **C** — Leave as-is; the startup log is enough.

⚠️ **This is the `Label detail` lesson inverted.** There, an empty state that did not explain
itself was nearly deleted as broken. Here, a *broken* state explains itself as normal — which is
worse, because the corpus is what is being lost and seven of the corpus's ten early days exist
only as backfilled rows that cannot be re-fetched.

⚠️ **Scope check**: this is pre-existing behaviour, not something U4 introduces. It is raised here
because U4 raises its likelihood, and fixing it is a few lines. Say if you would rather it were a
backlog item.

**Recommendation: A** — the banner is cheap and the failure it reports is expensive.

[Answer]:

---

## Out of scope

| | Why |
|---|---|
| New container, sidecar, or volume | Nothing here needs one |
| CI changes | The existing Docker-build job covers the new code |
| `:rw` on `./config` | Q3 — U4 has no editor |
| Down-migrations | Forward-only by design; rollback is by image, verified above |
