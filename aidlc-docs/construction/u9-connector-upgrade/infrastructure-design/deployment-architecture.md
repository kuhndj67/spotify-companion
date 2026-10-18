# Deployment Architecture — U9: Connector Upgrade & Publishable Image

**Date**: 2026-10-18 · Decisions: [`infrastructure-design.md`](infrastructure-design.md)

## 1. After U9

```
THIS PC (owner)                                         GITHUB  kuhndj67/spotify-companion (private)
------------------------------------------------        ----------------------------------------------------
Rancher Desktop                                           ci.yml on push / PR:  test · container · secrets
  spotify-companion:1.0.0-beta.N   :3010  LIVE              (container job: connector stage runs the guarded
    /app/secrets  ◄── ./secrets/  (DIRECTORY, rw)            patch + upstream's 113 tests on Node 22.23)
       spotify-config.json  ← connector refresh (rename)
       musicbrainz.json     ← CredentialsWriter (rename)   ci.yml on push of tag v* (owner's act):
    /data  /config  /state   (unchanged)                     test · container · secrets ──► publish
    connector: stdio child, pin 6065ce5c (MIT),                 actions/checkout@<sha> + docker CLI only
               SPOTIFY_CONFIG_PATH passed explicitly            GITHUB_TOKEN packages:write (this job only)
                                                                checks: tag==version · not yet published ·
  spotify-now-playing:*  images kept for rollback               LICENSEs · no secrets/data · base digest ·
                                                                Trivy (report only)
npm run release ── guards: old container running? ──┐             │
                           pin accepted?            │             ▼
  reads scripts/connector-acceptance.json           │        GHCR  ghcr.io/kuhndj67/spotify-companion:<version>
  tags locally; owner pushes the tag  ──────────────┘              private · linux/amd64 · no floating tag
                                                                    │
:3011 verification (during Build & Test only)                       │ docker pull (read token, 7 days)
  spotify-companion-verify, own ./verify-install/secrets/           ▼
  reduced credential copy, ≥ 50 min, rotation watch          VM Machine 1 (walk of README App only)
                                                               docker run … setup   → compose.yaml, secrets/, …
SPOTIFY  one account                                           docker run -p 127.0.0.1:8888:8888 … auth
  live app ◄── polls ── live and (briefly) :3011               docker compose up -d → play recorded
  walk app ◄── polls ── VM (registered for the walk)
```

## 2. The crossing (once, Build & Test step 5)

```
before:  container spotify-now-playing  (service now-playing, image spotify-now-playing:1.0.0-beta.2,
                                          single-file mounts, pin 7b5fde63)
   │  npm run release -- --apply  →  REFUSES while it runs, prints the stop command
   │  owner stops it
   ▼
after:   container spotify-companion     (service spotify-companion, image spotify-companion:1.0.0-beta.N,
                                          ./secrets/ directory mount, pin 6065ce5c)
host files: unchanged paths (secrets/spotify-config.json, secrets/musicbrainz.json, data/, config/, state/)

rollback: stop spotify-companion → v1.0.0-beta.2's compose + image spotify-now-playing:1.0.0-beta.2
          (no file moves; rehearsed on :3011 first)
```
