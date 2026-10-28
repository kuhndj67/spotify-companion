# U11 — Off-machine Deployment — Business Rules (BR-88 … BR-99)

**Inputs**: NFR-29 (amended 2026-10-24) · NFR-01…05, NFR-28 · FD plan Q1–Q11, Q4a · US-34 · `research-findings.md`,
*Machine 2's SSO Server* (measured provider behaviour).
⚙️ marks a decision that is **pure** (a function of its inputs) and so a property-test candidate; PBT numbers are
allocated at NFR Design. 🔴 marks a rule whose test must be **seen to fail** on a bad input (a forged, expired,
wrong-audience, wrong-account or unsigned token or session), or the rule is a belief.
⚖️ marks a value proposed here for the **owner to confirm at review** (security posture).

---

## BR-88 — Two access modes, chosen explicitly (NFR-29, Q1)

- **88.1 One setting, two values**: `local` and `server`. Absent → `local`. Any other value → the app refuses to
  start, naming the setting. ⚙️ `parseMode(raw)`.
- **88.2 Local mode is today's behaviour, unchanged**: `decideAccess`'s loopback peer and Host/Origin checks,
  `trustPublishedPort` as now. No sign-in route exists in local mode (they answer `404`).
- **88.3 Server mode requires all of**: the **public address** (an `https://` origin: scheme, host, port; no path),
  the **issuer** (exact string), the **client ID**, the **client secret** (a file, BR-95), the **allowed account**
  (BR-90.5), the **certificate and key** (files), the **session lifetime** (BR-91.3).
- **88.4 Fail closed: no serving, recording unaffected.** Server mode with any 88.3 value missing, unreadable or
  invalid (an `http://` public address, a certificate that does not parse, a key that does not match it) → the app
  **opens no listener at all**: it never falls back to local mode and never serves without the sign-in. It logs one
  line per problem at startup and repeats a one-line summary every hour. **Polling and recording run as usual**
  (BR-91.6). *Amended 2026-10-24 after FD approval (owner: the data-collection side runs indefinitely; only user
  sign-ins are time-limited). As first written, the app exited, which also stopped recording.* ⚙️
  `validateServerConfig(values) → ok | problems[]`. 🔴 (and a test that recording continues while serving is refused)
- **88.5 Not inferred.** Nothing switches mode on its own: not the presence of a certificate, not the network, not
  `inContainer`. `trustPublishedPort` and `LOCAL_ONLY=false` have **no effect** in server mode (the server rule
  replaces them), and Diagnostics says so if they are set.
- **88.6 Provider discovery.** In server mode the app fetches the issuer's discovery document; its `issuer` must
  equal the configured issuer **exactly**, and it must offer `code`, `S256` and `RS256`. A mismatch or unreachable
  provider → the app serves, **sign-in is refused** with the reason (BR-90.6), Diagnostics fails, and discovery is
  retried (at most once a minute, on a sign-in attempt). Existing sessions and recording are unaffected. *Amended
  2026-10-24 with 88.4: a mismatch first refused to start.* 🔴

## BR-89 — A sign-in in progress (PendingSignIn)

- **89.1 Created by `GET /auth/sign-in`** with fresh random `state`, `nonce` and PKCE verifier (≥ 32 bytes of
  randomness each), the requested **return path**, and an expiry.
- **89.2 Bound to the browser** by a short-lived pre-sign-in cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, path
  `/auth/`), so a callback carrying someone else's `state` is refused.
- **89.3 Single use, ten minutes.** Consumed by the first callback that names it, success or failure; expired ones
  are dropped. At most a small fixed number are held at once (oldest dropped first), so repeated sign-in attempts
  cannot grow memory. Held in memory: a restart only forces a new sign-in.
- **89.4 The callback is refused** (sign-in-problem page, BR-92.3) when: no pre-sign-in cookie, unknown or expired
  `state`, `state` not matching the cookie, the provider returned `error`, or redemption failed. Each names its reason
  in one sentence; none echoes the code or a token. 🔴
- **89.5 Return path: same origin only.** Accepted only if it starts with a single `/`, not `//` or `/\`, contains no
  scheme and no control characters, and is at most 512 characters; anything else becomes `/`. The open-redirect
  defence. ⚙️ `safeReturnPath(raw)`, property: the result, resolved against the public address, always has the public
  address's origin. 🔴

- **89.6 Sign in at the provider first, when it needs that** *(added 2026-10-24, owner: Step 10 gate, option A)*.
  Measured on Machine 2: SSO Server's sign-in page does not resume an authorization request that arrives with no SSO
  Server session (it loops, for every account), but completes at once when its own session exists. So, when the
  optional setting `OIDC_PROVIDER_PORTAL` is set (an `https://` address), `GET /auth/sign-in` first shows a page:
  *1. sign in at the provider (opens in a new tab); 2. Continue*. *Continue* is `/auth/sign-in?go=1&return=…`, which
  starts the sign-in as in 89.1. Without the setting, `/auth/sign-in` starts it at once (a provider that works
  directly). The app cannot tell whether the provider has a session (`prompt=none` is not honoured there, measured),
  so the page appears on every sign-in the app needs. Admitted without a session (it is `/auth/sign-in`, BR-92.3).

## BR-90 — The provider's ID token, verified once at the callback

- **90.1 Signature** with the provider's published key whose `kid` matches the token header. **Algorithm
  allow-list: `RS256` only.** `none`, symmetric algorithms and any algorithm the key does not declare are refused. 🔴
- **90.2 `iss`** equals the configured issuer exactly. 🔴
- **90.3 `aud`** equals the client ID, or is an array containing it; if an array has other members, `azp` must
  equal the client ID. (The first target sends a string; measured.) 🔴
- **90.4 `nonce`** equals the PendingSignIn's. **Time**: `exp` > now − skew and `iat` < now + skew, skew 60 s.
  (Measured skew on the first target: 0 s; the allowance covers drift, not design.) 🔴
- **90.5 The allowed account (Q6 = A)**: the token's `sub` equals the configured allowed account **exactly**
  (case-sensitive). Any other verified account → `403` page *"Signed in as <sub>. This app admits only its owner's
  account."* No session is created. (On the first target `sub` is the provider's user name; measured.) 🔴
- **90.6 Keys.** Fetched from the discovery document's key-set address, cached; an unknown `kid` triggers **one**
  refetch, at most once a minute. If no key can be obtained, sign-in is refused (*"The sign-in provider cannot be
  reached"*); **existing sessions are unaffected**. Never admit on a verification that could not be performed. 🔴
- **90.7 Used once.** After 90.1–90.5 the token is discarded. Neither it nor the access token is stored, logged,
  forwarded or put in a cookie. ⚙️ `verifyIdToken(token, keys, expected, now) → identity | reason` is pure.

## BR-91 — The app's session

- **91.1 Content**: subject, issued-at, expires-at, a random session id. Nothing else: no token, no provider data.
- **91.2 Signed** with the session key (a keyed MAC over the content); verified in constant time. A session that
  fails verification is treated as absent, never as partially valid. ⚙️ `signSession` / `verifySession(cookie, key,
  now)`. 🔴 (a flipped byte, a re-signed content under another key, an expired one, an empty one)
- **91.3 Lifetime**: absolute, from sign-in; **not** extended by use. ⚖️ **Proposed default 7 days**, configurable
  from 1 hour to 90 days; out of range → no serving (BR-88.4). After expiry the owner signs in again; while the
  provider's own session lasts, that sign-in may be silent.
- **91.4 The cookie**: name prefixed `__Host-` (so it is `Secure`, path `/`, and bound to this exact host),
  `HttpOnly`, `SameSite=Lax`, `Max-Age` equal to the remaining lifetime. `Lax` and not `Strict`, because the callback
  is reached by a cross-site redirect from the provider and must set it; state-changing requests are protected by
  BR-92.4, not by `SameSite`.
- **91.5 The subject is rechecked on every request** against the allowed account, so changing the allowed account
  (a restart with a new value) invalidates every session for the old one.

- **91.6 Recording never depends on access** *(added 2026-10-24, owner: "the app as deployed should run
  indefinitely on the data collection side … but user logins can have a limited session length")*. Session expiry,
  sign-out, *Sign out everywhere*, an unreachable or misbehaving provider, and refused server configuration (88.4)
  never stop, pause or slow polling, recording, kept backups or rule evaluation. Nothing on the poll and record path
  reads the access mode, a session or the provider. The only planned interruption is a restart (certificate renewal,
  release), after which the existing backfill recovers recent plays. 🔴 (a structural test: no module on the poll and
  record path imports an access module)

## BR-92 — Admission in server mode: `decideAccess`, the one rule (NFR-29)

- **92.1 Order**: Host/Origin → route class → session. First failure decides. ⚙️ pure given the policy, the key and
  `now`. 🔴 per reason.
- **92.2 Host/Origin**: `Host` must equal the public address's host and port (default port omitted or explicit,
  both accepted); `Origin`, when present, must equal the public address's origin. The same parsing discipline as the
  loopback check (no trailing content admitted). Keeps the DNS-rebinding defence. 🔴 (property: appending any label
  or character to the configured host must not stay admitted)
- **92.3 Route class**: only `GET /auth/sign-in`, `GET /auth/callback`, `GET /auth/problem` and the one stylesheet
  those pages use are admitted **without** a session. Everything else, every page, asset, API route, the WebSocket
  and Diagnostics, needs one (Q7 = A). The list is in `decideAccess`, not in the routes. 🔴
- **92.4 Cross-site requests**: every state-changing route keeps `ingestGuard` (its custom header) **after**
  `decideAccess`, and in server mode a state-changing request **must** carry an `Origin` equal to the public origin
  (absent is refused, unlike a `GET`). A cookie is sent automatically; the header and the origin are not. 🔴
- **92.5 Responses by reason and request kind**: a page navigation without a valid session → `302` to
  `/auth/sign-in?return=<path>`; an API request → `401` JSON `{ signIn: "/auth/sign-in" }`; a WebSocket upgrade →
  `401` before the handshake; `host-or-origin` → `403` text, as today; `wrong-account` → `403` page (BR-90.5).
- **92.6 Local mode**: `decideAccess` behaves exactly as today. The existing tests stay, unchanged, and pass. 🔴
  (a server-mode session cookie sent to a local-mode app grants nothing new)

## BR-93 — The live connection never outlives its session

- **93.1** The upgrade is admitted by BR-92 with the cookie it carries.
- **93.2** The server closes each connection at its session's expiry, on sign-out of that session (BR-94.1) and on
  sign-out everywhere (BR-94.2), with close code **4401** and reason *signed out*.
- **93.3** The page, on 4401, stops reconnecting and shows *Signed out* with a sign-in link (frontend §3). On any
  other close it reconnects as today; a reconnect answered `401` is treated as 4401. ⚙️ `onClose(code, httpStatus)
  → reconnect | signedOut`. 🔴

## BR-94 — Signing out

- **94.1 Sign out** (`POST /auth/sign-out`, BR-92.4 applies): expires the cookie, closes this session's
  connections, redirects to a *Signed out* page. The session id is remembered as revoked until its expiry (in memory;
  a restart forgets it, so the page also says *Sign out everywhere* is the one that survives a restart).
- **94.2 Sign out everywhere** (`POST /auth/sign-out-everywhere`): writes a **new session key** (BR-95.2) and closes
  every connection. Every existing session then fails BR-91.2.
- **94.3** Neither signs the owner out of the provider, and the page says so.

## BR-95 — Secrets and what is never shown

- **95.1 Client secret, session key, certificate key** are files in the app's secrets folder (`secrets/app/` on the
  host, the `/app/secrets` mount since U9): never in the repository (NFR-28), never in a backup or export, never in a
  response, a log line or Diagnostics (NFR-05). Diagnostics may say each is *present* and, for the certificate, its
  subject and expiry.
- **95.2 The session key** is created at first start in server mode if absent (≥ 32 random bytes, written by
  exclusive create, readable by the app only), and replaced only by BR-94.2. Deleting the file has the same effect as
  *Sign out everywhere*.
- **95.3 Never logged**: authorization codes, ID and access tokens, cookies, the PKCE verifier, `state`, `nonce`, the
  client secret, the session key. **Logged**: each sign-in's outcome and reason, with the subject on success and on
  `wrong-account`. 🔴 (a test captures the log of a full sign-in and searches it for each secret value)
- **95.4 The provider's trust anchor** (a private authority's certificate, when the provider uses one) is public and
  may live beside the other configuration; it is not a secret.

## BR-96 — TLS and Diagnostics in server mode

- **96.1 HTTPS only.** One listener, TLS, with the configured certificate and key. No plain-HTTP listener in server
  mode.
- **96.2 Diagnostics adds an *Access* check**: mode; public address; issuer and whether its discovery and keys were
  fetched (and when); allowed account; session lifetime; certificate subject, names and expiry; whether
  `trustPublishedPort` or `LOCAL_ONLY` are set and ignored (BR-88.5). **Fails** if keys cannot be fetched or the
  certificate has expired; **warns** inside 30 days of expiry or if the certificate does not cover the public
  address's host. In local mode the check reads *Local only* and passes.

## BR-97 — WAL is checked, not assumed

- **97.1** After asking SQLite for WAL, the app reads back the mode SQLite **actually** chose. Not `wal` → the app
  does not record (no migration, no writes), runs display-only, and Diagnostics fails naming the mode it got and the
  database path. Both access modes. 🔴 (measured basis: an in-memory database refuses WAL without throwing; the test
  uses that as its failing input)

## BR-98 — The exit test's comparison (Q10 = A)

- **98.1 Inputs**: from Diagnostics on each side, every table's row count (the same table list a backup manifest
  carries) and the rules file's content hash.
- **98.2 Pass** only if both maps have the **same table names** and **equal counts**, and the hashes are equal.
  Otherwise **fail**, listing each table missing on one side or differing, and the hash difference. ⚙️
  `compareCorpora(a, b) → pass | differences[]`. 🔴
- **98.3 Order**: taken immediately after *Restore backup* on the server and **before** its Spotify credentials are
  pasted (BLM §8). Diagnostics shows the counts and hash if it does not already.

## BR-99 — The deploy script's arguments (Q8 = B, later)

- **99.1** The forced-command script accepts exactly: `deploy <version>`, `rollback <version>`, `status`, `logs`.
  `<version>` must match `^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$` and nothing else; any other input is refused with a usage
  line and exit code 2, before anything runs. No argument reaches a shell unquoted. ⚙️ `parseDeployCommand(argv)`. 🔴
- **99.2** The image it deploys is the published image at exactly that tag; it never builds and never pulls
  `latest`.
