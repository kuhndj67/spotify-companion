# NFR Design Plan — U11: Off-machine Deployment

**Date**: 2026-10-24 · **Stage**: CONSTRUCTION — NFR Design, Unit U11
**Status**: plan OPEN, Q1–Q6 for the owner.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: U11 Functional Design (**approved 2026-10-24**): `business-rules.md` **BR-88…BR-99**,
`business-logic-model.md`, `domain-entities.md`, `frontend-components.md` · **NFR-29** (amended 2026-10-24) ·
NFR-01…05 (local-only, credentials never shown), NFR-13 (degrade, never crash), NFR-20/21 (property tests, seeds
logged), NFR-28 (no credentials in the repo) · `research-findings.md`, *Machine 2's SSO Server*

**NFR Requirements: SKIPPED**, as for U1–U10.

> **U11's non-functional risk is an authentication check that believes it works.** A sign-in that admits on a
> verification it could not perform, a session check that passes an empty cookie, a second copy of the admission
> rule on the WebSocket path (it happened once: `src/server.ts`'s upgrade handler). The bias of every pattern: **each
> check is seen to refuse a forged, expired, wrong-audience, wrong-account and unsigned input, through the same entry
> point the browser uses.**

---

## 1. Unit context

| | |
|---|---|
| **Allocates** | **P-88 …** · **LC-82 …** · **PBT-91 …** (U10 ended at P-87, LC-81, PBT-90; checked unused) |
| **Schema** | No change. Nothing U11 adds is stored in the history database |
| **Scalability** | **Not applicable, with reason**: one user, one allowed account, a handful of devices. The only growth is in-memory PendingSignIns and revoked session ids, both bounded (BR-89.3, BR-94.1) |
| **Performance** | One MAC verification per request (microseconds). Provider calls happen only at sign-in. No new latency target |
| **Availability** | Server mode depends on the provider **only at sign-in**: if it is down, signed-in devices keep working (BR-90.6). The app itself restarts as today (`restart: unless-stopped`) |

## 2. Facts measured for this plan (2026-10-24)

| | |
|---|---|
| **The image's Node** | `NODE_VERSION=22.23` (`Dockerfile:11`), `engines: node >=22`. `node:https`, `node:crypto` (HMAC, `timingSafeEqual`, JWK import) and global `fetch` are built in |
| **Private CA for outgoing calls** | Measured in the token probes: Node's `fetch` to SSO Server on 9443 **succeeded** with `NODE_EXTRA_CA_CERTS` pointing at the test CA, and **refused** without it (`SELF_SIGNED_CERT_IN_CHAIN`). So the provider trust anchor (BR-95.4) needs no code, only that variable |
| **Candidate library** | `openid-client` **6.8.8** (npm, 2026-10-24): MIT, latest, last published 2026-09-05; depends on `jose` ^6.2.12 and `oauth4webapi` ^3.8.8 (same author). `jose` latest **6.2.13** |
| **Runtime dependencies today** | four: `@modelcontextprotocol/sdk`, `express`, `tar`, `ws` |
| **The probe's flow** | ~80 lines on `node:crypto` and `fetch` (PKCE, state, nonce, code redemption, RS256 verification with a tamper control) worked against SSO Server, so either a library or our own code can do it |

## 3. Patterns already implied by the FD (stated here, not asked)

- **One rule** (P-88): `decideAccess` stays pure and is the only admission rule; the upgrade handler and the HTTP
  middleware call it with identical inputs. A structural test fails if either path admits without calling it.
- **Fail closed at startup** (BR-88.4): config validation is pure and runs before `listen()`.
- **Never admit on an unperformed check** (BR-90.6): every verifier returns `identity | reason`, and the callers
  have no default-admit branch.
- **No secret in any output** (BR-95.3): one log-capture test for a whole sign-in.
- **Property tests** (PBT-91…): `safeReturnPath`, the public-address Host check, `verifySession`, `onClose`,
  `compareCorpora`, `parseDeployCommand`, `parseMode`, `validateServerConfig`.

---

## 4. Questions

### Q1 — What does the OIDC sign-in (BR-89, BR-90)

| | Option |
|---|---|
| **A** | ⭐ **`openid-client` 6** (MIT; brings `jose` and `oauth4webapi`, same author): discovery, PKCE, state, nonce, code redemption and ID-token validation from a widely used, specification-tracking library. Three new runtime dependencies. We still write `decideAccess`, the session and the allowed-account check |
| **B** | **`oauth4webapi` + `jose` directly**: the same author's lower-level pieces, one dependency fewer, more of the flow wired by us |
| **C** | **Our own code on `node:crypto`**, as the probe did: no new dependency. ⚠️ Hand-written token validation is where OIDC bugs live (algorithm confusion, `aud` arrays, `azp`); every rule in BR-90 becomes ours to get right and keep right |

[Answer]:

### Q2 — How the app's session is signed (BR-91)

| | Option |
|---|---|
| **A** | ⭐ **HMAC-SHA256 on `node:crypto`**, a fixed format of our own (`v1.<payload>.<mac>`), verified with `timingSafeEqual`. No algorithm field to confuse; about 40 lines; every case property-tested |
| **B** | **A JWT signed with `jose`** (HS256, algorithm pinned). A standard format, from a library Q1 = A or B brings anyway. A JWT's flexibility (headers, algorithms) is what makes it riskier to verify than needed for one app talking to itself |

[Answer]:

### Q3 — How the sign-in is tested

| | Option |
|---|---|
| **A** | ⭐ **An in-process fake provider in the test suite** (real HTTP, discovery, a key set from a generated RSA key, a token endpoint that can be told to misbehave: wrong `iss`, wrong `aud`, expired, `alg: none`, another `kid`, another account), driving the app's real routes end to end, plus the WebSocket upgrade. **And one live acceptance against SSO Server**, by hand, recorded in `research-findings.md` (it includes the loop retest, Q4) |
| **B** | **A or plus a container provider in CI** (a mock OIDC server image). Closer to a real provider; one more image pinned and pulled in CI |

[Answer]:

### Q4 — When the sign-in loop is retested through the app's own flow

The probes saw the provider loop or land on its portal when a sign-in started from an authorize link (FD §2).

| | Option |
|---|---|
| **A** | ⭐ **First, as Code Generation's step 1**: build the sign-in routes (behind server mode, not yet admitting anything), run them against SSO Server, and record the result **before** the rest is built. If the loop persists, stop: Q3 (the provider) returns with the facts |
| **B** | **At the end**, during the live acceptance. Cheaper if it works; if it does not, everything built on SSO Server waits |

[Answer]:

### Q5 — Picking up a renewed certificate

The server certificate lasts up to 825 days (Apple's limit, Q5 of the FD plan).

| | Option |
|---|---|
| **A** | ⭐ **A restart picks it up.** Renewal is rare and done by the owner, who then restarts the container; Diagnostics warns 30 days before expiry (BR-96.2) |
| **B** | **The app watches the files and reloads** the certificate without a restart. More code, for an event every two years |

[Answer]:

### Q6 — Repeated sign-in attempts

| | Option |
|---|---|
| **A** | ⭐ **The bounded set of PendingSignIns only** (BR-89.3): any number of attempts costs fixed memory, the provider does the password checking (and its own lockout), and the LAN is private |
| **B** | **Also a per-address rate limit** on `/auth/*`. Useful if the app is ever reachable beyond the LAN, which is out of scope |

[Answer]:

---

## 5. Plan: after the answers

- [ ] Collect Q1–Q6; follow-ups for anything ambiguous
- [ ] `construction/u11-off-machine-deployment/nfr-design/nfr-design-patterns.md`: **P-88 …**, each pattern tied to its BR and its failing test
- [ ] `…/nfr-design/logical-components.md`: **LC-82 …** (access mode and config, provider client, PendingSignIn store, session codec, admission, sign-in routes, live-connection expiry, Access diagnostics, WAL check, corpus fingerprint, deploy-command parser) and **PBT-91 …**
- [ ] `HANDOFF.md`, `aidlc-state.md`, `audit.md` updated; completion message; owner approval
