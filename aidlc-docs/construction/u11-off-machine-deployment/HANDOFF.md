# U11 — Off-machine Deployment — HANDOFF

**The single entry point for U11.** Read this, then the current stage's document.

## ▶ Current state (2026-10-24) — FD ✅ · NFR Design ✅ · Infrastructure Design WRITTEN, awaiting owner approval

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

**Next**: owner approval of Infrastructure Design; then the Code Generation plan. Code Generation's step 1 is the sign-in loop retest (P-95). Nothing is installed or changed on the NAS without the owner's go-ahead.
