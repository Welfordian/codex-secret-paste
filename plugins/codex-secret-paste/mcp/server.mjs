import readline from "node:readline";
import {
  checkHelperStatus,
  cleanupSecretPasteTask,
  isGitTracked,
  listSecretPlaceholders,
  materializeSecretPlaceholders,
  normalizeHandles,
  readSecretPasteConfigSync,
  resolveWorkspaceTarget,
  SUPPORTED_SHORTCUTS,
  writeSecretPasteConfig,
} from "../lib/secret-store.mjs";

const SERVER_NAME = "Codex Secret Paste";
const JsonRpcError = {
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
};

let nextRequestId = 1;
const pendingRequests = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function request(method, params) {
  const id = `server-${nextRequestId++}`;
  send({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
  });
}

async function approveWorkspaceWrite(args) {
  const handles = normalizeHandles(args);
  const { target, relative, workspace } = resolveWorkspaceTarget(args.workspacePath, args.targetPath);
  const tracked = isGitTracked(workspace, target);

  const elicitation = await request("elicitation/create", {
    mode: "form",
    message: tracked
      ? `Approve writing ${handles.length} secret handle(s) to tracked env file ${relative}?`
      : `Approve writing ${handles.length} secret handle(s) to env file ${relative}?`,
    requestedSchema: {
      type: "object",
      properties: {
        targetPath: {
          type: "string",
          title: "Workspace env file",
          default: relative,
          minLength: 1,
        },
        approveWrite: {
          type: "boolean",
          title: "Approve secret write",
          default: false,
        },
        confirmTrackedWrite: {
          type: "boolean",
          title: "I understand this file is tracked by git",
          default: false,
        },
      },
      required: ["targetPath", "approveWrite"],
    },
  });

  if (elicitation?.action !== "accept" || elicitation.content?.approveWrite !== true) {
    return { approved: false, action: elicitation?.action || "cancel" };
  }
  if (tracked && elicitation.content?.confirmTrackedWrite !== true) {
    return { approved: false, action: "tracked_file_not_confirmed" };
  }
  return {
    approved: true,
    targetPath: elicitation.content?.targetPath || relative,
    allowTrackedWrite: true,
  };
}

async function handleToolCall(id, params) {
  const name = params?.name;
  const args = params?.arguments || {};

  if (name === "check_secret_paste_helper") {
    const status = checkHelperStatus(new URL("..", import.meta.url).pathname);
    sendResult(id, {
      content: [
        {
          type: "text",
          text: status.running
            ? "Codex Secret Paste helper is installed and running."
            : `Codex Secret Paste helper is not fully running. Build and install it before using ${status.shortcut}.`,
        },
      ],
      structuredContent: status,
    });
    return;
  }

  if (name === "get_secret_paste_config") {
    const config = readSecretPasteConfigSync();
    sendResult(id, {
      content: [
        {
          type: "text",
          text: `Codex Secret Paste shortcut is ${config.shortcut}.`,
        },
      ],
      structuredContent: config,
    });
    return;
  }

  if (name === "set_secret_paste_config") {
    const result = await writeSecretPasteConfig(args);
    sendResult(id, {
      content: [
        {
          type: "text",
          text: `Codex Secret Paste shortcut is now ${result.shortcut}. The running helper will pick it up automatically.`,
        },
      ],
      structuredContent: result,
    });
    return;
  }

  if (name === "list_secret_placeholders") {
    const placeholders = await listSecretPlaceholders();
    sendResult(id, {
      content: [
        {
          type: "text",
          text: `${placeholders.length} redacted secret placeholder(s) are available.`,
        },
      ],
      structuredContent: { placeholders },
    });
    return;
  }

  if (name === "materialize_secret_placeholder") {
    let materializeArgs = { ...args };
    if (args.mode === "workspace_env_file") {
      const approval = await approveWorkspaceWrite(args);
      if (!approval.approved) {
        sendResult(id, {
          content: [
            {
              type: "text",
              text: "The workspace env-file write was not approved. Do not use or reveal the secret.",
            },
          ],
          structuredContent: {
            status: "not_approved",
            action: approval.action,
          },
        });
        return;
      }
      materializeArgs = {
        ...materializeArgs,
        targetPath: approval.targetPath,
        allowTrackedWrite: approval.allowTrackedWrite,
      };
    }

    const result = await materializeSecretPlaceholders(materializeArgs);
    sendResult(id, {
      content: [
        {
          type: "text",
          text: `Materialized ${result.handles.length} redacted secret handle(s) into ${result.envFilePath}.`,
        },
      ],
      structuredContent: result,
    });
    return;
  }

  if (name === "cleanup_secret_paste_task") {
    const result = await cleanupSecretPasteTask(args);
    sendResult(id, {
      content: [
        {
          type: "text",
          text: `Cleaned Codex Secret Paste task ${result.taskId}.`,
        },
      ],
      structuredContent: result,
    });
    return;
  }

  sendError(id, JsonRpcError.INVALID_PARAMS, `Unknown tool: ${name || ""}`);
}

function tools() {
  return [
    {
      name: "check_secret_paste_helper",
      title: "Check Secret Paste Helper",
      description: "Check whether the macOS helper for the configured secure paste shortcut is built, installed, and running.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "get_secret_paste_config",
      title: "Get Secret Paste Config",
      description: "Read the local Codex Secret Paste plugin configuration, including the active secure paste shortcut.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "set_secret_paste_config",
      title: "Set Secret Paste Config",
      description: "Update the local Codex Secret Paste plugin configuration. The helper reads the new shortcut without a restart.",
      inputSchema: {
        type: "object",
        properties: {
          shortcut: {
            type: "string",
            enum: SUPPORTED_SHORTCUTS,
            description: "Secure paste shortcut to use in the Codex composer.",
          },
        },
        required: ["shortcut"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "list_secret_placeholders",
      title: "List Secret Placeholders",
      description: "List redacted @secret(...) handles currently known to the local helper. Never returns plaintext secrets.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "materialize_secret_placeholder",
      title: "Materialize Secret Placeholder",
      description: "Materialize one or more @secret(...) handles into a task-scoped env file or approved workspace env file. Never returns plaintext secrets.",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Text containing one or more @secret(...) placeholders.",
          },
          placeholder: {
            type: "string",
            description: "A single @secret(...) placeholder.",
          },
          handle: {
            type: "string",
            description: "A single secret handle such as secret-a1b2c3d4.",
          },
          handles: {
            type: "array",
            items: { type: "string" },
            description: "Multiple secret handles.",
          },
          envName: {
            type: "string",
            description: "Environment variable name for a single handle. Defaults to CODEX_SECRET for one handle.",
          },
          envNames: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Map of handle to environment variable name for multiple handles.",
          },
          mode: {
            type: "string",
            enum: ["temp_env_file", "workspace_env_file"],
            default: "temp_env_file",
          },
          taskId: {
            type: "string",
            description: "Optional task id used for later cleanup.",
          },
          workspacePath: {
            type: "string",
            description: "Workspace root for workspace_env_file mode.",
          },
          targetPath: {
            type: "string",
            description: "Workspace-relative env-file path for workspace_env_file mode.",
          },
        },
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    {
      name: "cleanup_secret_paste_task",
      title: "Cleanup Secret Paste Task",
      description: "Remove task-scoped env files and delete Keychain entries for handles materialized in that task.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "The task id returned by materialize_secret_placeholder.",
          },
          deleteSecrets: {
            type: "boolean",
            default: true,
            description: "Delete Keychain entries for handles used by the task. Defaults to true.",
          },
        },
        required: ["taskId"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ];
}

async function handleRequest(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: params?.protocolVersion || "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: {
        name: SERVER_NAME,
        version: "0.1.0",
      },
      instructions:
        "Use @secret(...) handles through materialize_secret_placeholder. Never ask the user to paste raw secrets into chat, never print secret-bearing files, call cleanup_secret_paste_task when the task is done, and use get_secret_paste_config/set_secret_paste_config for shortcut changes.",
    });
    return;
  }

  if (method === "ping") {
    sendResult(id, {});
    return;
  }

  if (method === "tools/list") {
    sendResult(id, { tools: tools() });
    return;
  }

  if (method === "tools/call") {
    try {
      await handleToolCall(id, params);
    } catch (error) {
      sendError(id, JsonRpcError.INVALID_PARAMS, error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (id !== undefined) {
    sendError(id, JsonRpcError.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

const lines = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

lines.on("line", (line) => {
  if (!line.trim()) {
    return;
  }

  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (message.method === undefined && message.id !== undefined) {
    const pending = pendingRequests.get(message.id);
    if (pending) {
      pendingRequests.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || "MCP request failed."));
      } else {
        pending.resolve(message.result);
      }
    }
    return;
  }

  void handleRequest(message);
});
