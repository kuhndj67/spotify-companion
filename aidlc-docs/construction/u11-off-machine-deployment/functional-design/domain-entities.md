# U11 — Off-machine Deployment — Domain Entities

Technology-agnostic. **Persisted** means it survives a restart; nothing here is stored in the history database, and
nothing here is in a backup (BR-95.1).

---

## AccessMode (value)

`local` | `server`. Absent → `local` (BR-88.1). Read once at startup; changing it is a restart.

## ServerAccessConfig (value, server mode only; BR-88.3)

| Field | Meaning | Source |
|---|---|---|
| `publicOrigin` | `https://<host>[:<port>]`, no path. The address the owner's devices open, and the redirect address's origin | configuration |
| `issuer` | the provider's exact issuer string | configuration |
| `clientId` | this app's registration at the provider | configuration |
| `clientSecret` | the registration's secret | **secrets folder** (file) |
| `allowedSubject` | the one account admitted (Q6 = A): the provider's `sub` for the owner | configuration |
| `sessionLifetime` | duration, 1 h … 90 days (⚖️ proposed 7 days) | configuration |
| `certificate`, `certificateKey` | the HTTPS certificate (chain) and its key | certificate: configuration folder or secrets; key: **secrets folder** |
| `providerTrustAnchor` | optional: a private authority's certificate, for the app's TLS calls to the provider | public file (BR-95.4) |

Derived: `redirectUri = publicOrigin + "/auth/callback"`, registered at the provider by the owner.
Invariant: valid as a whole or the app does not serve; recording is unaffected either way (BR-88.4, BR-91.6).

## AccessPolicy (value, extended)

Today: `{ localOnly, trustPublishedPort }`. Becomes a tagged value:
`{ mode: "local", localOnly, trustPublishedPort }` | `{ mode: "server", publicOrigin, allowedSubject }`.
`decideAccess` reads only this, the request fields and an injected session verifier, so the rule stays one pure
function (BR-92.1).

## AccessRequest (value, extended)

Today: `{ remoteAddress, host, origin }`. Adds `method`, `path` (route class, BR-92.3) and `cookie` (the session). Both
HTTP and the WebSocket upgrade fill it the same way.

## AccessDecision (value, extended)

`{ ok: true, identity? }` | `{ ok: false, reason }`, reason ∈ today's `peer`, `host-or-origin`, plus `no-session`,
`session-invalid`, `session-expired`, `wrong-account`. Callers map reason × request kind to a response (BR-92.5).

## ProviderMetadata (value, cached in memory)

From the discovery document: `issuer`, `authorizationEndpoint`, `tokenEndpoint`, `jwksUri`, supported response types,
PKCE methods and signing algorithms; `fetchedAt`. Refetched at startup and when keys must be refetched.

## ProviderKeySet (value, cached in memory)

The published public keys, by `kid`; `fetchedAt`; the time of the last refetch (rate limit, BR-90.6). Public data.

## PendingSignIn (entity, in memory, ≤ 10 minutes; BR-89)

| Field | |
|---|---|
| `id` | random; carried by the pre-sign-in cookie |
| `state`, `nonce`, `pkceVerifier` | random, single use |
| `returnPath` | already passed through `safeReturnPath` |
| `expiresAt` | creation + 10 min |

Lifecycle: created → consumed (success or failure) | expired. Never persisted, never logged.

## VerifiedIdentity (value, transient)

`{ subject, issuedAt }` from a verified ID token (BR-90). Exists only between verification and session creation.

## Session (value, carried by the browser; BR-91)

`{ sessionId, subject, issuedAt, expiresAt }` plus a MAC under the SessionKey. The app keeps no copy: the cookie
**is** the session. Valid ⇔ MAC verifies under the current key ∧ now < expiresAt ∧ subject = allowedSubject ∧
sessionId not in RevokedSessions.

## SessionKey (secret, **persisted** in the secrets folder; BR-95.2)

≥ 32 random bytes. Created at first server-mode start; replaced by *Sign out everywhere*. One at a time: no key
rotation window, so replacing it ends every session at once (intended).

## RevokedSessions (in memory)

Session ids signed out individually (BR-94.1), each kept until its own `expiresAt`. Lost on restart, by design;
*Sign out everywhere* is the durable revocation.

## LiveConnection (existing, extended)

A WebSocket client now carries the `sessionId` and `expiresAt` it was admitted with, so it can be closed at expiry
and on sign-out (BR-93.2).

## CorpusFingerprint (value; BR-98)

`{ tableCounts: { <table>: <rows> }, rulesHash }`, read from Diagnostics. Two fingerprints compare to *pass* or a list
of differences.

## DeployCommand (value; BR-99)

`deploy(version)` | `rollback(version)` | `status` | `logs`, with `version` a released tag. Parsed from SSH's
forced-command arguments, or refused.

## Relationships

```
ServerAccessConfig ──configures──▶ AccessPolicy ──read by──▶ decideAccess ◀── AccessRequest (HTTP | WS upgrade)
        │                                                   │
        ├─issuer──▶ ProviderMetadata ──jwksUri──▶ ProviderKeySet ──verifies──▶ ID token ─▶ VerifiedIdentity
        │                                                                                    │ subject = allowedSubject
        └─sessionLifetime                    PendingSignIn ──callback──────────────────────▶ Session ◀─MAC─ SessionKey
                                                                                              │
                                                              LiveConnection ──admitted with──┘   RevokedSessions
```
