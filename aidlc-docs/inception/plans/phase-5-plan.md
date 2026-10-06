# Phase 5 — **Share**: off this machine, and off one developer

**Written**: 2026-10-06 · **Stage**: INCEPTION — a new phase, after Phases 0–4 delivered
**Status**: 📋 **PLAN — 7 questions open.** Nothing in this phase is designed until they are answered.

> **Phases 1–4 all made the app do more. This one makes it survive being handled by someone else.**
> Nothing here adds a user-facing feature, and that is the point: the deliverable is that a second
> person can review, run and contribute without the project's accumulated tacit knowledge.

---

## 1. What actually changes, and what does not

⚠️ **The distinction that bounds this whole phase:**

| | |
|---|---|
| **Single *user*** | **UNCHANGED.** One listener, one Spotify account, one corpus per deployment |
| **Single *developer*** | **CHANGES.** Several people may review, test and contribute |
| **Single *machine*** | **CHANGES.** A deployment moves to a Synology Docker host on the same LAN |

**Each person runs their own deployment** (user, 2026-10-06). So this is **not** multi-tenancy, there is
no shared instance, and no user model is needed for *separation* — only, possibly, for *access* (§Q1).

⚠️ **Containment is deliberate**: the off-machine target is on the user's own network. That lets the
security model be worked out without internet exposure in the same step.

### What this invalidates

| Assumption | Where it is written | Status |
|---|---|---|
| *"Single developer, single dev machine… commit directly to `main`"* | `CLAUDE.md` § Git workflow | ⚠️ **Reverses** |
| *Local-only access is the entire security model* | `localGuard.ts`, option B (2026-09-05) | ⚠️ **Insufficient off-machine** — see Q1 |
| *The install path is known* | nowhere — it is tacit | ⚠️ **Never walked cold** |
| *One deployment per Spotify app registration* | implicit | ⚠️ **Rate limit is shared** — see Q5 |

---

## 2. Facts measured for this plan — 2026-10-06

### ⚠️ The access guard will refuse every off-machine request

`localGuard.ts:141` — `if (!isLoopbackHostHeader(req.host) || !isAllowedOrigin(req.origin))` → refuse.

A request reaching the NAS carries `Host: <nas>:3010`, which is not loopback. **Every page load and
every WebSocket upgrade 403s.** That is option B behaving exactly as specified, not a defect.

⚠️ **And the WebSocket is the trap.** `ws` does not run Express middleware, which is why the upgrade
handler calls `decideAccess` explicitly — the 2026-09-05 incident was those two copies diverging, with
**every page returning 200 and every handshake 403**, which reads as *Spotify is down*. **Any access
change must go through the one policy function, and `localGuard.test.ts` pins that structurally.**

### ⚠️ `README.md` describes an app from six weeks ago

463 lines, opening with *"Status: walking skeleton, requirements in progress"* and *"the enrichment
layer is **not built yet**"*, pointing at a clarification round that closed in August. The app now has
**5 delivered units, 1256 tests, automated skipping and 977 recorded plays.**

⚠️ **This is the project's own decay pattern on its most public surface** — the same shape as open item
2 reading stale for five weeks after shipping, and the `compose.yaml` `:rw` comment going stale twice.
A reviewer's *first* impression is a document that is wrong about what the software is.

**Absent entirely**: `LICENSE` (⚠️ without one, contributors have no granted rights), `CONTRIBUTING`,
`SECURITY`.

### ⚠️ Two Q9 guards were specified for CI and shipped as local scripts

NFR Q9 chose *"run each script's safe mode **in CI**"* and *"`knip` … **in CI**"*, warning that the
alternative *"is how this becomes the eleventh thing nobody runs."* `ci.yml` runs typecheck, coverage,
build and a container build — **neither `smoke` nor `knip`**. They exist only as `npm run` scripts.

✅ CI itself is healthy and has been green on every push.

### Contributor gates that already exist

- ⚠️ **Spotify Premium is required** for Development Mode access since 9 March 2026 (already in the
  README). Every contributor needs their own.
- ⚠️ **Development Mode requires accounts to be added to the app registration.** ⚠️ **PROBE THIS** —
  do not take the user cap from documentation. This project has drawn the wrong conclusion from
  Spotify's docs **six times**.

---

## 3. ⚠️ U6 IS A PREREQUISITE, and it gates Q2 and Q5

**Added 2026-10-06**, after the user asked whether moving a corpus was a required prerequisite. **It is.**

▶ **[`U6 — User-Data Lifecycle`](../../construction/u6-data-lifecycle/HANDOFF.md)** · FD plan:
[`u6-functional-design-plan.md`](../../construction/plans/u6-functional-design-plan.md)

The `db:backup` / `db:restore` pair already works and has a rehearsed round trip, so the proposed sequence
— *back up here, start the NAS app, restore there* — is feasible today. **Three gaps make it unsafe:**

1. ⚠️ **The guard goes blind across machines.** `assertNobodyElseHoldsIt` asks the **local** `docker ps`,
   so a restore run here reports *"nothing is running"* about **the wrong computer** while the NAS holds
   the file open. **That is the U4 corruption's shape one layer out** — the original lock probe was blind
   for the analogous reason, and returned green exactly when the danger was present.
2. ⚠️ **The backup covers `history.db` only.** Rules, the contact address, the refresh token and the
   `metabase-app-db` **named volume** do not travel — and ⚠️ **`state/automation-state.json` MUST NOT**,
   because restoring a stale latch can **silently re-arm automation**.
3. ⚠️ **There is no merge.** Restore is one-way; two deployments diverge immediately with colliding
   `observation` / `decision_log` / `skip_attempt` ids. **So *migrate* and *run both* are different
   decisions, and the second forecloses going back.**

⚠️ **Nothing touches the NAS corpus until U6 is done.** Q2 below is a choice between two options whose
risk profiles only differ *because* of gap 3.

---

## 4. Questions

### Q1 — ⭐ What is the security model once the app is not loopback-only?

**This blocks everything else in the phase.** The current model is not *weak* authentication; it is
**no authentication**, with reachability as the entire control. Off-machine, that control is gone.

⚠️ **The app has no identity concept at all** — no users, no sessions, no credentials of its own. So
"authorization" here means **authenticating the one user**, a gate rather than a permission system.
Anything richer is inventing a model the product does not need.

| | Option | What changes in the app | Exposure |
|---|---|---|---|
| **A** | ⭐ **Network-layer only** — keep `localOnly`, reach it over VPN/Tailscale/WireGuard | **Nothing** | None beyond the tunnel |
| **B** | **Reverse proxy with auth in front** (DSM's own, Caddy, Traefik) | A trusted-proxy allowance in `localGuard` | Auth delegated to mature software |
| **C** | **Bind/CIDR allowlist** — trust the LAN | Guard extended to accept configured hosts | ⚠️ **Every device on the LAN**, including guests and IoT |
| **D** | **Authentication in the app** — a shared secret or password | New surface: session handling, the WS upgrade, storage of the secret | Largest, and newest |

**Recommendation: A, with B as the fallback.** ⚠️ **D is the one to resist.** It is the only option that
adds an attack surface to the app itself, it must be reimplemented for the WebSocket upgrade path — the
exact split that caused the `403` incident — and a hand-rolled auth gate on a hobby project is
historically where real vulnerabilities live. **The app's job is to record plays; it should not also
become an identity provider.**

⚠️ Whatever is chosen, **`localGuard.test.ts`'s structural pin must survive it**, and the HTTP and
upgrade paths must keep going through one function.

[Answer]:

---

### Q2 — Does `data/` on the NAS get the same treatment as `data/` here?

`data/history.db` is *"the only artefact here that cannot be regenerated"*. On a NAS it gains new
properties: DSM snapshots, scheduled backup jobs, possibly cloud sync.

⚠️ **And `secrets/spotify-config.json` holds a refresh token that the MCP server rewrites.** On shared
NAS storage that may be swept into a backup target the user has not thought about as credential storage.

⚠️ **GATED ON U6.** Both options below assume a corpus can be moved and moved back, which it currently
cannot — see §3.

| | Option |
|---|---|
| **A** | ⭐ Treat the NAS deployment as **the** deployment; move the corpus there with U6's tooling |
| **B** | NAS is a **second, throwaway** deployment with its own empty corpus; this machine stays authoritative |

⚠️ **B is the safer first step and is what the phase goal implies** — *work through the problems without
risking anything*. ⚠️ But it has a cost that must be stated: **two deployments on one Spotify
registration** (Q5), and a second corpus that is **not** a backup of the first and must never be
mistaken for one.

[Answer]:

---

### Q3 — How much check-in gating, given reviewers who may not contribute?

Current: direct to `main`, no protection, CI advisory.

| | Option |
|---|---|
| **A** | Protect `main`: PRs required, CI must pass, no force-push | 
| **B** | ⭐ **A, plus the owner may still push directly** (admin bypass) |
| **C** | Full review requirement — every change needs a second approver |

⚠️ **C is wrong for this shape of team.** Reviewers who *may* contribute are not reviewers who are
available; requiring approval would block the person doing all the work on people who signed up to look.

⚠️ **Whatever is chosen, the required checks must include `smoke` and `knip`** — otherwise gating
formalises the Q9 gap rather than closing it.

[Answer]:

---

### Q4 — Is `npm run smoke` meaningful in CI, or only locally?

It must be in CI (Q9), but ⚠️ **it will be weaker there, and that should be understood rather than
discovered**: a fresh checkout has no `data/history.db`, no `secrets/`, and no corrupt snapshot — so
`restore-history --self-test` has nothing to self-test, and the gate scripts bail early.

**Those are still "it started" results**, which is exactly what the runner asserts — it only fails on
*load* failures. So it keeps its value as a link-time check and loses its value as a behaviour check.

| | Option |
|---|---|
| **A** | ⭐ Run it in CI as-is, and **say in the workflow** that it is a link check there and a behaviour check locally |
| **B** | Build fixtures so CI can exercise more of each script |

**Recommendation: A.** B is W-6 territory and should not be smuggled into a deployment phase.

[Answer]:

---

### Q5 — Two deployments, one Spotify app registration

⚠️ The poll is **1,200 requests/hour and 98.4% of the footprint**. Two live deployments is **2,400/hr**
against a ceiling **Spotify does not publish**, and `M1–M4` now exist to measure it.

| | Option |
|---|---|
| **A** | ⭐ Only one deployment polls at a time; the other is brought up for testing and stopped |
| **B** | Both run; accept the doubled rate and watch M2 for 429s |
| **C** | A second Spotify app registration for the NAS |

⚠️ **GATED ON U6's Q3**: *run both* is the option that forecloses going back, because the two corpora
diverge with no merge path.

⚠️ **B's risk is not symmetric**: a 429 storm would degrade *recording*, and recording is the one thing
that cannot be regenerated. ⚠️ **And zero observed 429s is not headroom** — it bounds nothing.

[Answer]:

---

### Q6 — What does the README become?

⚠️ It cannot simply be updated in place: it is **463 lines** describing a walking skeleton, and it is
now serving three audiences that want different things — a reviewer deciding whether to look, a user
installing it, and a contributor changing it.

| | Option |
|---|---|
| **A** | ⭐ Short README (what it is, status, install, where to read more) + `docs/INSTALL.md` + `CONTRIBUTING.md` |
| **B** | One long README, rewritten |

⚠️ **Whichever: the install path must be WALKED COLD by someone who does not already know it**, on a
clean checkout. Writing it from memory reproduces the tacit knowledge rather than removing it, and
nobody has ever done this from zero.

[Answer]:

---

### Q7 — Licence

⚠️ **There is none**, so contributors currently have no granted rights to use or modify the work. This
needs answering before anyone is invited, not after.

⚠️ Note the repository is **private** (checked 2026-09-26), and `CLAUDE.md` already warns that an
earlier comment cited public-ness as a reason for something and was wrong. Private does not remove the
need for a licence between collaborators.

[Answer]:

---

## 5. Proposed exit criteria

- [ ] ⚠️ **U6 complete** — a corpus moved between machines and back, with the guard demonstrated refusing
- [ ] The app is reachable and fully functional from a second machine, under the Q1 posture
- [ ] ⚠️ **WAL probed on the NAS volume** — not reasoned about. The existing proof covers a Rancher
      bind mount, and the standing advice is that WAL is unsafe on *network* filesystems
- [ ] WebSocket handshake verified **in both directions** from off-machine — the `403` incident's
      signature is 200 on the page and 403 on the socket
- [ ] `smoke` and `knip` run in CI; `main` protected per Q3
- [ ] A contributor walks the install cold on a clean machine and records where they got stuck
- [ ] `README`, `INSTALL`, `CONTRIBUTING`, `LICENSE`, `SECURITY` exist and are accurate
- [ ] `CLAUDE.md`'s single-developer assumption rewritten
- [ ] Backlog W-1…W-8 tracked wherever Q3's workflow says

## 6. Explicitly NOT in this phase

| | Why |
|---|---|
| Internet exposure | The containment that makes this phase safe |
| Multi-tenancy / a user model | Each person runs their own deployment; the app stays single-user |
| Shared corpus or cross-user analysis | Would change what the instrument measures |
| W-6's wider programme | Only its two shipped guards get wired into CI |
