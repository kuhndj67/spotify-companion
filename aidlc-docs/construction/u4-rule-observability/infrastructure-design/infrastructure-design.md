# Infrastructure Design — U4: Rule Observability

**Date**: 2026-09-20 · **Stage**: CONSTRUCTION — Infrastructure Design, U4
**Answers**: Q1 **A** · Q2 **as tabled** · Q3 **A** · Q4 **A** (status bar — see
[`../functional-design/frontend-components.md`](../functional-design/frontend-components.md))

> **U4 adds no infrastructure.** No mount, no volume, no port, no container. It adds one migration
> and three environment values. U3's was *"one file, one mount"*; U4's is *"one migration, no
> mount"*.

---

## 1. Migration 005

```sql
CREATE TABLE decision_log (...);          -- LC-13
CREATE INDEX idx_decision_decided_at ...; -- the retention and listing path
CREATE INDEX idx_decision_evaluation ...; -- grouping the rows of one decision
CREATE INDEX idx_decision_play ...;       -- back-fill and the agreement join
ALTER TABLE play ADD COLUMN explicit   INTEGER;   -- BR-31.2
ALTER TABLE play ADD COLUMN album_type TEXT;      -- BR-31.2
```

**Purely additive.** `ALTER TABLE … ADD COLUMN` with no default is an O(1) metadata operation in
SQLite — no row rewrite, regardless of corpus size. The whole migration is one `BEGIN`/`COMMIT`
with `ROLLBACK` on failure, so a partial 005 cannot be committed.

### Deployment sequence *(Q1 = A)*

```bash
docker compose down                 # stop the writer first
cp -r data/ data/backup-before-migration-005-<ts>/
docker compose build                # check the exit code directly, NOT through a pipe
docker compose up -d
docker logs spotify-now-playing | head -40    # confirm "migrated 5: ..."
```

⚠️ **Check the build's exit code directly.** `docker compose build | tail` reports the *pipe's*
status, and a failing build has read as success here once before.

⚠️ **`docker compose down` first is not optional.** Two writers on one SQLite file is the standing
hazard, and a migration is the worst moment for it.

### ✅ Rollback is by image, and it is safe — verified

`migrate()` skips every migration whose `version <= currentVersion(db)`. U3's image against a v5
database finds nothing to apply, reports `from: 5, to: 5`, and runs normally; the new table and
columns are simply unread.

> ⚠️ **This holds only while migrations stay additive.** A future migration that rewrites or drops
> would break rollback **silently** — the old image would start happily against data it can no
> longer interpret. Any non-additive migration must retire this guarantee explicitly.

---

## 2. Environment *(Q2 = as tabled)*

The project's existing split is preserved: **measurement parameters are settings; bounds are
constants.**

```yaml
      # -- U4: rule observability -----------------------------------------------
      RULES_POLL_INTERVAL_MS: 5000
      ENRICHMENT_WAIT_MS: 10000
```

| Value | Where | Why |
|---|---|---|
| `RULES_POLL_INTERVAL_MS` | **compose** | Operational cadence, exactly like `POLL_INTERVAL_MS` |
| `ENRICHMENT_WAIT_MS` | **compose** | ⭐ A measurement parameter in the `COMPLETION_THRESHOLD` family |
| `DECISION_LOG_CAP` = 100 000 | **constant** | A bound |
| Back-test cap = 50 000 | **constant** | A bound |

⚠️ **`ENRICHMENT_WAIT_MS` is a setting for one specific reason**, and the compose comment must say
it: it is **the only number in U4 openly admitted to be unmeasured**. The enrichment latency it
waits on has never been measured, and the figure that appeared to measure it — 0.2 s — was
`resolvedAt` stamped *before* the MusicBrainz calls. `partialData` will produce the real number,
and tuning against it should not need a rebuild.

⚠️ **`DECISION_LOG_CAP` stays a constant** for the reason already in `compose.yaml`: *"a limit that
can be raised from the environment will be raised at the moment it first refuses something — which
is the moment it is doing its job."*

---

## 3. Mounts — unchanged, and one comment corrected *(Q3 = A)*

| Mount | Mode | Change |
|---|---|---|
| `./data:/data` | `rw` | **none** — the decision log lives in `history.db` |
| `./config:/config` | **`ro`** | **none** — U4 has no editor |
| `./secrets/…` | as-is | **none** |

**`./config` stays read-only.** The reload button (P-19) *re-reads*; nothing in U4 writes rules.
Granting `:rw` a unit early is exactly what the `musicbrainz.json` comment warns against —
*"copying the `rw` out of habit would grant a write capability with no use."*

### Two comment corrections to apply at code generation

1. **Retarget the `:rw` anticipation.** The mount currently says *"this becomes `:rw` at U4 when
   the editor needs to write"*. **U4 has no editor.** Left as-is, it is an instruction a later
   session follows without re-deriving — and it would grant the capability for a whole unit before
   anything uses it. Retarget to *the unit that adds rule editing*.
2. **Soften the root-ownership claim.** The comment states as fact that Docker creates a
   missing bind-mount source owned by root, leaving the app unable to read its rules. **Measured
   2026-09-11: it does not happen on this host** — Rancher Desktop synthesises `rwxrwxrwx
   root:root` regardless. The hazard is real on a Linux host. CLAUDE.md was corrected then;
   `compose.yaml` was not. *An untested justification repeated confidently is how a wrong reason
   outlives the decision it justified.*

---

## 4. Deployment-health visibility *(Q4 = A)*

A failed migration or an unopenable database leaves `repository` null: the app serves the display,
connects its WebSocket, shows the track — **and records nothing**, saying so only in the startup
log. With autostart, there is nobody reading that log.

**This is the `Label detail` lesson inverted.** There, an empty state that did not explain itself
was nearly deleted as broken. Here a *broken* state explains itself as normal — worse, because what
is being lost is the corpus, and seven of its ten early days exist only as backfilled rows that
cannot be re-fetched.

U4 therefore surfaces deployment health in the UI, as a **compact status bar** rather than a
one-off banner. The full component design is in
[`frontend-components.md`](../functional-design/frontend-components.md); the infrastructure-facing
part is what it must be able to report:

| Indicator | Sourced from |
|---|---|
| **Recording** | `repository !== null` — the migration/database outcome |
| **Rules** | `LoadedRuleSet.state` + version (P-19, BR-26) |
| **Connection** | WebSocket readyState — replaces today's standalone "Disconnected" text |
| **Spotify** | `/api/health` — a real MCP round-trip |

⚠️ **Scope**: the recording indicator fixes pre-existing behaviour U4 did not introduce. It is in
scope because U4 adds a migration, which adds the occasion, and because the status bar is the right
home for the rules indicator you already asked for — three separate one-off indicators would have
been the alternative.

---

## 5. What is deliberately unchanged

| | Why |
|---|---|
| Port, binding, `LOCAL_ONLY`, `TRUST_PUBLISHED_PORT` | U4 adds no network surface. Routes sit behind the existing guard in `api.ts` |
| **No new WebSocket surface** | Deliberate. The upgrade handler is the one place admission must be invoked explicitly, and `localGuard.test.ts` pins it structurally. The decision log reads over HTTP |
| `MCP_SERVER_REF` pin | R7 stays closed |
| Snapshot scheduler | Unchanged. ⚠️ It exports `play`; whether it should also export decisions is a **U5 question**, not one to settle by habit here |
| CI | The existing Docker-build job covers the new code |

---

## 6. Post-deploy verification

Beyond the suite, after `compose up -d`:

```bash
docker logs spotify-now-playing | head -40          # "migrated 5: ..." exactly once
curl -s localhost:3010/api/health                    # real MCP round-trip
curl -s localhost:3010/api/rules | head              # version, state, rule statuses
curl -i -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Origin: http://evil.example" localhost:3010/ws   # still 403
```

Then `scripts/post-boot-check.ps1` on the next reboot — it is the cheapest way to re-check the
autostart chain, and the WebSocket handshake probe it gained in September is the part that matters,
because a `200` on `/` does not imply the live display works.

⚠️ **Confirm `integrity_check: ok` and the row count before and after**, as U3's deployment did
(428 rows before and after). A migration is exactly when that check earns its keep.
