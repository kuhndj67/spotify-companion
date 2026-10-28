# U11 Infrastructure Design — Off-machine Deployment

**Unit**: U11 · **Date**: 2026-10-24 · **Plan**: [`u11-infrastructure-design-plan.md`](../../plans/u11-infrastructure-design-plan.md)
— Q1–Q6, Q8–Q10 all A; Q7: this PC (Windows 11) for now
**Allocates**: **IN-U11-1…IN-U11-10** · Machine 2's layout in [`deployment-architecture.md`](deployment-architecture.md)

Host-agnostic first (FD plan Q9): each item says what **any** container host needs, then *For Synology deployment*
where Machine 2 needs something specific. Setting and file names below are the design's; Code Generation may rename
them, not change what they hold.

---

## IN-U11-1 — What a server host must provide

| Service | Needed for | *For Synology deployment* (Machine 2) |
|---|---|---|
| A container runtime with `docker compose` | running the app | Container Manager 24.0.2 (a *Project* is a compose file) |
| A **fixed LAN address** | the published port, the host entry (IN-U11-2) | `192.168.0.223`; a DHCP reservation on the router is assumed |
| An **OIDC provider** offering authorization code with PKCE (S256), RS256-signed ID tokens, a published key set, and HTTPS redirect addresses by name | sign-in (BR-89, BR-90) | **SSO Server**, on its own port **9443** (Login Portal → Applications), issuer `https://<Machine 2's name>.local:9443/webman/sso` (measured) |
| A **name** the owner's devices resolve (Q1 = A) | the address, the certificate, the redirect | `<Machine 2's name>.local`, by local-network discovery |
| A **certificate authority** the owner's devices trust, and certificates from it (Q4, Q6) | HTTPS for the app and the provider | the name-constrained CA (IN-U11-4); SSO Server's certificate imported in DSM |
| A **backup of the project folder** off its disk (Q10 = A) | surviving loss of the disk or the box | the owner's existing NAS backup task |

## IN-U11-2 — The server compose file (Q2 = A, Q3 = A)

Written by `setup --server` (IN-U11-3) from a new template beside `compose.app.yaml`. Differences from the App-only
file, and nothing else:

```yaml
    ports:
      # LAN address only (Q3 = A): not reachable through the host's other interfaces.
      - "<LAN address>:3443:3000"
    extra_hosts:
      # The container finds the provider by a fixed entry, not by DNS (Q2 = A; .local is not expected to
      # resolve inside a container on Linux Docker).
      - "<name>:<LAN address>"
    environment:
      ACCESS_MODE: server
      PUBLIC_ORIGIN: https://<name>:3443
      OIDC_ISSUER: <the provider's issuer, exactly>
      OIDC_CLIENT_ID: <from the provider>
      OIDC_ALLOWED_SUBJECT: <your account's subject at the provider>
      SESSION_LIFETIME: 7d
      NODE_EXTRA_CA_CERTS: /config/ca/ca-cert.pem     # the app trusts the provider's certificate
```

- **No** `TRUST_PUBLISHED_PORT` and **no** `LOCAL_ONLY` (BR-88.5). The volumes are the App-only four, unchanged.
- The app listens HTTPS on its usual container port; only the published side is 3443 (Host checks use the public
  origin, BR-92.2).
- `<LAN address>` appears twice; the install guide says so, and Diagnostics' *Access* row shows the public origin
  so a mismatch is visible.

## IN-U11-3 — `setup --server` (Q8 = A)

The image's `setup` gains one option. It writes the server template as `compose.yaml`, the same `secrets/app/`,
`config/`, `data/`, `state/` folders and starter files as App-only setup, plus `config/ca/` and `secrets/app/tls/`
(empty). It refuses, as `setup` does, if any target file exists (`decideSetup`, all or none). It prints the next steps:
fill in the placeholders, place the certificate files, register the app at the provider. It never creates a
certificate or a key on the server: the CA key must not be there (Q5).

## IN-U11-4 — Certificates: one script, run on the owner's PC (Q4 = A, Q6 = A)

A script under `scripts/` (its npm name chosen in Code Generation), using OpenSSL (on Windows, the one Git ships;
3.1.4 measured):

| Action | What it does |
|---|---|
| **Make the CA** | RSA, 10 years, `pathlen:0`, **name-constrained** (critical) to the DNS names and the single IP address given; writes `ca-cert.pem` and `ca-key.pem` to a folder the owner names, **refusing any folder inside the repository** (NFR-28) |
| **Issue** | a server certificate for the given names: subject alternative names, `serverAuth`, **≤ 825 days** (refuses more), its own new key. Run twice: once for SSO Server, once for the app (Q4 = A) |
| **Verify** (always, after each action) | the chain verifies against the CA; the names are covered; **positive control**: a throwaway certificate for a name outside the constraint is issued and **must fail** verification. Any failure → non-zero exit, nothing reported as done |

The pure parts (name validation, the 825-day cap, the refuse-inside-repo check) live in `src/` and are tested;
`scripts/` is covered only by `smoke` (CLAUDE.md).

**Where the files go**

| File | Goes to | Secret? |
|---|---|---|
| `ca-key.pem` | **offline only** (IN-U11-5) | **yes** |
| `ca-cert.pem` | every device that opens the app (installed as a trusted root); the server's `config/ca/` | no |
| the app's certificate and key | the server's `secrets/app/tls/` (`server-cert.pem`, `server-key.pem`) | the key, yes |
| SSO Server's certificate and key | *For Synology deployment*: DSM → Control Panel → Security → Certificate → Add → Import (private key, certificate, intermediate = `ca-cert.pem`), assigned to the `ssoserver-9443` entry | the key, yes; it then lives only in DSM |

**Renewal** (about every two years; Diagnostics warns 30 days ahead, BR-96.2): retrieve the CA key → issue both
certificates → import SSO Server's in DSM → copy the app's pair into `secrets/app/tls/` → restart the container
(P-98; recording resumes, backfill covers the gap) → return the CA key offline. The CA itself lasts ten years;
devices are not touched at renewal.

**Devices** (Q7: this PC, Windows 11, for now): the install guide covers installing `ca-cert.pem` in Windows'
*Trusted Root Certification Authorities* store (for the current user), which Edge and Chrome use. ⚠️ Firefox keeps its
own store unless its *enterprise roots* setting is on; the guide says so. Other kinds of device (macOS, iOS, Android)
get their own step when they are used, and a phone also needs the `.local` name measured (deployment-architecture §3).

## IN-U11-5 — The CA key stays offline (Q5 = A; security posture, the owner's)

`ca-key.pem` is kept in the owner's password manager (as an attachment) or on removable media. It is **never** on the
server, never in the repository, never in `secrets/app/`, never in a backup the app makes. The script writes it once,
to the folder the owner names; the install guide's next step is to move it offline and delete the local copy. Its
reach if stolen: certificates for Machine 2's names and address only (the name constraint, seen to refuse another
name).

## IN-U11-6 — Registering the app at the provider

Host-agnostic: register an OIDC application (confidential client) with redirect address
`https://<name>:3443/auth/callback`, scope `openid`; copy the client ID into the compose file and the client secret
into `secrets/app/oidc-client-secret`; set `OIDC_ALLOWED_SUBJECT` to the owner's subject.

*For Synology deployment*: SSO Server → Application → Add → OIDC. Measured rules: the redirect must be HTTPS, a name
(not an IP address), and the same protocol as SSO Server; `localhost` is refused. The subject is the DSM user name.

## IN-U11-7 — Files in the secrets and config folders

| Path (host · container) | Written by | Notes |
|---|---|---|
| `secrets/app/oidc-client-secret` · `/app/secrets/…` | the owner | read at startup |
| `secrets/app/session.key` | the app (LC-85), exclusive create | replaced by *Sign out everywhere*; temp then rename, inside the **directory** mount (U9: rename fails on a single-file mount) |
| `secrets/app/tls/server-cert.pem`, `server-key.pem` | the owner (IN-U11-4) | read at startup |
| `config/ca/ca-cert.pem` · `/config/ca/ca-cert.pem` | the owner | public |

None of these is in a backup or export (BR-95.1): the backup carries the database only, as today.

## IN-U11-8 — The restricted deploy path (Q9 = A: designed now, built after the first deployment by hand)

| Piece | Design |
|---|---|
| User | a dedicated host user, **not** an administrator, **not** in the `docker` group |
| Key | one SSH key, its `authorized_keys` line restricted: `command="<deploy script>",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding` |
| Deploy script (user-owned, read-only) | reads `SSH_ORIGINAL_COMMAND`, accepts only BR-99's four forms, then calls the privileged script through `sudo` |
| Privileged script (root-owned) | `deploy <v>` / `rollback <v>`: pull exactly that published tag, change only the `image:` line of the project's `compose.yaml`, `docker compose up -d`, report the container's state; `status`; `logs` (the last lines). Never builds, never pulls `latest` (BR-99.2). The app's own before-change backup (U10, BR-79) runs on the version change |
| `sudo` rule | that user may run that one script as root, nothing else, no password |
| Test | the argument check is a POSIX `sh` function, run by the suite on each refused and accepted form (example-based; CI runs on Linux) |

⚠️ **Not verified on Machine 2, probed first when it is built**: whether DSM 7.2 lets a **non-administrator** sign in
over SSH at all (believed to be restricted to administrators: if so, this design returns with the fact); whether a
`sudo` rule and files under `/usr/local/bin` survive a DSM update; where Container Manager keeps a project's
`compose.yaml` and whether `docker compose up -d` from the shell is reflected in Container Manager.

## IN-U11-9 — Off-disk copies (Q10 = A)

The host's own backup includes the project folder. ⚠️ The copies that are **guaranteed consistent** are the archives
in `data/backups/` (the app builds and verifies them, U10); a file-level copy of `data/history.db` taken while the app
writes may not be. The install guide says so: restore from an archive in `data/backups/`, never from a copied
`history.db`. The weekly reminder to download one (U10, FR-82) stays on.

*For Synology deployment*: include the shared folder holding the project in the owner's existing NAS backup task.

## IN-U11-10 — Monitoring

No new tooling. The container's log (*For Synology deployment*: Container Manager → Container → Log) carries the
startup problems and the hourly *not serving* summary (BR-88.4) and each sign-in's outcome (BR-95.3). Diagnostics'
*Access*, *WAL* and *Table counts* rows (LC-91) are the in-app view.
