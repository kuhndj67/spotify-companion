# Upstream proposal (DRAFT): an environment override for the config file path

**Status**: ✍️ **DRAFT, not posted.** Posting it is outward-facing and waits for the owner's go-ahead (BR-69.3).
**For**: `marcelmarais/spotify-mcp-server`, as an issue (and, if the maintainer prefers, a one-line PR).
**Why we want it**: it would let us delete our only build-time patch (BR-69.2, `scripts/lib/patchConfigPath.ts`) and
pin an unmodified upstream commit.

---

## Title

Allow the config file path to be set with an environment variable (atomic writes fail on a single-file bind mount)

## Body

Thank you for the MIT licence (#106), which lets us ship the server inside a container image.

Since b56bb07 ("serialize token refresh and write the config atomically") the server writes `spotify-config.json`
by creating a temp file next to it and renaming it over the original. That is the right fix for torn writes. It does
have one side effect for Docker users: the path is fixed at `<package root>/spotify-config.json`, and the usual way
to give a container one file is a **single-file bind mount**. A `rename()` onto a single-file bind mount fails with
`EBUSY` (reproduced with Node 22 in a Linux container on Rancher Desktop's dockerd), so in that setup every token refresh fails, about an hour
after start.

The fix on the user's side is to mount a **directory** instead, but the server can only be pointed at a file in that
directory if its path is configurable. Would you accept something like:

```ts
const CONFIG_FILE =
  process.env.SPOTIFY_CONFIG_PATH ?? path.join(__dirname, '../spotify-config.json');
```

in `src/utils.ts`? The default is unchanged, so nothing changes for anyone who does not set it. `npm run auth` would
honour the same variable, since it calls `saveSpotifyConfig`. We can open the PR, with a test in
`test/config-write.test.js` that a write lands at the overridden path, if that helps.

(Context: we run the server as a stdio child inside a single container image, with the credentials in a mounted
`secrets/` directory. The name `SPOTIFY_CONFIG_PATH` is only a suggestion; any name works for us.)
