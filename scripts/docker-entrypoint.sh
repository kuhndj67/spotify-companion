#!/bin/sh
#
# Container entrypoint: make the bind-mounted data directory writable, then drop privileges.
#
# ## Why this exists
#
# The image runs as the unprivileged `node` user (uid 1000). A Windows host directory bind-mounted
# through Docker Desktop arrives owned by root with mode 755, so `node` cannot create the SQLite
# database inside it. Found during U1 Build and Test: the app started, degraded to display-only,
# and reported "unable to open database file" — correct behaviour, but no history would ever be
# recorded in a container.
#
# The fix is the conventional one: start as root, correct ownership of the mount only, then hand
# off to the unprivileged user. Root exists for exactly two `chown` calls and never runs the app.
#
# ## Why not the alternatives
#
#   - Running the app as root would work and is what most quick fixes do. It discards the
#     non-root posture the image already went to the trouble of establishing.
#   - A named Docker volume would avoid the permission problem, but the whole point of the
#     bind mount (Infrastructure Design Q3 = A) is that the database is directly reachable from
#     the host for backup and analysis.
#   - Requiring the user to pre-create and chmod the directory pushes a container detail onto
#     them, and fails silently the first time they forget.

set -e

# ---------------------------------------------------------------------------------------------------------------
# U9 (BR-74.2/74.3, IN-U9-5): the *App only* commands. The user mounts their folder at /work:
#
#   docker run --rm -v "${PWD}:/work" <image> setup                              write compose.yaml, secrets/, config/…
#   docker run --rm -it -v "${PWD}:/work" -p 127.0.0.1:8888:8888 <image> auth    the Spotify sign-in
#
# Both run as the OWNER of /work (Infrastructure Q4 = A): on a Linux host the files then belong to the user, not to
# root. On Windows/Rancher the mount reports root, and running as root there does no harm. Anything else starts the
# app, as before.
# ---------------------------------------------------------------------------------------------------------------
case "${1:-}" in
  setup|auth)
    command="$1"; shift
    if [ ! -d /work ]; then
      echo "Mount the folder to set up at /work, e.g.:  docker run --rm -v \"\${PWD}:/work\" <image> $command" >&2
      exit 2
    fi
    if [ "$command" = setup ]; then
      set -- node /app/dist/appOnly/setupCli.js
    else
      export SPOTIFY_CONFIG_PATH=/work/secrets/app/spotify-config.json AUTH_BIND_HOST=0.0.0.0 AUTH_NO_BROWSER=1
      set -- node /app/scripts/auth.mjs
    fi
    owner_uid="$(stat -c %u /work)"
    owner_gid="$(stat -c %g /work)"
    if [ "$(id -u)" = "0" ] && [ "$owner_uid" != "0" ]; then
      exec setpriv --reuid="$owner_uid" --regid="$owner_gid" --clear-groups "$@"
    fi
    exec "$@"
    ;;
esac

DATA_DIR="$(dirname "${HISTORY_DB_PATH:-/data/history.db}")"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR" "${SNAPSHOT_DIR:-/data/snapshots}"

  # Only the mount points, never a recursive pass over application code.
  chown node:node "$DATA_DIR" "${SNAPSHOT_DIR:-/data/snapshots}" 2>/dev/null || true

  # U9 (IN-U9-1): the credentials DIRECTORY, not a file. The connector refreshes its token, and CredentialsWriter
  # saves Settings, by writing a temp file IN THIS DIRECTORY and renaming it over the original, so `node` must be
  # able to create files here. The directory only, never recursive; the files keep whatever owner they have.
  SECRETS_DIR="$(dirname "${SPOTIFY_CONFIG_PATH:-/app/secrets/spotify-config.json}")"
  if [ -d "$SECRETS_DIR" ]; then
    chown node:node "$SECRETS_DIR" 2>/dev/null || true
  fi

  # U9 (found by the App-only walk, 2026-10-21): the rules folder and the automation-state folder, for the same reason
  # as data/. An App-only folder is created by `setup` running as root, so these arrive root-owned 755 and `node` could
  # not upload rules or arm automation. (A source install never saw it: its folders are created by the host user.)
  # Mount points only, never recursive.
  for dir in "$(dirname "${RULES_PATH:-/config/rules.json}")" "$(dirname "${AUTOMATION_STATE_PATH:-/state/automation-state.json}")"; do
    if [ -d "$dir" ]; then
      chown node:node "$dir" 2>/dev/null || true
    fi
  done

  # setpriv rather than su/sudo: no extra package, no intermediate shell, and the app keeps
  # PID 1 so SIGTERM reaches it directly — which matters, because the shutdown handler is what
  # flushes the in-progress play instead of losing it.
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

# Already unprivileged (an explicit `--user` override): run as-is and let the app report a
# permission failure through diagnostics if the mount is not writable.
exec "$@"
