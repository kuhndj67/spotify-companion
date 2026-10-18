# U8 Business Logic Model — Team Workflow & Onboarding

**Unit**: U8 · **Date**: 2026-10-12 · Rules: [`business-rules.md`](business-rules.md) · Entities: [`domain-entities.md`](domain-entities.md)

Four flows. Only the fourth changes `src/`, and only to read the version from one place.

---

## 1. The install routine (US-30, BR-61) — the step skeleton

The exact commands and outputs are written in Code Generation and **proved by the cold walk**, not here. This is
the order and what each step must establish. ⚠️ Every *expected* below is a **positive** observation (BR-61.6).

| Step | Purpose | Establishes |
|---|---|---|
| S1 | Prerequisites | Docker running (`docker version` reports a server — Rancher Desktop on Windows, Docker Engine on Linux; macOS untested), Node 22 on the host (`node --version`), git |
| S2 | Get the code | a clone at a **release tag** `vX.Y.Z`, not an arbitrary `main` |
| S3 | Register your own Spotify app | client id + secret + redirect URI from **your** developer dashboard (BR-61.4); Development Mode limits stated |
| S4 | Spotify sign-in | `npm run auth` on the host (where the browser is) writes `secrets/spotify-config.json` with a refresh token |
| S5 | MusicBrainz contact | `secrets/musicbrainz.json` from the example with a real contact — **before** first start (BR-61.5) |
| S6 | Rules file | `npm run rules:init` creates `config/rules.json` from the template |
| S7 | Build and start | `docker compose up -d --build`; container **healthy** |
| S8 | Verify | UI on `http://localhost:3010` · Spotify indicator **ok** · with music playing, a play appears in history |
| S9 | *(optional)* Bring your history | *Restore backup* in Settings (BR-61.7) |
| S10 | Automation | stated **off**; how arming works and where the kill switch is (BR-61.9) |

⚠️ **Open for Code Generation, to be PROBED not reasoned**: whether S4 can move after S7 (credentials entered in
Settings, FR-69) as the primary path; what Docker Engine on Linux needs that Rancher Desktop supplies
(`TRUST_PUBLISHED_PORT`, bind-mount ownership — CLAUDE.md records the root-ownership concern as *not observed* on
Windows); the port when `3010` is taken.

## 2. The cold walk (BR-62)

```
INSTALL.md @ commit C ──► walker (agent | person), clean environment, only that file
      │
      ├─ for each step: run · compare observed with expected · record
      │        └─ deviation or outside knowledge needed ─► step FAILS (even if the walker recovered)
      │
      ├─ all steps passed as written ─► walk PASSES ─► release 1.0.0-beta.1 (agent) | 1.0.0 (person)
      └─ any step failed ─► fix INSTALL.md (commit C') ─► walk the changed steps again on C'
```

The agent walk is U8's exit criterion. Its environment is the Windows 11 VM **`Machine 1`**, reverted to its `clean` checkpoint, with a **fresh Claude Code
session** started in a folder holding only `INSTALL.md` — no clone history, no `CLAUDE.md`, no `aidlc-docs/`, no
memory (BR-62.6). *(Amended 2026-10-12 to the MacBook, and 2026-10-14 to `Machine 1`, because the MacBook is too old — Infrastructure Q1 = A.)*

## 3. A contribution (US-31, BR-63, BR-64, BR-67.2)

```
change ─► which path?
   ├─ fix (behaviour specified) ─► branch ─► PR
   └─ feature / new requirement ─► AI-DLC Inception ─► unit design gates (owner approves) ─► branch ─► PR
PR ─► CI: typecheck · tests · smoke (load check) · knip · gitleaks · build · container build
   ├─ any required check fails / does not report ─► merge refused
   └─ all pass ─► review ─► merge to main
owner ─► may push to main directly (stated bypass, BR-63.3)
```

Setting up protection is followed by its **positive control**: a throwaway PR that breaks one check and is refused
(BR-63.5).

## 4. A release (NFR-34, BR-66)

```
npm run verify green
  ─► bump package.json version (the ONLY write of the version)
  ─► build image spotify-now-playing:X.Y.Z   (refused if that tag exists — BR-66.7)
  ─► deploy; check healthy
  ─► git tag vX.Y.Z on that commit; push the tag
rollback ─► compose up with spotify-now-playing:<previous version>
```

**Readers of the version** (all derived, BR-66.1): the image tag in `compose.yaml` (from `package.json` at build
time) · `MaintenanceService` backup manifest (already reads `package.json` via `readAppVersion`) · MusicBrainz
User-Agent (**changes**: from `package.json`, no longer `musicbrainz.json` — BR-66.2) · Diagnostics and the UI
(`frontend-components.md`).

⚠️ Removing `appVersion` from `musicbrainz.json` must not break an existing install's file: the field is **ignored
if present**, and `CredentialsWriter` stops writing it.

## 5. Order of work (input to Code Generation, not a plan)

1. Secrets first: the **history scan** (BR-64.2) before anything else is published or shared.
2. CI: `smoke`, `knip`, `gitleaks`, the tracked-secrets test; then branch protection and its positive control.
3. Version plumbing and `0.8.0`.
4. `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, the short `README`, the short `CLAUDE.md`.
5. `docs/INSTALL.md`, then the agent cold walk ➜ `1.0.0-beta.1`.
