# Codex Secret Paste

Codex Secret Paste lets you press the configured secure-paste shortcut in the Codex composer to paste a secret as a redacted handle, for example:

```text
@secret(secret-a1b2c3d4e5f6)
```

The raw clipboard text is stored in macOS Keychain by the helper. Codex only sees the handle. The MCP tools can later materialize that handle into a task-scoped env file and clean it up when the task is finished.

## Setup From Repository Root

```bash
codex plugin marketplace add "$PWD"
codex plugin add codex-secret-paste@secret-paste
npm --prefix "$PWD/plugins/codex-secret-paste" run install:helper
```

macOS will need Accessibility permission for the helper because it observes the configured shortcut and sends `Cmd+V` to paste the placeholder into Codex.

## Configuration

The default shortcut is `CMD+SHIFT+V`. The shortcut is stored in:

```text
~/.codex-secret-paste/config.json
```

Codex can read or update it through the plugin MCP tools:

- `get_secret_paste_config`
- `set_secret_paste_config`

Supported shortcuts are currently:

- `CMD+SHIFT+V`
- `CTRL+SHIFT+V`

The running helper reads the config dynamically, so changing the shortcut does not require a helper restart.

## Safety Model

- Normal paste can still expose secrets. Use the configured secure-paste shortcut for secrets.
- The helper only handles the shortcut when Codex is the frontmost app.
- MCP responses never include the plaintext secret.
- Default materialization writes a `0600` env file under `~/.codex-secret-paste/tasks/`.
- Cleanup removes task env files and deletes the Keychain entries used by that task.
