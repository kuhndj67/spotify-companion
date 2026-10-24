# U11 Logical Components — Off-machine Deployment

**Unit**: U11 · **Date**: 2026-10-24 · Patterns: [`nfr-design-patterns.md`](nfr-design-patterns.md)
**Allocates**: **LC-82…LC-96** · **PBT-91…PBT-100**

The project's shape holds: a **pure decision module**, property-tested, inside a thin **impure shell**. Paths are
where each component is expected to live; Infrastructure Design and Code Generation may refine paths, not the split.

---

## Components

| ID | Component | Where | Kind | Patterns / rules |
|---|---|---|---|---|
| **LC-82** | **Access configuration**: `parseMode`, `validateServerConfig` (all problems at once), the derived redirect URI | `src/access/accessConfig.ts`, read by `src/config.ts` | ⚙️ pure | P-89 · BR-88 |
| **LC-83** | **Admission**: `decideAccess` extended with the server policy (public-address Host/Origin, route class, session step), the shared `AccessRequest` builder | `src/localGuard.ts` (kept: tests and comments pin it) | ⚙️ pure | P-88, P-92 · BR-92 |
| **LC-84** | **Session codec**: `signSession`, `verifySession` (`v1.` format) | `src/access/session.ts` | ⚙️ pure | P-91 · BR-91 |
| **LC-85** | **Session key store**: create by exclusive create if absent, read, replace (temp then rename) | `src/access/SessionKeyStore.ts` | impure | BR-95.2, 94.2 |
| **LC-86** | **Provider client**: the only importer of `openid-client`; discovery with retry, authorization URL, code redemption, ID-token validation, key refetch on unknown `kid` (once a minute); returns `VerifiedIdentity \| reason` | `src/access/ProviderClient.ts` | impure | P-90, P-92 · BR-88.6, 90 |
| **LC-87** | **Sign-ins in progress**: the bounded store (32, 10 min) and `safeReturnPath` | `src/access/pendingSignIns.ts`, `src/access/returnPath.ts` | ⚙️ pure + small state | P-99 · BR-89 |
| **LC-88** | **Sign-in routes**: `/auth/sign-in`, `/auth/callback`, `/auth/problem`, `/auth/sign-out`, `/auth/sign-out-everywhere`, the session status read; absent (`404`) in local mode | `src/access/authRoutes.ts`, mounted in `src/api.ts` | impure | BR-89, 90.5, 92.5, 94 |
| **LC-89** | **Live-connection registry**: sockets by session id, expiry timers, close 4401 | `src/server.ts` (upgrade and connection handling) | impure | P-93 · BR-93 |
| **LC-90** | **Listener selection**: HTTP (local) or HTTPS (server) after LC-82; none when LC-82 refuses | `src/server.ts` | impure | P-89, P-100 · BR-88.4, 96.1 |
| **LC-91** | **Diagnostics rows**: *Access*, *WAL*, *Table counts and rules hash* | `src/diagnostics.ts` | wiring | BR-96.2, 97, 98.3 |
| **LC-92** | **WAL read-back** at open | `src/history/SqliteHistoryRepository.ts` | impure | P-101 · BR-97 |
| **LC-93** | **Corpus comparison**: `compareCorpora(a, b)` over two Diagnostics fingerprints | `src/maintenance/corpusFingerprint.ts` | ⚙️ pure | BR-98 |
| **LC-94** | **Frontend**: *Sign-in problem* and *Signed out* pages, Settings → *Access*, the connection indicator's *Signed out* state, `onClose` | `public/` (pages, `app.js`, `styles.css`) | UI + ⚙️ `onClose` | P-93 · frontend §2–§4 |
| **LC-95** | **Fake OIDC provider** for the suite (HTTPS, per-run test CA, misbehaviour switches) | `test/support/fakeOidcProvider.ts` | test support | P-94 |
| **LC-96** | **Structural guards**: one admission rule (no cookie or verifier access outside LC-83/LC-88); the poll and record path imports no `src/access/` module | `test/` beside `purity` and `noOrphanModules` | test | P-88, P-96 · BR-91.6 |

**Deploy command (BR-99, Q8 = B)**: designed in Infrastructure Design with the deploy user; its property test is
allocated there. The first deployment is by hand (Q8 = A for now).

**Dependency**: `openid-client` (exact pin) added to `dependencies`; `knip` must see it imported only by LC-86.

## Guard tests (example-based, each seen to fail once)

| Guard | Positive control |
|---|---|
| Every BR-90 refusal (P-94) | One fake-provider switch per refusal: wrong `iss`, wrong `aud`, `aud` array without `azp`, expired, future `iat`, `alg: none`, HS256 with the public key, unknown `kid`, tampered signature, other account, replayed code, `error` callback, wrong `state`, expired PendingSignIn |
| The WebSocket upgrade refuses what HTTP refuses (P-88) | Each bad session above also opens a WebSocket and is refused `401`; a valid one is admitted |
| No serving on a bad configuration, recording continues (P-89, P-96) | Server mode with each required value removed: no port is open, plays from a scripted player are recorded |
| A state-changing request from another site is refused (BR-92.4) | Valid cookie, no `Origin` → refused; foreign `Origin` → refused; missing `ingestGuard` header → refused |
| Secrets never in output (P-97) | Full sign-in log and bodies searched for each secret value; one deliberate leak makes it fail |
| Sign out everywhere ends every session (BR-94.2) | Two sessions; after it, both refused on HTTP and WebSocket |
| The connection closes at expiry (P-93) | A 2 s lifetime; the socket closes with 4401 |
| WAL read-back (P-101) | An in-memory database → display-only, Diagnostics fails naming `memory` |
| Local mode unchanged (BR-92.6) | The existing `localGuard` tests pass untouched; a server-mode cookie sent to local mode changes nothing |

## Properties

| ID | Property | Component · rule |
|---|---|---|
| **PBT-91** | `parseMode`: `local` for absent, `local`/`server` for those exact values, refusal for every other string | LC-82 · BR-88.1 |
| **PBT-92** | `validateServerConfig`: for any configuration missing any required field, or with a non-`https` origin or an origin with a path, the result is `problems` and names each; a complete valid one is `ok` | LC-82 · BR-88.3–88.4 |
| **PBT-93** | Public-address Host check: the configured host (with or without its default port) is admitted; appending any label, character or port, or any other host, is refused; an `Origin` is admitted iff equal to the public origin | LC-83 · BR-92.2 |
| **PBT-94** | `decideAccess`, server mode: for any request to a route outside the sign-in list, no valid session → not admitted; a valid session with a wrong Host → not admitted; the sign-in routes are admitted only with a valid Host | LC-83 · BR-92.1, 92.3 |
| **PBT-95** | `safeReturnPath`: for any input string, the result resolved against the public origin has the public origin | LC-87 · BR-89.5 |
| **PBT-96** | Session codec: sign → verify round-trips; flipping any byte, verifying under any other key, any `now` ≥ `exp`, or any non-`v1` string gives *invalid* or *expired*, never valid | LC-84 · BR-91.2 |
| **PBT-97** | `onClose`: 4401 or a `401` → *signed out*; every other code and status → *reconnect* | LC-94 · BR-93.3 |
| **PBT-98** | `compareCorpora`: pass iff same table names, equal counts and equal hashes; every difference is listed; comparing a fingerprint with itself always passes | LC-93 · BR-98.2 |
| **PBT-99** | Pending sign-ins: under any sequence of creates, consumes and clock advances, the store never exceeds 32, never returns an expired or consumed entry, and returns each live one at most once | LC-87 · BR-89.3 |
| **PBT-100** | Local mode is unchanged: for any request, `decideAccess` in local mode equals the pre-U11 rule (a frozen copy kept in the test) | LC-83 · BR-92.6 |
