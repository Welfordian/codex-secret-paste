#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$PLUGIN_ROOT/scripts/SecretPasteHelper.swift"
TARGET="$PLUGIN_ROOT/bin/codex-secret-paste-helper"

mkdir -p "$PLUGIN_ROOT/bin"
swiftc "$SOURCE" -o "$TARGET" -framework AppKit -framework ApplicationServices -framework Security
chmod 755 "$TARGET"
echo "Built $TARGET"
