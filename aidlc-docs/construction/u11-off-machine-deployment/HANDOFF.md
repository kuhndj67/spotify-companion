# U11 — Off-machine Deployment — HANDOFF

**The single entry point for U11.** Read this, then the current stage's document.

## ▶ Current state (2026-10-24) — Functional Design plan OPEN

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

**Next**: register a test application in SSO Server and sign in once, to read a real ID token (claims, lifetime,
second factor); the remaining answers (Q1, Q2, Q4, Q6–Q11, Section 3); then the FD documents
in `functional-design/`. Nothing is installed or changed on the NAS without the owner's go-ahead.
