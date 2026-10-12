# U8 NFR Design Patterns — Team Workflow & Onboarding

**Unit**: U8 · **Date**: 2026-10-12 · **Plan**: [`u8-nfr-design-plan.md`](../../plans/u8-nfr-design-plan.md) — all 7 answered **A**
**Allocates**: **P-58…P-64** · components and properties in [`logical-components.md`](logical-components.md)

The common thread: **every claim U8 makes must have a test that runs where the claim can fail.** U8's failure mode is
not load or latency — it is a gate that silently stops gating, or a sentence that silently stops being true.

---

## P-58 — Checked copy, not a second source (Q1)

**Problem**: BR-66.1 wants one version source; Compose cannot read `package.json`, and a fresh clone must run plain
`docker compose up --build` with no generated file.

**Pattern**: the image tag stays a **literal** in `compose.yaml` and `compose.verify.yaml`, and a test fails unless it
**equals** `package.json`'s version. A copy that CI refuses to let drift is not a second source.

⚠️ **This is how BR-66.1 is read, stated so nobody "fixes" it later**: *derived* means **computed from, or
mechanically checked equal to**, `package.json`. Every reader inside the app (manifest, User-Agent, UI, diagnostics)
is computed (P-59); the compose literals are checked.

## P-59 — One reader (Q1, Q5)

`src/version.ts` is the **only** code that reads `package.json`'s version. `readAppVersion` moves there from
`server.ts`; `loadMusicBrainzIdentity` and `CredentialsWriter` stop carrying `'0.1.0'` and take the version from it.
An unreadable or invalid version is **`unknown`** — never a throw, never `0.1.0` (that fallback is exactly the
per-install copy BR-66.2 removes).

## P-60 — Releases only move forward; tags are never overwritten (Q1, Q6)

`npm run release` is the **owner's** path and the only one that makes a versioned release. Its decision is a **pure
function** of *(candidate version, existing git tags, existing image tags, verify result)*:

- refuse unless `npm run verify` passed;
- refuse unless the candidate is valid SemVer and **strictly greater** than every existing `v*` tag (SemVer
  precedence: `1.0.0-beta.2 < 1.0.0`);
- refuse if image `spotify-now-playing:X.Y.Z` **or** git tag `vX.Y.Z` already exists (BR-66.7).

Only after an accept does the impure shell build, deploy, and tag. An installer's `compose up --build` is untouched —
immutability is a release property, not an install property.

## P-61 — Scan the range on every change; the history on a schedule (Q2)

The **gitleaks binary, pinned by version and SHA-256**, runs as a CI step: on a push or PR it scans the **commits in
the range**; a **weekly scheduled job** scans the **whole history**. `--redact` always — a finding never prints the
value. The allow-list is a committed `.gitleaks.toml`; **every entry carries a reason** (BR-64.4), and a test fails on
an entry without one. No third-party action, so no licence-key condition and no extra token scope.

## P-62 — Protection as code, cross-checked against the workflow (Q3)

The `main` ruleset is a **committed JSON file**, applied by `npm run protect` (via `gh api`), which is **idempotent**
and **prints the difference before applying**. A **test** parses the ruleset and `ci.yml` and fails if any required
check names a job that does not exist — so renaming a CI job fails CI **before** it can leave `main` waiting for a
check that never reports (BR-63.4). The owner bypass lives in the file, visible to review. The **positive control**
(BR-63.5) — a deliberately failing PR refused merge — is recorded once.

## P-63 — Documents are tested for what can be tested, and say what cannot (Q4)

A `docs` test checks the mechanically checkable half of BR-67.5:

- every `npm run <x>` in `README.md`, `docs/INSTALL.md`, `CONTRIBUTING.md`, `CLAUDE.md` exists in `package.json`;
- every relative link and repository path resolves;
- `README.md` contains **no hand-written counts** (tests, plays, units) — the old README's decay;
- `CLAUDE.md` is **≤ 200 lines** (BR-67.3);
- every INSTALL step has BR-61.1's four parts: purpose, command, expected output, *if it differs*.

What it cannot check — that a command's **output** still matches — is the cold walk's job, and the test's header says
so. A docs test that claimed more would be the decorative guard this project keeps warning about.

## P-64 — A finding in history stops the unit (Q7)

If the one-time history scan (BR-64.2) finds a credential, **U8 stops at that point**. The owner gets file, commit and
rule — never the full value — revokes and rotates it **at its source**, and confirms. Claude does **not** rewrite
history (that is W-14's decision). The scan record then marks the finding *rotated*, and the allow-list entry says so.
