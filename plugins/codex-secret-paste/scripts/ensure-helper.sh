#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$PLUGIN_ROOT/bin/codex-secret-paste-helper"

if [[ "${CODEX_SECRET_PASTE_FORCE_HELPER_INSTALL:-0}" != "1" && -x "$TARGET" ]]; then
  echo "Using existing helper at $TARGET"
  exit 0
fi

if [[ "${CODEX_SECRET_PASTE_BUILD_FROM_SOURCE:-0}" == "1" ]]; then
  "$PLUGIN_ROOT/scripts/build-helper.sh"
  exit 0
fi

if "$PLUGIN_ROOT/scripts/download-helper.sh"; then
  exit 0
fi

echo "Could not download the prebuilt helper. Trying to build locally with swiftc." >&2
if command -v swiftc >/dev/null 2>&1 && swiftc --version >/dev/null 2>&1; then
  "$PLUGIN_ROOT/scripts/build-helper.sh"
  exit 0
fi

cat >&2 <<'EOF'
Unable to install codex-secret-paste-helper.

Either connect to GitHub releases so the installer can download the prebuilt helper,
or install Xcode command line tools / Swift and rerun with:

  CODEX_SECRET_PASTE_BUILD_FROM_SOURCE=1 npm run install:helper
EOF
exit 1
