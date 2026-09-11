# Infrastructure Design — U3: Rule Model & Evaluation

**Date**: 2026-09-10 · **Stage**: CONSTRUCTION — Infrastructure Design, U3
**Plan**: [`../../plans/u3-infrastructure-design-plan.md`](../../plans/u3-infrastructure-design-plan.md)
**Answers**: Q1 **A** `:ro` · Q2 **A** directory mount · Q3 **C** → resolved by **FQ1 A** ·
Q4 **A** gitignored with example · Q5 **A** bounded

U3 adds **one file and one mount**. Nothing else about the deployment changes: the container, the
port binding, the access posture, the database mount and the snapshot schedule are untouched.

---

## Decisions

| # | Decision | Source |
|---|---|---|
| 1 | Rule state lives at `config/rules.json` — **its own directory, never `data/`** | NFR Q2 = B (P-15) |
| 2 | Mounted `./config:/config` — **the directory**, not the file | Q2 = A |
| 3 | Mounted **`:ro`** at U3. Becomes `:rw` at U4 when the UI writes | Q1 = A |
| 4 | **The app never creates the file.** `npm run rules:init` does, on the host | FQ1 = A |
| 5 | Missing file is **quiet and normal**; invalid file is **loud** | Q3 reporting, FQ1 = A |
| 6 | `config/` is gitignored; `config/rules.example.json` is committed | Q4 = A |
| 7 | File bounded at **1 MB**; rule count bounded at **1000** | Q5 = A |

---

## ⚠️ How Q3 = C was resolved, and why it is recorded rather than silently dropped

Q3 = C asked the app to **write** a default rules file when none exists. Q1 = A mounts `config/`
**read-only**. Option C's own text flagged the dependency — *"Requires `:rw` (Q1)"* — and on a
read-only mount that write fails with `EROFS` at **every** startup of a fresh install, logging an
error on each one. That is the noisy-fresh-install outcome Q3 existed to prevent, reached by a
different route.

**FQ1 = A preserves C's intent — the file should always exist and be discoverable — by moving the
creation off the app and onto an explicit setup step**, exactly as `npm run auth` creates
`secrets/spotify-config.json`. The app never writes a byte; the read-only posture holds unchanged
through U3.

> ⚠️ **FQ1 was answered by recommendation, not explicitly.** The user replied *"continue"* with the
> tag blank on 2026-09-10, and A was the stated recommendation. Recorded as an assumption rather
> than a decision. Reversing it to B is a one-word compose change (`:ro` → `:rw`) plus restoring
> the auto-create in `RuleStore`.

---

## Mount

```yaml
    volumes:
      # -- U3: rule definitions -------------------------------------------------
      #
      # The DIRECTORY is mounted, not the file — the same distinction as ./data above, for a
      # different reason. A single-file bind mount binds an INODE, and the safe way to write a
      # config file is write-temp-then-rename, which replaces the inode. Through a single-file
      # mount that rename either fails or silently detaches the container's view from the host
      # file. U3 only reads, so the bug would be invisible here and would surface the first time
      # the U4 UI saves.
      #
      # READ-ONLY, like ./secrets/musicbrainz.json and unlike ./data: nothing in U3 writes rules.
      # `npm run rules:init` creates the file on the host; the app never does. This becomes :rw
      # at U4, when the rule editor needs to write — as a deliberate one-word change, not a
      # capability granted early out of habit.
      #
      # NOT under ./data on purpose. That directory holds history.db, the one artefact here that
      # cannot be regenerated. Rules are user-authored text that costs retyping. Keeping the
      # hand-edited file out of the directory nobody should hand-edit is the whole point.
      - ./config:/config:ro
```

### Environment

```yaml
      # -- U3: rule definitions -------------------------------------------------
      RULES_PATH: /config/rules.json
```

Only the path is configurable. **The bounds are not settings**: `MAX_RULES_FILE_BYTES` (1 MB),
`MAX_RULES` (1000) and `MAX_PREDICATE_DEPTH` (32) are constants in code, following the precedent
set by the MusicBrainz request spacing —

> *"There is no legitimate value other than one per second, so a knob here would exist only to
> violate the policy — most likely while debugging, and then forgotten."*

The same applies here. A depth limit that can be raised from the environment is a depth limit that
will be raised from the environment at the moment it first refuses something, which is the moment
it is doing its job.

---

## Failure behaviour

Every row ends in the same place — **no rules, and the app keeps recording** — and they differ only
in how they are reported. That is the point: a rules engine that cannot read its rules skips
nothing (P-14), and a bad rules file never costs a play record (BR-20.10).

| Condition | Level | Message shape | Rules active |
|---|---|---|---|
| File absent | **info** | `no rules file at /config/rules.json — no rules active` | none |
| Directory absent (mount failed) | **warn** | names the path, distinguishes it from an absent file | none |
| Unreadable (permissions) | **error** | names the path and the errno | none |
| Larger than 1 MB | **error** | reports actual size against the bound | none |
| More than 1000 rules | **error** | reports actual count against the bound | none |
| Invalid JSON | **error** | reports the parse position | none |
| Structurally invalid (BR-20.3/20.4) | **error** | names the first failure and the rule index | none |
| Semantically invalid (BR-20.5) | **warn** | per-rule, names `reason` and `detail` | **the valid rules** |

> ### The first two rows are the reason Q3 mattered
>
> **An absent file and an absent directory are different facts.** A missing file on a fresh install
> is normal; a missing directory means the mount did not happen, and quiet would be exactly wrong
> for that. Both name the path, so a typo is diagnosable either way.
>
> This is the `unknown`-is-two-facts pattern in its infrastructure clothes.

⚠️ **Only the last row leaves rules active**, and that is BR-20.5 working as designed: a semantic
failure disables one rule, a structural failure rejects the set. **Never a partial structural
load** (BR-20.6).

---

## Host-side setup

```jsonc
// config/rules.example.json — committed
{
  "version": 1,
  "rules": []
}
```

```json
"scripts": {
  "rules:init": "node scripts/rules-init.mjs"
}
```

`scripts/rules-init.mjs` copies the example to `config/rules.json` if and only if it does not
already exist, and **refuses to overwrite**. It creates `config/` first.

> ### Creating `config/` before the first `compose up` is not optional
>
> Docker creates a missing bind-mount source directory itself, **owned by root**. The container
> entrypoint drops privileges to `node`, so a root-owned `config/` can leave the app unable to read
> its own rules — with a permissions error that looks like a code fault.
>
> `rules:init` creating the directory as the invoking user avoids it. This is why the setup step
> earns its place rather than being a line in the README.

### `.gitignore`

```gitignore
# Rule definitions (U3). User-authored, and a fairly direct statement of listening
# preference — this repository is public. Same shape as secrets/: the directory is
# ignored, the example template is committed.
config/*
!config/rules.example.json
```

---

## What changes at U4, and what does not

| | U3 | U4 |
|---|---|---|
| Mount mode | `:ro` | **`:rw`** — the editor writes |
| Mount target | `./config:/config` | unchanged — Q2 = A already accommodates atomic rename |
| `RuleStore` | `load()`, `current()` | **`watch()` added**, with debounce and one retry |
| BR-20.8 last-known-good on reload | unreachable — no reload | **becomes reachable** |
| Half-written-file race | absent — nothing watches | **U4's to design** |

**Three of five rows are no-ops** because Q2 = A and the deferral decisions were taken with U4 in
view. The one real change is the mount mode, which is a deliberate one-word edit at the point the
capability is first needed.

---

## Categories not applicable

Recorded rather than skipped: deployment environment (settled 2026-09-05, reboot-proven), compute
(no new process), messaging (evaluation is synchronous), networking (no port, no route — the
`127.0.0.1:3010` binding and `LOCAL_ONLY` / `TRUST_PUBLISHED_PORT` posture are untouched), shared
infrastructure and multi-tenancy (single user, single container).

**Monitoring is one log line** — the rules-file load result, per the table above. Rendering
`Decision` values is U4's.

---

## Changes to apply at Code Generation

Written here, applied there. Nothing in this document has been applied to the running deployment.

1. `compose.yaml` — add the `./config:/config:ro` volume and `RULES_PATH` env var, with the
   comments above
2. `.gitignore` — add the `config/*` block
3. `config/rules.example.json` — new, committed
4. `scripts/rules-init.mjs` — new
5. `package.json` — add the `rules:init` script

⚠️ **The container must not be rebuilt to pick up a rules change.** `config/` is a bind mount, so
editing `rules.json` on the host changes what the container reads. At U3 a restart is needed for
the app to *re-read* it, because `watch()` is U4's — that is a known limitation of this stage, not
a defect.
