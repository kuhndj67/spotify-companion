# U10 — Data Safety — Domain Entities

| Entity | Fields | Lives in | Rules |
|---|---|---|---|
| **WriterLock** | `token` (random per acquisition) · `kind` (`app` \| `script:<name>`) · `pid` · `hostName` · `appVersion` · `acquiredAt`; heartbeat = the file's modification time | `<database>.lock` (`data/history.db.lock`) | BR-78 |
| **TakeoverMutex** | `token` · `createdAt` | `<database>.lock.takeover`, only during a takeover | BR-78.4 |
| **LockObservation** | `token` and modification time read at the start and the end of one stale window | memory | BR-78.3 ⚙️ alive / stale |
| **LockOutcome** | `held` · `refused` (holder, heartbeat moving) · `lost` (token changed under us) | memory; diagnostics | BR-78.5, 78.8 |
| **AppMeta** | `last_app_version` | the database: a one-row table added by U10's migration | BR-79.4 |
| **BackupKind** | `scheduled` \| `before-change` | — | BR-80 |
| **KeptBackup** | `kind` · `fileName` (`spotify-backup-<UTC stamp>.tar.gz`) · `takenAt` · manifest (U6's: `label` = reason, `appVersion`, `schemaVersion`, counts, hashes) | `data/backups/<kind>/` | BR-80 |
| **BackupReason** | `migration <from>→<to>` · `version <from>→<to>` · `first run with version tracking` · `release <version>` · `scheduled` | the manifest's `label` | BR-79.2, 82.1 |
| **BackupHealth** | level (`ok` \| `warn` \| `fail`) · newest of each kind and its age · last error | diagnostics; Settings | BR-81.2 ⚙️ |
| **ComposeImageLine** | the one `image: ghcr.io/kuhndj67/spotify-companion:<version>` line and its position | the user's `compose.yaml` | BR-83 |
| **UpdateDecision** | `refuse-older` \| `same` \| `rewrite` | — | BR-83.2 ⚙️ |
| **UpdatePreference** | `enabled` (absent = true) · `lastCheckedAt` | `state/update-check.json` | BR-85.1, 85.2, 85.9 |
| **ReleaseEntry** (untrusted) | `tag` · `prerelease` · `draft` · `pageUrl` (accepted only under this repository's `/releases/`) | GitHub's response, never stored raw | BR-85.5, 85.6 |
| **UpdateCheckResult** | `status` (`off` \| `not-yet` \| `current` \| `newer`) · `newest` (version, page URL) · `lastSuccessAt` · `lastFailureAt` | memory, sent to the UI with the status | BR-85.7, 86 |

## Relationships

- A **WriterLock** guards exactly one database; the **AppMeta** inside that database says which version last opened
  it. A restored database brings its own AppMeta, so the backup decision after a restore is about the restored
  file.
- Each **KeptBackup** is a U6 archive; its **BackupReason** says why it exists. Rotation (BR-80.4) works per
  **BackupKind** and never across kinds.
- **UpdatePreference** and **UpdateCheckResult** know nothing of the database: they live in `state/` and memory,
  are never backed up, and a restore does not change them.
- Version comparison everywhere (`update`, the update check, the release script) is one function: SemVer 2.0.0
  precedence, already in `scripts/lib/releaseDecision.ts` (`compareSemVer`). It is shared, not copied.
