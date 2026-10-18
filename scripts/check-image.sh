#!/usr/bin/env bash
#
# Check a built image BEFORE it is pushed (U9, LC-66, P-72, BR-72.7, BR-73.3). Run by ci.yml's `publish` job;
# runnable locally against any built image:
#
#   scripts/check-image.sh <image>             all checks, including the vulnerability scan
#   scripts/check-image.sh <image> --no-scan   skip the scan (e.g. on a machine without the pinned Trivy)
#
# Any failed check exits non-zero, and the job then pushes NOTHING. The vulnerability scan only REPORTS: it never
# fails this script (NFR Design Q3 = A, the owner's security-posture decision, 2026-10-18).
#
# Output for a human (and $GITHUB_STEP_SUMMARY when set): what the image was built on, and the scan's table.

set -euo pipefail

IMAGE="${1:?usage: check-image.sh <image> [--no-scan]}"
SCAN=1
[ "${2:-}" = "--no-scan" ] && SCAN=0
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
failures=0
fail() { echo "✖ $*" >&2; failures=$((failures + 1)); }
ok() { echo "✓ $*"; }

# The image's filesystem, without running it: export a stopped container ONCE, then read the archive.
work="$(mktemp -d)"
cid="$(docker create "$IMAGE")"
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
docker export "$cid" > "$work/fs.tar"
paths="$(tar -tf "$work/fs.tar")"

# 1. Both licence notices, non-empty (BR-73.3). The build already refuses without them; this checks what SHIPS.
for f in app/LICENSE opt/spotify-mcp/LICENSE; do
  size="$(tar -xOf "$work/fs.tar" "$f" 2>/dev/null | wc -c || true)"
  if [ "${size:-0}" -gt 0 ]; then ok "licence present: /$f ($size bytes)"; else fail "licence missing or empty: /$f"; fi
done

# 2. Nothing a user owns (NFR-28, BR-69.8): credentials other than the committed examples, a database, rules, the
#    automation switch. Matched by the app's own paths and file names -- not by any directory called `data/`, which
#    third-party packages under node_modules legitimately contain.
owned="$(printf '%s\n' "$paths" | grep -E '(^|/)(spotify-config|musicbrainz)\.json$|(^|/)history\.db(-wal|-shm)?$|^(app/)?(secrets|data|config|state)/.+|(^|/)automation-state\.json$|(^|/)rules\.json$' | grep -vE '\.example\.json$' || true)"
if [ -z "$owned" ]; then ok 'no credentials, history, rules or automation state in the image'
else fail "user-owned files in the image:"; printf '    %s\n' $owned >&2; fi

# 3. What it was built on (NFR Design Q4 = A): the labels the build recorded.
labels="$(docker inspect -f '{{json .Config.Labels}}' "$IMAGE")"
node_version="$(docker run --rm --entrypoint node "$IMAGE" --version)"
ok "built on node $node_version; labels $labels"
{
  echo "### Image checks: \`$IMAGE\`"
  echo "- Node: \`$node_version\`"
  echo "- Labels: \`$labels\`"
} >> "$SUMMARY"

# 4. Vulnerability scan: REPORT ONLY. Trivy's release binary, pinned by version and SHA-256 (the gitleaks pattern),
#    set by the caller in TRIVY_VERSION / TRIVY_SHA256.
if [ "$SCAN" = 1 ]; then
  : "${TRIVY_VERSION:?set TRIVY_VERSION (or pass --no-scan)}" "${TRIVY_SHA256:?set TRIVY_SHA256}"
  tmp="$work/trivy"; mkdir -p "$tmp"
  curl -sSfL -o "$tmp/trivy.tar.gz" \
    "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz"
  echo "${TRIVY_SHA256}  $tmp/trivy.tar.gz" | sha256sum --check --strict
  tar -xzf "$tmp/trivy.tar.gz" -C "$tmp" trivy
  {
    echo "#### Vulnerability scan (report only, Trivy ${TRIVY_VERSION})"
    echo '```'
    "$tmp/trivy" image --quiet --scanners vuln --severity HIGH,CRITICAL --exit-code 0 --format table "$IMAGE" || echo "(scan did not complete: reported, not a failure)"
    echo '```'
  } | tee -a "$SUMMARY"
else
  echo "(vulnerability scan skipped: --no-scan)"
fi

if [ "$failures" -gt 0 ]; then
  echo "✖ $failures check(s) failed: this image must not be published." >&2
  exit 1
fi
echo "✓ all image checks passed"
