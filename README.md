# Codex Secret Paste Share Bundle

This bundle contains a repo-local Codex plugin marketplace and the `codex-secret-paste` plugin source.

## Install

From this directory:

```bash
codex plugin marketplace add "$PWD"
codex plugin add codex-secret-paste@secret-paste
npm --prefix "$PWD/plugins/codex-secret-paste" run install:helper
```

Grant macOS Accessibility permission to `codex-secret-paste-helper` if prompted.

## Configure

The default secure paste shortcut is `CMD+SHIFT+V`. In a new Codex thread, ask Codex to set the plugin shortcut to either `CMD+SHIFT+V` or `CTRL+SHIFT+V`.

The helper stores local config in:

```text
~/.codex-secret-paste/config.json
```

## Share

Publish this directory as the Git repo root. Do not add local `~/.codex-secret-paste` state, Keychain data, or built helper binaries.
