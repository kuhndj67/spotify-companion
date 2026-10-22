# U10 Deployment Architecture — Data Safety

**Unit**: U10 · **Date**: 2026-10-22 · Details: [`infrastructure-design.md`](infrastructure-design.md)

## The installs after U10

```
 This PC
 ├─ live install        compose.yaml          127.0.0.1:3010 ─▶ container spotify-companion (node, PID 1)
 │    ./data  ──▶ /data      history.db · history.db.lock · backups/{scheduled,before-change}/ · .work/
 │    ./state ──▶ /state     automation-state.json · update-check.json
 │    ./config, ./secrets/app                                   (unchanged)
 │
 ├─ verification        compose.verify.yaml   127.0.0.1:3011 ─▶ container (own verify-install/ folders)
 │                      scheduled backups off; before-change backups on
 │
 └─ host development    npm start / npm run dev ─▶ data-dev/history.db (+ .lock)   unless HISTORY_DB_PATH says otherwise
                        writing scripts ─▶ data/history.db, under the same lock

 An App-only folder     compose.yaml written by `setup`, image line rewritten by `update`
      ./data ──▶ /data  (same layout as the live install)
```

Outbound, all from the app container: Spotify (via the connector), MusicBrainz, and, while FR-81's check is on,
`api.github.com`.

## Who can hold `history.db`

| Process | Takes the lock | Path |
|---|---|---|
| live container | yes (`app`) | `/data/history.db` |
| host `npm start` / `npm run dev` | yes (`app`) | `data-dev/history.db` by default |
| `db:backup`, `db:restore`, `reclassify -- --apply`, `repair-*` | yes (`script:<name>`) | `data/history.db` |
| read-only scripts | no | any |

Any two of these on the same file: the second is refused and names the first.

## First U10 deploy, in order (IN-U10-8)

```
owner: Create backup ─▶ verify:up --candidate (:3011) ─▶ restore archive into :3011
   ─▶ observe: before-change backup · v8 · counts · lock refusal and 30 s takeover · Status, light and dark
   ─▶ verify:down (live unchanged) ─▶ release --apply:
        POST /api/backups (old version keeps a before-change backup) ─▶ build ─▶ compose up -d
        ─▶ new container: lock ─▶ before-change backup (version, migration 7→8) ─▶ migrate ─▶ healthy ─▶ tag
```

## *App only* update, in order

```
docker run --rm -v "${PWD}:/work" ghcr.io/kuhndj67/spotify-companion:<new> update   (rewrites one line)
docker compose up -d   ─▶ old container stops (releases the lock) ─▶ new container: lock ─▶ before-change backup ─▶ migrate
```
