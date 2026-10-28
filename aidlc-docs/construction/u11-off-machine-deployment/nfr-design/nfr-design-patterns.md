# U11 NFR Design Patterns — Off-machine Deployment

**Unit**: U11 · **Date**: 2026-10-24 · **Plan**: [`u11-nfr-design-plan.md`](../../plans/u11-nfr-design-plan.md) — Q1–Q6 all A
**Allocates**: **P-88…P-101** · components and properties in [`logical-components.md`](logical-components.md)

The common thread: **every authentication check is seen to refuse a bad input, through the entry point the browser
uses, and none of them can reach the data-collection side.** The one earlier failure of this kind was a second copy
of the admission rule on the WebSocket path, green in every test because no test went through that path.

Scalability: **not applicable** (one user, one allowed account; in-memory state bounded by P-99). Performance: one
MAC check per request; provider calls only at sign-in. Availability: recording never depends on access (P-96).

---

## P-88 — One admission rule, pinned by structure (BR-92; NFR-29)

**Problem**: HTTP passes through Express middleware; the WebSocket upgrade does not. Two call sites invite two rules.

**Pattern**: `decideAccess(request, policy, verifySession, now)` stays pure and is the only place admission is
decided, in both modes. The middleware and the upgrade handler each build an `AccessRequest` with one shared helper
and map the decision's reason to a response; neither inspects a cookie, a header or the mode itself. A structural test
fails if `server.ts`'s upgrade handler or any route module reads the session cookie or calls the session verifier
directly, and the full-flow tests (P-94) open a WebSocket with each bad session and see it refused.

## P-89 — Validate everything before the listener (BR-88.4, 88.5)

**Pattern**: `parseMode` and `validateServerConfig` are pure and run at startup, before the listener is opened and
after history has started (P-96). Problems are a list, all reported at once, never only the first. `ok` is the only
path to opening an HTTPS listener; there is no code path that opens a plain-HTTP listener in server mode. Positive
controls: each required value removed in turn, an `http://` origin, a certificate whose key does not match.

## P-90 — A library at the edge, our rules in the middle (Q1 = A; BR-89, BR-90)

**Pattern**: `openid-client` 6 is used inside **one** module (the provider client, LC-86) and nowhere else. It does
discovery, the authorization URL (PKCE S256, state, nonce), code redemption and ID-token validation, configured with
`id_token_signed_response_alg: RS256`. The module returns our own `VerifiedIdentity | reason`; the allowed-account
check (BR-90.5) and everything after it are ours. Library errors are mapped to a reason **and an error name only**:
an error object may carry the provider's response, so it is never logged whole (P-97).

**Versions**: `openid-client` is pinned **exactly** in `package.json` (as `tar` is), its two dependencies are
locked by `package-lock.json`, and moving the pin is a reviewed change with the full-flow tests green.

**Swappable**: the fake-provider tests (P-94) drive the module through HTTP, not through the library's API, so
replacing the library (Q1 = B or C later) changes one module and no test.

## P-91 — A session format with nothing to negotiate (Q2 = A; BR-91)

**Pattern**: `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(key, "v1." + payload))>`. Verification: split into
exactly three parts → version is `v1` → recompute the MAC → compare with `timingSafeEqual` after a length check →
**only then** parse the payload → check `exp`, subject, revocation. No algorithm field, no key id, no header: nothing
an attacker can choose. Any failure before the comparison is *invalid*, never an exception that reaches a caller.

## P-92 — Never admit on a check that could not run (BR-90.6, 92.1)

**Pattern**: every verifier returns a tagged result; there is no boolean "valid" that defaults to true, and no
`try { … } catch { next() }`. An exception inside `decideAccess`'s session step is converted to `session-invalid`.
Provider unreachable → sign-in refused; sessions, being the app's own, still verify. Positive control: a verifier
stub that throws; the request is refused.

## P-93 — A live connection carries its own deadline (BR-93)

**Pattern**: a registry of open sockets keyed by session id. At admission each socket gets a timer for its
session's `expiresAt`; sign-out closes that session's sockets, *Sign out everywhere* closes all; each close uses code
**4401**. The page's `onClose(code, httpStatus)` (pure) chooses *signed out* or *reconnect*. Timers are cleared on
close, so the registry is bounded by open sockets.

## P-94 — A fake provider that can misbehave on purpose (Q3 = A)

**Pattern**: `test/support/fakeOidcProvider.ts` serves, on a random local port over HTTPS with a test CA generated
per run: discovery, a key set (a generated RSA key, plus a second key it can switch to), an authorization endpoint
that redirects straight back, and a token endpoint. Switches make it misbehave: wrong `iss`, wrong `aud`, an `aud`
array without `azp`, expired, `iat` in the future, `alg: none`, `HS256` signed with the public key, an unknown `kid`,
a tampered signature, another account, a replayed code, an `error` callback, unreachable. The app's **real** routes,
middleware and upgrade handler run against it. Each 🔴 in BR-88…BR-95 is one switch and one refusal.

**Live acceptance**, by hand, against Machine 2's SSO Server: sign-in from another device, the Settings → Access
section, sign-out, *Sign out everywhere*, the live connection closing at expiry (with a short lifetime set for the
test), recorded in `research-findings.md`.

## P-95 — Retest the loop before building on it (Q4 = A; FD §2)

**Pattern**: Code Generation's **step 1** is the sign-in routes alone (server mode, admitting nothing beyond the
sign-in pages), run against SSO Server from another device, each attempt recorded: completed, looped, or landed on the
portal. A loop that persists **stops Code Generation** and returns the FD plan's Q3 with the facts. Nothing else is
built on SSO Server before this result.

## P-96 — Recording is independent of access (BR-91.6; owner 2026-10-24)

**Problem**: the owner's deployment must collect data indefinitely, while user sign-ins are time-limited. Any
coupling (startup order, a shared failure path, an exception from the provider client) could stop recording.

**Pattern**: the startup sequence opens history and starts polling **before** access is configured; access
configuration failing (P-89) or the provider failing (P-92) leaves the recorder running. No module on the poll and
record path imports an access module, enforced by a structural test in the style of `purity` and `noOrphanModules`.
An unhandled error in the access path is logged and refused, never fatal to the process. Positive control: start
server mode with an invalid configuration and see plays still recorded from a scripted player.

## P-97 — Secrets never reach an output (BR-95.3)

**Pattern**: log lines from the access modules are built from an allow-list of fields (outcome, reason, error name,
subject when allowed), never from objects. One test runs a full sign-in, sign-out and a failed sign-in against the
fake provider, captures every log line and response body, and searches them for the code, both tokens, the cookie
value, the verifier, `state`, `nonce`, the client secret and the session key. It is seen to fail by logging one of
them deliberately once.

## P-98 — A renewed certificate is picked up by a restart (Q5 = A; BR-96)

**Pattern**: the certificate and key are read once at startup. Diagnostics warns 30 days before expiry and fails
after it. The install guide's renewal step ends with a restart, whose only cost is the gap backfill covers (P-96).

## P-99 — Bounded in-memory state (Q6 = A; BR-89.3, 94.1)

**Pattern**: PendingSignIns are capped at **32**, oldest evicted first, each pruned at 10 minutes. Revoked session ids
are pruned at their own expiry. Neither grows with attempts. No per-address rate limit: the provider checks passwords
and the LAN is private; reaching the app from beyond the LAN is out of scope and would reopen this.

## P-100 — HTTPS only, and the cookie bound to it (BR-91.4, 96.1)

**Pattern**: in server mode the one listener is `node:https` with the configured certificate; Express and the `ws`
upgrade attach to it exactly as to today's HTTP server. The session cookie's `__Host-` prefix makes the browser refuse
it over HTTP or for another host. No HSTS header: there is no HTTP listener to upgrade from.

## P-101 — WAL is read back, not assumed (BR-97)

**Pattern**: after `PRAGMA journal_mode = WAL`, the returned row is read; anything but `wal` → display-only with the
reason, before migration. Positive control: the same code on an in-memory database (measured to answer `memory`
without throwing).
