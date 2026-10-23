/**
 * A host run refuses an UNPATCHED connector (2026-10-23). ⚙️ PURE.
 *
 * The app passes the connector `SPOTIFY_CONFIG_PATH` (`connectorSpawnParams`). The image's connector is patched to
 * read it; a host checkout made by `npm run mcp:setup` before 2026-10-23 was not, and silently read its own copy of
 * the real credentials instead. So a host test run pointed at a missing credentials file still polled Spotify with
 * the owner's app, during a week Spotify was rate-limiting it.
 *
 * The decision: on the host, if the connector's source is present and lacks the patched line, do not start it, and
 * say the one command that fixes it. In the container, or with no checkout at all, there is nothing to decide here
 * (the image is patched at build, which fails if the patch does not apply; a missing checkout fails to start anyway).
 */

const PATCH_MARKER = 'process.env.SPOTIFY_CONFIG_PATH';

export function hostConnectorMessage(inContainer: boolean, connectorUtilsSource: string | null): string | null {
  if (inContainer || connectorUtilsSource === null) return null;
  if (connectorUtilsSource.includes(PATCH_MARKER)) return null;
  return (
    "The host's Spotify connector (.mcp-server) is unpatched: it would ignore this app's credentials path and use " +
    'its own copy. It was not started. Run `npm run mcp:setup`, then restart.'
  );
}
