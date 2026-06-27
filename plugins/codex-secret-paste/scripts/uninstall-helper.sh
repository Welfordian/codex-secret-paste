#!/usr/bin/env bash
set -euo pipefail

LABEL="me.welford.codex-secret-paste.helper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_VALUE="$(id -u)"

launchctl bootout "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST"

if [[ "${1:-}" == "--delete-secrets" ]]; then
  STATE_ROOT="${CODEX_SECRET_PASTE_HOME:-$HOME/.codex-secret-paste}"
  if [[ -d "$STATE_ROOT/secrets" ]]; then
    while IFS= read -r metadata; do
      handle="$(basename "$metadata" .json)"
      security delete-generic-password -s codex-secret-paste -a "$handle" >/dev/null 2>&1 || true
    done < <(find "$STATE_ROOT/secrets" -name 'secret-*.json' -type f)
  fi
  rm -rf "$STATE_ROOT"
fi

echo "Uninstalled $LABEL"
