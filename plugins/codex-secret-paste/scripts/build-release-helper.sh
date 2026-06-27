#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$PLUGIN_ROOT/scripts/SecretPasteHelper.swift"
DIST="$PLUGIN_ROOT/dist"
ASSET_NAME="codex-secret-paste-helper-macos-universal"
MIN_MACOS="${MACOSX_DEPLOYMENT_TARGET:-13.0}"

rm -rf "$DIST"
mkdir -p "$DIST"

for ARCH in arm64 x86_64; do
  swiftc "$SOURCE" \
    -target "$ARCH-apple-macosx$MIN_MACOS" \
    -o "$DIST/codex-secret-paste-helper-$ARCH" \
    -framework AppKit \
    -framework ApplicationServices \
    -framework Security
done

lipo -create \
  "$DIST/codex-secret-paste-helper-arm64" \
  "$DIST/codex-secret-paste-helper-x86_64" \
  -output "$DIST/$ASSET_NAME"

chmod 755 "$DIST/$ASSET_NAME"
(cd "$DIST" && /usr/bin/shasum -a 256 "$ASSET_NAME" > "$ASSET_NAME.sha256")
lipo -info "$DIST/$ASSET_NAME"
echo "Built release helper assets in $DIST"
