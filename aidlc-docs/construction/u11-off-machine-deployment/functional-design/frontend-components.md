# U11 — Off-machine Deployment — Frontend Components

Server mode adds **three small pages** (served before sign-in or after sign-out) and one **Settings** section. The
primary screen gains nothing permanent. Local mode shows none of it. ⚠️ Every new element is checked in **light and
dark** (issue #14 hid in light mode), and colour is never the only channel. All provider-supplied text (an `error`
description, a `sub`) is rendered as text, never as HTML.

---

## 1. Sign-in redirect (no page)

A page navigation without a valid session goes straight to `/auth/sign-in` and on to the provider (BR-92.5). The app
does not show its own sign-in form: there is no password to type into it.

## 2. *Sign-in problem* page (`/auth/problem`, admitted without a session; BR-89.4, BR-90.5, BR-90.6)

```
Spotify Companion
Sign-in did not complete
  <one sentence: the reason>
  [ Try again ]                 → /auth/sign-in (a fresh attempt)
  If your sign-in provider shows its own page and does not come back here,
  open <public address> again.
```

| Reason | Sentence |
|---|---|
| `expired` | *That sign-in took longer than 10 minutes, or was already used. Start again.* |
| `state` | *That sign-in was started in another browser or tab. Start again here.* |
| `provider-error` | *The sign-in provider refused: <its error code>.* |
| `provider-unreachable` | *The sign-in provider cannot be reached. Already signed-in devices are unaffected.* |
| `provider-mismatch` | *The sign-in provider's address does not match this app's configuration (see Diagnostics).* |
| `verification` | *The sign-in provider's answer could not be verified.* (details in the log, never on the page) |
| `wrong-account` | *Signed in as <sub>. This app admits only its owner's account.* Shown with `403` |

No link back into the app is offered except *Try again*: nothing else would be admitted.

## 3. *Signed out* (page, and an in-app state; BR-93.3, BR-94)

- **Page** after *Sign out*: *You are signed out of this app. Your sign-in provider may still have you signed in, so
  the next sign-in can be quick.* `[ Sign in ]`.
- **In-app**, when the live connection closes with 4401 or an API call answers `401`: the existing connection
  indicator reads **Signed out** (text, not only colour) instead of *Disconnected, reconnecting…*, with a
  `Sign in` link; reconnecting stops. Controls that would call the API are disabled with that reason as their tooltip.
  ⚙️ `onClose(code, httpStatus)` decides (BR-93.3).

## 4. Settings → **Access** (new section, server mode only)

Placed before *Diagnostics*.

```
Access
  Signed in as <sub> · session ends 2026-10-31 14:02 (7 days)
  This app is reachable at <public address>, for this account only.
  [ Sign out ]   [ Sign out everywhere ]
  Sign out everywhere ends every session, on every device, including this one.
```

| State | Source | Behaviour |
|---|---|---|
| `subject`, `expiresAt` | the current session, from a status endpoint | text; the end time in the report time zone |
| `publicOrigin` | configuration | text |
| *Sign out* | `POST /auth/sign-out` (with `ingestGuard`'s header) | → *Signed out* page |
| *Sign out everywhere* | confirmation pop-up (*This ends every session, including this one.*), then `POST /auth/sign-out-everywhere` | → *Signed out* page |

## 5. Diagnostics → **Access** check (BR-96.2)

One more row in the existing diagnostics run: *Local only* (pass), or the server-mode facts (mode, public address,
issuer, keys fetched at, allowed account, session lifetime, certificate names and expiry), with fail and warn as
BR-96.2 states. Also the **WAL** row (BR-97) and, for the exit test, **table counts and the rules hash** (BR-98), in
both modes.

## API integration points

| Component | Endpoint |
|---|---|
| Sign-in redirect | `GET /auth/sign-in?return=`, `GET /auth/callback` |
| Problem page | `GET /auth/problem?reason=` |
| Signed-out state | WebSocket close 4401; any `401` |
| Settings → Access | a session status read (subject, expiry), `POST /auth/sign-out`, `POST /auth/sign-out-everywhere` |
| Diagnostics | the existing diagnostics endpoint, with the new rows |
