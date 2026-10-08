# NFR Design Patterns — U7: Configuration Management

**Date**: 2026-10-08 · **Stage**: CONSTRUCTION — NFR Design, U7 · **Status**: ✅ approved 2026-10-08
**Answers**: Q1–Q7 all **A**, as recommended — [`../../plans/u7-nfr-design-plan.md`](../../plans/u7-nfr-design-plan.md).
**Numbering** continues from U6, which ended at **P-48**.

> ### The pattern that governs the other patterns
>
> U6 dissolved its concurrency problem by having **one writer** do everything. U7 cannot: `rules.json` has a
> second writer (the user, by hand), and `spotify-config.json` has a second writer **inside the image** (the MCP
> server, hourly). So:
>
> > **Never write while the other writer may be mid-write, and detect — never assume — that nobody changed the
> > file underneath.**
>
> Where the other writer can be stopped (the MCP server), stop it. Where it cannot (a person with an editor),
> detect it by hash and refuse.

---

## P-49: Stop the other writer first *(Q1, BR-56.5)*

The MCP server's refresh is **read → network round trip → write the whole object**. A file written by the app
during that await is overwritten with the **old** credentials plus a fresh token — silently, and *working*, so
nothing looks wrong until the old refresh token is revoked.

Saving credentials is therefore a fixed sequence: **pause the poll loop → close the MCP client and wait for the
child process to exit → write the file → drop the Web API token → resume the poll** (which spawns a fresh server).
Nothing can be inside a refresh, because nothing that refreshes is running. Probe **P-U7-2** confirms the process
really exits.

⚠️ **Do not "optimise" this to write-then-close.** That ordering looks equivalent and leaves the race window open
for one refresh round trip.

## P-50: Read back what you wrote *(Q1)*

After the credentials write, the file is read back and the four values compared with what was submitted. A
mismatch is a **failure**, reported as such. It costs one small file read, and it is the only thing that can
notice a writer this design did not anticipate.

## P-51: One atomic-write helper, imported *(Q2, BR-53.4)*

`AutomationStateStore.write`'s temp-in-same-directory → `renameSync` is extracted into **one** neutral helper,
used by `AutomationStateStore`, `rules.json` and `rules.previous.json`. Imported, never copied: this project has
shipped a policy that was copied and then diverged (the WebSocket `403`).

⚠️ **Verified for `/state`, not yet for `/config`.** Build & Test writes through the app and checks that host and
container see the same content — a directory mount should behave identically, but the project rule is to probe,
not to infer from a neighbouring mount.

⚠️ **The credential files cannot use it.** They are single-file mounts, where a rename detaches the container's
view (the inode hazard). They are written **in place** (BR-56.3, BR-57.3) — accepted under FD Q5 = B, with FR-71
making a broken result visible.

## P-52: Lock the whole check-and-write *(Q3, BR-54.3)*

One in-process mutex spans *check disk hash → write previous → write current → reload*. Two tabs confirming at
once: the second sees the first's hash and is refused `changed-since-staging` — **a refusal, never a lost update**.
Credential and contact saves get their own mutex. The hash check alone is not enough: check-then-write without a
lock is a race between the check and the write.

The lock covers **the app's own writers only**. A hand edit is a writer the lock cannot see; that is what the
hash comparison is for (P-49's second half).

## P-53: Secrets flow one way *(Q4, BR-56.9)*

The credentials route reads four fields, passes them to the writer, and returns only `SpotifyCredentialsView` —
a type with **no field able to hold a secret**. Error responses and log lines are built from **field names**,
never values. The masking functions never receive a secret at all.

Pinned by **PBT-61** (a property over generated secrets, including every refusal path) rather than by review,
because a leak is most likely to appear in an error message that someone adds later.

## P-54: Trust the upstream's wording only as far as a test can see it *(Q5, BR-58.1)*

The MCP server is fetched at **image build**, so its wording can change on any rebuild — and a changed wording
would silently put the display back to *"Spotify: ok"*. The anchored pattern `^Error [a-z]+ing\b.*:` is used at the
one call site, **and** a test scans `.mcp-server/src/**/*.ts` for every `text: \`Error …` template and asserts
each one matches. An upstream rewording then fails the **build's test run**, not the display.

⚠️ The scan runs against the MCP source checked out for the build. Where that checkout is absent (a host run
without `npm run mcp:setup`), the test **fails with a reason** — it never passes vacuously.

## P-55: Three outcomes, not two *(BR-58.3)*

A poll is `playing`, `idle` or `error`. A boolean cannot express the third, and the boolean is how both F5 (an
error counted as *playing*) and F6 (an error counted as *idle*) happened. M4 becomes idle ÷ (playing + idle);
errors are their own count.

⚠️ **And the field name changes with it.** `pollsReturningNothingPlaying` holds a **share** but reads as a
count — misread exactly that way on 2026-10-08 while checking the reboot. It becomes `idleShare`, with
`pollsIdle` and `pollsError` as counts beside it.

## P-56: A positive control for every refusal suite *(Q7)*

A rules writer that never wrote would pass every refusal property perfectly — U5's PBT-34a lesson. **PBT-63**
asserts that an accepted upload **does** change the running set (the watcher's version moves and the new rules
evaluate). Likewise PBT-61's leak property runs alongside a check that a valid save **does** write the file.

## P-57: Probe before the code that depends on the probe *(Q7)*

P-U7-1…3 run as **Code Generation step 1**, on the `:3011` verification installation, before any credentials
code is written. BR-56.4's placeholder token is reasoning from source; this project has been wrong about Spotify
six times, and a probe is cheaper than code built on a wrong premise. ✅ The Docker CLI they need is restored
(2026-10-08 post-reboot checks).
