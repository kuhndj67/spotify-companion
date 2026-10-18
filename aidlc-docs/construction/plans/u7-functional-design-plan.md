# U7 Functional Design Plan — Configuration Management

**Date**: 2026-10-08 · **Stage**: CONSTRUCTION — Functional Design, Unit **U7** (Phase 5)
**Status**: 📋 **PLAN — all questions answered 2026-10-08 (incl. Q4a A, Q7a A). ▶ Requirements round open: Questions 19–19a in `requirement-verification-questions.md`.**
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: `unit-of-work.md` §U7 · U6 FD settled reading ([`u6-functional-design-plan.md` §10](u6-functional-design-plan.md),
items 1, 9, 10) and T1–T3 · requirements **FR-64** (one admission path), **NFR-28**, **NFR-29** · U6 as built
(`src/ingest/`, `ingestGuard`, the Settings pop-up)

> **U7 makes the app able to change its own configuration.** On an appliance (U9's NAS) the user cannot edit
> files on the host, so rules and credentials must be manageable from inside the app. ⚠️ That reverses a
> deliberate posture: Infrastructure Q1 (U5) made `config/` read-only to the app *so no route could overwrite the
> hand-authored rules*. U7 makes the app a legitimate writer — so every write must be at least as safe as the
> hand edit it replaces.

---

## 1. Unit context

| | |
|---|---|
| **Phase** | 5 — *Share* · build order **U6 → U7 → U8 → U9** |
| **Settled already** (U6 FD) | Rules: **download/upload now, a built-in editor later** (T2 = C), validated by U3's validator before any write · Credentials: **write-only fields for non-OAuth values + upload of the `spotify-config.json` that `npm run auth` produces**, run where the browser is (T3 = A); in-app OAuth needs TLS → **W-10** · Restore may **offer** to apply a backup's `rules.json` once U7 exists (§10.9) · Every ingest goes through **FR-64's** path (§10.10) |
| **Reuses** | `ingestGuard`, `admitIngest`, the ingest caps (`rules.json` **256 KB**, credentials **16 KB** — BR-46.4), the Settings pop-up, `MaintenanceService`'s restart path |
| **Gates** | **U8** (the install routine documents U7's steps) and **U9** (an appliance is unusable without it) |
| **Requirements** | ⚠️ **None yet.** See §4 — they go through Requirements Analysis before this FD is approved, the order U6 had to correct |

---

## 2. Facts measured for this plan — 2026-10-08

| | |
|---|---|
| Rules loading | `RuleStore` reads `config/rules.json`; `RuleSetWatcher` polls every **5 s**. A file that **fails** validation is rejected and the **last-known-good** set stays in force (BR-20.8); a file that **disappears** on reload is rejected too (BR-26.3a — the write-temp-then-rename race) |
| ⚠️ The gap BR-20.8 leaves | A file truncated to **valid-but-empty** JSON *passes* validation and silently drops every rule — the reason `config/` was made `:ro` |
| `config/` mount | **Directory** mount, `:ro` (`compose.yaml`). A directory mount is what lets write-temp-then-rename work |
| Spotify credentials | `secrets/spotify-config.json`, a **single-file `:rw`** mount. ⚠️ The MCP server **rewrites it in place** (`writeFileSync`, `.mcp-server/src/utils.ts:47`) at a path **hard-coded** beside its build (`/opt/spotify-mcp/spotify-config.json`) — so it cannot simply become a directory mount |
| MusicBrainz contact | `secrets/musicbrainz.json`, single-file **`:ro`**. The app **refuses to start** without it (NFR-14) |
| ⚠️ **NEW DEFECT — broken credentials read as "nothing playing"** | The MCP server returns a failed `getNowPlaying` as **plain text** — `"Error getting current track: …"` — **without `isError`** (`.mcp-server/src/read.ts:283–291`). The app parses it, finds no *Currently Playing*, and reports **"Spotify: ok. The last poll succeeded."** with the card **PAUSED**. **Observed live** on U6's credential-less verification copy (2026-10-08). ⚠️ **It also means metric M4 ("share of polls returning nothing playing") counts auth failures as idle** — so the outage heartbeat the project relies on cannot see a credential outage. This is the project's own trap: *absent data reading as a fact*. ⚠️ **CORRECTED 2026-10-08 (FD, source read)**: the error text is **not** parsed as *nothing playing* — it becomes a snapshot with every field null and `playing: true`, so M4 counts it as a **playing** poll and the MCP call as `ok`; and separately a *thrown* MCP error **is** counted idle. *"Counted as idle"* was inferred, not read. See FD `business-rules.md` §0 F5–F6 |

---

## 3. Questions

### Q1 — ⭐ Where do app-written rules live?

| | Option |
|---|---|
| **A** | ⭐ **`config/` becomes `:rw`; one file stays the single source of truth.** Every app write: validate with U3's validator → write a temp file → rename (the directory mount makes this atomic) → keep **one** `rules.previous.json` |
| **B** | A new `./rules:rw` mount for app-written rules, `config/` stays `:ro` for hand-authored ones | ⚠️ **two** rule files — which wins? A precedence rule is a second place the answer lives |
| **C** | Rules in `state/` | ⛔ **Rejected already** (U5 Infra Q1): *"a kill switch in the same writable directory as the file an agent edits is a kill switch that agent can disable"* |

⚠️ A's cost, stated rather than discovered: **the app can now overwrite `rules.json`**. What makes that acceptable is
Q2's guards — not the mount.

[Answer]:
A
---

### Q2 — What may a rules write never do?

BR-20.8 protects against a **malformed** file, not a **valid-but-wrong** one. Proposed guards on every app write:

| | Guard |
|---|---|
| a | Validated by U3's `validateRuleSet` **before** anything is written; a refusal names the rule and the field |
| b | ⚠️ **An upload that removes every rule, or more than half of them, needs the typed confirmation** — the valid-but-empty case |
| c | **Optimistic concurrency**: the download carries a content hash; an upload based on an older version than the file now on disk is **refused** (someone — a hand edit, another tab — changed it since) |
| d | `rules.previous.json` kept, with *Undo last rules change* (same one-level undo as U6) |
| e | The automation switch is **untouched** — a rules upload never arms anything (rules carry `dryRun`; the global switch is in `state/`) |

A) **All five** ⭐ *recommended* · B) A subset (name which) · X) Other

[Answer]:
A
---

### Q3 — The rules upload experience

A) ⭐ **Mirror U6's restore**: upload → validate → **comparison** (rules added / removed / changed, by id, and any that would become *disabled with a reason*) → confirm → applied **without a restart** (the watcher picks it up within 5 s)
B) Upload applies immediately if valid, no comparison

[Answer]:
A
---

### Q4 — Which credentials are managed in-app, and how?

| | Value | Proposed |
|---|---|---|
| a | **Spotify** (`clientId`, `clientSecret`, `refreshToken`, `redirectUri`) | ⭐ **Upload the `spotify-config.json` that `npm run auth` produces** (T3 = A). Never displayed back |
| b | **MusicBrainz contact** (`musicbrainz.json`) | ⭐ An editable field — it is an email address, not a secret, but personal: shown **masked** (`<email address>`) |
| c | Spotify client id/secret as separate fields | Not offered: without a refresh token they cannot work, and `npm run auth` needs them anyway |

A) ⭐ a + b · B) a only · X) Other

[Answer]:
A (a+b) - and the settings screen should have sections for user entry of both spotify and musicbrainz configs (with appropriate masking)
---

### Q5 — ⚠️ Verify credentials BEFORE they replace working ones?

A bad upload would silently stop recording — and with the §2 defect, **would look healthy**.

A) ⭐ **Probe first**: before writing, use the uploaded refresh token to obtain one access token (**one** request to Spotify's token endpoint). Fail → refused, the working credentials untouched. Pass → write **in place** (the single-file mount — inode hazard), keep **one** previous copy, then **restart** through U6's restart path so the MCP server reads it fresh
B) Write, restart, and let the user find out

⚠️ A has a cost worth stating: ⚠️ **if Spotify rotates refresh tokens on use, the probe itself could invalidate the uploaded token.** *Unverified* — this project has been wrong about Spotify six times. **A must be probed before it is designed**: refresh twice with the same token and see whether the second succeeds.

[Answer]:
B - for authentication I think it's acceptible to create a more rigid approach, entering new auth information wipes the old information and if the user want's to backtrack they need to do it themselves.
---

### Q6 — ⭐ Fix the "broken credentials read as nothing playing" defect in U7?

§2. It is not a configuration feature, but **a credential-management UI that reports *ok* over broken credentials is
worthless**, and U7 is the unit that changes credentials.

A) ⭐ **Fix in U7**: an MCP response that is an error message (`"Error getting …"`) becomes a **snapshot error** — the Spotify indicator goes red with the reason, the poll counts as a **failure**, not an idle poll (M4). Pinned by a test using the MCP server's **real** error text, with a negative control (a genuine *nothing playing* response stays *ok*)
B) Separate backlog item, later

⚠️ Whichever: **historical M4 figures may include credential failures counted as idle polls.** Worth a note
wherever M4 has been cited — it has not been used to conclude anything yet (W-7 is not started).

[Answer]:
A
---

### Q7 — Restoring a backup's rules (U6 §10.9)

A) ⭐ After a U6 restore, Settings offers **"Apply the rules from this backup"** as a **separate** action — through Q3's comparison and Q2's guards. Never automatic
B) Leave backup rules unapplied; the user downloads and re-uploads them if wanted

⚠️ A needs the archive's `rules.json` **kept** after a restore — U6 currently discards it (BR-48.7). It would be kept
as **one** file beside `previous/`, replaced by each restore (FR-62's bounded storage).

[Answer]:
A - If I'm understanding this questions correctly, we decided that restoring a backup would have an OPT-IN "replace the rules" checkbox or similar and so if the user doesn't check the box then the current rules file shouldn't be replaced. If I have that right then I agree we need to hold onto the current rules file until the user input is parsed (at which point it can either be retained or replaced).
---

### Q8 — A user story?

A) ⭐ **One story, US-29**, persona **P2 (Curator)**: *"Change my rules and my credentials from inside the app, on any machine it runs on, without ever silently losing rules or breaking recording."*
B) None — U7 is plumbing for U9

[Answer]:
A
---

### Q9 — ⚠️ Process: requirements first

U6's FRs were written during its FD and had to be ratified afterwards. To keep the standard order, **U7's FRs go
through Requirements Analysis before this FD is approved**: once Q1–Q8 are answered, a short dated round in
`requirement-verification-questions.md` proposes **FR-66…** for ratification, then this FD is written.

A) ⭐ That order · X) Other

[Answer]:
A
---

## 3a. Answer analysis and follow-ups — 2026-10-08

| Q | Answer | Reading |
|---|---|---|
| 1 | A | `config/` → `:rw`, one `rules.json`, validate → temp → rename, one `rules.previous.json` |
| 2 | A | All five guards |
| 3 | A | Upload → validate → comparison → confirm → watcher applies, no restart |
| 4 | A **+ note** | Upload **and** a Settings section per credential set, with masking — ⚠️ **extends T3 = A and reverses 4c**; see **Q4a** |
| 5 | **B** | **No probe, no previous copy, no undo.** New credentials **replace** the old outright; backtracking is the user's job. The refresh-token rotation probe is **no longer needed**. ⚠️ Exit criterion *"probed before applied"* is withdrawn |
| 6 | A | Fix in U7 |
| 7 | A **+ note** | ⚠️ **Your reading is right and the question's option A was not.** BR-48.7 already says U7 adds the choice to **the same restore flow**; option A had moved it to a separate action afterwards. See **Q7a** |
| 8 | A | US-29, P2 Curator |
| 9 | A | Requirements round before the FD |

⚠️ **Q5 = B stands on Q6 = A.** *"Let the user find out"* only works if a bad credential shows **red**; today it
shows *"Spotify: ok"*. So Q6's fix is a precondition of Q5's answer, not a separate nicety — it must ship in the
same deployment or earlier. And since `secrets/` is never in a backup, **the old credentials exist nowhere after a
replace** — the UI must say so before saving.

### Q4a — The Spotify section: what does the user enter?

`spotify-config.json` holds `clientId`, `clientSecret`, `redirectUri` (all three required by the MCP server) and,
after `npm run auth`, the tokens. ⚠️ **The refresh token cannot be produced inside the app** until in-app OAuth
exists (W-10, needs TLS off-machine) — so fields alone cannot make a working config from nothing.

| | Option |
|---|---|
| **A** | ⭐ **Fields for all four** — client id, client secret, redirect URI, refresh token — **plus** *Upload spotify-config.json* as a shortcut that fills the same form. **Saving requires every field** and replaces the whole set (Q5 = B: nothing carried over from the old one). Display: client id shown partly (`3f2a…91c0`), redirect URI in full (not secret), **secret and refresh token never shown back** — only *"set · replaced 2026-10-08 14:02"* |
| **B** | Fields for client id / secret / redirect URI only; the refresh token arrives **only** by upload. ⚠️ Two paths that must both be done, in order, to get one working config |
| **C** | Upload only (as originally planned), with a read-only masked summary of what is set |

MusicBrainz (4b) is unchanged: one **contact** field, shown masked (`<email address>`), app name/version not
editable (Question 18 makes the version derived).

[Answer]:
A - and if the process to get spotify authenticated is not trivial we should include text guidance for users.

### Q7a — The rules choice inside the restore flow: when does it take effect?

Reading: the restore dialog shows *"This backup includes rules — identical / differs from yours"*, with an
**opt-in** *"Also replace my rules with the backup's"* — **unchecked by default**; when it differs, Q3's
comparison is shown beside it and Q2's guards apply (e.g. typed confirmation if most rules would be removed).
Unchecked → current `rules.json` untouched. The open point: a restore is applied **at startup**, and can fail and
fall back (BR-48.6).

| | Option |
|---|---|
| **A** | ⭐ **Staged with the restore, applied only if the database restore succeeds.** The backup's `rules.json` goes into `restore-pending/` beside `history.db`; at startup, after step 5 passes, rules are written through the normal guarded path (`rules.previous.json` kept). If the database restore falls back, the rules are **not** applied — you never get the backup's rules on top of the current corpus |
| **B** | Applied immediately at confirm time, independently of the database restore. ⚠️ A failed restore leaves backup rules over current data |

[Answer]:
A
---

## 4. What this unit will NOT do

| | Why |
|---|---|
| A built-in rules editor | Later (U6 T2 = C) — candidate backlog item |
| In-app Spotify OAuth | Needs TLS — **W-10** |
| Off-machine access to any of it | **NFR-29, U9** — U7's routes are local-only like U6's |
| Touch `state/` | The kill switch stays where an agent editing rules cannot reach it |

## 5. Exit criteria (draft)

- [ ] Rules changed through the app on a running deployment, with the watcher reloading them, and *Undo* restoring the previous set
- [ ] ⚠️ A valid-but-empty upload **refused without the typed confirmation**; a stale-hash upload **refused**
- [ ] Credentials replaced through the app, **probed before applied**, recording continuing afterwards
- [ ] ⚠️ **Broken credentials show RED** — demonstrated on a deployment with a placeholder config, the exact case U6's copy showed green
- [ ] `localGuard.test.ts` unchanged; every new route behind `ingestGuard`
