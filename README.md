# Codex Secret Paste

Codex Secret Paste is a local Codex plugin for securely pasting secrets into the Codex chat composer.

When you use the configured secure-paste shortcut in Codex, the macOS helper stores the clipboard text in Keychain and inserts a placeholder such as:

```text
@secret(secret-a1b2c3d4e5f6)
```

Codex sees only the placeholder. The plugin MCP tools can later materialize the secret into a task-scoped env file without returning plaintext secret values in chat.

## Requirements

- macOS
- Codex
- Node.js
- Network access to GitHub Releases for the prebuilt macOS helper

## Install From This Repo

Clone the repo, then run:

```bash
cd codex-secret-paste
codex plugin marketplace add "$PWD"
codex plugin add codex-secret-paste@secret-paste
npm --prefix "$PWD/plugins/codex-secret-paste" run install:helper
```

Grant macOS Accessibility permission to `codex-secret-paste-helper` if prompted.

The installer downloads a prebuilt helper binary from this repo's GitHub Releases and verifies its SHA-256 checksum. If you prefer to build the helper locally, or need an offline fallback, install Xcode command line tools or another Swift compiler and run:

```bash
CODEX_SECRET_PASTE_BUILD_FROM_SOURCE=1 npm --prefix "$PWD/plugins/codex-secret-paste" run install:helper
```

## Usage

1. Copy a secret to the clipboard.
2. Focus the Codex chat composer.
3. Press the configured secure-paste shortcut.
4. Confirm that Codex receives an `@secret(...)` placeholder rather than the raw secret.

## Configure

The default secure paste shortcut is `CMD+SHIFT+V`. In a new Codex thread, ask Codex to set the plugin shortcut to either `CMD+SHIFT+V` or `CTRL+SHIFT+V`.

The helper stores local config in:

```text
~/.codex-secret-paste/config.json
```

## Safety Model

- Normal paste can still expose secrets. Use the configured secure-paste shortcut for secrets.
- The helper only handles the shortcut when Codex is the frontmost app.
- Raw secret values are stored in macOS Keychain by opaque handle.
- MCP responses never include plaintext secrets.
- Default materialization writes a `0600` env file under `~/.codex-secret-paste/tasks/`.
- Cleanup removes task env files and can delete the Keychain entries used by that task.

## Repository Layout

```text
.agents/plugins/marketplace.json
plugins/codex-secret-paste/
```

Do not commit local `~/.codex-secret-paste` state, Keychain data, or built helper binaries.
