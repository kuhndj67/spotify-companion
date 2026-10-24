# U11 — Off-machine Deployment — HANDOFF

**The single entry point for U11.** Read this, then the current stage's document.

## ▶ Current state (2026-10-24) — Functional Design plan OPEN

[`plans/u11-functional-design-plan.md`](../plans/u11-functional-design-plan.md): Q1–Q11 for the owner, plus six
values only the owner can read from DSM (Section 3: model and CPU, DSM version, Container Manager version, the SSO
package and its state, the data volume, free RAM). Q3 (identity provider) and Q8 (how releases reach the NAS) are
**security-posture decisions**: the owner's.

Measured for the plan (unauthenticated, read-only, from this machine): Machine 2 answers on 80/443/5000/5001, SSH
(22) is off; DSM 7 with Container Manager and an OAuth service; the OIDC discovery document is **not reachable**
(`403`, or a redirect page that is not the document); DSM's certificate is the factory default; the published image is
`amd64` only. Found: the app sets WAL mode without checking the result, and SQLite does not throw when it refuses
(measured), so a volume without WAL would go unnoticed. Proposed as a business rule.

**Next**: the owner's answers, then (if Q3 = A) a probe of DSM's SSO Server once it is enabled, then the FD documents
in `functional-design/`. Nothing is installed or changed on the NAS without the owner's go-ahead.
