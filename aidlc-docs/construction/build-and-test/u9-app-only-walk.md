# End-to-end test: the U9 *App only* walk (BR-74.6)

**What it proves**: someone with only Docker, a read token and their own Spotify app can install the app from the
**published image**, following README *App only* **as written**, with no source code, no Node and no help. When it
passes, README's *coming soon* label comes off (a docs-only change).

**Method**: walk ①'s (`e2e-test-instructions.md`), on **Machine 1** from its `clean` checkpoint, with a fresh Claude Code
session. Read that guide's §1–§2 for the base, and §6 (Procedure T) for moving results off the VM. Only the
differences are written here.

**The verdict** (BR-62.3, unchanged): the walk **passes** only if **every** step matched *as written*. Any step that
needed outside knowledge **fails**, even if the agent recovered. Fix README (or INSTALL S1/S3 if the failure is
there), and walk the changed steps again from a revert.

---

## 1. Before

- **The published image**: the version `INSTALL-APP.md` names (walk ① used `1.0.0-beta.5`; the re-walk `1.0.0-beta.7`).
- **The documents**: `README.md` and `docs/INSTALL.md` from **`main`** after the U9 publish PR is merged (README's
  *App only* names the classic token since then). The walk tests those two files only.
- **The token**: a **classic** GitHub token with **only** `read:packages`, 7 days (the fine-grained one cannot pull:
  measured). The one made for the token probe can be reused while it is valid. ⚠️ It is typed into Docker's login
  prompt by the owner; it never goes into the chat, the log or a file.
- **A new Spotify app** for the walk, `spotify-companion-walk2`, redirect URI exactly `http://127.0.0.1:8888/callback`.
  ⚠️ Never the live app.
- The live deployment on the owner's PC **keeps running**. Note the start time (UTC).

## 2. The walk

1. **Revert** Machine 1 to `clean`, then boot it.
2. In Edge on Machine 1, signed in to GitHub (the repository is private), save **only** these two files from `main`
   into a new folder `C:\walk\`, via *Raw* → *Save as*: `docs/INSTALL-APP.md` and `docs/claude-start.md`. Then **sign
   out of GitHub** in Edge. (Since 2026-10-21 the App-only steps are their own document; README only points to it.)
3. Open VS Code on `C:\walk`, start a **new** Claude Code session, and type exactly what `claude-start.md` tells a
   user to type for this install (the log rule ships in `claude-start.md`):

   > Read claude-start.md and install the app.

   *(Walk ①'s longer prompt, kept for the record; no longer used:)*

   > Read README.md and install the app by following its "App only" section, step by step. INSTALL.md is here only
   > for the steps that README links to (S1 for Docker, S3 for the Spotify app). Do the steps you can; when a step
   > needs me (an administrator window, a browser, a password, playing music), tell me exactly what to do and wait.
   > Use only these two files. Keep install-log.md in this folder: for each step, the commands you ran, the output
   > you saw, whether it matched README's *Expected* as written, and anything you had to work out. Never write a
   > secret, token, client id, client secret or refresh token into the log.

   Install into an **empty** folder the agent chooses or asks for (e.g. `C:\spotify-companion\`), not `C:\walk\`.
4. The owner does what the session asks and **nothing more**:
   - **INSTALL S1** (Docker): as in walk ① (an administrator window, perhaps a restart; after a restart, a new session
     with the same instruction and *"continue from S1's checks"*).
   - **Step 1, the registry**: run `docker login ghcr.io -u kuhndj67` in **your own** PowerShell window and type the
     token at the password prompt. *Expected*: `Login Succeeded`.
   - **INSTALL S3**: register `spotify-companion-walk2`.
   - **Step 3, the contact address**: give the agent an address to put in `secrets/musicbrainz.json`.
   - **Step 5, the sign-in**: the `auth` command needs a terminal you can type into (`-it`): Client ID and Client
     Secret are typed by you, not the agent; then open the printed link in the browser and approve.
   - **Step 6**: play music on the account.

⚠️ **If the walk stops early, at any step: copy `C:\walk\install-log.md` and the session transcript to
`C:\walk-out\` and run Procedure T BEFORE reverting.** A revert destroys the only record (learned in walk ①).

## 3. After

1. Procedure T: `install-log.md` and the transcript to `D:\walk-results\<date>\` on the dev PC, outside the repository.
2. Secret-scan `install-log.md`, then commit it as `aidlc-docs/construction/u9-connector-upgrade/walks/walk-app-only-<date>.md`,
   adding at its top: the image digest walked, the README commit walked, start and end times (UTC).
3. The transcript is for review only, **never** committed (it holds the walk app's secret). Check it for files read
   beyond `README.md` and `INSTALL.md`, then delete it.
4. **Revoke** the token, **delete** the `spotify-companion-walk2` Spotify app, `docker logout ghcr.io` on the dev PC.
5. **Revert** Machine 1 to `clean`, only once step 1's files are confirmed on the dev PC.
6. **Passed** → remove *coming soon* from README *App only* (a docs-only PR; no release needed, since the image is
   unchanged). **Failed** → fix the document, and walk the changed steps again.
