# Security Test Instructions

**Date**: 2026-08-26 · **Stage**: CONSTRUCTION — Build and Test

---

## Scope

Q9 scoped security to one property: **the app is reachable only from this machine.** There is no
authentication, and that is defensible *only* while that property holds. So the tests here are
narrow and load-bearing rather than broad.

---

## Automated — `test/localGuard.test.ts`

```bash
npm test
```

| Check | Assertion |
|---|---|
| Non-loopback peer | Rejected |
| `Host: evil.com` | Rejected |
| `Host: 127.0.0.1.evil.com` | Rejected (DNS rebinding) |
| `Host: [::1].a.com`, `[::1]evil.com` | Rejected — **a real bypass found by a property test** |
| Cross-origin WebSocket upgrade | Rejected |
| Loopback IPv4, IPv6, `localhost`, with/without port | Accepted |

The bracketed-IPv6 case is worth remembering: the original implementation took everything up to
`]` and discarded the remainder without validating it. A property asserting *"appending any label
to a loopback name must not keep it loopback"* found it. An attacker controls that header.

---

## Manual — credentials

| Check | How | Result |
|---|---|---|
| Credentials never in exports | `grep -i -E 'client_secret\|refresh_token' export.csv` | ✅ none |
| Credentials never in the database | Schema carries no credential columns | ✅ by construction |
| Credentials never logged | Review startup output | ✅ |
| `secrets/` gitignored | `git check-ignore secrets/spotify-config.json` | ✅ |
| `data/` gitignored | `git check-ignore data/history.db` | ✅ |

---

## Manual — access control, verified 2026-08-26

| Check | Result |
|---|---|
| Host-run app: spoofed `Host` header rejected | ✅ 403 |
| Container: spoofed `Host` header rejected | ✅ 403 |
| Export route sits behind `localGuard` | ✅ — no new listener, no new port |
| U1 added no network exposure | ✅ confirmed |

**U1 required no security review**, which was the point of the §3.5 download-only decision: export
is a download over the existing loopback listener.

---

## U2 — outbound posture  ✅ **VERIFIED 2026-09-01**

U2 is the first traffic to leave the machine other than Spotify's. What was checked:

| Check | Result |
|---|---|
| New inbound ports or listeners | **None.** `/api/explain/:playId` and `/api/history/recent` sit on the existing loopback listener behind `localGuard` |
| Contact address committed | **No.** `secrets/musicbrainz.json` is gitignored; `git check-ignore` confirms. Only `musicbrainz.example.json` is tracked |
| Anonymous fallback | **None.** A missing or placeholder contact is a startup error; the app runs display-and-record-only rather than sending unidentified traffic |
| Mount permissions | `musicbrainz.json` is mounted **`:ro`** — unlike `spotify-config.json`, nothing writes it |
| NFR-01–07 | **Unchanged.** No control was relaxed |

**What actually leaves the machine**, per *distinct* track and only once, because resolutions are
cached: the ISRC or Spotify artist ID, and a `User-Agent` naming the app and the contact address.
Closer to *the distinct library* than *the listening timeline*.

---

## ⚠️ Open security decision — the guard blocks the container

### What was found

`localGuard` requires `req.socket.remoteAddress` to be loopback. Traffic reaching a container via
a published port arrives from the **Docker bridge gateway**, so **every request to the
containerised app is refused**. Verified: the same request succeeds from inside the container and
fails from the host.

This is pre-existing (U0) and was surfaced only by exercising the container. It fails **closed** —
the safe direction — but the containerised deployment cannot serve its UI at all.

### Why it is not fixed here

Any fix relaxes the single control that NFR-07's no-authentication decision depends on. That is a
posture question, not a bug fix, and it belongs to the user — the same reasoning that kept
§3.5 route C and wishlist W-1 out of scope.

### Options

| # | Approach | Effect on the local-only guarantee |
|---|---|---|
| **A** | **Run on the host** (`npm start`). Peer address genuinely is loopback | **None.** Works today, no change |
| **B** | In-container, trust the `127.0.0.1:3000:3000` publish for network isolation and accept the bridge gateway as a peer; keep Host/Origin validation | **Changed, arguably not weakened.** Isolation moves from the peer check to the port binding, which is what actually constrains reachability on the host |
| **C** | Allow a configured peer CIDR | Same as B, more explicit, more to get wrong |
| **D** | `network_mode: host` | Poorly supported on Docker Desktop for Windows |

### The argument for B, stated so it can be disagreed with

Inside a container, the peer check **cannot** see loopback for any legitimate request. It is not
providing the defence it was designed for — it is only refusing valid traffic. What genuinely
limits reachability in that deployment is the `127.0.0.1` publish: without it the port is on the
LAN, and with it only host-local processes can connect.

Host and Origin validation — the DNS-rebinding defence, and the check that caught a real bypass —
is unaffected either way and would remain in force.

The counter-argument is real: any container on the same bridge network could then reach the app.
Today that means other projects' containers on this machine, and the app exposes listening history
and playback data without authentication.

**Recommended**: A for now, since it works and costs nothing. Decide B or C when containerised
deployment is actually wanted.

### ✅ DECIDED 2026-09-05 — **option B**, by the user

Containerised deployment became actually wanted: the user asked for unattended data collection
(the hypothesis gate needs roughly 215 more live plays) via Rancher Desktop at login.

Implemented as **`TRUST_PUBLISHED_PORT`**, opt-in and set only in `compose.yaml`. It disables the
peer-address check **and nothing else**. It is deliberately *not* inferred from `inContainer`, so
enabling it stays a visible deployment decision rather than something that switches on depending
on where the process happens to run — and the host deployment keeps the strict check it can
genuinely satisfy.

**Measured before deciding, rather than assumed** — and the measurement made the counter-argument
weaker than it reads above:

| Claim in the counter-argument | Measured 2026-09-05 |
|---|---|
| "any container on the same bridge network could reach the app" | The default bridge is **empty**. The machine's other compose projects (`imagelens-immich-eval`, `opencodetest`) are on their own networks |
| — | The app runs on its **own** network `spotify_default` (gateway 172.20.0.1), reachable from no other container |
| — | The publish is `127.0.0.1:3010`, so container-to-container access would have to route through host loopback, which containers cannot reach |

Residual exposure is therefore **host-local processes only** — which is exactly what the host
`npm start` deployment already exposed, and which was accepted there.

**Verified live after the change**, not just in tests:

```
GET http://localhost:3010/            -> HTTP 200     (was 403 for every request)
GET /api/now-playing                  -> HTTP 200
GET / with Origin: http://evil.com    -> HTTP 403     (DNS-rebinding defence intact)
```

Pinned by 7 new tests, including a property asserting the invariant that replaces PBT-03 for this
deployment: **under `trustPublishedPort`, any peer is admitted, but only with a loopback `Host`.**
If that ever fails, option B has silently become "no guard at all".

**Open item 1 is closed.**

---

## Dependency scanning

```bash
npm audit
```

Advisories in the **vendored MCP server** are upstream and unpinned; the project accepted that
risk with Q8 = A (no license, personal use). Advisories in this project's own dependencies —
`express`, `ws`, `fast-check`, `tsx`, `typescript` — should be acted on.
