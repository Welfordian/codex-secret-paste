import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cleanupSecretPasteTask,
  helperCommandCandidates,
  materializeSecretPlaceholders,
  normalizeShortcut,
  parseSecretPlaceholders,
  readSecretPasteConfigSync,
  upsertEnvEntries,
  writeSecretPasteConfig,
} from "../lib/secret-store.mjs";

async function withTempStore(fn) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-secret-paste-test-"));
  const secretStore = path.join(root, "test-keychain");
  await fsp.mkdir(secretStore, { recursive: true });
  const previousHome = process.env.CODEX_SECRET_PASTE_HOME;
  const previousStore = process.env.CODEX_SECRET_PASTE_TEST_STORE_DIR;
  process.env.CODEX_SECRET_PASTE_HOME = root;
  process.env.CODEX_SECRET_PASTE_TEST_STORE_DIR = secretStore;
  try {
    return await fn({ root, secretStore });
  } finally {
    if (previousHome === undefined) {
      delete process.env.CODEX_SECRET_PASTE_HOME;
    } else {
      process.env.CODEX_SECRET_PASTE_HOME = previousHome;
    }
    if (previousStore === undefined) {
      delete process.env.CODEX_SECRET_PASTE_TEST_STORE_DIR;
    } else {
      process.env.CODEX_SECRET_PASTE_TEST_STORE_DIR = previousStore;
    }
    await fsp.rm(root, { recursive: true, force: true });
  }
}

async function seedSecret({ root, secretStore, handle, secret }) {
  await fsp.mkdir(path.join(root, "secrets"), { recursive: true });
  await fsp.writeFile(path.join(secretStore, `${handle}.txt`), secret, { mode: 0o600 });
  await fsp.writeFile(
    path.join(root, "secrets", `${handle}.json`),
    JSON.stringify({
      handle,
      placeholder: `@secret(${handle})`,
      createdAt: "2026-06-27T00:00:00Z",
      source: "test",
    }),
    { mode: 0o600 },
  );
}

test("parses secret placeholders without duplicates", () => {
  assert.deepEqual(parseSecretPlaceholders("use @secret(secret-abc123) and @secret(secret-abc123)"), ["secret-abc123"]);
  assert.deepEqual(parseSecretPlaceholders("@secret(api-key:secret-def456)"), ["secret-def456"]);
});

test("env upsert replaces existing vars and appends new vars", () => {
  const result = upsertEnvEntries("OTHER=value\nOPENAI_API_KEY=old\n", [
    { envName: "OPENAI_API_KEY", secret: "new-secret" },
    { envName: "SECOND", secret: "two" },
  ]);
  assert.equal(result, "OTHER=value\nOPENAI_API_KEY='new-secret'\nSECOND='two'\n");
});

test("helper command candidates prefer metadata helper path", async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-secret-helper-candidates-"));
  try {
    const helper = path.join(temp, "helper");
    await fsp.writeFile(helper, "#!/bin/sh\n", { mode: 0o755 });
    const candidates = helperCommandCandidates({ helperPath: helper });
    assert.equal(candidates[0], helper);
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
});

test("secret paste config defaults, normalizes, and validates shortcuts", async () => {
  await withTempStore(async () => {
    assert.equal(readSecretPasteConfigSync().shortcut, "CMD+SHIFT+V");
    assert.equal(normalizeShortcut("control shift v"), "CTRL+SHIFT+V");
    assert.equal(normalizeShortcut("command-shift-v"), "CMD+SHIFT+V");
    await writeSecretPasteConfig({ shortcut: "control+shift+v" });

    const config = readSecretPasteConfigSync();
    assert.equal(config.shortcut, "CTRL+SHIFT+V");
    assert.equal((await fsp.stat(config.configPath)).mode & 0o777, 0o600);
    assert.throws(() => normalizeShortcut("CMD+V"), /Unsupported shortcut/);
  });
});


test("materializes a temp env file without returning plaintext", async () => {
  await withTempStore(async ({ root, secretStore }) => {
    const handle = "secret-abc123";
    const secret = "sk-test-secret-value";
    await seedSecret({ root, secretStore, handle, secret });

    const result = await materializeSecretPlaceholders({
      text: `please use @secret(${handle})`,
      envName: "OPENAI_API_KEY",
      taskId: "task-unit",
    });

    assert.equal(result.status, "materialized");
    assert.equal(result.handles[0].envName, "OPENAI_API_KEY");
    assert.ok(!JSON.stringify(result).includes(secret));

    const contents = await fsp.readFile(result.envFilePath, "utf8");
    assert.match(contents, /OPENAI_API_KEY=/);
    assert.ok(contents.includes(secret));
    assert.equal((await fsp.stat(result.envFilePath)).mode & 0o777, 0o600);
  });
});

test("cleanup removes temp env files and test keychain entries", async () => {
  await withTempStore(async ({ root, secretStore }) => {
    const handle = "secret-clean123";
    await seedSecret({ root, secretStore, handle, secret: "cleanup-secret" });
    const result = await materializeSecretPlaceholders({
      handle,
      envName: "TOKEN",
      taskId: "task-clean",
    });

    await cleanupSecretPasteTask({ taskId: result.taskId });
    assert.equal(fs.existsSync(result.envFilePath), false);
    assert.equal(fs.existsSync(path.join(secretStore, `${handle}.txt`)), false);
    assert.equal(fs.existsSync(path.join(root, "secrets", `${handle}.json`)), false);
  });
});

test("rejects out-of-workspace env targets", async () => {
  await withTempStore(async ({ root, secretStore }) => {
    const handle = "secret-path123";
    await seedSecret({ root, secretStore, handle, secret: "path-secret" });
    const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-secret-workspace-"));
    try {
      await assert.rejects(
        materializeSecretPlaceholders({
          handle,
          mode: "workspace_env_file",
          workspacePath: workspace,
          targetPath: "../outside.env",
        }),
        /inside the selected workspace/,
      );
    } finally {
      await fsp.rm(workspace, { recursive: true, force: true });
    }
  });
});

test("mcp server materialization response does not include plaintext", async () => {
  await withTempStore(async ({ root, secretStore }) => {
    const handle = "secret-mcp123";
    const secret = "mcp-secret-value";
    await seedSecret({ root, secretStore, handle, secret });

    const serverPath = path.resolve("mcp/server.mjs");
    const child = spawn(process.execPath, [serverPath], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        CODEX_SECRET_PASTE_HOME: root,
        CODEX_SECRET_PASTE_TEST_STORE_DIR: secretStore,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const lines = [];
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      for (const line of chunk.split("\n")) {
        if (line.trim()) {
          lines.push(JSON.parse(line));
        }
      }
    });

    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "materialize_secret_placeholder",
          arguments: {
            handle,
            envName: "TOKEN",
            taskId: "task-mcp",
          },
        },
      }) + "\n",
    );
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "set_secret_paste_config",
          arguments: {
            shortcut: "CTRL+SHIFT+V",
          },
        },
      }) + "\n",
    );

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for MCP response.")), 3000);
      const interval = setInterval(() => {
        if (lines.some((line) => line.id === 2) && lines.some((line) => line.id === 3)) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        }
      }, 25);
    });
    child.kill();

    const response = lines.find((line) => line.id === 2);
    assert.equal(response.error, undefined);
    assert.ok(!JSON.stringify(response).includes(secret));

    const configResponse = lines.find((line) => line.id === 3);
    assert.equal(configResponse.error, undefined);
    assert.equal(configResponse.result.structuredContent.shortcut, "CTRL+SHIFT+V");
  });
});
