# Deployment Architecture — U8: Team Workflow & Onboarding

**Date**: 2026-10-14 · **Status**: ✅ approved 2026-10-14 · Decisions: [`infrastructure-design.md`](infrastructure-design.md)

## 1. Where everything runs during the walk

```
THIS PC (owner)                                    SECOND PHYSICAL MACHINE
-----------------------------------------          ------------------------------------------------------
Rancher Desktop                                    Hyper-V host
  spotify-now-playing:0.8.0  :3010  LIVE             └─ VM kuhndjwin11pro (Win 11 Pro, 16 GB fixed, nested virt)
  ./data  ./state  ./config  ./secrets                    checkpoint `clean` = base B1–B7   (every walk reverts here)
  (UNCHANGED by U8; keeps recording)                       │
                                                           ├─ C:\walk\INSTALL.md   (from tag; the ONLY input)
gh (owner) ── npm run protect ──┐                          ├─ fresh Claude Code session  (no CLAUDE.md: IN-U8-4)
(PAT: made in the VM's Edge)    ┤                          ├─ C:\walk\spotify-companion\  (clone at S2, PAT read-only)
                                │                          ├─ Rancher Desktop + WSL  (installed BY the walk, S1)
                                │                          └─ walk container :3010 on 127.0.0.1, THROWAWAY DB
                                │                                automation OFF; destroyed by revert
                                ▼
GITHUB  kuhndj67/spotify-companion (private)               ▲ clone only (Contents: read)
  ruleset on main (LC-52) ◄─ write: owner's gh ONLY        │
  fine-grained PAT, 7 days ───────────────────────────────┘ ✗ push refused (positive control)
  CI ubuntu-latest: typecheck · test · smoke(load) · knip · gitleaks · build · container build
  weekly: gitleaks full history

SPOTIFY  one account, TWO apps
  live app  ◄── polls ── this PC
  spotify-companion-walk ◄── polls ── VM          (registered at S3, deleted after)

BACK TO THIS PC (Procedure T, amended 2026-10-16): this PC PULLS C:\walk-out\ from a temporary read-only SMB share
                  ON THE VM (deleted by the revert) into D:\walk-results\, outside the repo:
                  walk-record.md → gitleaks → commit under walks/ · transcript.jsonl → review only, never committed
THE HYPER-V HOST OS IS ISOLATED (corporate VPN): it manages the VM and carries no data. No clipboard.
NOTHING on this PC is shared with the VM.
```

## 2. Credentials: who holds what, and for how long

| Credential | Held by | Scope | Lifetime | Leaves with |
|---|---|---|---|---|
| Owner's `gh` login | this PC | admin on the repo | standing | never goes to the VM |
| Fine-grained PAT | VM's Git Credential Manager | **one repo, Contents read** | ≤ 7 days | deleted on GitHub + revert |
| `spotify-companion-walk` id/secret, refresh token | VM `secrets/` · the session transcript | the owner's account, Development Mode | the walk | app deleted + revert; transcript deleted after review |
| MusicBrainz contact | VM `secrets/musicbrainz.json` | — | the walk | revert |
| Claude Code sign-in | VM (in `clean`) | the owner's Claude account | standing | stays in the base |

## 3. Walk lifecycle

```
revert to `clean` ─► C:\walk\INSTALL.md ─► fresh session ─► S1…S10 (owner: PAT at S2, browser at S3/S4)
      ▲                                                          │
      │            step failed (BR-62.3) ─► fix INSTALL.md ─► new commit ─┘ (walk the changed steps again)
      │
      └──── after the walk: copy back record + transcript ─► delete PAT ─► delete Spotify app ─► revert
```
