# Infrastructure Design Plan — U11: Off-machine Deployment

**Date**: 2026-10-24 · **Stage**: CONSTRUCTION — Infrastructure Design, Unit U11
**Status**: ✅ **APPROVED** (owner, 2026-10-24). Q1–Q6, Q8–Q10 **A**; Q7: this PC (Windows 11) for now. Deliverables: `infrastructure-design/infrastructure-design.md` (**IN-U11-1…IN-U11-10**), `infrastructure-design/deployment-architecture.md`.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: U11 Functional Design (approved 2026-10-24; amended BR-88.4, 88.6, 91.6) · U11 NFR Design (**approved
2026-10-24**): P-88…P-101, LC-82…LC-96 · FD plan Q5 (own CA; open: name, port, CA key custody, renewal), Q8 (B, with
A for the first deployment), Q9 (host-agnostic instructions) · U8/U10 *App only* install (`setup`, `update`)

> The design stays **host-agnostic** (FD plan Q9): what a container host must provide, then *For Synology deployment*
> where Machine 2 needs something specific. Machine 2 is the first target, not the only one.

---

## 1. Unit context

| | |
|---|---|
| **Compute** | One container, as today. Machine 2: DS1517+, Atom C2538 (x86-64), 8 GB with 24 % in use, Container Manager 24.0.2 |
| **Storage** | The project folder on the data volume (Machine 2: Volume 1, Btrfs, RAID 6, 6.2 TB free): `data/`, `state/`, `config/`, `secrets/app/`, as today |
| **Messaging** | None. Not applicable |
| **Monitoring** | The container's log (Container Manager shows it) and Diagnostics. Nothing new |
| **Shared infrastructure** | The sign-in provider (Machine 2: SSO Server, on 9443) and the certificate authority. Both outside the app |

## 2. Facts measured for this plan (2026-10-24)

| | |
|---|---|
| **Free ports on Machine 2** | TCP connect from this machine: **3010, 3443, 8443 closed**; **9443 open** (SSO Server, as configured) |
| **`.local` inside a container, here** | `getent hosts <Machine 2's name>.local` in `node:22.23-bookworm-slim` on **this machine's Docker Desktop** → `192.168.0.223`. ⚠️ **Not representative of the NAS**: Docker Desktop resolves through Windows, which does local-network discovery (mDNS); a container on Linux Docker usually asks the host's DNS server, which does not. Not measured on Machine 2 |
| **A fixed host entry works** | The same container with `--add-host "<name>.local:192.168.0.223"` resolves it, independent of DNS |
| **OpenSSL on this machine** | 3.1.4 (Git for Windows), used to make the test CA |
| **`setup` exists** | The image's entrypoint offers `setup`, `auth`, `update` (`scripts/docker-entrypoint.sh:40`); `setup` writes an App-only folder (`src/appOnly/setup.ts`) |

---

## 3. Questions

### Q1 — The name the owner's devices open

| | Option |
|---|---|
| **A** | ⭐ **`<Machine 2's name>.local`**, found by local-network discovery (mDNS). Already covered by the test certificate and resolving on this PC. ⚠️ Phones: not yet measured (recent iOS and Android support it; to be checked on the owner's phone in the trial) |
| **B** | **A `home.arpa` name in the router's DNS** (reserved for home networks, RFC 8375). Works for every device that uses the router's DNS; needs a router that lets you add local names (does yours?) |
| **C** | **Hosts-file entries on each device.** Not possible on an unmodified phone. Not recommended |

[Answer]: **A** (owner, 2026-10-24: *"accept recommendations for all questions"*)

### Q2 — How the app container finds the provider

The app calls SSO Server (discovery, keys, code redemption) at the issuer's address.

| | Option |
|---|---|
| **A** | ⭐ **A fixed host entry in the compose file** (`extra_hosts`: the name → the server's LAN address). Independent of whatever DNS the host gives containers; measured to work. Host-agnostic: every host's compose supports it. Cost: the address is written in one more place (a DHCP reservation for the server is assumed) |
| **B** | **The container's own DNS.** Nothing to configure if it works; not measured on Machine 2, and expected not to resolve `.local` |

[Answer]: **A** (owner, 2026-10-24: *"accept recommendations for all questions"*)

### Q3 — The app's port, and where it is published

| | Option |
|---|---|
| **A** | ⭐ **3443**, published on the server's **LAN address only** (`192.168.0.223:3443:3443`): closed today (measured), and not reachable through any other interface the host has (VPN, other bridges) |
| **B** | **3443 on all interfaces** (`3443:3443`). Simpler; reachable on every interface the host has |

[Answer]: **A** (owner, 2026-10-24: *"accept recommendations for all questions"*)

### Q4 — The app's certificate

| | Option |
|---|---|
| **A** | ⭐ **Its own key and certificate from the same CA**, for the same names. SSO Server's private key stays only in DSM; the app's only in its `secrets/app/`. Two certificates to renew, by one script (Q6) |
| **B** | **SSO Server's certificate and key, reused.** One certificate; DSM's private key is copied into the app's folder |

[Answer]: **A** (owner, 2026-10-24: *"accept recommendations for all questions"*)

### Q5 — Where the certificate authority's private key lives

⚠️ **Security posture: the owner's decision.** Whoever holds this key can make a certificate the owner's devices
trust, but **only for Machine 2's names and address** (the CA is name-constrained, and that was seen to refuse another
name).

| | Option |
|---|---|
| **A** | ⭐ **Offline**: in the owner's password manager (as an attachment) or on removable media, not on either machine's everyday disk. Retrieved only to issue or renew (about every two years) |
| **B** | **On this PC**, in the owner's profile, encrypted with a passphrase |
| **C** | **Not kept**: deleted after issuing. Each renewal makes a new CA, and its root is installed again on every device |

[Answer]: **A** (owner, 2026-10-24: *"accept recommendations for all questions"*)

### Q6 — Issuing and renewing certificates

The owner would rather not be in the business of issuing certificates (FD plan Q5).

| | Option |
|---|---|
| **A** | ⭐ **A script in the repository** that makes the name-constrained CA, issues a server certificate for given names (refusing more than 825 days), and verifies the result, including a positive control that another name is refused. Uses OpenSSL (on Windows, the one Git ships). Host-agnostic; INSTALL-APP's server part calls it |
| **B** | **A written OpenSSL procedure** in INSTALL-APP, no script. Nothing to maintain in code; more to type, and nothing checks the result |

[Answer]: **A** (owner, 2026-10-24: *"accept recommendations for all questions"*)

### Q7 — Which devices will open the app

Each one needs the CA's root certificate installed once, and the install guide covers each kind. (A fact, not a
choice.)

[Answer]: **This PC only, Windows 11, for now** (owner, 2026-10-24: *"This machine (windows 11) will be used for
now..."*). Other kinds of device are added to the install guide when they are used.

### Q8 — How a server install is created

| | Option |
|---|---|
| **A** | ⭐ **`setup --server`**: the image's existing `setup` writes a server-mode `compose.yaml` and folders, with the server settings as placeholders to fill in, so the server install follows the App-only path the walks already test |
| **B** | **An example compose file** in the docs, copied and edited by hand |

[Answer]: **A** (owner, 2026-10-24: *"accept recommendations for all questions"*)

### Q9 — When the restricted deploy path is built (FD plan Q8 = B, A first)

| | Option |
|---|---|
| **A** | ⭐ **Designed now, built after the first deployment by hand, inside U11**: the deploy user, its one key with a forced command, the script (`deploy`, `rollback`, `status`, `logs`), its `sudo` rule. U11 closes when a release has gone out that way |
| **B** | **Deferred to a later unit**; U11 closes after the deployment by hand |

[Answer]: **A** (owner, 2026-10-24: *"accept recommendations for all questions"*)

### Q10 — Copies of the server's data off its disk

`data/backups/` is on the same disk as the database (CLAUDE.md). On a NAS, the disk is RAID 6, which survives drive
failures, not deletion, corruption or loss of the box.

| | Option |
|---|---|
| **A** | ⭐ **The host's own backup includes the project folder** (*For Synology deployment*: the owner's existing NAS backup task), plus the app's weekly reminder to download one |
| **B** | **The app's reminder only** (U10), as on this machine |

[Answer]: **A** (owner, 2026-10-24: *"accept recommendations for all questions"*)

---

## 4. Plan: after the answers

- [x] Collect Q1–Q10; follow-ups for anything ambiguous
- [x] `construction/u11-off-machine-deployment/infrastructure-design/infrastructure-design.md`: the services a host must provide; the server compose (ports, mounts, `extra_hosts`, settings); certificates and the CA; the deploy path
- [x] `…/infrastructure-design/deployment-architecture.md`: Machine 2's layout (SSO Server 9443, the app, folders, devices), the trial beside this machine's deployment, the move
- [x] `HANDOFF.md`, `aidlc-state.md`, `audit.md` updated; completion message; owner approval (2026-10-24, *"approved"*)
