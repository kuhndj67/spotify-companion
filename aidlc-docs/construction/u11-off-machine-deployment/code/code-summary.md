# U11 — Off-machine Deployment — Code Summary

**Branch**: `u11-code-generation` · **Plan**: [`u11-code-generation-plan.md`](../../plans/u11-code-generation-plan.md)
(approved 2026-10-24) · one commit per step, `npm run verify` green after each. Details and every deviation are in
the plan, per step; this page is the overview.

## What was built, by step

| Step | What | Where |
|---|---|---|
| 1 | Access configuration: `ACCESS_MODE` (`local` default, `server`), every server problem reported at once | `src/access/accessConfig.ts`, `src/config.ts` |
| 2 | The app's own session: `v1.` cookie, HMAC-SHA256, constant-time compare; the session key file | `src/access/session.ts`, `SessionKeyStore.ts` |
| 3 | `decideAccess` gains the server policy (public Host/Origin → open routes → session), one `AccessRequest` builder for HTTP and the WebSocket | `src/localGuard.ts`, `src/ingest/ingestGuard.ts` |
| 4 | Bounded sign-ins in progress; the safe return path | `src/access/pendingSignIns.ts`, `returnPath.ts` |
| 5 | The provider client (the only `openid-client` importer), the sign-in routes and pages; a fake provider for the suite | `src/access/ProviderClient.ts`, `authRoutes.ts`, `authPages.ts`, `test/support/` |
| 6 | HTTPS listener in server mode; recording starts first and whatever the listener does; *not serving* opens no port | `src/access/accessStartup.ts`, `src/server.ts` |
| 7 | The certificate tool: a name-constrained CA, server certificates, a built-in control that another name is refused | `src/certs/`, `npm run certs`, the image's `certs` |
| 8 | The server compose template, `setup --server`, a health check that follows the mode | `compose.server.yaml`, `src/appOnly/setup.ts`, `src/health/` |
| 9 | Candidate image, run isolated in server, refused and local modes | (image) |
| 10 | ⛔ Gate: deployed by hand on Machine 2; the sign-in loop retested | `research-findings.md` |
| 10a | *Sign in at the provider first* (`OIDC_PROVIDER_PORTAL`, BR-89.6); a lock that cannot be created no longer crashes | `authRoutes.ts`, `authPages.ts`, `src/lock/WriterLock.ts` |
| 11 | Live connections closed with 4401 at session end; sign out, sign out everywhere | `src/access/liveConnections.ts`, `authRoutes.ts`, `server.ts` |
| 12 | *Signed out* state, Settings → Access, the close decision (PBT-97) | `public/connectionDecision.js`, `public/app.js`, `index.html`, `styles.css` |
| 13 | WAL read back; Diagnostics *Access*, *WAL*, *Table counts and rules hash*; `compareCorpora` and `npm run corpus:compare` | `SqliteHistoryRepository.ts`, `prepareHistory.ts`, `src/access/accessDiagnostics.ts`, `src/maintenance/corpusFingerprint.ts`, `scripts/compare-corpora.mjs` |
| 14 | Structural guards; the secrets-in-output test | `test/accessStructure.test.ts`, `test/accessSecrets.test.ts` |
| 15 | The server install guide beside the local ones; README, ARCHITECTURE, CONTRIBUTING, CLAUDE.md | `docs/INSTALL-SERVER.md`, root |

## Defects found by the work itself

Each was found by a test written to refuse, a positive control, or by running the built thing; each now fails a test
if undone.

- 🔴 **`openid-client` 6.8.8 does not verify an ID token's signature** for a token from the token endpoint unless
  `enableNonRepudiationChecks` is applied: a tampered signature and an unpublished key were admitted (the fake
  provider's switches). It also does not refuse an `iat` in the future. Both enforced now.
- 🔴 **`ingestGuard` used the loopback origin rule**: every save would have been refused in server mode.
- 🔴 **The image `HEALTHCHECK` asked plain HTTP on loopback**: a working server would have been *unhealthy*.
- 🔴 **A lock that cannot be created crashed the app into a restart loop** (U10; found on Machine 2, where the share's
  ACL refused the container's user).
- 🟠 **The sign-in redirect's body repeated `state` and `nonce`** (Express's *Found. Redirecting to …*); found by the
  secrets test. Sent with no body now.
- 🟠 **PBT-99 was too weak**: a store that kept consumed entries, and one with no cap, both passed it. Strengthened.
- 🟠 **Three pure modules were never registered with `purity.test.ts`**: an unasserted text replace on a CRLF file did
  nothing. Every later edit asserts its anchor.
- 🟡 Looking at the pages: the signed-out notice was squeezed into the header row, and its link was the browser's
  default blue, unreadable in dark mode.

## Measured on Machine 2 (research-findings)

- Node runs on the Atom C2538; the fixed host entry and `NODE_EXTRA_CA_CERTS` work inside the container.
- The share's ACL refuses uid 1000 even as owner; `chown`/`chmod` to Linux mode fixes it (install guide, N4).
- **SSO Server does not resume a sign-in that arrives with no SSO Server session** (it loops, for every account;
  SSO Server 3.0.7; DSM's iframe setting no help); with its session it completes. Owner chose option A (BR-89.6):
  the app asks to sign in there first. Measured to work.

## Not done here

- The cold walk of `docs/INSTALL-SERVER.md`, the exit test (N7) and the move: Build & Test.
- Firefox, macOS, iOS and Android trust steps (Q7: this PC only, for now).
- Pre-U11, noticed: other links on the main page keep the browser's default blue in dark mode.
- The restricted deploy path (Step 17), after the first deployment.
