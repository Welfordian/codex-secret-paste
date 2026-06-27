#!/usr/bin/env bash
set -euo pipefail

LABEL="me.welford.codex-secret-paste.helper"
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BINARY="$PLUGIN_ROOT/bin/codex-secret-paste-helper"
UID_VALUE="$(id -u)"
SHORTCUT="$(PLUGIN_ROOT="$PLUGIN_ROOT" node --input-type=module -e 'const { pathToFileURL } = await import("node:url"); const root = process.env.PLUGIN_ROOT; const mod = await import(pathToFileURL(`${root}/lib/secret-store.mjs`).href); console.log(mod.readSecretPasteConfigSync().shortcut);' 2>/dev/null || printf 'CMD+SHIFT+V')"

echo "label=$LABEL"
echo "plist=$PLIST"
echo "binary=$BINARY"
echo "config=$HOME/.codex-secret-paste/config.json"
echo "shortcut=$SHORTCUT"
[[ -f "$PLIST" ]] && echo "plistInstalled=true" || echo "plistInstalled=false"
[[ -x "$BINARY" ]] && echo "binaryBuilt=true" || echo "binaryBuilt=false"
if launchctl print "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1; then
  echo "running=true"
else
  echo "running=false"
fi
