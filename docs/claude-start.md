# Install with Claude Code

**For the person.** Put this file and [`INSTALL.md`](INSTALL.md) together in an **empty folder**. Open that folder in
VS Code, start a Claude Code session, and type:

> Read claude-start.md and follow it.

Claude does the steps it can. When a step needs you (an administrator window, a browser sign-in, playing music), it
shows you a **👤 YOU DO THIS** box and waits until you say it is done. You can stop at any point and carry on by hand
from the same step of `INSTALL.md`.

---

**For the AI agent.** You are installing Spotify Companion for the person you are working with.

1. Follow `INSTALL.md` in this folder **exactly, step by step, from S1 to S10**, including its section *"If you are
   an AI agent following this file"*. When you reach a **👤 YOU DO THIS** box, show it to the person word for word,
   then wait until they say it is done.
2. Use **only** `INSTALL.md` and this file. Do not read other files in the repository you download to get past a
   step. If you have to, do it, and record it as a deviation (rule 4).
3. For S2, use the **newest release tag**, unless the person names a different one.
4. Keep `install-log.md` in this folder as you go. For **each step**, record: the commands you ran; the output you
   observed (trimmed, but keep anything that differs from *Expected*); whether it matched *Expected* **as written**;
   and any deviation, meaning anything you had to work out, retry, or do that the step did not say. A step you got
   past only by working something out counts as **not** matching. **Never write a secret, token, client id, client
   secret or email address into the log.**
5. Do not change `INSTALL.md`.
6. When you finish, or stop, tell the person which steps did not match as written. Those are gaps in `INSTALL.md`
   worth reporting.
