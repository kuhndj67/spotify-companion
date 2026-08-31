# Infrastructure Design Plan — U2: Label Enrichment

**Date**: 2026-08-31 · **Stage**: CONSTRUCTION — Infrastructure Design, Unit U2
**Inputs**: [functional design](../u2-label-enrichment/functional-design/) ·
[NFR design](../u2-label-enrichment/nfr-design/)
**Deferred here by NFR Design**: backfill scheduling · container egress · contact-address location

---

## Scope

Marked **EXECUTE (narrow)** in the execution plan. U1 needed somewhere durable for a database.
**U2 needs one new thing: a way out of the machine** — and one secret that is not a credential.

Nothing about U2 changes the shape of the deployment. It adds no listener, no port, no inbound
path, and no new process. The whole infrastructure delta is **outbound egress to one host, plus
configuration**.

### Categories evaluated

| Category | Applicability |
|---|---|
| **Deployment environment** | **One open question, and it is old.** The container has never been able to serve its UI (open item 1). U2 is the first unit whose design assumes a long-running process for scheduled sweeps, so it is worth settling which deployment is real. Q2 |
| **Compute** | **No change.** One Node process. The 1 req/sec ceiling means U2 adds essentially zero CPU — it is a unit that spends its life waiting |
| **Storage** | **No new infrastructure.** Six new tables in the existing SQLite file, on the existing `./data` bind mount. Growth measured as negligible (P-3). **No retention policy — deliberately**, see below |
| **Messaging** | **Not applicable.** The queue is in-process and deliberately not durable (P-5); the database is the queue of record. No broker, no external queue |
| **Networking** | **The genuinely new item.** First outbound traffic to a host other than Spotify. Q3 |
| **Monitoring** | **Existing mechanism extended.** Diagnostics gains coverage metrics (BR-10.1) and the trace gets its own route (P-7). No observability stack for a single-user local tool. Q5 |
| **Shared infrastructure** | **Not applicable.** Single tenant, single deployable, one machine |

### Storage retention — recorded as a decision, not an omission

The versioned tables are **append-only and never pruned**. BR-8.7 recomputes verdicts from stored
candidates and votes, and BR-12's trace re-runs the classifier over the same rows — **eviction would
break both**. Measured growth (P-3): ~4,000 rows per quarter against the ~3,600 rows/day
`observation` already absorbs. There is no retention problem to solve, and a retention policy would
quietly destroy the two capabilities the storage exists for.

---

## Questions

### Question 1 — Where does the MusicBrainz contact address live?

NFR-14 requires a `User-Agent` carrying a real contact address. P-6 requires it to come from
configuration rather than source, because **`compose.yaml` is tracked in git and this repository is
on GitHub**. Every other U2 setting is a plain env var in `compose.yaml`; this one cannot be.

Two conventions already exist in the project, and `.gitignore` already covers both:

```
secrets/*                 (except the committed example template)
.env / .env.local
```

A) **`.env` at the project root**, referenced from `compose.yaml` as
   `MUSICBRAINZ_CONTACT: ${MUSICBRAINZ_CONTACT}`. Compose reads `.env` natively; on the host,
   `npm start` uses `node --env-file-if-exists=.env` — **verified working on this machine's Node
   22.17.0**, and it prints a notice and continues when the file is absent rather than failing.
   One mechanism, both deployments

B) **`secrets/musicbrainz.json`**, read by `config.ts` the way `spotify-config.json` already is.
   Most consistent with *this project's* existing convention, and the `secrets/` directory is
   already bind-mounted into the container. Adds a second file-reading path to `config.ts`

C) **Extend `secrets/spotify-config.json`** with a `contact` field — no new file, no new mount.
   But that file is written by `npm run auth` and rewritten by the MCP server on token refresh, so
   a hand-added field risks being clobbered by a process we do not control

D) **Literal value in `compose.yaml`** — simplest, and commits a contact address to a public
   repository. Listed for completeness; not recommended

[Answer]: B — `secrets/musicbrainz.json`, read by `config.ts`. Matches the existing `secrets/` convention; already gitignored and already mounted. **User.**

---

### Question 2 — Which deployment is U2 actually targeting?

**This re-raises open item 1 at the point where it starts to matter.**

The container has **never been able to serve its UI**: `localGuard` requires a loopback peer, and
published-port traffic arrives from the Docker bridge gateway, so every request is refused. The app
works today via `npm start` on the host.

U2 is the first unit that assumes a **long-running process** — scheduled backfill sweeps, TTL
re-resolution, the 30-second liked grace window. On the host that means a terminal stays open. In
the container `restart: unless-stopped` already handles it, which is what the container was for.

A) **Host (`npm start`) remains the real deployment.** Keep `compose.yaml` updated with U2's
   settings so it stays correct, but treat the container as unverified. No security change

B) **Resolve item 1 now, option B** — accept the Docker bridge gateway as a peer, keeping the
   `127.0.0.1:3000:3000` publish and Host/Origin validation as the actual controls. Isolation moves
   from the peer check to the port binding, which is what genuinely constrains reachability

C) **Resolve item 1 now, option C** — configurable peer CIDR. Same posture as B, more explicit,
   more to get wrong

D) **Defer again.** U2 proceeds host-only; revisit before U5, where automated skipping makes an
   unattended long-running process more valuable

[Answer]: A — host `npm start` remains the real deployment; `compose.yaml` kept correct but unverified. **No security change.** **User.** Open item 1 stays open.

---

### Question 3 — Container egress to `musicbrainz.org`

`compose.yaml` declares no `networks:` block, so the container uses the default bridge and outbound
traffic is unrestricted. **Expected to need no change** — but this project's standing rule is to
probe rather than reason from configuration, and the container has already surprised us once, in
exactly this area.

A) **Verify at Build and Test** — add an explicit egress check to the container test instructions
   (one `curl` to the MusicBrainz endpoint from inside the container, asserting a 200 and a sane
   `User-Agent` round-trip). Costs one test step, converts an assumption into a fact

B) **Assume it works** — it is the Docker default and nothing in `compose.yaml` restricts it

C) **Verify now**, before the design is approved, by starting a container and probing from inside

[Answer]: A — verify egress at Build and Test with an explicit in-container check. *Recommended default.*

---

### Question 4 — How much of U2 is environment-tunable?

U1's precedent is instructive: `COMPLETION_THRESHOLD` was made configurable, and that turned out to
matter — the live-verification finding is only actionable *because* the threshold is a setting
rather than a constant.

U2's candidates: the two TTLs, request spacing, retry counts, backfill batch size and interval,
and the MusicBrainz base URL.

A) **Tunable: both TTLs, backfill interval and batch size. Fixed: rate limit and retry policy.**
   The TTLs are *measurement* parameters and belong beside `COMPLETION_THRESHOLD`; the 1 req/sec
   spacing is a **policy compliance** value (NFR-15) and making it configurable creates a setting
   whose only use is to violate the policy

B) **Everything tunable**, including request spacing — maximum flexibility

C) **Nothing tunable** — all constants in code, changed by editing and rebuilding

D) **A, plus a configurable MusicBrainz base URL** so tests and probes can point at a local stub
   instead of the live service

[Answer]: D — TTLs, backfill interval and batch size tunable; rate limit and retry policy fixed; MusicBrainz base URL configurable for stubbing. *Recommended default.*

---

### Question 5 — Where do the coverage metrics surface?

BR-10.1 requires the coverage rate to be *"exposed in diagnostics, not derived ad hoc"*, broken down
by `unknown` reason (BR-10.2) and by release year (BR-10.3).

The existing diagnostics dialog is a flat list of `ok`/`fail`/`skip` steps. Coverage is a
**measurement**, not a health check — the same mismatch that gave the resolution trace its own
section (P-7).

A) **A second section in the diagnostics dialog**, beside the trace — metrics rendered as a table,
   with no pass/fail status. `/api/diagnostics` gains a `coverage` block alongside `steps`

B) **As diagnostic steps** — one step reporting the headline rate, `ok` unless resolution is
   failing outright. Reuses the existing renderer; makes a measurement look like a health check

C) **A separate endpoint and panel**, independent of diagnostics

[Answer]: A — a second section in the diagnostics dialog beside the trace; `/api/diagnostics` gains a `coverage` block. *Recommended default.*

---

## Recommendations

- **Q1 = B.** A is idiomatic Docker and I verified `--env-file-if-exists` works here, but B matches
  the convention this project already has: credentials live in `secrets/`, which is gitignored and
  already mounted. One place to look for "things that must not be committed" beats two. C is the
  one to avoid — that file is rewritten by a process we do not control.
- **Q2 = A.** U2 changes nothing about the guard, and bundling a security-posture change into a
  unit about label enrichment is how postures get changed by accident. Keep `compose.yaml` correct
  and honest about being unverified. **Flagged rather than decided — this is your call, as it has
  been since 2026-08-26.**
- **Q3 = A.** The cost is one test step. The project has been wrong four times by reasoning from
  documentation, and the container specifically has already produced one silent failure in its
  network configuration. C is the same check done earlier, but the container cannot serve its UI
  anyway, so Build and Test is the natural place.
- **Q4 = D.** A's split is the important part: TTLs are measurement parameters and deserve the
  `COMPLETION_THRESHOLD` treatment, while a configurable rate limit is a setting whose only
  function is non-compliance. D adds the base URL, which is worth it — the two-call chain needs a
  regression test against a known-many-releases recording (BR-1.2), and pointing that at a stub is
  cheaper and more reliable than hitting the live service in CI.
- **Q5 = A.** Coverage is the instrument R2 is measured with; rendering it as a green tick would
  make a measurement look like a verdict. It also shares a section with the trace, which is where
  someone asking "why is this label unknown?" is already looking.

---

## Execution Checklist

- [x] Confirm answers; analyse for ambiguity
- [x] Generate `infrastructure-design/infrastructure-design.md`
- [x] Generate `infrastructure-design/deployment-architecture.md`
- [x] Specify the `compose.yaml` additions (env vars, no port or network change)
- [x] Specify the host `npm start` equivalents so both deployments stay in step
- [x] Confirm **no inbound exposure change** — no new port, no new listener
- [x] Record the contact-address mechanism and that it is gitignored
- [x] Record the egress verification step for Build and Test
- [x] Confirm no retention policy on the versioned tables, with the reason
- [x] Update `aidlc-state.md`; log in `audit.md`
