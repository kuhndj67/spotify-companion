# U7 Domain Entities — Configuration Management

**Stage**: Functional Design · **Written**: 2026-10-08 · Rules: [`business-rules.md`](business-rules.md)

No database table and **no migration**: everything U7 writes is a file. Schema stays **v7**.

---

## 1. Files

| File | Location (container) | Mount | Writer(s) | In a backup? |
|---|---|---|---|---|
| `rules.json` | `/config/rules.json` | `./config` directory — **`:ro` → `:rw`** (Infrastructure Design) | the user by hand · **the app** (BR-53) | ✅ (U6, BR-45.5) |
| `rules.previous.json` | `/config/rules.previous.json` | same | the app only | ❌ — not in the allowlist |
| temp file | `/config/.rules.<random>.tmp` | same | the app, then renamed | ❌ |
| `spotify-config.json` | `/opt/spotify-mcp/spotify-config.json` | **single file** `:rw` (unchanged) | `npm run auth` · the MCP server (hourly refresh) · **the app** (BR-56) | ❌ never (FR-60) |
| `musicbrainz.json` | `/app/secrets/musicbrainz.json` | **single file** **`:ro` → `:rw`** (Infrastructure Design) | the user by hand · **the app** (BR-57) | ❌ never |
| `stage.json` (U6) | `/data/restore-pending/stage.json` | `./data` | the app | — |

⚠️ **`config/` becoming writable re-opens what U5 Infrastructure Q1 closed.** What replaces the `:ro` mount as
protection is BR-53/54's guards. **`state/` is not touched** — the kill switch still cannot share a directory with
a file the app (or an agent) edits.

## 2. Value types

| Type | Shape | Notes |
|---|---|---|
| `RulesComparison` | `{ added: RuleRef[]; removed: RuleRef[]; changed: { id, fields: string[] }[]; wouldDisable: { id, reason }[]; becomesLive: RuleRef[]; currentCount: number; massRemoval: boolean }` | Pure function of two validated sets (BR-53.6, BR-53.7). `massRemoval` = BR-54.1's test |
| `RulesStaging` | `{ token; content: string; contentHash; diskHashAtStaging; baseHash: string \| null; comparison; expiresAt }` | In memory, one at a time, 10-minute TTL (as U6). `baseHash: null` → BR-54.4 |
| `RulesWriteOutcome` | `{ kind: 'applied', version } \| { kind: 'refused', reason: RefusalReason, detail }` | `version` is the watcher's, after `reloadNow()` |
| `RefusalReason` (rules) | `'invalid' \| 'stale-base' \| 'changed-since-staging' \| 'confirmation-required' \| 'staging-expired' \| 'nothing-to-undo'` | Each has its own message — never one generic *"failed"* |
| `SpotifyCredentialsInput` | `{ clientId; clientSecret; redirectUri; refreshToken }` | All required (BR-56.2). Exists only for the duration of the request |
| `SpotifyCredentialsView` | `{ set: boolean; clientIdMasked: string \| null; redirectUri: string \| null; secretSet; refreshTokenSet; replacedAt: string \| null; source: 'app' \| 'file' }` | ⚠️ **The only credential shape that ever leaves the server.** No field can carry a secret |
| `MusicBrainzContactView` | `{ set: boolean; masked: string \| null }` | BR-57.1 |
| `PollOutcome` | `'playing' \| 'idle' \| 'error'` | Replaces `recordPoll(playing: boolean)` (BR-58.3) |
| `StageRecord` (U6, extended) | `+ applyRules: boolean; rulesHashAtConfirm: string \| null` | BR-59.4. ⚠️ A U6 `stage.json` without these fields reads as `applyRules: false` — so a restore staged by U6 and applied by U7 never applies rules |

## 3. Masking (pure)

| Input | Display |
|---|---|
| client id `3f2a…………91c0` (any length ≥ 9) | `3f2a…91c0` |
| client id shorter than 9 | `set` |
| email `<email address>` | `<email address>` |
| other contact (URL) | first 8 characters + `…` |

Pure functions in their own module, listed in `test/purity.test.ts`; property-tested so that **no output ever
contains more than 8 characters of the input** (secrets never reach these functions at all — BR-56.7).
