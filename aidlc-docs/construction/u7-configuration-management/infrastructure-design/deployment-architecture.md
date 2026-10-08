# Deployment Architecture — U7: Configuration Management

**Date**: 2026-10-08 · **Status**: ✅ approved 2026-10-08 · Decisions: [`infrastructure-design.md`](infrastructure-design.md)

## 1. Live deployment after U7

```
Windows host (D:\Software\Spotify)            container spotify-now-playing (port 3010 -> 3000)
----------------------------------            ------------------------------------------------
./data/                     :rw  ---------->  /data              history.db, previous/, restore-pending/
./state/                    :rw  ---------->  /state             automation-state.json   (unchanged; never touched by U7)
./config/                   :ro -> :rw  --->  /config            rules.json, rules.previous.json*, .rules.*.tmp*
                                                                   written ONLY by RulesWriter (temp + rename)
./secrets/spotify-config.json  :rw  ------->  /opt/spotify-mcp/spotify-config.json
                                                                   writers: MCP server (hourly refresh, in place)
                                                                            CredentialsWriter (in place, MCP stopped first — P-49)
./secrets/musicbrainz.json  :ro -> :rw  --->  /app/secrets/musicbrainz.json
                                                                   writer: CredentialsWriter (contact only, in place)
                                              * new files
image: spotify-now-playing:0.1.0  (rebuilt as U7)     rollback: spotify-now-playing:u6-rollback
```

**Who writes what** — the table the compose comments must agree with:

| Path | Writers | Mechanism | Protection |
|---|---|---|---|
| `/config/rules.json` | the user (host editor) · `RulesWriter` | temp + rename (directory mount) | BR-53/54: validate, compare, confirm, hash, previous copy, mutex |
| `/opt/spotify-mcp/spotify-config.json` | MCP server · `CredentialsWriter` | in place (single-file mount) | P-49 stop-then-write, P-50 read-back, FR-71 makes a bad file visible |
| `/app/secrets/musicbrainz.json` | the user · `CredentialsWriter` | in place (single-file mount) | the shared startup validator (BR-57.2) |
| `/state/automation-state.json` | `AutomationStateStore` | temp + rename | unchanged — **not reachable from any U7 path** (BR-54.5, structural test) |

## 2. The verification installation during U7

```
compose.verify.yaml  (project spotify-verify, port 3011, all state in ./verify-install/, gitignored)

  P-U7-1 / P-U7-2 (probe only, IN-U7-3):
    verify-install/secrets/spotify-config.json = REDUCED COPY of the real credentials
        { clientId, clientSecret, redirectUri, refreshToken, accessToken: "placeholder", expiresAt: 0 }
    -> does the first poll refresh and play?  -> does closing the MCP client end the process?
    -> verify:down removes it; the step records that the file is gone

  P-U7-3 and the exit tests (IN-U6-3 contract restored):
    verify-install/secrets/spotify-config.json = deliberately INVALID config
    -> the Spotify dot is RED with the reason — the exact case U6's copy showed green
    verify-install/config  :rw  -> rules upload / undo / restore-with-rules exercised on the real mount mode
```

The live deployment runs throughout and is proven unchanged by `verify:up` / `verify:down`, as in U6.
