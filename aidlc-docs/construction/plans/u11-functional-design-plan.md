# U11 Functional Design Plan — Off-machine Deployment

**Date**: 2026-10-24 · **Stage**: CONSTRUCTION — Functional Design, Unit **U11** (Phase 5)
**Status**: plan OPEN. **Q3 = A** (2026-10-24); Q1, Q2, Q4–Q11 awaiting the owner. Section 3 lists values only the owner can read from DSM.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: `unit-of-work.md` §U11 (and its *Carried into its design plan*: U9-a, U9-b, U9-c, WAL, WebSocket, CPU
architecture) · **NFR-29** (Requirements Q11a = B) · NFR-28 · W-10 · U6 (*Restore backup*, the one writer) · U7
(credentials written from Settings) · U8/U9 (*App only* install, `docs/INSTALL-APP.md`) · U10 (lock, kept backups)

> **The scope is one promise**: the app runs on Machine 2 and is fully usable from another device on the LAN, and
> nobody who has not signed in as the owner can reach it. Everything else here (which deployment polls Spotify, how
> the NAS is deployed to, what the exit test counts) serves that promise or keeps the existing one, *no history is
> lost*, true across two machines.

---

## 1. Unit context

| | |
|---|---|
| **Phase** | 5. Build order U6 → … → U10 → **U11** → U12 |
| **Settled already** | Q11a = **B**: delegated authentication. An OIDC sign-in at a proxy that terminates TLS; the app verifies a **signed identity token** on every request, HTTP **and** WebSocket upgrade, in **one** function (`decideAccess`). Local-only stays the default mode (NFR-29) |
| **Exit criterion** | (from U6, NFR Design Q10 = A) the **real corpus** is backed up here, restored on the NAS through *Restore backup*, and the NAS app runs with **the same counts** |
| **Verification** | The NAS deployment is performed **by following U8's install routine**: the walk is the test |
| **Not U11's** | Issue #29 (Spotify's reason and wait) and #30 (pause polling): own requirements round · teams (U12) · in-app Spotify sign-in (W-10: TLS makes it possible, it is not built here) |
| **Stories** | None yet: Q11 |

---

## 2. Facts measured for this plan (2026-10-24)

From this machine, unauthenticated, read-only: TCP connects, `GET` requests, one TLS handshake, and one registry
manifest read. Nothing was signed in to and nothing was written on the NAS. The live deployment was not touched.

| | |
|---|---|
| **Machine 2 is reachable** | `192.168.0.223` answers ping (< 1 ms). Open: **80, 443** (DSM's web server), **5000, 5001** (DSM HTTP/HTTPS). **SSH is on port 222** (owner, 2026-10-24; 22 is refused). Probed with an unauthenticated connection: the server offers **`publickey,password`**, so password sign-in is enabled for SSH today (Q8) |
| **It runs DSM 7 with Container Manager and an OAuth service** | DSM's public API index (`/webapi/query.cgi?api=SYNO.API.Info`, no sign-in) lists `SYNO.API.Auth` up to v7, the `SYNO.Docker.*` family (Container, Image, **Project** = compose, Registry) and `SYNO.OAUTH.Client` / `.Token` / `.Common` / `.Log` |
| ⚠️ **The OIDC discovery document is not reachable** | `GET /webman/sso/.well-known/openid-configuration` → **`403`** on 5000 and 5001. On 80/443 it returns `200`, but the body is only DSM's redirect page sending the browser back to 5000/5001 (a `200` that is **not** the document: checked by reading the body). `/.well-known/openid-configuration` at the root: `403`. So **whether DSM can act as an OIDC provider is still unknown**: consistent with "SSO installed but not configured", and not yet distinguishable from "not supported". It must be probed after the owner enables it (Q3) |
| **DSM's certificate is its factory default** | `CN = synology.com`, issued by *Synology Inc. CA*, valid 2017–2037. No browser trusts it for `192.168.0.223`. Any HTTPS endpoint the app sits behind needs a certificate the owner's devices trust (Q5) |
| **The published image is `amd64` only** | `ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.9` is a single-platform manifest (no image index). If Machine 2 is ARM, U11 adds an `arm64` build (Section 3, value 1) |
| **The NAS can be given Spotify credentials from a browser** | U7's Settings writes `clientId`, `clientSecret`, `redirectUri`, `refreshToken` (`src/api.ts:1061`, `CredentialsWriter`). `npm run auth`'s redirect URI is loopback only (`http://127.0.0.1:<port>/callback`, `scripts/auth.mjs:38`), so the refresh token is minted on a PC and pasted into the NAS's Settings. In-app sign-in stays W-10 |
| **Today's access rule cannot admit the NAS's users** | `decideAccess` (`src/localGuard.ts`) admits only a loopback `Host`/`Origin`. A browser on another device sends `Host: <NAS name>` and is refused `403` by design. NFR-29's trusted-proxy mode is the change; the rule stays one function |
| **Spotify's quota is per app registration** | The 2026-10-23 lockout was `429 QUOTA_EXCEEDED` for the app (audit 2026-10-24). Two deployments polling with **one** registration share one quota (U9-b) |

⚠️ **WAL failure would be silent today.** The app runs `PRAGMA journal_mode = WAL`
(`src/history/SqliteHistoryRepository.ts:205`) and **does not read the result**. SQLite answers with the mode it
actually chose, and keeps the old one when WAL is unavailable, so a volume without WAL support would not be noticed.
Measured with `node:sqlite` (the app's driver) on an in-memory database, where WAL is impossible: the same `exec`
**did not throw**, and the mode read back afterwards was `memory`.
Proposed rule for the FD: check the returned mode at startup and refuse to record if it is not `wal` (a guard that
can observe its condition, and a test that sees it fail).

**Not yet measured** (each becomes a probe in a later stage, not a belief now): WAL on the NAS volume; the WebSocket both
directions through the proxy; whether a container on the NAS can reach a `127.0.0.1`-published port (U10's open
item); whether DSM's built-in reverse proxy can require a sign-in (believed **not**: it forwards, it does not
authenticate. A belief until probed).

---

## 2a. The four kinds of access, and which DSM tools serve which

Added 2026-10-24 after the owner listed the NAS's security tools and asked which this project needs. The owner
prefers **not to touch the primary NAS environment** (DSM's own accounts and sign-in) if it can be avoided.

| # | Access | Who or what | Needs a NAS account? | Decided by |
|---|---|---|---|---|
| 1 | **Signing in to the app** | The owner, in a browser on another device | Only if Q3 = A (the identity provider is DSM's) | Q3, Q6 |
| 2 | **The running app** | The app container | **No.** It verifies tokens with the provider's *public* keys and holds no NAS credential. Container Manager runs it; it reaches nothing on the NAS outside its mounted folders | Settled by NFR-29's shape |
| 3 | **Deploying and reading logs** (dev) | The owner, or an agent on this machine | Yes, unless Q8 = A (by hand) | Q8 |
| 4 | **One-time setup** | The owner, by hand in DSM | The owner's administrator account, used by the owner only. Creating the compose project; for Q3 = A, also installing and configuring SSO Server; for Q8 = B, the deploy user and its `sudo` rule | Follows from Q3 and Q8 |

**The DSM tools the owner listed.** What each is for is Synology's documented behaviour, **not probed**; Q3 = A
probes it before anything relies on it.

| Tool | What it does | Needed here? |
|---|---|---|
| **SSO Client** (Control Panel, Security tab) | Makes **DSM's own sign-in** use an outside identity provider | **No.** It changes how you sign in to DSM, not how the app signs you in. Leave it alone |
| **OAuth Service** (package, installed) | Lets outside apps get permission to act on **DSM's** resources with an OAuth grant | **No.** This app needs to know *who* you are (an OIDC identity token), not permission to use DSM. Probably why discovery returned `403`: the package that serves OIDC is not installed |
| **Secure SignIn** (package, installed, 2FA in use) | Second factor and passkeys for DSM accounts | **Only with Q3 = A**, where a sign-in to the app is a DSM-account sign-in and is expected to ask for the same second factor (to verify by probe) |
| **SSO Server** (package, available, **not installed**) | Makes the NAS an **identity provider** for other apps: OIDC, among others | **Only with Q3 = A.** It is the one tool here that does what NFR-29 needs |

So with **Q3 = B or C, none of DSM's security tools are used** and the primary environment is not touched: the
identity provider runs in a container (B) or outside (C), and the only DSM work is creating the compose project (4).

---

## 3. Values only the owner can read (please fill in)

These need a DSM sign-in, which this plan does not have. Each is one line in DSM.

| # | Value | Where in DSM | [Answer] |
|---|---|---|---|
| 1 | **Model and CPU** (decides `amd64` vs `arm64`) | Control Panel → Info Center → General: *Model name*, *CPU* | |
| 2 | **DSM version** | same page: *DSM version* | |
| 3 | **Container Manager version** | Package Center → Installed → Container Manager | |
| 4 | **What the SSO/OAuth package is called and its state** | Package Center → Installed | **Answered** (owner, 2026-10-24): *SSO Client* (Control Panel, Security tab): available, not configured · *OAuth Service* package: installed, no apps configured · *Secure SignIn* package: installed, 2FA in use for DSM sign-in · *SSO Server* package: available, **not installed**. See Section 2a |
| 5 | **Which volume would hold the app's data**, and its file system | Storage Manager: e.g. *Volume 1, Btrfs* | |
| 6 | **Free RAM** | Resource Monitor → Memory | |

---

## 4. Questions

### Q1 — The NAS's role (U9-a)

| | Option |
|---|---|
| **A** | ⭐ **A trial, then the move.** The NAS first runs as a second deployment beside this one, for the walk and the exit test. When the exit test passes, the owner chooses the day of the **move**: a final backup here, restore there, and this machine's container is stopped and stays stopped. **From the move on, the NAS is the only deployment** that records. The trial's own plays (if it polls at all, Q2) are thrown away by the final restore |
| **B** | **The NAS becomes the deployment at once**: the exit test *is* the move. Simplest; no rehearsal before the real history moves |
| **C** | **Two permanent deployments**, this machine and the NAS, each recording. ⚠️ Two corpora of one person's listening that never merge: R1's data splits in two, and Q2 becomes a permanent cost |

[Answer]:

---

### Q2 — Spotify app registrations (U9-b)

Spotify's quota is per registration (Section 2). Each registration has its own client ID, secret, redirect URI and
refresh token.

| | Option |
|---|---|
| **A** | ⭐ **The NAS gets its own Spotify registration** (Spotify Developer Dashboard, the owner's account, the same steps as INSTALL-APP's). During the trial the two deployments cannot push each other over quota; after the move, the old registration can be deleted or kept for this machine's development. This is also what a *new* user does, so the walk exercises it |
| **B** | **One registration, one poller at a time.** The NAS reuses this machine's credentials; the two never run together (the trial happens with this machine's container stopped). ⚠️ Nothing enforces it: U10's lock is per database, and the two databases are different files on different machines |
| **C** | **One registration, both running.** Halves the quota for both during the trial. Not recommended after 2026-10-23 |

[Answer]:

---

### Q3 — Who signs the owner in (the identity provider)

⚠️ **Security posture: the owner's decision.** The provider decides where the owner's password lives and who could
mint a token the app accepts.

| | Option |
|---|---|
| **A** | **DSM's *SSO Server* package** (not installed today), signing in with the owner's **DSM account**, with the 2FA *Secure SignIn* already gives it. No new service to maintain. ⚠️ **Touches the primary NAS environment**: a package installed and an app registered in it by the owner, and a stolen app session is a DSM-account sign-in. ⚠️ **Unprobed**: choosing A means the owner installs it, then it is probed for discovery, a key endpoint, signed ID tokens (algorithm) and their claims, and whether it asks for the second factor, before the design relies on it. If it fails, this question returns |
| **B** | **A self-hosted identity provider in a container on the NAS**, in the same compose project as the app (e.g. Authelia). **Leaves DSM untouched**: its own single user (the owner), its own password and second factor (an authenticator app), stored in the project's folders. Everything stays on the LAN. One more service to keep updated, and its own security record to watch |
| **C** | **An outside provider** (e.g. Google, or Microsoft Entra ID), through the proxy. The best-maintained sign-in, with a second factor the owner already has. ⚠️ The NAS then needs outbound internet at sign-in, and the provider learns when the owner signs in. Closest to the long-term cloud shape Q11a was asked for |

*Revised 2026-10-24* after the owner said they would rather not touch the primary NAS environment: ⭐ **B** fits that
best (DSM untouched, nothing leaves the LAN) at the price of one more service to keep updated. **A** is the least to
maintain but works inside DSM's accounts. **C** keeps DSM untouched and is the best-maintained sign-in, but needs the
internet at every sign-in. The earlier recommendation (probe A first) is withdrawn.

[Answer]: **A** (owner, 2026-10-24: *"I'm OK with using SSO Server since it's a synology product and is part of the
already active update process"*). Conditional on the probe: once the owner has installed SSO Server, its discovery
document, keys, ID-token algorithm and claims, and whether it asks for the second factor are probed before the
design relies on them. If it fails, Q3 returns. **How it gets configured** (a walk-through, limited DSM access, or a
Synology MCP server) is an open security-posture item, recorded in `audit.md` 2026-10-24.

---

### Q4 — What does the sign-in in front of the app (the proxy)

| | Option |
|---|---|
| **A** | ⭐ **`oauth2-proxy` in its own container**, in the same compose project, in front of the app. It does the OIDC sign-in with the Q3 provider, terminates TLS, and forwards the **provider's own signed ID token** to the app. The app verifies that token against the **provider's** published keys, so the proxy is not trusted to vouch: a forwarded header the provider did not sign is refused. The app's port is **not published** on the NAS at all; the only way in is through the proxy |
| **B** | **DSM's built-in reverse proxy** for TLS, with the app running the OIDC sign-in itself. ⚠️ Contradicts NFR-29 as ratified ("the app never handles passwords" is kept, but the app then runs the sign-in flow and holds a client secret, which the ratified shape put in the proxy) and would need a requirements change |
| **C** | **A proxy that has sign-in built in** (e.g. Caddy or Traefik with a forward-auth plugin, or the Q3 = B provider's own proxy mode). Same shape as A, different product; chosen only if Q3 = B makes it simpler |

[Answer]:

---

### Q5 — The address and the certificate

The owner's devices must trust the HTTPS certificate, and the OIDC provider redirects back to a fixed address.

| | Option |
|---|---|
| **A** | ⭐ **A LAN name and a small private certificate authority.** A name such as `spotify.home.arpa` (`home.arpa` is reserved for home networks, RFC 8375), resolved by the router or by each device's hosts file; a certificate from a private CA (e.g. `mkcert`), whose root the owner installs once on each device that will open the app. Nothing public, nothing forwarded |
| **B** | **A public DNS name with a Let's Encrypt certificate by DNS challenge**, the name pointing at the private address. Every device trusts it with no install. Needs a domain the owner controls and a DNS provider with an API; the name (not the app) becomes public |
| **C** | **The IP address and a self-signed certificate**, warning accepted in each browser. ⚠️ Some OIDC providers refuse a redirect to an IP address, and browsers keep warning. Not recommended. **Ruled out for Q3 = A** (Synology's SSO Server help, read 2026-10-24 through a search summary, not yet seen on the NAS): a redirect URI must use the same protocol as SSO Server, should be an HTTPS domain with a valid TLS certificate, and **cannot be an IP address or a QuickConnect address**; up to 10 per application |

*Added 2026-10-24, from the NAS* (owner): SSO Server's account type is *Domain/LDAP/local* (the only choice; the
domain/LDAP part greyed out). Its default **Server URL** is `https://<Machine 2's name>:5001`. Probed from this
machine: the name resolves to `192.168.0.223` (and also to an IPv6 address), and `https://<name>:5001/` answers
`200`. ⚠️ Not yet measured: whether a container **on the NAS** resolves that name. The app must reach the issuer to
fetch its keys (Q5).

*Observed on the NAS 2026-10-24* (owner): the Server URL shown is only a placeholder. *Service* refuses to enable
OIDC until one is saved, and saving `https://<Machine 2's name>:5001` is refused: *"use a domain name that can be
accessed over https and has a valid tls certificate. you can create one at control panel>security>certificate"*. The
NAS holds two certificates: the factory `synology.com` (default) and one used by *Active Backup for Business*. So **Q5
must be answered before SSO Server can be turned on.** Not yet known: what DSM counts as *valid* (a certificate that
covers the name, or one from a publicly trusted authority).

*Added 2026-10-24*: with Q3 = A, SSO Server's own **Server URL** (General Settings) is the token issuer. The browser
signs in there, and the app fetches its keys from there, so the Q5 name and certificate cover **both** SSO Server's
address and the app's.

[Answer]:

---

### Q6 — Who is let in, once signed in

| | Option |
|---|---|
| **A** | ⭐ **Exactly one identity**: the app's configuration names the provider (issuer), the app's client ID (audience) and the owner's account (the token's subject). Any other signed-in account is refused `403` with a sentence saying so. Single-user unchanged |
| **B** | **Anyone the provider signs in.** The provider's account list is the guest list. Simpler to configure; a second NAS account (a family member's) would reach the owner's history and its controls |

[Answer]:

---

### Q7 — What a signed-in browser may do

Off-machine today, nothing reaches the app. ⚠️ U6's upload routes (*Restore backup*) were held local-only "until
Question 11 is decided", and it now is. The exit test needs *Restore backup* from a browser on another device.

| | Option |
|---|---|
| **A** | ⭐ **Everything the local app can do**: playback controls, rules, *Restore backup*, credentials in Settings, the automation switches. The sign-in **is** the authority. The admission rule stays one function and does not grow a per-route list |
| **B** | **Everything except the writes that replace data** (*Restore backup*, credentials). Those stay reachable only from the NAS itself, which has no browser: they would need SSH and `curl`. The exit test then runs that way instead of through *Restore backup* |

[Answer]:

---

### Q8 — How releases reach the NAS (least authority, U9-c)

⚠️ **Security posture: the owner's decision.** Container Manager runs as root; a Docker-group account is
root-equivalent (a container can mount the host). SSH is **on, port 222**, and accepts passwords as well as keys
(Section 2).

| | Option |
|---|---|
| **A** | **By hand, in DSM.** The owner updates the compose project in Container Manager (*Project → Stop → edit the image line → Build/Start*), following a NAS section of INSTALL-APP. No SSH, no new account, no agent access. Rollback = the previous image line. The agent reads only what the owner pastes |
| **B** | ⭐ **The U9-c design**: over the existing SSH on 222, a dedicated NAS user (not an administrator, not in the Docker group) with **one** SSH key locked by `command=` to an owner-written script offering only `deploy <vX.Y.Z>` · `status` · `logs` · `rollback <vX.Y.Z>`, reaching Docker through a `sudo` rule for that one script. Agents and scripts on this machine can deploy and read logs without ever holding a NAS password. (The repository is public since U9, so the read-only GitHub deploy key U9-c named is no longer needed: the image is pulled anonymously from GHCR) |
| **C** | **A Synology MCP server** with an administrator credential. Rejected in U9-c's analysis; listed so the rejection is on record |

⭐ B is recommended for the long run. **A for the first deployment** is reasonable too: B's script is easier to
write after one deployment has been done by hand.

[Answer]:

---

### Q9 — The NAS install instructions

The deployment is performed by following U8's routine (the walk is U11's verification). No new document types.

| | Option |
|---|---|
| **A** | ⭐ **A *On a NAS or another machine* part in `docs/INSTALL-APP.md`**: the proxy, the provider, the certificate, the access configuration, and how to paste credentials into Settings. Same structure and checks as the local install; a user who stays local skips it |
| **B** | **A separate `docs/INSTALL-NAS.md`**. Keeps INSTALL-APP short; two install documents to keep consistent (`test/docs.test.ts` covers both) |

[Answer]:

---

### Q10 — The exit test's "same counts"

| | Option |
|---|---|
| **A** | ⭐ **Every table the backup carries**, compared row for row by count: plays, decisions, skip attempts, observation trails, and the rules file's content hash, read from `/api/diagnostics` on both sides immediately after the restore and **before** the NAS polls Spotify (Q2's registration is pasted in only after the comparison) |
| **B** | **Plays and decisions only**, the two counts U6 and U10's rehearsals used |

[Answer]:

---

### Q11 — Does U11 add a user story?

| | Option |
|---|---|
| **A** | ⭐ **One story, US-34**: *"As someone running the app (P1), I can open it from another device on my home network after signing in, and nobody who has not signed in as me can reach it."* Acceptance = NFR-29 and the exit test |
| **B** | No story: U11 is tracked by NFR-29 and the exit criterion |

[Answer]:

---

## 5. Plan: after the answers

- [ ] Fill in Section 3 (owner) and collect Q1–Q11; ask follow-ups for anything ambiguous (rule Step 5). Amend NFR-29's wording if Q4 = B (`requirements.md`, `audit.md`)
- [ ] If Q3 = A: probe DSM's SSO Server once the owner has installed it (discovery, JWKS, ID-token algorithm and claims, redirect URIs it accepts) and record it in `research-findings.md` **before** the design names its claims
- [ ] `construction/u11-off-machine-deployment/functional-design/business-logic-model.md`: the two access modes and how one is chosen; the token check on HTTP and on the WebSocket upgrade, through `decideAccess`; the trial and the move (Q1); the exit test sequence (Q10)
- [ ] `…/functional-design/business-rules.md`: BR-… issuer, audience, subject, signature, expiry and clock-skew checks; key fetching and rotation; what happens when the keys cannot be fetched (refuse, never admit); Host/Origin in trusted-proxy mode (the configured address replaces loopback, so the DNS-rebinding defence is kept); a WebSocket outliving its token; the `403` sentences; trusted-proxy mode never active by accident (one explicit setting, visible in Diagnostics); the startup WAL check (Section 2). Each rule with a test that must be **seen to fail** on a forged, expired, wrong-audience and unsigned token
- [ ] `…/functional-design/domain-entities.md`: access mode, verified identity, the allowed identity (Q6), the provider's keys
- [ ] `…/functional-design/frontend-components.md`: the `403` page off-machine (who is signed in and why they were refused); Diagnostics shows the access mode and the provider. Both colour schemes
- [ ] `HANDOFF.md`, `aidlc-state.md`, `audit.md` updated; completion message; owner approval
