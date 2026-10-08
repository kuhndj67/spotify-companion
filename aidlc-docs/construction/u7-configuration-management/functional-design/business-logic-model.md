# U7 Business Logic Model — Configuration Management

**Stage**: Functional Design · **Written**: 2026-10-08 · Rules: [`business-rules.md`](business-rules.md)

---

## 1. Rules upload (FR-66, FR-67)

```
Rules pop-up                         server
------------                         ------
[Download] ------------------------> GET  /api/rules/file        -> bytes + X-Rules-Hash      (BR-53.2)
  UI keeps baseHash
[Upload file] ---------------------> POST /api/rules/upload       ingestGuard, 256 KB
                                       admitIngest -> parse -> validateRuleSet
                                         invalid  -> 400 {rule id, field}      nothing changes (BR-53.3)
                                       baseHash given and != disk hash -> 409 stale-base   (BR-54.2)
                                       compare(current, uploaded) -> RulesComparison
                                       stage {token, diskHashAtStaging, baseHash}
  <-------------------------------- comparison + token + needsTypedConfirm
                                        (massRemoval || baseHash == null)          (BR-54.1, 54.4)
[Confirm (+ REPLACE if asked)] ----> POST /api/rules/confirm
                                       token valid?             else staging-expired
                                       disk hash == diskHashAtStaging?  else changed-since-staging (BR-54.3)
                                       typed word present if needed?    else confirmation-required
                                       RulesWriter.write(content)                         (BR-53.4)
                                         current -> rules.previous.json (temp+rename)
                                         content -> temp -> rename over rules.json
                                       watcher.reloadNow() -> version
  <-------------------------------- { applied, version } | { refused, reason }
```

**Undo** (BR-55): `POST /api/rules/undo/stage` returns the comparison *current → previous*; confirm swaps through
the same `RulesWriter`. **One writer, one comparison** (BR-53.7) — upload, undo and restore all call it.

⚠️ `reloadNow()` can itself reject (a file the validator accepts but the watcher does not, or a race with a hand
edit). The response then reports **the watcher's** outcome, never *"applied"* on the strength of the write alone —
the U5 lesson that a label written by one component and read by another can disagree.

## 2. Spotify credentials (FR-69, FR-71)

```
Settings -> Spotify                    server
-------------------                    ------
[Upload spotify-config.json]  (browser FileReader fills the four fields; nothing sent)    (BR-56.1)
[Save] -> warning dialog (BR-56.6) -> POST /api/settings/spotify   ingestGuard, 16 KB
                                       validate four fields                                (BR-56.2)
                                       write in place: {four, accessToken placeholder,
                                                        expiresAt: 0, replacedAt}         (BR-56.3/4)
                                       mcpClient.close(); webApi.invalidateToken()         (BR-56.5)
  <-------------------------------- SpotifyCredentialsView
next poll (<= 3 s):
  MCP server spawns fresh -> sees expiresAt 0 -> refreshes with refresh token -> saves real token
     ok    -> indicator green, playing/idle as usual
     fails -> "Error getting current track: Failed to refresh access token ..."
              -> BR-58.1 throws -> error snapshot -> indicator RED with reason; poll counted 'error'
```

⚠️ **The success path rests on probe P-U7-1** (the placeholder-token behaviour) and **P-U7-2** (closing the client
ends the process). Both are verified on the `:3011` verification installation **before** code generation writes
BR-56.4/56.5.

## 3. MCP text errors (FR-71)

```
#callToolText(name):
  result = client.callTool(...)
  if result.isError                                  -> throw  (today)
  text = join(text blocks)
  if /^Error [a-z]+ing\b.*:/.test(text)              -> throw new McpToolError(name, text)   (BR-58.1, new)
  return text

recordPollMetrics(snapshot):
  outcome = error snapshot ? 'error' : snapshot.playing ? 'playing' : 'idle'               (BR-58.3)
  upstreamMetrics.recordPoll(outcome)
  M4 = idle / (playing + idle)
```

## 4. Restore with rules (FR-72)

```
staging (U6 BR-47 + U7):
  archive has rules.json?
    validate -> invalid -> checkbox disabled with reason                                   (BR-59.2)
    compare(current, archive) -> identical | differs + RulesComparison
confirm (typed RESTORE):
  applyRules ticked?  yes -> keep rules.json in restore-pending/, stage.json += {applyRules, rulesHashAtConfirm}
                      no  -> remove rules.json (as U6)                                      (BR-59.4)
  exit(0) -> Docker restarts
startup (startupRestorer):
  BR-48.5 steps 1-5
    any step fails -> fall back (BR-48.6); rules NOT applied                               (BR-59.5)
    success and applyRules:
      current rules hash == rulesHashAtConfirm ? RulesWriter.write(archive rules)          (BR-59.5)
                                                : skip, report "your rules changed since"  (BR-59.6)
  then RuleSetWatcher.start()
```

⚠️ The rules write at startup happens **before the watcher starts**, so the first load is already the restored
set — there is no window in which the old rules are evaluated against the restored corpus.
