# U8 Logical Components — Team Workflow & Onboarding

**Unit**: U8 · **Date**: 2026-10-12 · Patterns: [`nfr-design-patterns.md`](nfr-design-patterns.md)
**Allocates**: **LC-49…LC-57** · **PBT-68…PBT-72**

Scripts follow the project's existing shape: a **pure decision module** that is tested, and a thin **impure shell**
that `smoke` checks can load (NFR-31 — a load check, not a behaviour check).

---

## Components

| ID | Component | Where | Kind | Patterns / rules |
|---|---|---|---|---|
| **LC-49** | **Version reader** — the one reader of `package.json`'s version; `unknown` on any failure | `src/version.ts` | pure + one file read at the edge | P-59 · BR-66.1/66.2 |
| **LC-50** | **Release decision** — accept/refuse a candidate version against tags, images and verify | `scripts/lib/releaseDecision.mjs` (or `.ts` under the tsx loader, as the `db:*` scripts) | ⚙️ pure | P-60 · BR-66.3/66.4/66.7 |
| **LC-51** | **Release shell** — `npm run release`: runs verify, gathers tags/images, calls LC-50, builds, tags | `scripts/release.mjs` | impure | P-60 |
| **LC-52** | **Ruleset** — the `main` ruleset as data | `.github/rulesets/main.json` | data | P-62 · BR-63.3 |
| **LC-53** | **Protect shell** — `npm run protect`: diff then apply LC-52 through `gh api` | `scripts/protect.mjs` | impure | P-62 |
| **LC-54** | **Secret scan** — the gitleaks steps (range on push/PR, full history weekly) and the allow-list | `.github/workflows/ci.yml`, `.github/workflows/secret-history.yml`, `.gitleaks.toml` | CI | P-61 · BR-64 |
| **LC-55** | **CI additions** — `smoke` (labelled *load check*) and `knip` steps | `.github/workflows/ci.yml` | CI | BR-63.1/63.2 |
| **LC-56** | **Document set** — `LICENSE`, `README.md`, `docs/INSTALL.md`, `CONTRIBUTING.md`, `SECURITY.md`, the short `CLAUDE.md` | repository root, `docs/` | docs | BR-61, BR-67 |
| **LC-57** | **Version display** — the version in Settings and diagnostics, server-derived from LC-49 | `src/` maintenance/diagnostics views, `public/app.js` renders only | UI | `frontend-components.md` |

## Guard tests (example-based)

| Test | Asserts | Rule |
|---|---|---|
| `versionSources.test.ts` | the image tag in `compose.yaml` **and** `compose.verify.yaml` equals `package.json`'s version; nothing else in `src/` or `secrets/*.example.json` holds a version literal | P-58 · BR-66.1/66.2 |
| `rulesetMatchesWorkflow.test.ts` | every required check in LC-52 is a job name in `ci.yml`; the owner bypass is present | P-62 · BR-63.4 |
| `secretsTracked.test.ts` | every tracked file under `secrets/` matches `*.example.json`; every `.gitleaks.toml` allow-list entry has a non-empty reason | BR-64.3/64.4 |
| `docs.test.ts` | P-63's five checks; header states what it cannot check | P-63 · BR-67.5 |

## Property obligations

| ID | Property | Component |
|---|---|---|
| **PBT-68** | For any set of existing tags and any candidate, the release decision **accepts only** a valid SemVer **strictly greater** (by SemVer precedence) than every existing tag | LC-50 |
| **PBT-69** | Pre-release ordering holds: for any `X.Y.Z`, `X.Y.Z-beta.N < X.Y.Z-beta.N+1 < X.Y.Z`, and the decision follows it | LC-50 |
| **PBT-70** | If the candidate's image tag **or** git tag already exists, the decision **refuses**, whatever else is true | LC-50 · BR-66.7 |
| **PBT-71** | ⭐ **Positive control**: for any tag set, the next valid PATCH / MINOR / MAJOR with verify passed **is accepted**. A decision that refused everything would satisfy PBT-68…70 perfectly (the PBT-34a lesson) | LC-50 |
| **PBT-72** | For any `package.json` content — missing, malformed JSON, no `version`, a non-SemVer `version` — the version reader returns `unknown`, never throws and never returns `0.1.0` | LC-49 |

Seeds are logged and replayable as for every existing property (NFR-20/21, PBT-08).
