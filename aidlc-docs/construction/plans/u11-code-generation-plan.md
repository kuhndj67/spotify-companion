# Code Generation Plan — U11: Off-machine Deployment

**Date**: 2026-10-24 · **Stage**: CONSTRUCTION — Code Generation (Part 1, planning), Unit U11
**Status**: ✅ **APPROVED** (owner, 2026-10-24, *"approve the plan and defaults for q1/2"*): Q1 = A, Q2 = A, and the P-95 refinement. This plan is the single source of truth for U11's Code Generation.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield (modify in place; never duplicate a file)
**Inputs** (all approved 2026-10-24): FD BR-88…BR-99 · NFR Design P-88…P-101, LC-82…LC-96, PBT-91…PBT-100 ·
Infrastructure IN-U11-1…10 · requirements NFR-29 (amended, ratified) · story **US-34**

---

## Unit context

| | |
|---|---|
| **Story** | US-34 (NFR-29) |
| **Depends on** | U6 (`localGuard`, `decideAccess`, `ingestGuard`), U9 (image entrypoint, `setup`, the `secrets/app` directory mount), U10 (writer lock, kept backups, Diagnostics) |
| **Owns** | `src/access/`; `ACCESS_MODE` and the server settings; `secrets/app/session.key`, `secrets/app/oidc-client-secret`, `secrets/app/tls/`; `config/ca/`; the server compose template; the certificate tool; `/auth/*` |
| **Interfaces added** | `/auth/sign-in`, `/auth/callback`, `/auth/problem`, `/auth/sign-out`, `/auth/sign-out-everywhere`, the session status read (all absent, `404`, in local mode) · WebSocket close code **4401** · `setup --server` |
| **Branch** | `u11-code-generation`, from `main` **after the design pull request (this branch, `u11-functional-design`) is merged**; one commit per step; pull request to `main`, the owner merges |

### ⚠️ What must not move

- **Local mode is the default and is unchanged** (BR-92.6): the existing `localGuard` tests pass untouched, and
  PBT-100 compares local mode with a frozen copy of today's rule.
- **Recording never depends on access** (BR-91.6, P-96): history opens and polling starts before access is configured;
  nothing on the poll and record path imports `src/access/`.
- `data/` is never written by a test or a step. The live container on this PC keeps running `1.0.0-beta.9`; images
  are built under a **candidate** tag, never by `docker compose build` (which would overwrite the rollback target).
- Nothing on Machine 2 is changed by an agent. What happens in DSM is done by the owner, with my guidance.
- No secret (client secret, private keys, session key, cookie values) goes into chat, the repository or a log.

## Ordering principle

As for U10: pure decisions first, each with its property test and a positive control; then the impure parts around
them; then wiring; then UI; then documents. Every step ends with `npm run verify` green and its own commit.

U11 adds one **gate**: P-95. Everything the sign-in loop needs is built first (Part A) and tried on Machine 2 against
SSO Server (Step 10). **Nothing else is built on SSO Server until that result is in.** A loop that persists stops Code
Generation and sends the FD plan's Q3 back to the owner with the facts.

---

## Questions (before approval)

### Q1 — How the Step 1 build gets to Machine 2

The retest must run on Machine 2: the CA covers only its names (deployment-architecture §4).

| | Option |
|---|---|
| **A** | ⭐ **An image file copied by hand.** I build the candidate image on this PC and save it to a file (`docker save`). You copy the file to the NAS and import it (*For Synology deployment*: Container Manager → Image → Add → Add from file). Nothing is published. The image is `amd64`, which suits the Atom C2538 |
| **B** | **A pre-release tag you push** (for example `1.0.0-beta.10`). CI publishes it to the public `ghcr.io` package, and the NAS pulls it. The build is incomplete: sign-out, the live connection closing at expiry, and the Access pages are not built yet. Anyone could still pull it as a release |

[Answer]: **A** (owner, 2026-10-24: *"defaults for q1/2"*)

### Q2 — How someone with the App-only install gets the certificate tool

IN-U11-4 puts the certificate tool under `scripts/`, so you need the repository to run it. A person with the App-only
install has no clone. Measured today: the runtime image's base (`node:22.23-bookworm-slim`) has **no `openssl`
program**, and Node cannot create X.509 certificates by itself.

| | Option |
|---|---|
| **A** | ⭐ **The image offers `certs`**, like `setup` and `update`. `openssl` is added to the runtime image (Debian's package, a few MB). You run it **on your PC** with Docker (`docker run --rm -v "<folder>:/work" … certs …`). The CA key is written to that folder on your PC, never to the server. It refuses a folder that holds an install (`compose.yaml` or `secrets/`). The same pure checks back the `npm run` script for a source install. One path for both install types, and the install walks test it |
| **B** | **The `scripts/` tool only.** An App-only server install either clones the repository or follows a written OpenSSL procedure that nothing checks. The image stays as it is |

⚠️ Option A adds a program to the published image. Nothing in the app calls it, and only `certs` uses it.

[Answer]: **A** (owner, 2026-10-24: *"defaults for q1/2"*). Security posture accepted by the owner: `openssl` in the published image, used only by `certs`

---

## Part A — the sign-in loop, then the retest (P-95)

⚖️ **A refinement of P-95, for you at approval.** P-95 says the Step 1 build admits nothing beyond the sign-in pages.
If it did, a completed sign-in would return to a refused page and go round again, which is the very loop being tested
for. So the Step 1 build includes the full admission rule (Step 3), and a completed sign-in lands on the app itself.
Machine 2 has no Spotify registration during the retest, so the app there shows no data. Not yet built at that point:
sign-out, and the live connection closing at expiry (Step 11).

### Step 1 — Dependency and access configuration *(LC-82; BR-88; P-89; PBT-91, PBT-92)* — ✅ DONE · ⚠️ the pin moves to **Step 5** (knip fails an unused dependency until `ProviderClient.ts` imports it). Checked: `openid-client` 6.8.8 (MIT, 2026-09-05), `oauth4webapi` 3.8.8 (MIT, 2026-09-05); `jose` **6.2.13 is four days old** (2026-10-20), so the lock is held at **6.2.12** (2026-09-05, satisfies `^6.2.12` and the MCP SDK's `^6.1.3`). ⚠️ Deviation from BR-88.1: an unknown `ACCESS_MODE` is a *problem* like BR-88.4's (no listener, recording continues), not a refusal to start, by BR-91.6; empty counts as absent (compose writes `ACCESS_MODE:` as `""`). Positive control: a validator that stops at the first problem fails PBT-92
- [x] *(done in Step 5)* `package.json`: `openid-client` **6.8.8** pinned exactly in `dependencies`; `package-lock.json` locks `jose` and
      `oauth4webapi`. Before pinning, check that the version is at least two weeks old, and record its licence.
- [x] `src/access/accessConfig.ts` (⚙️ pure): `parseMode`, `validateServerConfig` (reports every problem at once), the
      derived redirect URI. `src/config.ts` reads `ACCESS_MODE`, `PUBLIC_ORIGIN`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
      `OIDC_ALLOWED_SUBJECT`, `SESSION_LIFETIME` (1 h–90 d, default 7 d) and the secret and certificate paths.
- [x] `test/accessConfig.property.test.ts`: PBT-91, PBT-92. Positive control: a validator that stops at the first
      problem fails PBT-92.

### Step 2 — Session codec and key store *(LC-84, LC-85; BR-91, BR-95.2; P-91, P-92; PBT-96)* — ✅ DONE · `verifySession` also checks the subject (BR-91.5) and revocation (BR-94.1), so admission has one session call. ⚠️ `session.ts` is deterministic but not in `purity.test.ts`'s list, which forbids `node:crypto` as a whole. Key stored as hex text, mode 600; `replace()` of a deleted key creates it by exclusive create (keeps mode 600). Positive control: dropping the MAC comparison fails 4 tests
- [x] `src/access/session.ts` (⚙️ pure): `signSession`, `verifySession`, in the `v1.` format, using `timingSafeEqual`
      after a length check. The payload is parsed only after the MAC matches.
- [x] `src/access/SessionKeyStore.ts`: create the key by exclusive create if it is absent; read it; replace it (write a
      temporary file, then rename it inside the directory mount).
- [x] Tests: PBT-96. Key store: a second creator does not overwrite the first; after a replacement, the old key
      verifies nothing. Positive control: a verifier that parses the payload before the comparison fails a tampering
      case.

### Step 3 — Admission *(LC-83; BR-92; P-88, P-92; PBT-93, PBT-94, PBT-100)* — ✅ DONE · `decideAccess(request, policy, verifySession?)`: the key, clock, allowed account and revocations are bound into the verifier by the caller (one parameter, not three). `accessRequestFrom` is the one builder (middleware and upgrade). `serverGuard` maps reasons to responses (BR-92.5) and hands the session and the mode's origin rule on in `res.locals.access`. ⚠️ **Found**: `ingestGuard` checked `Origin` with the loopback rule, which would refuse every save in server mode; it now takes the origin rule from admission (falls back to loopback when absent). ⚠️ Deviation from BR-92.3: `/auth/signed-out` is an open route (Sign out redirects there with no session). Positive controls: checking the session before Host fails 6 tests; admitting when the verifier throws fails P-92's test
- [x] `src/localGuard.ts`: `decideAccess(request, policy, verifySession, now)` gains the server policy (Host and
      Origin checked against the public origin, then the route class, then the session). Add one shared
      `AccessRequest` builder. The middleware and `server.ts`'s upgrade handler both use it.
- [x] Tests: PBT-93, PBT-94, PBT-100 (with the frozen pre-U11 rule in the test). The existing `localGuard` tests are
      unchanged. Positive controls: a session verifier stub that throws is refused (P-92); an admission rule that
      skips Host when a session is valid fails PBT-94.

### Step 4 — Sign-ins in progress *(LC-87; BR-89; P-99; PBT-95, PBT-99)* — ✅ DONE · `safeReturnPath` also refuses a backslash anywhere and any return into `/auth/` (a return to the sign-in would start another). ⚠️ **The positive controls caught a weak property**: with 51 state names the generator almost never consumed one twice, and it never passed the cap, so a store that kept consumed entries, and one with no cap, both passed PBT-99 (only the example tests failed). Strengthened with a small name pool and a burst operation; both mutations now fail PBT-99. A return path that allows `//` fails PBT-95
- [x] `src/access/pendingSignIns.ts` (at most 32 entries, 10 minutes each, the oldest evicted first, each consumed
      once) and `src/access/returnPath.ts` (`safeReturnPath`).
- [x] Tests: PBT-95, PBT-99. Positive control: a store that does not remove an entry when it is consumed fails PBT-99.

### Step 5 — Fake provider, provider client, sign-in routes *(LC-95, LC-86, LC-88; BR-89, BR-90; P-90, P-94)* — ✅ DONE · the pin landed here (from Step 1). ⚠️ **Found by the fake provider's switches**: (1) `openid-client` does **not verify the ID token's signature** for a token from the token endpoint unless `enableNonRepudiationChecks` is applied (a tampered signature and an unpublished key were admitted); now applied. (2) It does not refuse an `iat` in the future (BR-90.4); checked in `ProviderClient`. (3) Its key-set rule matches BR-90.6 as written: an unknown `kid` refetches only if the cached set is ≥ 60 s old (dropped at 300 s); tested by moving `Date.now`. (4) It form-encodes the client ID and secret inside Basic authentication (RFC 6749 §2.3.1: `-` → `%2D`); whether DSM's SSO Server decodes that is seen at Step 10. Measured: Node's own `fetch` trusts `NODE_EXTRA_CA_CERTS` (refused without it, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`). The test CA is made with `openssl` per run (`test/support/testCa.ts`; knip told it is a system program). Pages in `src/access/authPages.ts` (pure); `/auth/signed-out` served now. Positive controls: an identity check accepting any `sub` fails 2 tests; removing the signature checks fails 3
- [x] `test/support/fakeOidcProvider.ts`: HTTPS on a random port, a test CA generated for each run, and switches that
      make it misbehave (P-94's list).
- [x] `src/access/ProviderClient.ts`: the **only** importer of `openid-client`. RS256 only; 60 s clock tolerance;
      discovery with retry; the key set fetched again for an unknown `kid`, at most once a minute. It returns
      `VerifiedIdentity | reason`. Library errors are mapped to a reason and an error **name** only.
- [x] `src/access/authRoutes.ts`, mounted in `src/api.ts`: `/auth/sign-in`, `/auth/callback`, `/auth/problem` and the
      session status read. Sign-out comes in Step 11. A successful callback issues the session and redirects to the
      safe return path.
- [x] Tests: one refusal for each BR-90 switch, through the real routes. Positive control: an identity check that
      accepts any `sub` fails the other-account case. In local mode every `/auth/*` route returns `404`.

### Step 6 — HTTPS listener and startup order *(LC-90; BR-88.4, BR-96.1; P-89, P-96, P-100)* — ✅ DONE · `src/access/accessStartup.ts` (`configureAccess`, never throws) decides `local` / `server` / `not-serving`; it also checks the key matches the certificate (`X509Certificate.checkPrivateKey`) and creates the session key only once everything else is valid. `server.ts`: the listen callback's body moved into `startRecording()`, called once at top level before the listener; `not-serving` opens no listener and logs every problem, then an hourly summary; the WebSocket upgrade answers `401` for a missing or expired session (BR-92.5). ⚠️ **Deviation**: the guard test with a *scripted player* is not built: the suite has no way to run `server.ts` with a player, and the real connector cannot be used in a test. In its place, `configureAccess` is tested against real files (each value removed, mismatched key, non-PEM files, every problem listed, no secret in any line) and `server.ts`'s order is pinned on its text (as U6's wiring is). The end-to-end check (plays recorded while serving is refused) is observed on the built image in Step 9 and on Machine 2. ⚠️ Not yet run as a process. Positive control: moving `startRecording()` into the serving branch fails 3 pins
- [x] `src/server.ts`: in server mode the one listener is `node:https`, with the configured certificate and key.
      Express and the `ws` upgrade attach to it. History opens and polling starts **before** access is configured. A
      refused configuration opens no listener, logs every problem, and logs an hourly *not serving* line. Recording
      continues.
- [x] Tests: server mode with each required value removed in turn → no port is open, and a scripted player's plays are
      recorded ⭐. With an `http://` origin, no listener opens. A certificate whose key does not match is reported by
      name.

### Step 7 — Certificate tool *(IN-U11-4, IN-U11-5; Q2)* — ✅ DONE · `src/certs/certPolicy.ts` (pure), `certTool.ts`, `certsCli.ts`: `ca`, `issue`, `verify`; `npm run certs` and the image's `certs` (entrypoint; `openssl` added to the runtime image, Q2 = A). The CA key is refused at or under a git repository or an install folder (`compose.yaml` or `secrets/`); seen refused inside this repository. Never overwrites; random serials, so no `.srl` file beside the CA. IPv6 refused with a reason. ⭐ The tool's control is itself tested: a CA **without** a name constraint makes `issue` fail with *name constraint is NOT working*, and nothing is left behind. Run once on this PC with throwaway names (`192.0.2.10`, a documentation address), in the scratchpad. ⚠️ Found earlier, fixed here: Steps 4–5 had not registered `returnPath`, `pendingSignIns`, `authPages` with `purity.test.ts` (an unasserted text replace on a CRLF file did nothing); now registered with `certPolicy`. ⚠️ Found for Step 8: the image's `HEALTHCHECK` asks for `http://127.0.0.1/api/health`, which server mode refuses (HTTPS, public Host)
- [x] `src/certs/certPolicy.ts` (⚙️ pure): name and IP validation, the 825-day cap, and the refusal of a destination
      inside the repository or an install folder.
- [x] The tool: `scripts/certs.mjs` (with `npm run certs`), and, if Q2 = A, the image's `certs` command through
      `scripts/docker-entrypoint.sh`. Actions: make a CA, issue a certificate, and verify after each action.
- [x] Tests: the pure checks (each refusal seen to fire). The verify action's positive control is built into the
      tool: a throwaway certificate for a name outside the constraint is issued, and verification **must reject
      it**. If it does not, the tool exits non-zero. I run it once on this PC with throwaway names, in the scratchpad.

### Step 8 — Server template and `setup --server` *(IN-U11-2, IN-U11-3)* — ✅ DONE · `compose.server.yaml`; `setup --server` (`runSetup(…, 'server')`, the entrypoint now passes `setup`'s option through); the template is in the image. A drift test holds the server template to compose.app.yaml except IN-U11-2's differences (positive control: one volume changed fails it). ⚠️ **Also**: the image's `HEALTHCHECK` now follows the mode (`src/health/healthTarget.ts`, pure, tested; `healthcheckCli.ts` in the image): server mode asks `https://127.0.0.1/auth/auth.css` with the public Host and does not check the certificate (liveness over loopback only); a refused configuration is *unhealthy*, which is true. ⚠️ Not yet run in a built image (Step 9)
- [x] `compose.server.yaml`, beside `compose.app.yaml`. It differs from `compose.app.yaml` only as IN-U11-2 lists:
      the LAN-address publish on 3443, `extra_hosts`, the server settings as placeholders, and
      `NODE_EXTRA_CA_CERTS`.
- [x] `src/appOnly/setup.ts`: `--server` writes that template as `compose.yaml` and also creates `config/ca/` and
      `secrets/app/tls/`. It writes all of it or none (`decideSetup`). It never creates a key.
- [x] Tests: the existing setup property test also covers the server file list. `versionSources` checks the new
      template's image tag.

### Step 9 — Step 1 candidate image *(Q1)* — ✅ DONE · built from `18da3ff` (clean tree) as `spotify-companion:candidate-u11-signin` (`sha256:d61fd8d4…`, amd64; exit 0; `1.0.0-beta.9` still `8e0132e8`). Run isolated on this PC (scratch folders, no Spotify credentials, labels and automation off), against a throwaway CA for `localhost` made by the image's own tool. **Server mode**: one HTTPS listener; `/auth/problem` 200; `/` navigation 302 to `/auth/sign-in?return=%2F`; `/api/health` 401; a forged cookie 401; a WebSocket upgrade without a session 401; a wrong Host 403; `/auth/sign-in` 503 (provider unreachable, as configured); plain HTTP refused; without the CA, TLS refused (control); session key created; healthcheck *healthy*. **Refused configuration** (`OIDC_CLIENT_ID` removed): no listener (`ECONNREFUSED` inside), the problem logged by name, **polling and the scheduled backup ran**, no session key made, healthcheck fails. ⚠️ Not observed: plays actually recorded while not serving (no Spotify credentials in an isolated run; Machine 2 will have none either until the exit test). **Local mode**: `/api/health` 200, every `/auth/*` 404, healthy. `setup --server` and `certs` work in the image (`openssl` 3.0.22; constraint control passes; an install folder refused). Image file (Q1 = A) in the session scratchpad, SHA-256 `7a65e45f…0d22`, 94 MB
- [x] `npm run verify` green. Build the image as `spotify-companion:candidate-u11-signin`. Check the build's exit code
      directly. Run it on this PC in server mode with a throwaway CA for `localhost` and **no Spotify credentials**.
      Expected: it starts, `/auth/problem` is served, and every other route is refused without a session.
- [x] Deliver it as Q1 decides. With A, I save the image file in the scratchpad and give you its full path.

### Step 10 — ⛔ Gate: the deployment by hand and the retest (P-95) — ✅ GATE PASSED WITH A WORKAROUND (owner, 2026-10-24: *"yea lets do A"*) · Deployed by hand on Machine 2 (steps 1–4; permissions fixed by hand, see research-findings). Retest: a sign-in started from the authorize link with **no SSO Server session loops for every account** (dedicated and administrator; SSO Server's log records nothing; the app receives no callback); **with an SSO Server session first it completes** (attempts 2–4: plain, after the app's cookie is deleted, deep link). Version 3.0.7 and DSM's iframe setting ruled out. Not done: attempt 5. **Owner's decision: option A**, keep SSO Server; the app shows *sign in at the provider first, then Continue* when `OIDC_PROVIDER_PORTAL` is set (BR-89.6, added). Rejected: B (look for a DSM setting; none found), C (an identity provider in a container). FD plan Q3 stays A. Built as **Step 10a**
- [ ] You, with my guidance, follow deployment-architecture §4 steps 1–4:
      1. Make the real CA on this PC and issue the two certificates. Move the CA key offline.
      2. Import SSO Server's certificate in DSM. Register the app in SSO Server.
      3. Install `ca-cert.pem` on this PC.
      4. Create the project on Machine 2 with the candidate image. **No Spotify registration is added**, so nothing
         records on Machine 2.
- [ ] Trial check, step 5 (first part): the container starts on the Atom C2538. This answers whether Node runs
      without AVX. The *WAL* row comes in Step 13.
- [ ] The retest, from this PC: **at least five sign-ins** in a fresh browser profile, each started from a different
      state (no SSO Server session, a live one, an expired app session, a deep link, after SSO Server's own
      sign-out). Each is recorded as *completed*, *looped* or *landed on the portal*, in `research-findings.md`.
- [ ] **All completed → Part B. A persistent loop → stop**; the FD plan's Q3 goes back to you with the records.

### Step 10a — Sign in at the provider first *(BR-89.6; owner's option A)* — code ✅ · `OIDC_PROVIDER_PORTAL` optional, https only (PBT-92 extended); the page creates no sign-in state; Continue keeps the (already safe) return path. Positive controls: ignoring `go=1` fails the full-flow test; re-throwing in `WriterLock.acquire` fails the new lock test. Lock fix: `acquire()` returns a refusal with the error code for anything but a held lock
- [x] `OIDC_PROVIDER_PORTAL` (optional, `https://` only) in `accessConfig` (PBT-92 extended), `config.ts`, `accessStartup`; `compose.server.yaml` (with the Synology value as a comment) and its drift test.
- [x] `src/access/authPages.ts`: the *Sign in first* page; `authRoutes.ts`: `/auth/sign-in` shows it unless `go=1`, then proceeds as before. Tests: the page, its two links (portal in a new tab, Continue keeping the return path), escaping, and the sign-in completing through Continue; without the setting, unchanged.
- [x] Fix found at Step 10: a lock that cannot be created (`EACCES`) runs the app display-only with the reason instead of crashing into a restart loop (`WriterLock.acquire`, U10).
- [x] A new candidate image for Machine 2, so the retest's attempt 5 and a fresh-browser sign-in are run through the page. Built from `ddd343d` as `spotify-companion:candidate-u11-signin-2` (`sha256:4a5b4288…`); run isolated: the page appears, Continue starts the sign-in. Image file SHA-256 `89554cc1…8752`. ⚠️ Seen: a container reusing a data folder whose previous container was force-removed waits one stale window (30 s) for the old lock before it listens (U10's takeover, as designed). **Run on Machine 2** (owner, 2026-10-25): with no SSO Server session, the page → SSO Server in a new tab → *Continue* → the app. ✅ The gate's workaround is measured to work. Not done: attempt 5 (after SSO Server's own sign-out)

## Part B — after the retest

### Step 11 — Live connections and sign-out *(LC-89, LC-88; BR-93, BR-94; P-93)*
- [ ] `src/server.ts`: a registry of sockets by session id. Each socket gets a timer at its session's expiry and is
      closed with **4401**. Timers are cleared on close.
- [ ] `/auth/sign-out` (revokes this session and closes its sockets) and `/auth/sign-out-everywhere` (replaces
      `session.key` and closes every socket). Both are state-changing and refused from another site (BR-92.4).
- [ ] Tests: the WebSocket upgrade refuses each bad session with `401`, and a valid one is admitted. Sign out
      everywhere: two sessions are refused afterwards, on HTTP and on WebSocket. A 2 s lifetime closes the socket with
      4401.

### Step 12 — Frontend *(LC-94; frontend-components §2–§5; PBT-97)*
- [ ] `public/`: the *Sign-in problem* and *Signed out* pages; Settings → *Access* (server mode only); the connection
      indicator's *Signed out* state; `onClose` (⚙️, PBT-97).
- [ ] Checked in the browser on the built app, in **light and dark**, against the fake provider. Screenshots go in the
      code summary. Primary screen: state only as a compact indicator; colour never the only signal.

### Step 13 — Diagnostics, WAL, corpus comparison *(LC-91, LC-92, LC-93; BR-96.2, BR-97, BR-98; P-98, P-101; PBT-98)*
- [ ] `src/history/SqliteHistoryRepository.ts`: read back `journal_mode`. Anything but `wal` makes the app
      display-only, with the reason, before migration.
- [ ] `src/diagnostics.ts`: the *Access* row (mode, public origin, certificate expiry: a warning 30 days ahead, a
      failure after it), the *WAL* row, and *Table counts and rules hash*. `src/maintenance/corpusFingerprint.ts`:
      `compareCorpora`.
- [ ] Tests: PBT-98. Positive control (P-101): an in-memory database answers `memory`, which leads to display-only and
      a failed row that names `memory`.

### Step 14 — Structural guards and secrets in output *(LC-96; P-88, P-96, P-97)*
- [ ] `test/accessStructure.test.ts`: no session cookie or verifier access outside LC-83 and LC-88; no module on the
      poll and record path imports `src/access/`; `openid-client` imported only by `ProviderClient.ts`.
- [ ] `test/accessSecrets.test.ts`: a full sign-in, a sign-out and a failed sign-in. Every log line and response body
      is searched for the code, both tokens, the cookie value, the verifier, `state`, `nonce`, the client secret and
      the session key.
- [ ] Positive controls: each guard is seen to fail once, on a deliberate violation that is then reverted (recorded in
      the code summary).

### Step 15 — Documents *(IN-U11-1…7, 9, 10; FD plan Q9)* — ◐ **moved ahead of Steps 11–14** (owner, 2026-10-25: others must see both deployments before any release). Done for what exists: ⚠️ deviation, the server install is its own guide, `docs/INSTALL-SERVER.md` (N1–N6, host-agnostic with *For Synology deployment* notes, the measured Synology findings), not a part of INSTALL-APP; INSTALL-APP and INSTALL-DEV point to it; README has a Local/Server table; ARCHITECTURE has the two modes, the components and the new invariants; CONTRIBUTING has the traps (one admission rule and its builder, recording independent of access, `openid-client`'s signature default, PowerShell's `--`, the Synology ACL, the SSO Server loop); CLAUDE.md names server mode and `src/access/`. `test/docs.test.ts` covers the new guide (four parts per step, 👤 boxes, links, paths). ⚠️ The guide writes `<version>` for the image: replace with the release's version when it is cut. Still to add when built: sign-out, *Settings → Access*, the moving-your-history section (exit test), and the code summary
- [ ] `docs/INSTALL-APP.md`: a server part. Each step says what any host needs, with a *For Synology deployment*
      subsection where Machine 2 needs something specific. It covers the name, the certificates and the offline CA key,
      installing the root on Windows (with the Firefox note), registering the app with the provider, `setup --server`,
      the secrets files, renewal, copying data off the disk (restore from `data/backups/`, never from a copied
      `history.db`), monitoring, and **one recorder at a time**.
- [ ] ⚠️ Measured at Step 10 (2026-10-24): **Windows PowerShell 5.1 drops an unquoted `--`** before npm sees it, so `npm run certs -- ca --out …` fails (*Unexpected argument*). Every `npm run … --` command in the guides is written with `'--'` for PowerShell, or the guide says so once.
- [ ] `docs/INSTALL-DEV.md` (server mode for development), `CONTRIBUTING.md` (traps: one admission rule, recording
      independent of access) and `CLAUDE.md` (`src/access/` in *Where things are*). No hand-written counts; every
      `npm run` and path must resolve (`test/docs.test.ts`). Never Machine 2's name.
- [ ] `construction/u11-off-machine-deployment/code/code-summary.md`: what changed in each step, deviations,
      screenshots.

### Step 16 — Close Part B
- [ ] Register PBT-91…PBT-100 with `propertyObligations` (no gaps). `npm run verify` green. Build the candidate image.
      Update HANDOFF, state and audit. Open a pull request (with your go-ahead). Build & Test then runs the trial, the
      exit test and the move (BLM §8).

## Part C — after the first deployment by hand (FD plan Q8; Infrastructure plan Q9 = A)

### Step 17 — The restricted deploy path *(IN-U11-8; BR-99)*
- [ ] **Probe first, with you**: whether DSM 7.2 lets a non-administrator sign in over SSH. If it does not, IN-U11-8
      comes back to you with that fact before anything is built.
- [ ] The deploy script's argument check as a POSIX `sh` function, and a suite test of each accepted and refused form.
      The privileged script (`deploy`, `rollback`, `status`, `logs`), the forced-command `authorized_keys` line and the
      `sudo` rule, written as files plus install steps. You install them on Machine 2.
- [ ] U11 closes when a release has gone out that way.

---

## Story traceability

| US-34 acceptance | Steps |
|---|---|
| Sign in from another device through the provider; then the whole app works, live updates included | 1, 2, 3, 5, 10, 11 |
| Without signing in, or as another account, nothing but a page saying why | 3, 5, 12 |
| The session ends at the chosen lifetime; sign out here or everywhere | 1, 2, 11, 12 |
| HTTPS with a certificate the devices trust | 6, 7, 8, 10 |
| A local deployment works exactly as before, with no sign-in | 3 (PBT-100), 5 (`404`) |
| The real history moves with every table's count unchanged (exit test) | 13 (`compareCorpora`); run in Build & Test |

Not a US-34 criterion, but held throughout: recording continues whatever access does (BR-91.6): Steps 6 and 14.
