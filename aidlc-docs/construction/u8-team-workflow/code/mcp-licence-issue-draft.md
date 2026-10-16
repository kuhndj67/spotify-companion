# Draft — upstream issue asking `spotify-mcp-server` for a licence (BR-65.3)

✅ **POSTED by the owner 2026-10-16**: <https://github.com/marcelmarais/spotify-mcp-server/issues/106>, *"More a request... could you add a license?"*, open. Until a licence lands, BR-65.2 stands: **no published image**.

**For the owner to post. Claude does not post it**, because it is outward-facing. Target:
<https://github.com/marcelmarais/spotify-mcp-server/issues/new>. Checked 2026-10-07: the repository has **no licence**
file, and GitHub shows no licence.

Once it is posted, record the issue URL in `audit.md`. A licence that allows redistribution unblocks **NFR-32**'s *no
published image*. Until then, every user builds their own image (BR-61.8, BR-65.2).

---

**Title**: Could you add a licence?

**Body**:

> Hi, and thanks for spotify-mcp-server. I use it inside a small personal project
> ([spotify-companion](https://github.com/kuhndj67/spotify-companion), GPL-3.0-or-later). Its Docker image builds
> your server from source at a pinned commit.
>
> The repository has no licence file. That means, by default, nobody else has permission to redistribute it, so I
> can't publish a built image that includes it. For now every user of my project builds their own image from your
> source.
>
> Would you consider adding a licence? Any permissive licence (MIT, Apache-2.0, BSD) or a GPL-compatible one would
> make redistribution clear. GitHub's *Add file → Create new file → `LICENSE` → Choose a license template* does it in
> a minute.
>
> Thanks either way!

---

⚠️ The repository will be **private** when the issue is posted, so the link in the body will not open for the
maintainer. Either drop the link, or post the issue after the repository goes public (W-14). Up to the owner.
