#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPACT_VERSION="${COMPACT_VERSION:-0.28.0}"

ensure_compact() {
  if command -v compact >/dev/null 2>&1; then
    return 0
  fi

  # Install the Compact CLI locally (default: $HOME/.local/bin/compact).
  # This is a public installer published by midnightntwrk/compact.
  export COMPACT_NO_MODIFY_PATH=1
  curl --proto '=https' --tlsv1.2 -LsSf \
    https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh \
    | sh

  export PATH="$HOME/.local/bin:$PATH"
  command -v compact >/dev/null 2>&1
}

ensure_compact

compact update "$COMPACT_VERSION" >/dev/null
compact compile +"$COMPACT_VERSION" src/pickup.compact src/managed/pickup

