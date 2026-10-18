# U9 NFR Design Patterns — Connector Upgrade & Publishable Image

**Unit**: U9 · **Date**: 2026-10-18 · **Plan**: [`u9-nfr-design-plan.md`](../../plans/u9-nfr-design-plan.md) — all 6 answered **A**
**Allocates**: **P-65…P-75** · components and properties in [`logical-components.md`](logical-components.md)

The common thread: **the job that can publish runs as little third-party code as possible, and checks what it
publishes before it publishes it.** U9 is the first time something this project builds leaves the machine. Its
second risk is upstream drift, so every divergence from upstream is guarded where it can fail: at build time.

Scalability and performance: **not applicable** (plan §1). One user per deployment; the new cost is build time.

---

## P-65 — Guarded patch (BR-69.1, BR-69.2)

**Problem**: the connector's config path is fixed (G5), and a patch that silently stops applying would put the
`EBUSY` failure back (G4) without anyone noticing.

**Pattern**: a **pure function** `patchConfigPath(source) → { patched } | { refused, reason }` that counts the
original line (exactly one, else refuse), replaces it, and counts the patched line (exactly one, else refuse). The
Dockerfile runs it as a build step; a refusal **fails the build** with the reason. The replacement keeps upstream's
path as the fallback, so an unset variable behaves exactly as upstream does.

⚠️ **Positive control**: the property tests include sources where the patch **must** succeed (PBT-74), so a
function that refused everything cannot pass.

## P-66 — Upstream's tests are the drift detector (BR-68.3, NFR-40)

The connector build stage runs `npm test` from upstream **after** the patch. The suite passes 113/113 on Node 22.23
today (plan §2), unpatched. A pin move that needs Node 26, or that the patch breaks, fails at **build** time, in CI's
`container` job, before any deploy. If the suite cannot run on 22.23, that goes to the owner; it is never skipped.

## P-67 — Directory mount, explicit environment (BR-69.4…69.6)

`./secrets/` is mounted read-write **as a directory**; the app and the connector both write there by temp-then-
rename. The connector learns its path **only** from the `env` the app passes when spawning it (the SDK's stdio client
does not inherit, measured), and the app passes the **same** constant it uses itself. There is one constant for the
container path, not two strings that can drift.

## P-68 — Start, and say so (Q5 = A, NFR-13)

**Problem**: a stale compose file can start the new image with the old single-file mount or no `secrets/` mount.

**Pattern**: at startup, a **credentials-directory check** classifies the mount as `ok` · `not-mounted` ·
`not-writable` · `single-file` (the parent directory is not a mount but the file is). Anything but `ok`:

- the app **runs** (as it does without credentials today);
- the **Spotify indicator** shows the reason in words, pointing at INSTALL's *upgrading* note;
- `/api/diagnostics` reports the classification;
- the connector is **not spawned** with a path that cannot take a rename, so no refresh is attempted into it.

MusicBrainz's refuse-to-start rule (NFR-14) is **unchanged**: a missing contact is a configuration error that Settings
cannot fix on a fresh install, while a wrong mount is something the indicator can explain.

## P-69 — Name and pin consistency by test (BR-68.1, BR-71.1)

Two structural tests, in the family of `versionSources`:

- **No old name**: no tracked file outside an explicit allow-list (the release guard, INSTALL's upgrade note,
  `aidlc-docs/`, `CHANGELOG`-style notes) contains `spotify-now-playing`.
- **One pin**: both compose files carry the **same** full 40-character `MCP_SERVER_REF`, and no compose file or the
  Dockerfile sets any of upstream's new feature variables (HTTP transport, `MCP_AUTH`) (BR-68.2).

## P-70 — Publishing inside `ci.yml`, behind the same jobs (Q1 = A)

`ci.yml` gains a `push: tags: ['v*']` trigger and a `publish` job with `needs: [test, container, secrets]` and
`if: startsWith(github.ref, 'refs/tags/v')`. The checks are **the same jobs** that guard `main`, not a copy.
`publish` is **not** a required status check, so the ruleset and its test are unaffected (`rulesetMatchesWorkflow`
must still pass, and is extended to assert that `publish` is not required).

A **`concurrency` group keyed on the tag** serialises runs, so *check absent → push* cannot race (BR-72.3).

## P-71 — Least code beside the write token (Q2 = A)

- `permissions` at workflow level stay **read-only**; only the `publish` job is granted `packages: write`.
- The `publish` job uses **one** action, `actions/checkout`, pinned by **full commit SHA** with the version in a
  comment. Everything else is the runner's own `docker` CLI: `docker login ghcr.io --password-stdin` from
  `GITHUB_TOKEN`, `docker build`, the image checks (P-72), `docker push`.
- No third-party action ever receives the token. The other jobs keep their `@v4` tags (no write credential).
- Version check first: the tag must equal `v` + `package.json` (BR-72.2), before anything is built.

## P-72 — Check the image before it leaves (BR-72.7, BR-73.3, Q3 = A, Q4 = A)

Run against the **built image**, before `docker push`; any failure pushes nothing:

1. **Licences**: `/app/LICENSE` and `/opt/spotify-mcp/LICENSE` exist and are non-empty (BR-73.3).
2. **No secrets or user data**: no file under any `secrets` path except `*.example.json`; no `data/`, `config/`,
   `state/` content (NFR-28).
3. **Already published?** the registry has no `<version>` tag (BR-72.3).
4. **Vulnerability scan, report only** (Q3 = A): a scanner binary pinned by version **and checksum** (the gitleaks
   pattern, LC-54) scans the image; findings go to the job summary and the release record. It **never blocks** a
   release. ⚠️ A security-posture choice made by the owner, recorded as such.
5. **Base recorded** (Q4 = A): the resolved base image **digest** and the Node version go into OCI labels and the
   job summary. The patch keeps floating (IN-U6-1); each published image says exactly what it was built on.

## P-73 — Sign-in listener: loopback `Host` (Q6 = A, BR-74.3)

In the image, `auth.mjs` binds all interfaces **inside** the container. A user who drops the `127.0.0.1:` prefix from
the documented `-p` would expose it. The listener therefore **refuses any request whose `Host` is not loopback**
(the same principle as `decideAccess`), in addition to what it already does: reject a wrong OAuth `state`, close
after one code or its timeout (`scripts/auth.mjs:99-127`). The host-side `npm run auth` gets the same check: one
script, one behaviour.

## P-74 — Acceptance gate before live (BR-70)

The new pin must not reach the live deployment by accident. `npm run release -- --apply` refuses to deploy a
connector pin that differs from the **previously released** pin unless an **acceptance record** for that pin exists
(`construction/u9-connector-upgrade/` Build & Test, BR-70.7) and states a pass. The record's shape is settled in
Infrastructure Design; the rule is that moving the pin is a deliberate, recorded act (NFR-40), not a side effect of
releasing something else.

## P-75 — The crossing guard (BR-71.2)

`npm run release -- --apply` asks Docker whether a container named exactly `spotify-now-playing` is **running**. If
so, it refuses and prints the one command that stops it. The check is a **pure decision over Docker's answer**, so
it is property-tested (PBT-77). ⚠️ If Docker cannot be asked, the release refuses: an unknown is not a *no*.
