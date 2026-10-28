# U11 — Off-machine Deployment — Business Logic Model

**Inputs**: NFR-29 (as amended and ratified 2026-10-24) · FD plan Q1–Q11 and Q4a (answered 2026-10-24) · US-34 ·
`research-findings.md`, *Machine 2's SSO Server as an OIDC provider* (the measured provider behaviour this design is
built against) · U6 (*Restore backup*), U7 (credentials from Settings), U10 (the writer lock, kept backups).
Rules are in [`business-rules.md`](business-rules.md) (BR-88 … BR-99), entities in
[`domain-entities.md`](domain-entities.md), screens in [`frontend-components.md`](frontend-components.md).

> **The promise**: the app runs on a server and is fully usable from another device on the LAN, and nobody who has
> not signed in as the owner can reach it. A deployment that stays local is unchanged.

The design names **services a container host must provide**, never a product (Q9, Q3 note). Where Machine 2 is the
first concrete host, it is named as *the first target*, and its specifics go to the install guide's *For Synology
deployment* subsections.

---

## 1. Two access modes, chosen explicitly (Q1, BR-88)

| | **Local** (default, today) | **Server** (new) |
|---|---|---|
| Who reaches it | Only this machine: the `127.0.0.1` publish, the peer check (host run) and Host/Origin = loopback | Any device that can reach the address, **after signing in** as the one allowed account |
| Transport | HTTP on loopback | **HTTPS only**, served by the app with the configured certificate |
| Proof per request | None (NFR-01…04 justify it) | A **session the app signed** (BR-91), plus Host/Origin = the configured public address |
| Sign-in | None | OIDC authorization code with PKCE against the configured provider (BR-89, BR-90) |
| Configuration | Nothing new | Public address, provider (issuer), client ID, client secret, allowed account, certificate and key, session lifetime (BR-88.3) |

The mode is **one setting** with exactly two values; absent means **local**. Nothing infers it (not the network, not
the presence of a certificate, not "in a container"). Server mode with any required value missing or invalid
**opens no listener** (BR-88.4): it never falls back to local, and never serves without the sign-in.

**Recording is independent of access** (BR-91.6, owner 2026-10-24): data collection runs indefinitely. Only browser
sign-ins are time-limited; nothing about sessions, sign-out, the provider or a refused configuration stops polling
or recording.

`decideAccess` stays the **one** admission rule. It gains the mode and, in server mode, the session check; HTTP and
the WebSocket upgrade still call it with the same inputs (BR-92).

## 2. The sign-in (BR-89, BR-90)

```
Browser (no session)            App (server mode)                      Provider (issuer)
  GET /anything  ───────────────▶ decideAccess: no session
                 ◀── 302 /auth/sign-in?return=/anything   (page navigations)
                 ◀── 401 {signIn}                         (API calls, WebSocket upgrade)
  GET /auth/sign-in ────────────▶ new PendingSignIn {state, nonce, PKCE verifier, return path, expiry}
                                   pre-sign-in cookie binds it to this browser
                 ◀── 302 provider authorize (code, S256 challenge, state, nonce)
  … the provider signs the user in (password, second factor: the provider's business, never the app's) …
  GET /auth/callback?code&state ▶ match state to this browser's PendingSignIn (single use, unexpired)
                                   redeem code + verifier + client secret ─────────────▶ token endpoint
                                   ◀────────────────────────────────────────── ID token (180 s on the first target)
                                   verify ID token once (BR-90): key, alg, iss, aud, nonce, time
                                   subject == the allowed account?  no → 403 "signed in as <sub>, not allowed"
                                   yes → mint Session (BR-91), Set-Cookie, discard PendingSignIn
                 ◀── 302 return path (same-origin only, BR-89.5)
```

- The provider's token is used **once**, at the callback. From then on the app's own session is the proof (NFR-29 as
  amended). This is why the 180 s token lifetime and the missing refresh token, both measured, do not matter.
- The app **never** sees a password. It holds a **client secret** (to redeem codes) and a **session key** (to sign
  sessions), both in the secrets folder (BR-95).
- **Measured hazards the flow must survive** (first target): a sign-in started from an authorize link has **looped**
  on the provider's pages (twice) or **landed on the provider's own portal** (once). The app cannot stop either; it
  can make each harmless and recoverable: an abandoned PendingSignIn simply expires (BR-89.3), a later attempt starts
  fresh, and the sign-in page says what to do when the provider does not return (frontend §2). ⚠️ **The loop must be
  retested through this flow** before Code Generation is accepted; if it persists, Q3 (the provider) returns.

## 3. Every request after sign-in (BR-91, BR-92)

`decideAccess(request, policy)`, server mode, in order; the first failure decides:

1. **Host** equals the configured public address's host (and port), and **Origin**, if present, equals its origin.
   This keeps the DNS-rebinding defence: it replaces "loopback" with "the one configured address". ⚙️ pure.
2. **Route class.** The sign-in routes (`/auth/sign-in`, `/auth/callback`, the sign-in-problem page and its
   stylesheet) are admitted without a session. **Nothing else is** (Q7 = A: everything is behind sign-in).
3. **Session** cookie present, signature valid under the current session key, not expired, subject equal to the
   allowed account. ⚙️ pure given the key and `now`.

The decision carries a **reason** (`host-or-origin`, `no-session`, `session-invalid`, `session-expired`,
`wrong-account`) so each caller keeps its own response: a page navigation is redirected to sign in; an API call gets
`401` with a JSON body naming the sign-in address; a WebSocket upgrade is refused `401` before the handshake.

**State-changing routes** keep `ingestGuard` (its custom header) on top. A cookie is sent by the browser
automatically, so the custom header and the Origin check are what stop another site from driving the app through
the owner's browser (BR-92.4).

## 4. The live connection (BR-93)

The WebSocket upgrade is admitted by the same rule (the browser sends the session cookie with it). A connection must
not outlive its session: the server closes it, with a distinct close code, **at the session's expiry** and **on
sign-out**. The page, on that code, shows *Signed out* with a sign-in link instead of its usual
*Disconnected, reconnecting…* loop, which would otherwise retry forever against a `401`.

## 5. Sign-out (BR-94)

- **Sign out** (this browser): clears the cookie, closes this session's live connections.
- **Sign out everywhere**: replaces the session key, so every existing session fails its signature check at once;
  closes every live connection. The only revocation there is, and enough for one user.
- Neither signs the owner out **of the provider**. The page says so: the next sign-in may be silent while the
  provider's own session lasts (measured: silent re-sign-in works while it lives).

## 6. TLS and the provider's keys (BR-90.6, BR-96)

- In server mode the app listens **HTTPS only**, with the certificate and key from the secrets folder. No plain-HTTP
  listener, so a session cookie (`Secure`) can never travel unencrypted.
- The app is also a **TLS client** of the provider (discovery, keys, token redemption). If the provider's
  certificate comes from a private authority, the app is given that authority's certificate as a trust anchor. It is
  a public certificate, not a secret.
- Keys are fetched from the provider's published key set, cached, and refetched on an unknown key id (rate-limited).
  If they cannot be fetched, **sign-in is refused** with a sentence; existing sessions keep working, because they are
  the app's own.
- Diagnostics shows the mode, the public address, the provider and whether its keys were fetched, the certificate's
  expiry (a warning inside 30 days), and the session lifetime (BR-96).

## 7. The database on a new volume (BR-97)

At startup the app checks the journal mode SQLite **actually** chose after asking for WAL. Not `wal` → the app does
not record and runs display-only, Diagnostics failing with the reason. Found while planning: today the result is
unread and SQLite does not throw (measured), so a volume without WAL would go unnoticed. The first target's volume is
Btrfs; WAL there is expected to work and is **measured** by this check, not assumed.

## 8. The trial, the exit test and the move (Q1, Q2, Q10, BR-98)

```
① Install on the server by following INSTALL-APP's server part (Q9): the walk is the verification.
② Server mode on, signed in from another device. NO Spotify credentials yet: the app polls nothing.
③ Backup here (Create backup) → Restore backup on the server, from the other device's browser (Q7 = A).
④ Exit test (Q10 = A): every table's count, and the rules file's hash, from Diagnostics on both sides, compared
   immediately after the restore and before the server polls. Equal → pass. Any difference → fail; nothing goes on.
⑤ The server's OWN Spotify registration (Q2 = A) pasted into its Settings; it polls. The trial runs beside this
   machine's deployment, each with its own quota.
⑥ The move, on a day the owner chooses: final backup here → restore on the server → this machine's container is
   stopped and stays stopped. From then on the server is the only deployment that records.
```

- ③ before ⑤ matters: a server that polled before the comparison would have rows this machine lacks.
- The trial's own plays are **discarded** by the restore at ⑥ (Q1 = A). Plays this machine records between ③ and ⑥
  arrive with ⑥'s backup.
- ⚠️ **Nothing enforces "one recorder" across machines.** U10's lock is per database, and the two databases are
  different files on different machines. After ⑥ it is a procedure, stated in the install guide, not a guarantee.
- This machine keeps **local** mode for development (`data-dev/`), unchanged.
- ⚙️ The comparison is pure: two count maps and two hashes → pass, or the list of differences.

## 9. Releases reaching the server (Q8)

- **First deployment by hand** (Q8 = A for now): the owner edits the image tag in the host's compose project and
  restarts it, following the install guide.
- **Later, the restricted deploy path** (Q8 = B), designed in Infrastructure Design: a dedicated server user whose one
  SSH key may only run an owner-written script offering `deploy <version>`, `status`, `logs`, `rollback <version>`.
  Business rule now: the script accepts **only** an exact released version (`vX.Y.Z[-pre]`) and nothing else from its
  arguments (BR-99). ⚙️ pure, property-tested.

## 10. Install instructions (Q9)

INSTALL-APP gains a **server** part written for **any container host** that provides: a container runtime with
compose; an **OIDC provider** offering authorization code with PKCE, signed ID tokens and a published key set; a
**name** the owner's devices resolve; a **certificate** for that name the devices trust. Each step that differs by host
has a labelled subsection, *For Synology deployment* first, so other hosts can be added beside it. Writing it is Code
Generation's; its walk is U11's verification.

## Carried to later stages (not Functional Design's)

| Item | Stage |
|---|---|
| The OIDC library and the cookie-signing primitive | NFR Design |
| The name, the app's HTTPS port, where the certificate authority's key lives, and the renewal procedure (Q5, open) | Infrastructure Design (CA key custody is a security-posture decision: the owner's) |
| The deploy user, its forced-command script and `sudo` rule (Q8 = B) | Infrastructure Design |
| Whether a container on the server resolves the provider's name, and the phone resolves it | Probes in Infrastructure Design |
| Whether the image's Node runtime starts on the first target's CPU (no AVX) | First trial step |
