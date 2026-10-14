# One-time full-history secret scan — 2026-10-14 (BR-64.2)

**Result: no credentials in history.** Two findings, both **false positives**, allow-listed with reasons in
`.gitleaks.toml`. P-64's stop did **not** trigger.

| | |
|---|---|
| Tool | **gitleaks 8.30.1** (`windows_x64`), from the GitHub release, checked against the release's `checksums.txt` |
| SHA-256 | `windows_x64.zip` `d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e` · `linux_x64.tar.gz` `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` (this one is what CI pins) |
| Command | `gitleaks git --redact .` (default rules), then again with `-c .gitleaks.toml` |
| Scope | **154 commits** (`git rev-list --all --count`), ~7.06 MB |

## Findings (values redacted by the tool; identified here by what they are)

| # | File · line · commit | Rule | What it is | Disposition |
|---|---|---|---|---|
| 1 | `scripts/post-boot-check.ps1:101` · `2661f4c` (still present at line 123) | `generic-api-key` | RFC 6455's **published sample** `Sec-WebSocket-Key` (base64 of *"the sample nonce"*), used to probe the handshake | allow-listed by **exact value**, with a reason |
| 2 | `aidlc-docs/audit.md:848` · `a8136d9` | `generic-api-key` | A **git commit SHA** of the upstream `spotify-mcp-server` (the R7 pin), quoted next to the word "API" | allow-listed by **exact value**, with a reason |

## Checks

- With `.gitleaks.toml`: **154 commits, no leaks found** (exit 0).
- **Positive control**: a scratch folder with a planted generic API key and a planted `ghp_` token, scanned with
  the same config. **Both found** (`generic-api-key`, `github-pat`; exit 1). Allow-listing by value, not by path or
  rule, keeps a real secret pasted into either file later detectable.

⚠️ **What this scan does not cover**: files that were never committed. `secrets/spotify-config.json`,
`secrets/musicbrainz.json` and `data/` are gitignored and so are outside history by construction. BR-64.3's test
guards the tracked side.
