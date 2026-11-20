#!/usr/bin/env bash
# Build/tag the allowlisted isolated-desktop image WITHOUT starting a desktop service
# and WITHOUT creating a container named `desktop`.
#
# Produces: hamster/worker-isolated:latest
# Source:   ./agent (same worker image the control-plane agent uses; retagged for the
#           isolation allowlist used by the control-plane broker).
#
# Safe usage (from repo root):
#   ./scripts/build-worker-isolated.sh
# Optional override:
#   HAMSTER_ISOLATED_DESKTOP_IMAGE=hamster/worker-isolated:latest ./scripts/build-worker-isolated.sh
#
# Do NOT run: docker compose ... up desktop
# Do NOT pre-create a container named desktop — create/start happens only after
# an in-app approval ticket bound to target_isolated_desktop.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${HAMSTER_ISOLATED_DESKTOP_IMAGE:-hamster/worker-isolated:latest}"
DOCKER="${DOCKER:-docker}"

if ! command -v "$DOCKER" >/dev/null 2>&1; then
  echo "error: docker CLI not found (set DOCKER=... if needed)" >&2
  exit 1
fi

echo "Building agent image context, then tagging as ${IMAGE}"
echo "(no desktop service start; no container named desktop)"

# Build from the agent Dockerfile; tag only as the allowlisted isolated image.
# This does not start any container and does not touch compose services.
"$DOCKER" build -t "${IMAGE}" -f "${ROOT}/agent/Dockerfile" "${ROOT}/agent"

echo "OK: ${IMAGE}"
"$DOCKER" image inspect --format '{{.Id}} {{.RepoTags}}' "${IMAGE}"
echo
echo "Next (optional stack, still no desktop service):"
echo "  docker compose -f docker-compose.p2.yml up -d db agent api client"
echo "Create/start of container 'desktop' happens only after in-app approval."
