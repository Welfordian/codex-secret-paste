import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const SERVICE_NAME = "codex-secret-paste";
export const HELPER_LABEL = "me.welford.codex-secret-paste.helper";
export const CODEX_BUNDLE_ID = "com.openai.codex";
export const HANDLE_PATTERN = /^secret-[A-Za-z0-9_-]{6,80}$/;
export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const DEFAULT_SHORTCUT = "CMD+SHIFT+V";
export const SUPPORTED_SHORTCUTS = Object.freeze(["CMD+SHIFT+V", "CTRL+SHIFT+V"]);

const PLACEHOLDER_PATTERN = /@secret\(([^)\r\n]+)\)/g;

export function stateRoot() {
  return path.resolve(process.env.CODEX_SECRET_PASTE_HOME || path.join(os.homedir(), ".codex-secret-paste"));
}

export function configPath() {
  return path.join(stateRoot(), "config.json");
}

export function launchAgentPath() {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${HELPER_LABEL}.plist`);
}

export function helperBinaryPath(pluginRoot = path.resolve(new URL("..", import.meta.url).pathname)) {
  return path.join(pluginRoot, "bin", "codex-secret-paste-helper");
}

export function sourceHelperBinaryPath() {
  return path.join(os.homedir(), "plugins", "codex-secret-paste", "bin", "codex-secret-paste-helper");
}

export function generateTaskId() {
  return `task-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${crypto.randomBytes(4).toString("hex")}`;
}

export function normalizeShortcut(shortcut) {
  if (typeof shortcut !== "string" || shortcut.trim().length === 0) {
    throw new Error("shortcut is required.");
  }
  const tokens = shortcut
    .trim()
    .toUpperCase()
    .replaceAll("COMMAND", "CMD")
    .replaceAll("CONTROL", "CTRL")
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((token) => (token === "ESCAPE" ? "ESC" : token));
  const tokenSet = new Set(tokens);
  const canonical = [
    tokenSet.has("CMD") ? "CMD" : null,
    tokenSet.has("CTRL") ? "CTRL" : null,
    tokenSet.has("SHIFT") ? "SHIFT" : null,
    tokenSet.has("V") ? "V" : null,
  ]
    .filter(Boolean)
    .join("+");
  if (!SUPPORTED_SHORTCUTS.includes(canonical) || tokenSet.size !== canonical.split("+").length) {
    throw new Error(`Unsupported shortcut: ${shortcut}. Supported shortcuts: ${SUPPORTED_SHORTCUTS.join(", ")}.`);
  }
  return canonical;
}

export function readSecretPasteConfigSync() {
  let shortcut = DEFAULT_SHORTCUT;
  let source = "default";
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    if (typeof parsed.shortcut === "string") {
      shortcut = normalizeShortcut(parsed.shortcut);
      source = "file";
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      source = "default_after_invalid_config";
    }
  }
  return {
    shortcut,
    defaultShortcut: DEFAULT_SHORTCUT,
    supportedShortcuts: [...SUPPORTED_SHORTCUTS],
    configPath: configPath(),
    source,
  };
}

export async function readSecretPasteConfig() {
  return readSecretPasteConfigSync();
}

export async function writeSecretPasteConfig(args = {}) {
  const shortcut = normalizeShortcut(args.shortcut);
  await fsp.mkdir(stateRoot(), { recursive: true, mode: 0o700 });
  await fsp.chmod(stateRoot(), 0o700).catch(() => {});
  await fsp.writeFile(configPath(), JSON.stringify({ shortcut }, null, 2) + "\n", { mode: 0o600 });
  await fsp.chmod(configPath(), 0o600).catch(() => {});
  return readSecretPasteConfigSync();
}

export function parseSecretPlaceholders(text) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  const handles = [];
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const parts = String(match[1] || "")
      .split(":")
      .map((part) => part.trim())
      .filter(Boolean);
    const handle = parts.find((part) => HANDLE_PATTERN.test(part));
    if (handle && !handles.includes(handle)) {
      handles.push(handle);
    }
  }
  return handles;
}

export function normalizeHandles(args = {}) {
  const handles = [];
  const candidates = [
    ...(Array.isArray(args.handles) ? args.handles : []),
    args.handle,
    args.placeholder,
    args.text,
  ].filter((value) => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    if (HANDLE_PATTERN.test(candidate)) {
      if (!handles.includes(candidate)) {
        handles.push(candidate);
      }
      continue;
    }
    for (const parsed of parseSecretPlaceholders(candidate)) {
      if (!handles.includes(parsed)) {
        handles.push(parsed);
      }
    }
  }

  if (handles.length === 0) {
    throw new Error("No valid @secret(...) placeholder or secret handle was provided.");
  }
  return handles;
}

export function assertHandle(handle) {
  if (!HANDLE_PATTERN.test(handle)) {
    throw new Error(`Invalid secret handle: ${handle}`);
  }
}

export function assertEnvName(envName) {
  if (!ENV_NAME_PATTERN.test(envName)) {
    throw new Error(`Invalid environment variable name: ${envName}`);
  }
}

export function envNamesForHandles(handles, args = {}) {
  const mapping = args.envNames && typeof args.envNames === "object" ? args.envNames : {};
  const names = handles.map((handle, index) => {
    if (typeof mapping[handle] === "string") {
      return mapping[handle].trim();
    }
    if (handles.length === 1 && typeof args.envName === "string" && args.envName.trim()) {
      return args.envName.trim();
    }
    if (handles.length === 1) {
      return "CODEX_SECRET";
    }
    return `CODEX_SECRET_${index + 1}`;
  });

  const seen = new Set();
  for (const name of names) {
    assertEnvName(name);
    if (seen.has(name)) {
      throw new Error(`Duplicate environment variable name: ${name}`);
    }
    seen.add(name);
  }
  return names;
}

export async function metadataForHandle(handle) {
  assertHandle(handle);
  const metadataPath = path.join(stateRoot(), "secrets", `${handle}.json`);
  try {
    return JSON.parse(await fsp.readFile(metadataPath, "utf8"));
  } catch {
    return {
      handle,
      placeholder: `@secret(${handle})`,
      createdAt: null,
      source: "unknown",
    };
  }
}

export async function listSecretPlaceholders() {
  const secretsDir = path.join(stateRoot(), "secrets");
  let entries = [];
  try {
    entries = await fsp.readdir(secretsDir);
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    try {
      const metadata = JSON.parse(await fsp.readFile(path.join(secretsDir, entry), "utf8"));
      if (typeof metadata.handle === "string" && HANDLE_PATTERN.test(metadata.handle)) {
        results.push(redactedMetadata(metadata));
      }
    } catch {
      // Ignore malformed metadata; it never contains plaintext.
    }
  }
  return results.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export function redactedMetadata(metadata) {
  const handle = metadata.handle;
  return {
    handle,
    placeholder: metadata.placeholder || `@secret(${handle})`,
    createdAt: metadata.createdAt || null,
    source: metadata.source || "unknown",
    redacted: true,
  };
}

export async function readSecretValue(handle) {
  assertHandle(handle);

  const testStore = process.env.CODEX_SECRET_PASTE_TEST_STORE_DIR;
  if (testStore) {
    return await fsp.readFile(path.join(testStore, `${handle}.txt`), "utf8");
  }

  const helperValue = await readSecretViaHelper(handle);
  if (helperValue !== null) {
    return helperValue;
  }

  const result = spawnSync("security", ["find-generic-password", "-s", SERVICE_NAME, "-a", handle, "-w"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Secret ${handle} is missing or inaccessible. Secure-paste it again.`);
  }
  return result.stdout.endsWith("\n") ? result.stdout.slice(0, -1) : result.stdout;
}

export async function readSecretViaHelper(handle) {
  const metadata = await metadataForHandle(handle);
  for (const candidate of helperCommandCandidates(metadata)) {
    const result = spawnSync(candidate, ["read-secret", handle], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });
    if (result.status === 0) {
      return result.stdout;
    }
  }
  return null;
}

export function helperCommandCandidates(metadata = {}) {
  const candidates = [
    process.env.CODEX_SECRET_PASTE_HELPER_PATH,
    typeof metadata.helperPath === "string" ? metadata.helperPath : null,
    sourceHelperBinaryPath(),
    helperBinaryPath(),
  ].filter((candidate) => typeof candidate === "string" && candidate.length > 0);

  const unique = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!unique.includes(resolved) && fs.existsSync(resolved)) {
      unique.push(resolved);
    }
  }
  return unique;
}

export async function deleteSecretValue(handle) {
  assertHandle(handle);

  const testStore = process.env.CODEX_SECRET_PASTE_TEST_STORE_DIR;
  if (testStore) {
    await fsp.rm(path.join(testStore, `${handle}.txt`), { force: true });
  } else {
    let deletedViaHelper = false;
    const metadata = await metadataForHandle(handle);
    for (const candidate of helperCommandCandidates(metadata)) {
      const result = spawnSync(candidate, ["delete-secret", handle], {
        encoding: "utf8",
        stdio: ["ignore", "ignore", "ignore"],
        timeout: 15000,
      });
      if (result.status === 0) {
        deletedViaHelper = true;
        break;
      }
    }
    if (!deletedViaHelper) {
      spawnSync("security", ["delete-generic-password", "-s", SERVICE_NAME, "-a", handle], {
        encoding: "utf8",
        stdio: ["ignore", "ignore", "ignore"],
      });
    }
  }
  await fsp.rm(path.join(stateRoot(), "secrets", `${handle}.json`), { force: true });
}

export function dotenvQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function safeFilename(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
}

export async function writeTempEnvFile({ taskId, entries }) {
  const safeTaskId = safeFilename(taskId || generateTaskId());
  const taskDir = path.join(stateRoot(), "tasks", safeTaskId);
  await fsp.mkdir(taskDir, { recursive: true, mode: 0o700 });
  await fsp.chmod(taskDir, 0o700).catch(() => {});

  const targetPath = path.join(taskDir, "secrets.env");
  const body = entries.map((entry) => `${entry.envName}=${dotenvQuote(entry.secret)}`).join("\n") + "\n";
  await fsp.writeFile(targetPath, body, { mode: 0o600 });
  await fsp.chmod(targetPath, 0o600).catch(() => {});
  return targetPath;
}

export function resolveWorkspaceTarget(workspacePath, targetPath) {
  if (typeof workspacePath !== "string" || workspacePath.trim().length === 0) {
    throw new Error("workspacePath is required for workspace env-file writes.");
  }
  if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
    throw new Error("targetPath is required for workspace env-file writes.");
  }

  const workspace = path.resolve(workspacePath);
  const target = path.resolve(workspace, targetPath);
  const relative = path.relative(workspace, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("The target env file must be inside the selected workspace.");
  }
  return { workspace, target, relative };
}

export function isGitTracked(workspace, target) {
  const relative = path.relative(workspace, target);
  const result = spawnSync("git", ["-C", workspace, "ls-files", "--error-unmatch", "--", relative], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
  });
  return result.status === 0;
}

export async function updateWorkspaceEnvFile({ workspacePath, targetPath, entries, allowTrackedWrite = false }) {
  const { workspace, target, relative } = resolveWorkspaceTarget(workspacePath, targetPath);
  const tracked = isGitTracked(workspace, target);
  if (tracked && !allowTrackedWrite) {
    throw new Error("The target env file is tracked by git. Explicit confirmation is required before writing secrets there.");
  }

  let previous = null;
  try {
    previous = await fsp.readFile(target, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const next = upsertEnvEntries(previous || "", entries);
  await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fsp.writeFile(target, next, { mode: 0o600 });
  await fsp.chmod(target, 0o600).catch(() => {});

  return {
    targetPath: target,
    workspacePath: workspace,
    relativePath: relative,
    tracked,
    previousContent: previous,
  };
}

export function upsertEnvEntries(contents, entries) {
  const lines = contents.length > 0 ? contents.replace(/\n?$/, "\n").split("\n") : [];
  if (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }

  for (const entry of entries) {
    const escapedName = entry.envName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matcher = new RegExp(`^\\s*(?:export\\s+)?${escapedName}\\s*=`);
    const nextLine = `${entry.envName}=${dotenvQuote(entry.secret)}`;
    const index = lines.findIndex((line) => matcher.test(line));
    if (index === -1) {
      lines.push(nextLine);
    } else {
      lines[index] = nextLine;
    }
  }
  return lines.join("\n") + "\n";
}

export async function recordTaskManifest({ taskId, handles, files = [] }) {
  const safeTaskId = safeFilename(taskId || generateTaskId());
  const taskDir = path.join(stateRoot(), "tasks", safeTaskId);
  await fsp.mkdir(taskDir, { recursive: true, mode: 0o700 });
  await fsp.chmod(taskDir, 0o700).catch(() => {});

  const manifestPath = path.join(taskDir, "manifest.json");
  let manifest = { taskId: safeTaskId, handles: [], files: [] };
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  } catch {
    // New manifest.
  }

  for (const handle of handles) {
    if (!manifest.handles.includes(handle)) {
      manifest.handles.push(handle);
    }
  }
  manifest.files.push(...files);
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  await fsp.chmod(manifestPath, 0o600).catch(() => {});
  return manifest;
}

export async function materializeSecretPlaceholders(args = {}) {
  const handles = normalizeHandles(args);
  const envNames = envNamesForHandles(handles, args);
  const taskId = safeFilename(args.taskId || generateTaskId());
  const mode = args.mode || "temp_env_file";
  if (!["temp_env_file", "workspace_env_file"].includes(mode)) {
    throw new Error("mode must be temp_env_file or workspace_env_file.");
  }

  const entries = [];
  for (let index = 0; index < handles.length; index += 1) {
    const handle = handles[index];
    entries.push({
      handle,
      envName: envNames[index],
      secret: await readSecretValue(handle),
      metadata: await metadataForHandle(handle),
    });
  }

  let fileRecord;
  if (mode === "workspace_env_file") {
    const written = await updateWorkspaceEnvFile({
      workspacePath: args.workspacePath,
      targetPath: args.targetPath,
      entries,
      allowTrackedWrite: args.allowTrackedWrite === true,
    });
    fileRecord = {
      kind: "workspace_env_file",
      path: written.targetPath,
      workspacePath: written.workspacePath,
      relativePath: written.relativePath,
      tracked: written.tracked,
      previousContent: written.previousContent,
    };
  } else {
    fileRecord = {
      kind: "temp_env_file",
      path: await writeTempEnvFile({ taskId, entries }),
    };
  }

  await recordTaskManifest({
    taskId,
    handles,
    files: [fileRecord],
  });

  return {
    status: "materialized",
    taskId,
    mode,
    envFilePath: fileRecord.path,
    handles: entries.map((entry) => ({
      handle: entry.handle,
      placeholder: entry.metadata.placeholder || `@secret(${entry.handle})`,
      envName: entry.envName,
      redacted: true,
    })),
  };
}

export async function cleanupSecretPasteTask(args = {}) {
  const taskId = safeFilename(args.taskId || "");
  if (!taskId) {
    throw new Error("taskId is required.");
  }
  const deleteSecrets = args.deleteSecrets !== false;
  const taskDir = path.join(stateRoot(), "tasks", taskId);
  const manifestPath = path.join(taskDir, "manifest.json");

  let manifest = { handles: [], files: [] };
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  } catch {
    await fsp.rm(taskDir, { recursive: true, force: true });
    return { status: "cleaned", taskId, deletedHandles: 0, cleanedFiles: 0 };
  }

  let cleanedFiles = 0;
  for (const file of manifest.files || []) {
    if (!file || typeof file.path !== "string") {
      continue;
    }
    if (file.kind === "workspace_env_file") {
      if (typeof file.previousContent === "string") {
        await fsp.writeFile(file.path, file.previousContent, { mode: 0o600 });
        await fsp.chmod(file.path, 0o600).catch(() => {});
      } else {
        await fsp.rm(file.path, { force: true });
      }
      cleanedFiles += 1;
      continue;
    }
    await fsp.rm(file.path, { force: true });
    cleanedFiles += 1;
  }

  let deletedHandles = 0;
  if (deleteSecrets) {
    for (const handle of manifest.handles || []) {
      await deleteSecretValue(handle);
      deletedHandles += 1;
    }
  }
  await fsp.rm(taskDir, { recursive: true, force: true });

  return {
    status: "cleaned",
    taskId,
    deletedHandles,
    cleanedFiles,
  };
}

export function checkHelperStatus(pluginRoot = path.resolve(new URL("..", import.meta.url).pathname)) {
  const plistPath = launchAgentPath();
  const binaryPath = helperBinaryPath(pluginRoot);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  let running = false;
  let launchctlStatus = null;

  if (uid !== null) {
    const result = spawnSync("launchctl", ["print", `gui/${uid}/${HELPER_LABEL}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    running = result.status === 0;
    launchctlStatus = running ? "loaded" : "not_loaded";
  }

  return {
    label: HELPER_LABEL,
    codexBundleId: CODEX_BUNDLE_ID,
    plistPath,
    binaryPath,
    plistInstalled: fs.existsSync(plistPath),
    binaryBuilt: fs.existsSync(binaryPath),
    running,
    launchctlStatus,
    ...readSecretPasteConfigSync(),
  };
}
