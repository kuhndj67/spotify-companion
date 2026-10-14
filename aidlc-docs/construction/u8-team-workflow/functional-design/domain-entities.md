# U8 Domain Entities — Team Workflow & Onboarding

**Unit**: U8 · **Date**: 2026-10-12 · Rules: [`business-rules.md`](business-rules.md)

U8's entities are mostly **artefacts of process**, not rows in a database. They are modelled anyway, because each
has a lifecycle, an owner and a test — and an entity with no test is how a document decays.

---

## 1. AppVersion

| Field | Type | Notes |
|---|---|---|
| `value` | SemVer string | `0.MINOR.PATCH` pre-1.0; `1.0.0-beta.N`; then `MAJOR.MINOR.PATCH` |
| source | `package.json` `version` | **The only place it is written** (BR-66.1) |

**Derived readers** (never written independently): image tag · backup manifest `appVersion` · MusicBrainz
User-Agent · UI version display · `/api/diagnostics`.
**Not related to** `SchemaVersion` (BR-66.6).

**Bump rules** (NFR-34): MINOR per delivered unit; PATCH per fix release; after `1.0.0`, MAJOR when an existing user
must act by hand.

## 2. Release

| Field | Notes |
|---|---|
| `version` | an `AppVersion` |
| `commit` | the commit the git tag `vX.Y.Z` points at |
| `image` | `spotify-now-playing:X.Y.Z` — **immutable** once built (BR-66.7) |
| `previous` | the prior release — the rollback target (BR-66.5) |

Lifecycle: *verified* → *built* → *deployed* → *tagged*. A release missing any stage is not a release (BR-66.4).

## 3. InstallRoutine and InstallStep

**InstallRoutine** = `docs/INSTALL.md`: an ordered list of `InstallStep`, a list of supported platforms
(`windows-rancher`, `macos-rancher`, `linux-docker` — amended 2026-10-12), and its prerequisites.

| InstallStep field | Notes |
|---|---|
| `id` | stable, e.g. `S4` — cited by walk records and by *if it differs* text |
| `purpose` | one sentence |
| `commands` | per platform, or one marked *identical on both* |
| `expected` | literal output or a stated shape (BR-61.1) |
| `ifItDiffers` | what to check, in words — never "ask the owner" |
| `optional` | e.g. *Restore backup* (BR-61.7) |

## 4. ColdWalk

| Field | Notes |
|---|---|
| `kind` | `agent` (walk ①, `kuhndjwin11pro`, U8 exit, `1.0.0-beta.1`) · `person` (walk ②, platform recorded, `1.0.0`) |
| `walker`, `date`, `platform`, `environment` | e.g. agent / `kuhndjwin11pro` from `clean`, fresh Claude Code session; plus the base inventory (IN-U8-2c) |
| `steps[]` | per `InstallStep`: observed output · `passedAsWritten` (bool) · deviation note |
| `verdict` | **pass only if every step `passedAsWritten`** (BR-62.3) |
| `docRevision` | the commit of `INSTALL.md` walked — a fix changes it, and the changed steps are walked again |

Recorded under `construction/u8-team-workflow/` (one file per walk).

## 5. CIGate

| Field | Notes |
|---|---|
| `checks[]` | typecheck · tests · smoke (*load check*) · knip · secret scan · build · container build |
| `requiredOnMain` | the set enforced by branch protection, **named exactly as the workflow names them** (BR-63.4) |
| `ownerBypass` | `true`, stated in CONTRIBUTING (BR-63.3) |
| `positiveControl` | the recorded failing PR that was refused merge (BR-63.5) |

## 6. SecretScan

`ciScan` (every push/PR) · `historyScan` (once in U8: commits scanned, findings, date) · `trackedSecretsTest`
(`secrets/` holds only `*.example.json`) · `allowList[]` — each entry with a reason (BR-64.4).

## 7. ContributionPath

| Path | When | Gate |
|---|---|---|
| `fix` | behaviour already specified (a requirement or BR says what is right) | PR + tests + required CI |
| `feature` | a new or changed requirement | AI-DLC: Inception questions → unit design stages, owner approval at each |

## 8. DocumentSet

| Document | Audience | Owner of |
|---|---|---|
| `README.md` | anyone | what / status / version / links (BR-67.1) |
| `docs/INSTALL.md` | P1 and agents | the `InstallRoutine` |
| `CONTRIBUTING.md` | P4 | `ContributionPath`, traps, the bypass |
| `SECURITY.md` | reporters | channel `kuhndj67@hotmail.com` → GitHub reporting under W-14 |
| `LICENSE` | everyone | GPL-3.0 text |
| `CLAUDE.md` | any contributor's agent | short orientation; no dated history (BR-67.3) |

## 9. Personas touched

**P1 Listener** — US-30 (install). **P4 Contributor** *(new, Requirements Question 20)* — US-31.
