# App-only walk ① — 2026-10-21 — NOT PASSED (BR-62.3), four findings, fixed in `1.0.0-beta.6`

| | |
|---|---|
| Walker | A fresh Claude Code session on **Machine 1** (the walk VM), from `clean` |
| Image | `ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.5` (the newest tag; found by the agent, see F1) |
| Documents | `README.md` and `docs/INSTALL.md` from `main` (after PR #8); `claude-start.md` was also in the folder |
| Times (UTC) | 2026-10-19 00:47 → 01:06 (S1, steps 1–3); 2026-10-21 13:34 → 13:41 (steps 4–6) |
| Record | This summary, made from the session transcript (reviewed outside the repository; **no** token, client id, client secret or refresh token in it, checked by pattern; it does contain the owner's email address, so it is not committed). **No `install-log.md`**: see *Process* |

## Outcome

The app **installed and ran**: S1 (WSL, Rancher Desktop) by the owner; registry login `Login Succeeded`; `setup` wrote
the folder; the contact address set; the Spotify app registered; the sign-in wrote `secrets/app/spotify-config.json`;
`docker compose up -d` healthy; `http://localhost:3010` answered (only on `127.0.0.1`); the logs showed 50 recent
plays backfilled and 731 liked tracks cached; the owner confirmed it working.

**Verdict: NOT PASSED.** BR-62.3 passes a walk only if every step matched *as written*:

| # | Step | What happened | Kind | Fix (`1.0.0-beta.6`) |
|---|---|---|---|---|
| F1 | README `<version>` | Nothing said which version exists. The agent **probed the registry with guessed tag names** (`1.0.0-beta.3…15`, `1.0.0`, …) until it found `1.0.0-beta.5` | outside knowledge | README names the current release and uses it in the commands; a test keeps it equal to `package.json` |
| F2 | README → INSTALL S1 | S1 installs Rancher Desktop **and Node.js and git**; the agent decided by itself to skip the Node and git checks | outside knowledge | README names exactly which parts of S1 *App only* needs |
| F3 | Step 2 *Expected* | The real line ends `(and empty data/, state/)`; README's did not | mismatch (harmless) | README quotes the full line |
| F4 | Step 6 (the image) | At start the app logged `/state/automation-state.json is NOT WRITABLE`; the agent confirmed `node` gets *Permission denied* on `/state`. Reproduced on the dev PC: **`/config` too** (rules upload and undo). `setup` runs as root, so its folders arrive root-owned 755; the entrypoint handed only `/data` and the credentials folder to `node` | **defect** | The entrypoint also hands the rules and automation-state folders to `node` (mount points only). Seen: on fresh `setup` folders, `beta.5` → `EACCES` on both, the fix → writable on both |

The agent reported F4 accurately and **did not work around it** (it offered a one-off `chown` only with the owner's
agreement), exactly what a cold walker should do.

## Process (not document failures)

- The prompt typed was a short one (*"read readme.md and install the app following its 'app only' section, step by
  step"*), not the guide's longer one, so **no `install-log.md`** was asked for or kept. Root cause: the App-only path
  had no equivalent of `claude-start.md`, so the log depended on a prompt that lived only in the walk guide. **Fixed**:
  `docs/claude-start.md` gains an App-only route under its existing logging rule, and README tells the user to type
  *"Read claude-start.md and install App only."*
- `claude-start.md` was in the walk folder; the agent consulted it only for "newest release tag" (F1).
- The agent installed into `C:\walk\app` (a new, empty subfolder of the walk folder), not a separate folder. Harmless;
  `claude-start.md` now says "not this one".

## Next

Re-walk the changed steps on `1.0.0-beta.6`, from a revert, with the shipped one-line prompt: S1 (Docker parts only),
step 2 (version from README, full *Expected*), and step 6 including **arming automation and uploading a rules file**
(F4), with `install-log.md` kept.
