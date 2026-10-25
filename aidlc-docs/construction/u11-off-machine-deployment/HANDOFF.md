# U11 — Off-machine Deployment — HANDOFF

**The single entry point for U11.** Read this, then the current stage's document.

## ▶ Current state (2026-10-24) — Code Generation Part A Steps 1–9 ✅ on `u11-code-generation`; ⛔ Step 10 (the deployment by hand and the sign-in retest) waits for the owner

[`plans/u11-functional-design-plan.md`](../plans/u11-functional-design-plan.md): Q1–Q11 for the owner, plus six
values only the owner can read from DSM (Section 3: model and CPU, DSM version, Container Manager version, the SSO
package and its state, the data volume, free RAM). Q3 (identity provider) and Q8 (how releases reach the NAS) are
**security-posture decisions**: the owner's.

Measured for the plan (unauthenticated, read-only, from this machine): Machine 2 answers on 80/443/5000/5001, SSH
on **222** (owner; accepts keys and passwords); DSM 7 with Container Manager and an OAuth service; the OIDC discovery document is **not reachable**
(`403`, or a redirect page that is not the document); DSM's certificate is the factory default; the published image is
`amd64` only. Found: the app sets WAL mode without checking the result, and SQLite does not throw when it refuses
(measured), so a volume without WAL would go unnoticed. Proposed as a business rule.

**2026-10-24, later**: the owner listed DSM's security tools (SSO Client available, unconfigured; OAuth Service and
Secure SignIn installed; SSO Server not installed) and would rather not touch the primary NAS environment. Plan Section 2a now separates
the four kinds of access and says which tool serves which; Q3's recommendation moved to **B** (an identity provider
in a container, DSM untouched).

**Q3 = A** (owner, 2026-10-24): DSM's SSO Server, subject to the probe. Configured **by hand**, walked through (owner, 2026-10-24); no DSM credential for an agent. The owner is taking a
full NAS backup first.

**SSO Server is installed and serving OIDC** on its own port 9443 with a **test** certificate from a name-constrained
CA generated on this machine (in the session scratchpad, which is temporary; the CA key never went to the NAS). Q5
answered: our own CA. Probe results: `research-findings.md`, *Machine 2's SSO Server*.

**Token probes done** (2026-10-24, `research-findings.md`): RS256 tokens verify; `sub` = the DSM user name; no `amr`;
**180 s ID tokens, no refresh token**; silent re-sign-in works only while SSO Server's session lives, and without one
`prompt=none` shows a sign-in page; sign-ins started from an authorize link can loop or land on the portal. Probe
secret deleted; the owner deletes the probe application. **Q4 must be re-asked** with these facts.

**Q4a = B** (owner, 2026-10-24): the app is the OIDC client with its own signed session cookie; no proxy. This
**amends NFR-29**: the new wording is **ratified** (owner, 2026-10-24) and in `requirements.md`.

**Q1–Q11 answered** (owner, 2026-10-24): Q1 = A, and **both modes stay supported** (local-only, as today, and the
server mode this unit builds); Q2 = A; Q6 = A; Q7 = A; Q8 = B, with A (by hand) for the first deployment; Q9: the
install instructions are **host-agnostic**, naming the services a container host must provide, with host-specific
steps in clearly labelled subsections (*For Synology deployment*) inside each step; Q10 = A; Q11 = A (US-34). Q3's
note says the same as Q9: the documents must not assume Synology.

**Machine 2** (owner, 2026-10-24): DS1517+, Intel Atom C2538 (x86-64: the `amd64` image fits), 8 GB (24 % in use), DSM 7.2-64570 Update 4, Container Manager 24.0.2-1535; data on Volume 1 (Btrfs, RAID 6, 6.2 TB free).

**FD written** (2026-10-24): [`functional-design/`](functional-design/): business-logic-model, business-rules
(BR-88 … BR-99), domain-entities, frontend-components. US-34 added to `stories.md`. ⚖️ For the owner at review: the
proposed **7-day** session lifetime (BR-91.3). Carried to later stages: the OIDC library (NFR Design); the name, the
app's port, CA key custody and renewal, the deploy user (Infrastructure Design); the sign-in loop retest (before Code
Generation is accepted).

**FD approved** (owner, 2026-10-24, *"continue"*), as written, including the proposed 7-day session lifetime.
NFR Requirements skipped, as for U1–U10. **NFR Design plan open**: [`plans/u11-nfr-design-plan.md`](../plans/u11-nfr-design-plan.md),
Q1–Q6 (library, session signing, tests, when the loop is retested, certificate renewal, repeated sign-ins).

**Recording never depends on access** (owner, 2026-10-24): BR-88.4 and 88.6 amended (a refused configuration
stops serving, not recording), BR-91.6 added. **NFR Design written**: Q1–Q6 all A; [`nfr-design/`](nfr-design/)
(P-88…P-101, LC-82…LC-96, PBT-91…PBT-100).

**NFR Design approved** (owner, 2026-10-24, *"Continue"*). **Infrastructure Design plan open**:
[`plans/u11-infrastructure-design-plan.md`](../plans/u11-infrastructure-design-plan.md), Q1–Q10 (name, provider lookup,
port, certificates, **CA key custody** (security posture), issuing script, devices, `setup --server`, deploy path,
off-disk copies).

**Infrastructure Design written** (Q1–Q6, Q8–Q10 = A; Q7: this PC, Windows 11, for now): [`infrastructure-design/`](infrastructure-design/)
(IN-U11-1…10). ⚠️ To probe when the deploy path is built: whether DSM lets a non-administrator use SSH. The sign-in
loop retest must run **on Machine 2** (the CA covers only its names).

**Infrastructure Design approved** (owner, 2026-10-24, *"approved"*). **Code Generation plan written**:
[`plans/u11-code-generation-plan.md`](../plans/u11-code-generation-plan.md), 17 steps in three parts. Part A (Steps
1–9) builds what the sign-in loop needs; Step 10 is the **gate** (the deployment by hand and the retest on Machine 2,
P-95); Part B (11–16) the rest; Part C (17) the restricted deploy path after the first deployment. Open for the owner:
**Q1** (how the Step 1 build reaches Machine 2: an image file copied by hand ⭐, or a pre-release tag) and **Q2** (the
certificate tool for an App-only install: the image gains `certs` with `openssl` ⭐, or the repository script only).
Found while planning: the runtime image has no `openssl` program (measured), so IN-U11-4's script needs a clone.

**Code Generation plan approved** (owner, 2026-10-24): Q1 = A (image file copied by hand), Q2 = A (the image gains
`certs`, with `openssl`), the P-95 refinement accepted. Code on `u11-code-generation`.

**Part A, Steps 1–9 done** (2026-10-24, branch `u11-code-generation`, one commit per step, `npm run verify` green;
details per step in the plan). Found and fixed on the way: `openid-client` does not verify an ID token's signature
unless `enableNonRepudiationChecks` is applied, and does not refuse a future `iat`; `ingestGuard` used the loopback
origin rule (would refuse every save in server mode); the image `HEALTHCHECK` could not reach a server-mode app.
Candidate image `spotify-companion:candidate-u11-signin` built and run isolated in all three cases (server,
refused configuration, local); saved as an image file in the session scratchpad (Q1 = A).

**Step 10 gate passed with a workaround** (owner chose option A, 2026-10-24): SSO Server's sign-in page does not resume
a request with no SSO Server session (measured: loops for every account); the app now shows *sign in at the provider
first, then Continue* when `OIDC_PROVIDER_PORTAL` is set (BR-89.6, Step 10a), **measured to work on Machine 2**
(2026-10-25). Also fixed: a lock that cannot be created no longer crashes the app. Machine 2 runs
`candidate-u11-signin-2` with no Spotify registration (nothing records there).

**Part B done** (2026-10-25, Steps 11–16; Step 15 moved ahead at the owner's request): sign-out and sign out
everywhere, live connections closed with 4401, the *Signed out* state and Settings → Access (checked in light and
dark), the WAL read-back and Diagnostics' *Access*, *WAL* and corpus rows, `npm run corpus:compare`, the structural
and secrets guards, `docs/INSTALL-SERVER.md` (N1–N7) beside the local guides, and the code summary
([`code/code-summary.md`](code/code-summary.md)). Candidate `spotify-companion:candidate-u11` built and run isolated.
Branch pushed.

**Next (owner, 2026-10-25: "do part b and then do the walks")**: Build & Test: the walk of `docs/INSTALL-SERVER.md`
on Machine 2 with the candidate, a check that local mode is unchanged, then the exit test (N7) and the move. Then the
release. Pull requests wait for the owner's go-ahead.

*(superseded)* **Next**: ⛔ **Step 10, the owner's**: deployment-architecture §4 steps 1–4 with the candidate image (no Spotify
registration on Machine 2), then at least five sign-ins recorded in `research-findings.md`. A persistent loop stops
Code Generation and returns FD plan Q3. Not yet pushed: `u11-code-generation` (and the design pull request) wait for
the owner's go-ahead. Nothing is installed or changed on the NAS by an agent.
