#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$PLUGIN_ROOT/bin/codex-secret-paste-helper"
REPO="${CODEX_SECRET_PASTE_HELPER_REPO:-Welfordian/codex-secret-paste}"
VERSION="${CODEX_SECRET_PASTE_HELPER_VERSION:-v0.1.0}"
ASSET_NAME="${CODEX_SECRET_PASTE_HELPER_ASSET:-codex-secret-paste-helper-macos-universal}"
BASE_URL="${CODEX_SECRET_PASTE_HELPER_BASE_URL:-https://github.com/$REPO/releases/download/$VERSION}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

DOWNLOADED="$TMP_DIR/$ASSET_NAME"
CHECKSUM_FILE="$TMP_DIR/$ASSET_NAME.sha256"

echo "Downloading $ASSET_NAME from $BASE_URL"
/usr/bin/curl -fsSL --retry 3 --retry-delay 1 "$BASE_URL/$ASSET_NAME" -o "$DOWNLOADED"
/usr/bin/curl -fsSL --retry 3 --retry-delay 1 "$BASE_URL/$ASSET_NAME.sha256" -o "$CHECKSUM_FILE"

EXPECTED="$(awk '{print $1}' "$CHECKSUM_FILE")"
ACTUAL="$(/usr/bin/shasum -a 256 "$DOWNLOADED" | awk '{print $1}')"
if [[ -z "$EXPECTED" || "$EXPECTED" != "$ACTUAL" ]]; then
  echo "Downloaded helper checksum did not match." >&2
  exit 1
fi

mkdir -p "$PLUGIN_ROOT/bin"
mv "$DOWNLOADED" "$TARGET"
chmod 755 "$TARGET"
echo "Installed prebuilt helper at $TARGET"
