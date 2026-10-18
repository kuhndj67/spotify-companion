# Public-readiness review — 2026-10-18 (U9 Code Generation step 13, W-14)

**Verdict: NOT READY YET, because the disclosure decisions (§2) are the owner's and have not been made.** The
technical side is ready: no secret in 203 commits, the licences are in place, and nothing in the repository depends
on it being private. What remains is what the repository *says*: your listening history, your email addresses and
your home network's names. **Going public cannot be undone** (clones, caches, archives), and history keeps
everything that was ever committed, so these are decided before, not after.

This review changes nothing. Going public is the owner's exposure decision (W-14).

---

## 1. Secrets — ✅ clean

| | |
|---|---|
| Tool | gitleaks **8.30.1** (`windows_x64`), checksum `d29144de…` verified against U8's record |
| Scope | **all refs**, including branch `u9-connector-upgrade`: `git rev-list --all --count` = 204; **203 commits scanned** (one has no content changes), 7.67 MB |
| Result | `gitleaks git --redact -c .gitleaks.toml .` → **no leaks found** (exit 0) |
| Positive control | a scratch repository with a planted fake `ghp_` token, same config → **found** (exit 1) |
| Not covered | files never committed (`secrets/`, `data/`): gitignored, outside history by construction |

## 2. What the repository discloses — ⚠️ owner decisions needed

Measured against your own history: the newest snapshot's (2026-10-03, 879 plays) titles and artists, counted in
tracked files. Plays after that date are not covered, so these are **lower bounds**. Read from a copy; `data/` was not
touched.

| Class | Where (counted) | How sensitive |
|---|---|---|
| **Raw listening sessions** with timestamps | 7 probe files in `aidlc-docs/construction/u5-automated-skipping/probes/` (`p-u5-1-marks-*.json` ×6, `p-u5-1-driven.json`), with titles, artists, **32 Spotify track ids**, times | **Highest**: when you listened to what, minute by minute, on 2026-09-27 |
| **Tracks and artists in prose** | **25** design files name **73** distinct multi-word titles/artists (most in `audit.md`, `research-findings.md`, `r11-queue-lookahead-2026-09-22.md`, `requirements.md`); with single-word names, 72 titles and 54 artists | Medium: taste, sometimes with dates |
| **Artist names as test fixtures** | ~20 files under `src/`, `test/`, `public/` use a few real artists as examples (e.g. Bad Bunny, Chris Webby, Eden Nash, Macklemore, Dolly Parton), **no dates** | Low |
| **Email addresses** | `<email address>` (the MusicBrainz contact): 3 test files + U7 design docs + `audit.md`. `<email address>`: `SECURITY.md` (intended) + U8 design docs | Medium (gmail): a personal address, findable by scrapers |
| **Home network** | NAS address `192.168.0.223` (7 lines, 5 files), name `Machine 2` (10 lines, 5 files) | Low–medium: a private LAN address and a device name; no exposure by itself, but useful reconnaissance |
| **Machine names** | `Machine 1` (43 lines, 19 files) | Low |
| Spotify client id, Windows user paths | **none found** | — |

**The options, per class** (from W-14):

- **A. Accept**: publish as is. Simplest; everything above becomes public, permanently.
- **B. Redact going forward**: replace in the current files (fixtures → invented names; gmail → `you@example.com`;
  IP → `<nas-address>`). ⚠️ The **history still contains** them; anyone can read old commits. Only useful for what
  is not yet committed.
- **C. Rewrite history** (e.g. `git filter-repo`) to remove a class from every commit, then publish. ⚠️ Rewrites
  every commit id: PR #3, tags `v0.8.0`…`v1.0.0-beta.2`, every clone and every commit reference in `audit.md` change
  or break. Do it **once**, before going public, never after.
- **D. Publish a fresh repository**: a new repository from the current tree (redacted), without history; this one
  stays private as the archive. Keeps the record intact here; the public one starts clean but loses its visible
  history.

A reasonable middle path to consider (yours to choose): **C for the 7 raw probe files** (they are data, not
design) **and the gmail address**; **A** for prose, fixtures, NAS and machine names. Or **D** if the AI-DLC record
itself (`audit.md` quotes tracks with dates) should not be public.

### Owner's choices (2026-10-18)

| Class | Choice | Done |
|---|---|---|
| Email addresses | **Redact** → `<email address>` (tests use the obviously fake `listener@example.org`, since the code validates it) | ✅ 2026-10-18, current files. ⚠️ Still in **history**, and `<email address>` (the hotmail one) is the **author email of all 406 commit records**, which a public repository shows. Not changed by redacting files. `SECURITY.md` now points at **GitHub private vulnerability reporting** (owner, 2026-10-18; switched on when public). Commit-metadata email: **GitHub no-reply address from 2026-10-18** (global `user.email`); past commits keep the old address (accepted, no rewrite) |
| Machine names | **Redact**: the walk VM → `Machine 1`, the NAS → `Machine 2` | ✅ 2026-10-18, current files (still in history) |
| NAS IP address | **Accept**: a private network address | — |
| Listening history (probe files, prose, fixtures) | Not yet decided | — |

## 3. Licence and image

- The repository is **GPL-3.0-or-later** (`LICENSE`); going public is compatible, and a public repository is what
  makes the GPL source offer trivially true for a published image.
- The bundled connector is **not in this repository** (built from upstream at build time), so publishing the source
  publishes no connector code. Its licence (MIT) matters for the **image**: NFR-32 is discharged when U9's acceptance
  passes and the first image ships with both licences (code summary, B&T items 3 and 7).
- On going public, the **GHCR package** can be made public too (FR-74 says *private while the repository is*); that
  is a separate switch in the package settings.

## 4. After going public (W-14's list)

- [ ] Enable **private vulnerability reporting** (`SECURITY.md` already points at it; no email address remains).
- [ ] Review the `main` ruleset (it works the same on a public repository; GitHub Pro is then no longer needed for it).
- [ ] Decide the GHCR package's visibility (§3).
- [ ] Re-run this review's secret scan on the day (W-14 item 1).
- [ ] In GitHub *Settings → Emails*: **Keep my email addresses private** and **Block command line pushes that expose my email** (owner; the CLI token cannot change account settings).

## 5. When it would be ready

When the owner has chosen A/B/C/D for each class in §2 and that choice is carried out. If C or D is chosen, it is
done **before** the visibility switch, and best **after** PR #3 merges (so the rewrite is done once, on `main`).
