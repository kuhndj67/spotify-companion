# Install: on a server, for your other devices

This installs the app on an **always-on machine on your home network** (a NAS, a mini PC, a home server), so you can
open it from your other devices after **signing in**. It is the same app and the same image as the
[app-only install](INSTALL-APP.md), in its second mode:

| | **Local** (the default) | **Server** (this document) |
|---|---|---|
| Who can open it | this machine only (`http://localhost:3010`) | devices on your home network, after signing in |
| Sign-in | none: the trust boundary is the machine itself | through **your own sign-in provider** (OpenID Connect), one allowed account |
| Address | `http://localhost:3010` | `https://<name>:3443`, with a certificate your devices trust |
| Setting | nothing to set | `ACCESS_MODE: server` and the settings below |
| Guide | [`INSTALL-APP.md`](INSTALL-APP.md), [`INSTALL-DEV.md`](INSTALL-DEV.md) | this one |

It is still a **single-user** app: one person, one Spotify account, one allowed sign-in account. Reaching it from
outside your home network is **not** supported and not designed for.

**Availability.** Server mode arrives in **`1.0.0-beta.10`**; the commands below use it. Newer releases are announced
on the [Releases page](https://github.com/kuhndj67/spotify-companion/releases).

**How to use this document.** As the other install guides: do the steps in order; each has a **Purpose**, the
**Commands**, what you should see (**Expected**) and what to do otherwise (**If it differs**). A step that only a
person can do is a box starting **👤 YOU DO THIS**. Each step says what **any** host needs, then, under ***For
Synology deployment***, what a Synology NAS needs in particular. The Synology parts were measured on a DS1517+ with
DSM 7.2 and Container Manager 24.0.2; other hosts are written for but not walked.

## If you are an AI agent following this file

1. When you reach a **👤 YOU DO THIS** box, **show it to the person word for word**, then **stop and wait** until they
   say it is done. Never try to do one yourself: they need a browser, the provider's administration pages, a password,
   or a private key that must not pass through you.
2. **Never ask for, read or repeat** the client secret, any private key (`*-key.pem`) or the session key. Ask only
   for what a box says to tell you.
3. Where a step runs on the **server**, you may not have a shell there: show the person the command and wait for what
   they report.
4. Compare what you see with **Expected**; on a difference, follow **If it differs**, and stop if that does not get
   you past it.

⚠️ **One recorder at a time.** If you already run the app on another machine, do **not** give this server your
Spotify credentials until you have moved your history to it (N7). Two installs recording the same account
double-count every play, and nothing stops you: each install's one-writer lock covers its own database only.

---

## What the server needs

| Service | Why | *For Synology deployment* |
|---|---|---|
| A container runtime with `docker compose` | runs the app | **Container Manager** (a *Project* is a compose file) |
| A **fixed LAN address** | the published port and a host entry use it | a DHCP reservation for the NAS on your router |
| A **name** your devices resolve | the address and the certificate use it | `<name>.local`, the NAS's own name (local-network discovery) |
| An **OpenID Connect provider**: authorization code with PKCE (S256), RS256-signed ID tokens, HTTPS redirect addresses | sign-in | **SSO Server** (Package Center), on its own port, for example **9443** |
| A **certificate authority** your devices trust | HTTPS for the app and the provider | made in N1 by the app's own tool |
| `amd64` (Intel or AMD) | the image is published for it only | most Plus-series models; ARM models are untested |

On **your PC** (not the server) you need Docker, as in [`INSTALL-APP.md`](INSTALL-APP.md) A1, for the certificate tool.

**Two values used throughout**, decided once:

- **`<name>`**: the name your devices use to reach the server, with its suffix, for example `machine.local` (on a
  Synology NAS, its name plus `.local`). The sign-in provider and the app both run on that one server, on different
  ports (for example 9443 and 3443), so they share this name. The CA is not a server: it is two files on your PC.
- **`<LAN address>`**: the server's fixed address on your home network, for example `192.168.0.10`.

---

## N1 — Certificates

**Purpose**: make your own small certificate authority (CA) and two certificates from it: one for the sign-in
provider, one for the app. The CA is **name-constrained** to the server's name and address, so its key can make
certificates for nothing else. Done **on your PC**: the CA's key must never be on the server.

**Commands**: on your PC, in a folder **outside** any install or repository folder (ideally removable media, here
`G:\companion-ca`). Replace `<name>` and `<LAN address>` (see *Two values used throughout*, above), lower case:

```powershell
docker run --rm -v "G:\companion-ca:/work" ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.10 certs ca --out /work/ca --dns <name> --ip <LAN address>
docker run --rm -v "G:\companion-ca:/work" ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.10 certs issue --ca /work/ca --out /work/sso --name sso --dns <name> --ip <LAN address>
docker run --rm -v "G:\companion-ca:/work" ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.10 certs issue --ca /work/ca --out /work/app --name server --dns <name> --ip <LAN address>
```

From a source checkout the same tool is `npm run certs -- ca …`. ⚠️ In **Windows PowerShell**, write the `--` as
`'--'` (PowerShell drops a bare `--` before npm sees it, and the tool then reports *Unexpected argument*); in Command
Prompt or a Linux shell, a plain `--` works.

> 👤 **YOU DO THIS** — N1 CA key · needs: your password manager, or removable media
>
> 1. Move `ca\ca-key.pem` **offline**: an attachment in your password manager, or the removable media kept unplugged.
> 2. Delete any other copy of it. It is needed again only to issue or renew a certificate.
>
> **You should see:** `ca\ca-cert.pem`, `sso\sso-cert.pem`, `sso\sso-key.pem`, `app\server-cert.pem`,
> `app\server-key.pem` still on disk; `ca-key.pem` nowhere but offline.
> **When done, tell the agent:** "N1 done, CA key offline", and the name and LAN address you used (N4 needs them).

**Expected**: each command ends with `✓ positive control: a certificate for outside-the-constraint.invalid is refused
(name constraint works)`. The certificates last 825 days; the CA ten years.

**If it differs**

- `✗ … is (inside) a git repository` or `… an install folder`: the tool refuses to put the CA key where it could be
  committed or copied to the server. Use another folder.
- `✗ refusing to overwrite`: a renewal goes into a new, empty folder.
- `⚠️ the CA vouched for outside-the-constraint.invalid`: the name constraint is not working. Do not use that CA.

---

## N2 — The sign-in provider

**Purpose**: give the provider its certificate, and register the app with it, so it can sign you in and send you
back.

**Commands**: at your provider, register an **OpenID Connect** application (a confidential client):

- **Redirect address**: exactly `https://<name>:3443/auth/callback`
- **Scope**: `openid`

Note its **client ID** (not secret), its **issuer** and the **subject** of the account you will sign in with. Keep
the **client secret** for N4 (a password manager is a good place); never paste it anywhere else.

The **issuer** is the provider's own address for itself. The app compares it character for character with what the
provider announces, so copy it, do not type it: open the provider's discovery document (its documentation names the
address; it ends in `/.well-known/openid-configuration`) and copy the value of `"issuer"`. *For Synology deployment*,
it is `https://<name>:9443/webman/sso`.

### *For Synology deployment*

> 👤 **YOU DO THIS** — N2 SSO Server · needs: DSM as an administrator
>
> 1. **Package Center** → install **SSO Server**. Give it its **own HTTPS port**: **Control Panel → Login Portal →
>    Applications → SSO Server → Edit**, customized HTTPS port, for example `9443` (`5443` is refused as reserved).
>    Then in SSO Server's **Settings**, set the **Server URL** to `https://<name>:9443` and enable **OIDC**.
> 2. **Control Panel → Security → Certificate → Add → Import**: private key `sso-key.pem`, certificate `sso-cert.pem`,
>    intermediate `ca-cert.pem`. Then **Settings** on the same tab: assign it to the **`ssoserver-9443`** entry.
> 3. **SSO Server → Application → Add → OIDC**: redirect address `https://<name>:3443/auth/callback`. When it is
>    saved, the entry shows an **Application ID** (the client ID) and a **secret** beside it (the client secret).
>    Copy both, and keep the secret somewhere safe (a password manager): N4 puts it in a file, and nothing else ever
>    asks for it. If you no longer have it later, the entry can be given a new secret; the old one then stops working.
> 4. The **issuer** on a Synology NAS is always `https://<name>:9443/webman/sso` (with your SSO Server port).
> 5. The account you will sign in with: its **subject is its DSM user name**, exactly (case matters). Measured: a
>    dedicated non-administrator account with DSM's own application privilege works. Whether less suffices is not
>    measured. The app never uses the account's files, so it needs no shared-folder access.
>
> **You should see:** `https://<name>:9443/webman/sso/.well-known/openid-configuration` opens (after N3, without a
> warning) and its `issuer` is `https://<name>:9443/webman/sso`.
> **When done, tell the agent:** "N2 done", the client ID, the issuer, and the subject of the account you will sign
> in with. Not the secret.

**Expected**: the provider's discovery document offers `code`, `S256` and `RS256`.

**If it differs**

- SSO Server refuses the redirect address: it must be HTTPS and a **name** (`localhost` and IP addresses are refused).
- DSM still serves its factory certificate on the SSO port: the certificate was imported but not **assigned** to
  `ssoserver-9443` (step 2's *Settings*).

---

## N3 — Trust the CA on each device

**Purpose**: make each device that opens the app trust your CA, so the app's address shows no warning.

**Commands**: on Windows, for your own account (Command Prompt):

```
certutil -user -addstore Root G:\companion-ca\ca\ca-cert.pem
```

or **Manage user certificates** → *Trusted Root Certification Authorities* → *Certificates* → *All Tasks → Import*.
Edge and Chrome use that store. ⚠️ **Firefox** keeps its own unless its *enterprise roots* setting is on. Other kinds
of device (macOS, iOS, Android) are not yet written up.

**Expected**: Windows asks to confirm *Spotify Companion CA for `<name>`*; afterwards the provider's discovery
address opens without a warning.

**If it differs**

- Still a warning: the browser was open during the import; restart it. Firefox: see above.
- Never import either **key** file on a device: only `ca-cert.pem`.

---

## N4 — The server's folder

**Purpose**: on your PC, create the folder the app will run from, with the server settings filled in and the
certificates and secret in place. N5 copies it to the server, so no shell on the server is needed here.

**Commands**: on your PC, create a **new, empty** folder outside any repository (here `D:\companion-server`), go
into it, and run `setup` there (`${PWD}` is the folder you are in):

```powershell
mkdir D:\companion-server
cd D:\companion-server
docker run --rm -v "${PWD}:/work" ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.10 setup --server
```

Then, in the new `compose.yaml`, replace every `<placeholder>` on a setting line (the comments mention them too;
those can stay). The values come from earlier steps:

| Setting | Text to replace | Value | From |
|---|---|---|---|
| `ports` | `<LAN address>` | the server's address | N1's `--ip` |
| `extra_hosts` | `<name>` and `<LAN address>` | the server's name and address | N1's `--dns` and `--ip` |
| `PUBLIC_ORIGIN` | `<name>` | the server's name | N1's `--dns` |
| `OIDC_ISSUER` | `<the provider's issuer>` | the issuer, copied (*For Synology*: `https://<name>:9443/webman/sso`) | N2 |
| `OIDC_CLIENT_ID` | `<the client ID the provider gave>` | the client ID (*Synology*: the Application ID) | N2 |
| `OIDC_ALLOWED_SUBJECT` | `<your account's subject>` | your account's subject (*Synology*: the DSM user name, exact letter case) | N2 |
| `SESSION_LIFETIME` | (none: `7d`) | how long a sign-in lasts, `1h` to `90d`. Recording never stops when it ends | your choice |
| `OIDC_PROVIDER_PORTAL` | the whole line is a comment | optional: remove the `# ` in front of it and fill in `<name>` | *For Synology deployment* |

The `image:` line names the version of the image you ran `setup` with; leave it. (A test build is the one exception:
its tag is not a release, so put that tag on the line instead.)

Then the files. The two **public** ones (the agent may copy these): `ca\ca-cert.pem` → `.\config\ca\ca-cert.pem`, and
`app\server-cert.pem` → `.\secrets\app\tls\server-cert.pem`.

> 👤 **YOU DO THIS** — N4 secrets · needs: the files from N1, the client secret from N2, a text editor
>
> 1. Copy `app\server-key.pem` (from N1) to `.\secrets\app\tls\server-key.pem`.
> 2. Create `.\secrets\app\oidc-client-secret` (no file extension; in Notepad, save as `oidc-client-secret.` with the
>    final dot) holding the **client secret** on one line: the secret you kept in N2 (*Synology*: SSO Server →
>    Application → your app's entry, the secret shown beside the Application ID).
> 3. Open `.\secrets\app\musicbrainz.json` (setup already wrote it) and replace `you@example.com` with an address
>    where you can be reached, as [`INSTALL-APP.md`](INSTALL-APP.md) A5.
>
> **You should see:** in `.\secrets\app\`: `musicbrainz.json`, `oidc-client-secret`, and `tls\` holding
> `server-cert.pem` and `server-key.pem`.
> **When done, tell the agent:** "N4 secrets done". Not the secret, not the key.

Do **not** add Spotify credentials yet (see *One recorder at a time*, above).

### *For Synology deployment*

- **Set `OIDC_PROVIDER_PORTAL: https://<name>:9443/`** (uncommented). Measured: SSO Server's sign-in page does
  **not** return to the app when you arrive with no SSO Server session (it loops back to its own sign-in, for every
  account). With this setting the app first shows a short page: *sign in at the provider (opens in a new tab), then
  Continue*, which completes.

**Expected**: no `<placeholder>` left on a setting line of `compose.yaml`; these five files in place:
`./config/ca/ca-cert.pem`, `./secrets/app/tls/server-cert.pem`, `./secrets/app/tls/server-key.pem`,
`./secrets/app/oidc-client-secret`, and `./secrets/app/musicbrainz.json` with your address.

**If it differs**

- `✗ setup: refusing to overwrite`: use a new, empty folder.
- `✗ setup: unknown option`: the only option is `--server`.

---

## N5 — Copy it to the server, start it, check that it serves

**Purpose**: put the folder on the server, start the app there, and see positive evidence that it serves HTTPS and
refuses requests without a sign-in.

> 👤 **YOU DO THIS** — N5 server · needs: the server's administration (Synology: DSM as an administrator, and SSH)
>
> 1. Copy the whole folder from N4 to the server, into a place only administrators can open, on a volume you back
>    up. It holds the client secret, the app's TLS key and (once started) the session key.
> 2. Start it: `docker compose up -d` in the folder on the server.
>
> *For Synology deployment*, these three replace 1 and 2:
>
> 1. Copy the folder into an administrators-only shared folder, for example `docker/spotify-companion`.
> 2. **Give the container's user its four folders.** DSM's shared-folder permissions refuse the container's user
>    (uid 1000) even when it owns the files, so the app could not read `ca-cert.pem` or write its database. Over SSH,
>    as an administrator, in that folder:
>
>    ```
>    sudo chown -R 1000:1000 data state config secrets
>    sudo chmod -R u+rwX data state config secrets
>    ```
>
>    This switches those four folders to ordinary Linux permissions (owner only): File Station can no longer browse
>    them; use SSH (`sudo`) to reach them, for example to copy a backup out of `./data/backups/`.
> 3. **Container Manager → Project → Create**: choose the folder, *use the existing compose.yaml*. Leave the **Web
>    Station portal** option **off**: the app serves its own HTTPS, and a proxy in front would bypass its address
>    check. Start it.
>
> **You should see:** the container running.
> **When done, tell the agent:** "N5 started", and the lines of the container's log from its start that begin
> `spotify-companion listening on`, `Access:` and `[access]` (`docker logs spotify-companion`; *Synology*: Container
> Manager → Container → Log, which shows the **newest line first**, so the start is at the bottom). The log holds no
> secrets, but it does show your MusicBrainz contact address (the `Labels:` line); leave that line out if you prefer.

**Commands**: the agent reads the log lines you send, then checks that a page request goes to the sign-in
(`--ssl-no-revoke` is for Windows' `curl.exe`, whose certificate check otherwise wants a revocation list your CA does
not publish):

```powershell
curl.exe -s -o NUL -w "%{http_code} %{redirect_url}" --ssl-no-revoke -H "Sec-Fetch-Mode: navigate" https://<name>:3443/
```

**Expected**: in the log, `spotify-companion listening on https://0.0.0.0:3000, public address https://<name>:3443`
and `Access: server mode, sign-in through <issuer>`; no `NOT SERVING`. (Errors that Spotify is not configured are
expected until you add credentials.) The check prints `302 https://<name>:3443/auth/sign-in?return=%2F`. (Without the
`Sec-Fetch-Mode` header, which a browser sends, the answer is `401`: that is an API request without a session, also
correct.)

**If it differs**

- `[access] NOT SERVING …` followed by named settings: each line names what is missing or wrong; fix it and restart.
  The app records meanwhile; it only opens no port.
- `EACCES` or *Ignoring extra certs … Permission denied*: the container's user cannot read its folders (the box's
  Synology step 2).
- `[lock] cannot create … the app's user cannot write to the data folder`: the same.
- Nothing answers for the first half-minute after replacing a container that was force-removed: the app waits one
  30-second window for the old database lock before taking it over. That is the one-writer rule working.
- *the sign-in provider is not usable yet: provider-unreachable*: the container cannot reach the provider. Check
  `extra_hosts` and that `ca-cert.pem` is in `./config/ca/`.

---

## N6 — Sign in

**Purpose**: sign in from another device and reach the app.

> 👤 **YOU DO THIS** — N6 sign-in · needs: a device that trusts the CA (N3), and the account from N2
>
> 1. Open `https://<name>:3443/`.
> 2. With `OIDC_PROVIDER_PORTAL` set: click **Sign in at your sign-in provider** (a new tab), sign in there, come back,
>    click **Continue**. Without it: you go straight to the provider; sign in.
>
> **You should see:** the app's page. A page titled *Sign-in did not complete* gives its reason in one sentence.
> **When done, tell the agent:** "N6 signed in", or the sentence on the problem page, and the line from the **app's**
> container log (not the provider's) that begins `[access] sign-in` (*Synology*: Container Manager → Container →
> Log, newest first).

**Commands**: none beyond the box; afterwards the log has one line per sign-in, `[access] sign-in completed for …` or
`[access] sign-in refused: <reason>`. Nothing secret is ever logged.

**Expected**: the app's page; the log line *completed*. **Settings → Access** shows who is signed in and when the
session ends, with **Sign out** (this device) and **Sign out everywhere** (every device: the app replaces its session
key). The sign-in lasts `SESSION_LIFETIME`; when it ends, the page says **Signed out** (the status bar's connection
light, and a *Sign in* link) and stops updating until you sign in again. Neither sign-out signs you out of the
provider, so the next sign-in can be quick. Recording never stops for any of this.

**If it differs**

- *Signed in as … This app admits only its owner's account*: `OIDC_ALLOWED_SUBJECT` does not match that account
  exactly.
- SSO Server's sign-in page keeps coming back (*For Synology deployment*): set `OIDC_PROVIDER_PORTAL` (N4). Measured:
  SSO Server 3.0.7; DSM's iframe-embedding setting makes no difference.
- *The sign-in provider cannot be reached*: N5's last item.

---

## N7 — Move your history to the server

**Purpose**: bring your listening history from the machine that records it now to the server, check that every row
arrived, and only then let the server record. Afterwards the old machine stops recording.

**Commands**, in this order (the order is the point):

1. On the server: N1–N6 done, signed in, **no Spotify credentials** yet (so it records nothing). **Pause label
   lookups** for the test: add `LABELS_ENABLED: "false"` to `compose.yaml`'s `environment:` and recreate the
   container. Measured: right after a restore, the label lookups (MusicBrainz, which need no Spotify credentials) add
   label rows on their own, and the test then fails on those tables though your history arrived whole.
2. On the machine that records now: **Settings → Create backup** (a `.tar.gz` downloads).
3. In the server's app, from your browser: **Settings → Restore backup**, choose that file, confirm. The server
   restarts with your history. Tick **Also replace my rules with the backup's** in the restore dialog, so your rules
   come too (a backup carries both, but replaces the rules only when asked). If you restored without it: on the old
   machine **Rules → Rules file → Download rules**, on the server **Upload rules…** that file and confirm.
4. **The exit test**, immediately, before anything else: run **Diagnostics** on both and compare the row
   ***Table counts and rules hash***: every table and count, and the rules hash, must be identical. To compare by
   machine instead, save each report (`/api/diagnostics`: on the old machine
   `curl.exe -s http://localhost:3010/api/diagnostics -o old.json`; on the server, open
   `https://<name>:3443/api/diagnostics` in the signed-in browser and save it as `new.json`) and, from a source
   checkout, run `npm run corpus:compare -- old.json new.json`.
5. Only if the test passes: remove the `LABELS_ENABLED` line again and recreate the container. Then, on the server,
   **Settings → Spotify**, the server's **own** Spotify app registration
   (another client id, so the two installs never share one quota). The server now records. The old machine still does
   too: this is the trial, two recorders on purpose, for as long as you choose.
6. **The move**, when you are ready: a last **Create backup** on the old machine → **Restore backup** on the server
   (the trial's own plays are replaced; the old machine's arrive with the backup) → stop the old machine's app
   (`docker compose down` there) and leave it stopped.

**Expected**: step 4 shows the same counts and hash on both sides (`✓ pass` from `corpus:compare`); after step 6 only
the server records.

**If it differs**

- Step 4 differs: stop. Do not add Spotify credentials. A difference right after a restore means the restore did not
  bring everything; restore again from the same file and compare again, and report it if it persists.
- The server recorded before step 4 (credentials added early): its own plays make the counts differ. Restore again,
  then compare.
- Only `label_*` tables differ, each higher on the server: label lookups were running (step 1). Pause them, restore
  again, compare again.
- Only the rules hash differs: the restore did not replace the rules (step 3's tick box), or a rules file was changed
  on one side.
- `corpus:compare` says *has no fingerprint*: one side runs a version before server mode, or has no database open.
  The old machine must run this release too before the test: update it first (*Updating* in its install guide).

---

## Renewal, backups, monitoring

- **Renewal**, about every two years (the certificates last 825 days): bring the CA key back from offline, issue both
  certificates into a new folder (N1's `issue` lines), import SSO Server's again (*For Synology*: N2 step 2), copy the
  app's pair into `./secrets/app/tls/`, restart the container, put the CA key offline again. Devices keep the CA
  (ten years) and are not touched.
- **Backups**: the app keeps its own in `./data/backups/` (see [`INSTALL-APP.md`](INSTALL-APP.md), *Backups*). Include
  the folder in the host's own backup too (*For Synology*: your NAS backup task). ⚠️ Restore from an archive in
  `./data/backups/`, never from a copied `history.db`: a file copied while the app writes may be inconsistent.
- **Monitoring**: the container's log (one line per sign-in and sign-out, the problems at startup, and a summary every
  hour while not serving), the container's health status (*unhealthy* while it is not serving), and **Diagnostics**:
  *Access* (the mode, the provider, the certificate's expiry, warning 30 days ahead), *WAL* (fails if the volume
  refused SQLite's WAL mode: then nothing is recorded) and *Table counts and rules hash*.
