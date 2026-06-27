#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="me.welford.codex-secret-paste.helper"
BINARY="$PLUGIN_ROOT/bin/codex-secret-paste-helper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
CONFIG_DIR="$HOME/.codex-secret-paste"
CONFIG_FILE="$CONFIG_DIR/config.json"
UID_VALUE="$(id -u)"

"$PLUGIN_ROOT/scripts/ensure-helper.sh"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"
if [[ ! -f "$CONFIG_FILE" ]]; then
  printf '{\n  "shortcut": "CMD+SHIFT+V"\n}\n' > "$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"
fi

tmp_plist="$(mktemp)"
cat > "$tmp_plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BINARY</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/codex-secret-paste-helper.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/codex-secret-paste-helper.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST

plutil -lint "$tmp_plist" >/dev/null
mv "$tmp_plist" "$PLIST"
chmod 644 "$PLIST"

launchctl bootout "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1 || true
launchctl bootout "gui/$UID_VALUE" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID_VALUE" "$PLIST"
launchctl enable "gui/$UID_VALUE/$LABEL"
launchctl kickstart -k "gui/$UID_VALUE/$LABEL"

echo "Installed $LABEL"
echo "Config file: $CONFIG_FILE"
echo "Grant Accessibility permission to codex-secret-paste-helper if macOS prompts."
