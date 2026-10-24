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

**Q3 = A** (owner, 2026-10-24): DSM's SSO Server, subject to the probe. Open: how it is configured (walk-through,
limited DSM access, or a Synology MCP server); the owner is taking a full NAS backup first.

**Next**: the remaining answers, the owner installs SSO Server, then the probe of it, then the FD documents
in `functional-design/`. Nothing is installed or changed on the NAS without the owner's go-ahead.
