---
name: secret-paste
description: Use when the user includes @secret(...) handles, mentions secure secret paste, API keys, tokens, credentials, or secure paste shortcuts with Codex. Keeps plaintext secrets out of chat and tool output.
---

# Codex Secret Paste

Use this skill whenever a prompt contains `@secret(...)` or the user wants to paste or use secrets safely in Codex.

## Hard Rules

- Never ask the user to paste raw secrets into chat.
- Never reveal, print, summarize, transform, or quote plaintext secrets.
- Never run commands that inspect secret-bearing files directly, including `cat`, `grep`, `rg`, `sed`, `awk`, `env`, or `printenv` on files or variables that may contain the secret.
- Treat `@secret(...)` as a reference only. The model should never try to infer the value from the handle.
- Use the `materialize_secret_placeholder` tool to create a task-scoped env file when code or commands need the secret.
- Use `cleanup_secret_paste_task` before the final response once the task that needed the secret is complete.
- If a handle is missing or expired, ask the user to use the configured secure-paste shortcut in the Codex composer again.
- Use `get_secret_paste_config` to check the active shortcut and `set_secret_paste_config` when the user asks to change it.

## Typical Flow

1. If the user mentions setup or the shortcut not working, call `check_secret_paste_helper`.
2. When the user gives a prompt containing `@secret(...)`, call `materialize_secret_placeholder` with the full text or handle.
3. For one secret, pass a specific `envName` when the user names one, such as `OPENAI_API_KEY`; otherwise use the default returned by the tool.
4. Run only commands that consume the env file without printing secret values.
5. Call `cleanup_secret_paste_task` with the returned `taskId` before the final response.

## Shortcut Configuration

The helper reads `~/.codex-secret-paste/config.json` dynamically. Prefer `set_secret_paste_config` instead of editing that file manually. Supported shortcuts are currently `CMD+SHIFT+V` and `CTRL+SHIFT+V`.

## Workspace Env Files

Prefer the default temp env-file mode. Use `workspace_env_file` only when the user explicitly asks to write the secret into the workspace. The tool will request approval and reject out-of-workspace paths.
