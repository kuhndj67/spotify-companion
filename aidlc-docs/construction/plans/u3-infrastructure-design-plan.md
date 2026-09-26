# Infrastructure Design Plan — U3: Rule Model & Evaluation

**Date**: 2026-09-10 · **Stage**: CONSTRUCTION — Infrastructure Design, Unit U3
**Functional design**: [`../u3-rule-model/functional-design/`](../u3-rule-model/functional-design/) (approved 2026-09-10)
**NFR design**: [`../u3-rule-model/nfr-design/`](../u3-rule-model/nfr-design/) (approved 2026-09-10)

U3 has **one** logical component that touches infrastructure: **LC-11 `RuleStore`**, which reads
`config/rules.json`. Everything else is a pure function in an already-running process.

This stage exists to answer a narrow set of questions properly rather than to invent deployment
surface.

---

## Categories evaluated and found not applicable

Justified explicitly rather than skipped silently, as the stage requires.

| Category | Applicability | Why |
|---|---|---|
| **Deployment environment** | ❌ Settled | Rancher Desktop, one container, `compose.yaml`. Closed as open item 1 on 2026-09-05 and reboot-proven. U3 adds no target |
| **Compute** | ❌ None | U3 is function calls inside the existing process. No sizing, no scaling, no new service |
| **Messaging / queues** | ❌ None | Evaluation is synchronous. The only queue in the project is MusicBrainz's 1 req/sec, which is U2's |
| **Networking** | ❌ None | No port, no route, no listener. `127.0.0.1:3010` and the `LOCAL_ONLY` / `TRUST_PUBLISHED_PORT` posture are untouched |
| **Monitoring** | ⚠️ Minimal | One new log line: the rules-file load result. `Decision` rendering is **U4** |
| **Shared infrastructure / multi-tenancy** | ❌ None | Single user, single process, single container |
| **Storage** | ✅ Applies | One new file, one new mount → **Q1–Q5** |

---

## Plan

- [x] Decide the mount mode for rule state (Q1)
- [x] Decide directory-vs-file mount, against the atomic-rename gotcha (Q2)
- [x] Decide missing-file vs invalid-file semantics (Q3)
- [x] Decide whether rule state is tracked in git (Q4)
- [x] Decide the rules-file size bound left open by NFR Q1 (Q5)
- [x] Write `infrastructure-design.md` — mounts, env vars, failure behaviour
- [x] Write the `compose.yaml` and `.gitignore` changes the decisions imply

---

## Questions

### Question 1 — Read-only or read-write mount at U3?

**Nothing in U3 writes rules.** There is no UI; `RuleStore` has `load()` and `current()` and
`watch()` was deferred to U4. This repo already has an explicit convention for exactly this
situation, in `compose.yaml`:

> *"Mounted **READ-ONLY**, unlike the Spotify config above: nothing rewrites this file, and copying
> the `rw` out of habit would grant a write capability with no use."*

A) **`:ro` at U3, changed to `:rw` at U4** when the UI writes rules. Tightest posture, matches the
   existing convention exactly, and the U4 change is a one-word compose edit made deliberately

B) **`:rw` now**, so U4 needs no infrastructure change. Grants a capability nothing uses, which is
   the habit the `musicbrainz.json` comment exists to warn against

C) `:ro` permanently — rules are only ever hand-edited on the host, and the U4 UI reads and
   validates but never writes. A real option, and it makes the UI a rule *viewer*

**[Answer]:**
A
---

### Question 2 — Mount the directory or the file?

`compose.yaml` already carries a hard-won warning about this distinction for `data/`:

> *"The **DIRECTORY** is mounted, not the file. SQLite's `-wal` and `-shm` siblings must live
> beside the database or crash recovery breaks — copying the single-file secrets mount pattern
> above would be a subtle and hard-to-diagnose mistake."*

The rules file has a different but related trap. **A single-file bind mount binds an inode.** The
safe way to write a config file is write-temp-then-rename, which replaces the inode — and through a
single-file bind mount that rename either fails or silently detaches the container's view from the
host file. It works in testing, because reading works, and breaks the first time U4 saves.

A) **Mount the directory** `./config:/config`. Atomic rename works, editor backup files land
   harmlessly, and U4 needs no change. Costs one directory that holds one file today

B) **Mount the file** `./config/rules.json:/config/rules.json`. Tighter surface — the container
   sees exactly one file — but forecloses atomic writes at U4 unless it is changed then

C) Mount the file read-only now and switch to a directory at U4, accepting the change then

⚠️ This trap is invisible at U3 because U3 only reads. It becomes real at U4, which is the worst
time to discover it.

**[Answer]:**
A
---

### Question 3 — Is a missing rules file an error?

On a fresh install `config/rules.json` will not exist. **"No file" and "bad file" are two facts**,
and the app's behaviour is identical either way — no rules — while the *reason* is completely
different.

If they are merged, every fresh install logs a loud error about a malformed rules file that was
never written, which trains the user to ignore the message that matters.

A) **Missing is normal and quiet**: *"no rules file at /config/rules.json — no rules active"* at
   info level. **Invalid is loud**: an error naming the parse failure. Same outcome, different
   report

B) Missing is an error too — surfaces misconfiguration such as a mount that silently failed

C) Missing causes the app to **write** a default empty rules file, so the file always exists.
   Requires `:rw` (Q1) and means the app creates state on the host without being asked

⚠️ This is the `unknown`-is-two-facts pattern in a new place. Note that B has a real argument: a
mount typo produces a missing file, and quiet is exactly wrong for that. A names the path in the
message so a typo is still diagnosable.

**[Answer]:**
C
---

### Question 4 — Is `config/rules.json` tracked in git?

⚠️ **CORRECTED 2026-09-26 — the premise below was false, and the decision it supported still
stands.** This said *"**This repository is public** — `compose.yaml` says so"*. The repository is
**private** (`gh repo view` -> `"visibility": "PRIVATE"`), and `compose.yaml` was simply asserting
it; **this doc then cited that assertion as the authority**, which is how one unverified claim
became the stated basis for a decision in three documents. The reason that actually holds is that
`config/` is **user-authored data rather than project configuration**, which does not depend on
visibility. Kept as written below for the history.

Rules are not credentials, but they are a fairly direct statement of musical taste and of which
artists the user wants filtered out. `data/` is gitignored; `secrets/*` is gitignored with
committed `*.example.json` templates.

A) **Gitignore `config/`, commit `config/rules.example.json`** — follows the `secrets/` convention
   exactly. Rules stay private, and a new checkout has a working template

B) **Track `config/rules.json`** — rules are project configuration, version history is useful, and
   losing them costs retyping. But they publish listening preferences to a public repo

C) Gitignore `config/`, no example file — the format is documented in the design artifacts

⚠️ Per this project's working rule — *"when a design decision is a security-posture question,
surface it rather than deciding it"* — this is surfaced rather than assumed. The exposure is mild
and it is a real one.

**[Answer]:**
A
---

### Question 5 — What bounds the rules file?

NFR Q1 bounded predicate **depth** at 32 and left file **size** to this stage. `RuleStore` reads
the whole file into memory and parses it. There is no attacker here, but there is a text editor, a
runaway generator, and a `cat` into the wrong path.

A) **Bound the file at 1 MB and the rule count at 1000**, both named constants; over either, the
   load fails as a structural error and the app runs with no rules (BR-20.7). Generous by four
   orders of magnitude against any real rule set

B) **Bound the file size only** — the rule count is implied by it

C) **No bound.** A local single-user app reading a file the user wrote is not a threat model, and
   an unreadable file already fails safely

⚠️ Note that A's failure mode is *fail-inert*, which is the same direction as every other rule-file
failure: no rules, said loudly. It does not add a new behaviour, only a new trigger.

**[Answer]:**
A
---

## After the answers

Ambiguities get follow-ups. Then `infrastructure-design.md`, plus the concrete `compose.yaml` and
`.gitignore` changes — written as a diff to apply at Code Generation, not applied here.

---

# Follow-up — round 2

**Answers received 2026-09-10**: Q1 **A** · Q2 **A** · Q3 **C** · Q4 **A** · Q5 **A**.

Four of the five compose cleanly. **Q1 = A and Q3 = C cannot both hold**, and option C's own text
said so — *"Requires `:rw` (Q1)"*.

---

### FQ1 — `:ro` mount vs the app writing a default rules file

| Chosen | Says |
|---|---|
| **Q1 = A** | `config/` is mounted **`:ro`** at U3, becoming `:rw` at U4 |
| **Q3 = C** | When no rules file exists, **the app writes** a default empty one |

On a read-only mount the write fails with `EROFS`. The app would attempt it on **every** startup of
a fresh install, fail, and log an error — which is precisely the noisy-on-fresh-install outcome
Q3 was trying to avoid, arriving by a different route.

The intent behind C is clear and worth preserving: **the file should always exist, so it is
discoverable and editable without the user having to know the filename.** These options all deliver
that; they differ in *who* creates it.

A) **Keep `:ro` (Q1 = A). A setup step creates the file, not the app.** `config/rules.json` is
   created from the committed `rules.example.json` by an explicit `npm run rules:init` — the same
   shape as `npm run auth` creating `secrets/spotify-config.json`. The app **never** writes, the
   read-only posture holds unchanged through U3, and a missing file is reported quietly by path
   (Q3 = A's reporting). *Most consistent with everything else already decided.*

B) **Change Q1 to `:rw` now.** The app self-heals a missing file exactly as Q3 = C describes. Costs
   the write capability U3 has no other use for — the habit `compose.yaml`'s `musicbrainz.json`
   comment exists to warn against — and means the app creates host state unasked.

C) **Keep `:ro`, and seed the file at image build / entrypoint** rather than from the app's rule
   loader. Still a write to a read-only mount, so this only works if the seeding happens on the
   **host** side before the mount — in practice this collapses into A.

D) **Keep `:ro`, drop the auto-create (Q3 → A).** Missing is normal and quiet, naming the path;
   the user creates the file when they want rules. Simplest; gives up the discoverability C wanted.

**[Answer]:**
A — **taken by recommendation, not by explicit answer.** The user replied *"continue"* with the
tag left blank on 2026-09-10; option A was the stated recommendation. Recorded this way so it is
visible as an assumption rather than a decision, and it is a one-line reversal if wrong.

