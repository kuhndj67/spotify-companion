# U4 Handoff — read this before starting Code Generation

**Written 2026-09-20**, at the design/code boundary. Everything committed and pushed; working tree
clean; no code written; schema still **v4**; container healthy and recording on the U3 image.

> **Where we are**: U4's three design stages are **complete and awaiting approval** — Functional
> Design, NFR Design, Infrastructure Design. **Next stage is Code Generation**, which is the
> largest single chunk of this unit.

---

## Read in this order

1. `CLAUDE.md` — the invariants
2. `aidlc-docs/aidlc-state.md` — authoritative state
3. `audit.md` — the last ~6 entries cover all of U4
4. `u4-rule-observability/functional-design/` — BR-22…BR-32, plus `frontend-components.md`
5. `u4-rule-observability/nfr-design/` — P-19…P-26, LC-13…LC-20, PBT-21…PBT-30
6. `u4-rule-observability/infrastructure-design/`
7. The three plans in `construction/plans/u4-*` — **these carry the Q&A trail and the reasoning
   that did not survive into the artifacts**

---

## ⚠️ The five things most likely to be got wrong

### 1. Two decisions were taken BY RECOMMENDATION and modify explicit user answers

**FQ1** (evaluate at first-enrichment + 10 s cap, not at track start) and **FQ3** (`partialData`
means the wait timed out). The user answered *"ok commit and continue"* rather than answering them
individually.

**They are one decision wearing two numbers. If either is reversed, both revert together** —
reverting FQ1 makes FQ3's `partialData` meaningless. Flagged in the plan, the state doc and
`audit.md` as the first thing to revisit at approval.

### 2. `fs.watch` DOES NOT WORK here — and BR-26.1 was written before that was known

Probed 2026-09-20: **0 events in 12 s** over the Rancher Desktop bind mount, for both an in-place
write and a rename, **while the container read the new content within 1 s**. `watch()` registers,
throws nothing, and never calls back.

BR-26.1 and `business-logic-model.md` §4 have been **marked superseded** rather than silently
rewritten. The mechanism is **polling** (P-19): `stat` every 5 s, hash only when `mtime`/`size`
move, plus a reload button. **Both enter the same `load()`** — re-implementing it is the WebSocket
`403` shape.

⚠️ **A unit test of a watcher on a normal filesystem proves nothing.** The defect exists only over
the bind mount, which is the only place the app runs.

### 3. `ENRICHMENT_WAIT_MS = 10 000` is an admitted guess, and it has a measured blind spot

The enrichment latency it waits on **has never been measured**. The number that looked like it
measured it (0.2 s) was `resolvedAt` stamped *before* the MusicBrainz calls — initiation, not
completion.

Plays that **end** before the cap produce **no decision row at all**: measured **2.8% of plays**
and **4 of 31 skips**. Bounded and accepted — but anything counting decisions must use its own
denominator, not the play count. **At 15 s the blind spot grows to 3.5% / 5 of 31.**

`partialData` counts how often the cap fires. **That is the first real measurement of this number**
and the main thing to collect in live verification.

### 4. PBT-22 is the only thing that will ever catch the point-in-time decision

BR-27.2 (history counts computed over plays strictly *before* the row) has **no observable failure
mode**. As-of-now counts produce plausible numbers today and diverge only over months.

The property: take a report, insert plays dated **after** the range, take it again. Point-in-time
is stable; as-of-now moves. **Do not weaken this into "back-test twice in a row" — that passes
under both implementations.**

### 5. U3's containment guarantee retires HERE, on purpose

U3's was *"`git status src/` shows only `src/rules/`"*. Code Generation necessarily changes the
poll loop, `api.ts`, the schema and the UI. **From this unit the phase boundary rests entirely on
`src/playback/` not existing** (BR-30.3) — a weaker guard, stated rather than discovered.

⚠️ **`LoggingExecutor` takes no playback collaborator — not unused, not optional, not null.** An
injected-but-uncalled one reduces the boundary to one line of restraint.

---

## Code Generation scope

| Area | What |
|---|---|
| `src/rules/` | `EvaluationCoordinator`, `LoggingExecutor`, `DecisionLogRepository` + SQLite impl, `RuleSetWatcher`, `factReconstructor` ⚙️, `BackTestService`, `decisionTrace` ⚙️, `rulesDiagnostics` ⚙️ |
| `src/history/migrations.ts` | **Migration 005** — `decision_log` + indexes, `play.explicit`, `play.album_type` |
| `src/api.ts` | `GET /api/rules`, `GET /api/decisions`, `POST /api/backtest`, `POST /api/rules/reload` |
| `src/nowPlayingService.ts` | Wire the coordinator to **`tick`** |
| `public/app.js` + `src/` helpers | Status bar, rules panel, decision-log table. ⚠️ **State derivation goes in `src/` as tested pure functions** |
| `compose.yaml` | Two env values; **two comment corrections** (see below) |
| `test/` | PBT-21…PBT-30, plus extend `purity.test.ts` to the new pure modules |

### The two compose comment corrections

1. The `./config` mount says *"this becomes `:rw` at U4 when the editor needs to write."* **U4 has
   no editor** — it stays `:ro`. Retarget the comment at the unit that adds editing.
2. The same mount states the root-ownership hazard as fact. **Measured 2026-09-11 not to occur on
   this host.** CLAUDE.md was corrected; `compose.yaml` was not.

### Deployment (Q1 = A)

```bash
docker compose down            # two writers on one SQLite file is the standing hazard
cp -r data/ data/backup-before-migration-005-<ts>/
docker compose build           # check the exit code DIRECTLY, not through a pipe
docker compose up -d
docker logs spotify-now-playing | head -40      # "migrated 5: ..." exactly once
```

Rollback is by image and is **verified safe** — `migrate()` skips anything ≤ current version, so
U3's image ignores the new table and columns. ⚠️ **Only while migrations stay additive.**

---

## Three exit criteria that CI cannot close

1. **The dry-run agreement gate** — a real session whose match log the user agrees with
2. **The `partialData` rate** — whether the 10 s wait is right
3. **BR-20.8's last-known-good path** — specified since U3 and **never once run**. Exercise it by
   deliberately breaking `rules.json` and confirming 🔴 names the version still in force

---

## Open, not blocking

- **Fable design review** — deferred by the user, still available. Now is the cheapest moment: the
  complete design set exists and no code depends on it yet.
- **W-3** (session-end discriminator) — backlog; would change the outcome variable back-testing
  compares against
- **Open item 4** (crossfade confound) and **open item 7** (playback context) — unchanged
