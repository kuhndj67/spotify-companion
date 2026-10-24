# U11 Deployment Architecture — Off-machine Deployment

**Unit**: U11 · **Date**: 2026-10-24 · Infrastructure: [`infrastructure-design.md`](infrastructure-design.md)

Machine 2 is the first server target. Its names appear here as placeholders (`<Machine 2's name>`); its address is
`192.168.0.223`.

---

## 1. During the trial

```
 Owner's devices (LAN)                    Machine 2 (DS1517+, DSM 7.2, 192.168.0.223)
 ┌──────────────────────┐                 ┌──────────────────────────────────────────────────────────┐
 │ browser, trusts      │  HTTPS :3443    │ Container Manager project  (published on 192.168.0.223)   │
 │ ca-cert.pem          │────────────────▶│  spotify-companion  ACCESS_MODE=server                    │
 │                      │                 │   ├─ ./data   history.db, backups/   (Volume 1, Btrfs)     │
 │                      │                 │   ├─ ./state  ./config (rules, ca/ca-cert.pem)            │
 │                      │  HTTPS :9443    │   └─ ./secrets/app (oidc secret, session.key, tls/)       │
 │                      │────────────────▶│        │ extra_hosts: <name>.local → 192.168.0.223        │
 └──────────────────────┘  (sign-in)      │        ▼ discovery, keys, code redemption                 │
                                          │  SSO Server :9443  (own port; certificate from our CA)    │
                                          │  DSM :5000/:5001   (untouched; factory certificate)       │
                                          └──────────────────────┬───────────────────────────────────┘
                                                                 │ HTTPS, its OWN Spotify registration
                                                                 ▼ (pasted only after the exit test)
                                                             Spotify Web API

 This PC (unchanged)
 ┌──────────────────────────────────────────────────────────┐
 │ spotify-companion  local mode  127.0.0.1:3010 → recording │  its own Spotify registration
 │ certificate script + OpenSSL (CA key brought in, then     │
 │ returned offline)                                         │
 └──────────────────────────────────────────────────────────┘
```

- Two deployments, two databases, two Spotify registrations (FD plan Q2 = A): neither can push the other over quota.
- The server's recording starts only after the exit test (BLM §8 ⑤).
- Nothing on DSM is changed by an agent. What the owner does in DSM, by hand: the SSO Server application, the
  certificate import, the Container Manager project, the backup task.

## 2. After the move

This PC's container is **stopped and stays stopped**; the server is the only deployment recording. This PC keeps
local mode for development (`data-dev/`). ⚠️ Nothing enforces "one recorder" across machines (BLM §8); the install
guide states it.

## 3. Ports and names

| Port (Machine 2) | Service | Certificate | Measured |
|---|---|---|---|
| 5000 / 5001 | DSM | factory (`synology.com`) | open; untouched |
| 9443 | SSO Server | ours (test CA today; replaced by the real CA) | open, verifies against the test CA |
| **3443** | the app | ours, its own key (Q4 = A) | closed today |

| Name | Resolved by | Measured |
|---|---|---|
| `<Machine 2's name>.local` on the owner's PC | local-network discovery | yes |
| on a phone | local-network discovery | **no**; not needed yet (Q7: this PC only, for now) |
| inside the app container | `extra_hosts` | the mechanism, on Docker Desktop here; on Machine 2, in the trial |

## 4. Sequence of the first deployment (by hand, Q8 = A)

1. On this PC: make the real CA; issue SSO Server's and the app's certificates (IN-U11-4); move the CA key offline.
2. DSM: import SSO Server's certificate and assign it to `ssoserver-9443`; register the app in SSO Server
   (IN-U11-6).
3. This PC (Q7): install `ca-cert.pem` as a trusted root (Windows, current user).
4. Machine 2: a project folder; `setup --server` (through Container Manager or SSH); fill in the placeholders; place
   the certificate files and the client secret; create the Container Manager project from `compose.yaml`; start it.
5. **First trial check**: the container starts on the Atom C2538 (no AVX; not yet measured) and Diagnostics' *WAL* row
   passes on Btrfs.
6. Then the trial, the exit test and the move (BLM §8).

⚠️ **The sign-in loop retest (P-95) must run on Machine 2.** The redirect must be an HTTPS name with a trusted
certificate, and the CA is constrained to Machine 2's names, so the Code Generation step-1 build cannot be tested
from this PC. Steps 1–4 therefore come first, with the step-1 build. How that build reaches Machine 2 (a pre-release
image tag the owner pushes, or an image copied across by hand) is decided at Code Generation's plan; a tag push is
the owner's act.
