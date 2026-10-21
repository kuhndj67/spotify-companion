# Install with Claude Code

**For the person.** Put this file and **one** install document together in an **empty folder**, open that folder in
VS Code, start a Claude Code session, and type the line for your install:

| Install | Put with this file | Type |
|---|---|---|
| **Just the app** (most people) | [`INSTALL-APP.md`](INSTALL-APP.md) | *Read claude-start.md and install the app.* |
| **Full development environment** | [`INSTALL-DEV.md`](INSTALL-DEV.md) | *Read claude-start.md and follow it.* |

Claude does the steps it can. When a step needs you (an administrator window, a browser sign-in, playing music), it
shows you a **👤 YOU DO THIS** box and waits until you say it is done. You can stop at any point and carry on by hand
from the same step of the install document.

---

**For the AI agent.** You are installing Spotify Companion for the person you are working with.

1. Follow the install document in this folder **exactly, step by step, from its first step to its last**: if the
   person asked to *install the app*, that is `INSTALL-APP.md` (A1 to A8); otherwise `INSTALL-DEV.md` (S1 to S10).
   Include its section *"If you are an AI agent following this file"*. When you reach a **👤 YOU DO THIS** box, show
   it to the person word for word, then wait until they say it is done.
2. Use **only** the install document and this file. Do not read other files to get past a step. If you have to, do it,
   and record it as a deviation (rule 4).
3. For `INSTALL-DEV.md` S2, use the **newest release tag**, unless the person names a different one. For
   `INSTALL-APP.md`, install the release it names, into a new, empty folder that is **not** this one.
4. Keep `install-log.md` in this folder as you go. For **each step**, record: the commands you ran; the output you
   observed (trimmed, but keep anything that differs from *Expected*); whether it matched *Expected* **as written**;
   and any deviation, meaning anything you had to work out, retry, or do that the step did not say. A step you got
   past only by working something out counts as **not** matching. **Never write a secret, token, client id, client
   secret or email address into the log.**
5. Do not change the install document.
6. When you finish, or stop, tell the person which steps did not match as written. Those are gaps in the install
   document worth reporting.
