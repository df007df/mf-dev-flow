#!/usr/bin/env node
import crypto from "node:crypto";
import { HEALTH_WARNING, recordHookHealth } from "../../../modules/workflow/hook-health.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { CLI_FILE_NAME, ENVIRONMENT, PRIVATE_STORE_DIRECTORY, SKILL_ID, STORE_DIRECTORY, temporaryDirectoryName } from "../../../modules/skill-identity.mjs";

let healthFailed = false, healthRoot = process.cwd();
const STATE_SCHEMA_VERSION = 1;
const CODE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".mts",
  ".scss",
  ".sh",
  ".sql",
  ".ts",
  ".tsx",
  ".vue",
  ".yaml",
  ".yml",
]);
const CODE_BASENAMES = new Set([
  "Dockerfile",
  "Makefile",
  "Procfile",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  STORE_DIRECTORY,
  PRIVATE_STORE_DIRECTORY,
  "coverage",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const MF_DEV_FLOW_TOOLING_PREFIXES = [
  path.join(".agents", "skills", SKILL_ID),
  path.join(".codex", "skills", SKILL_ID),
  path.join(".zcode"),
  path.join(".zcode-plugin"),
];
const MF_DEV_FLOW_TOOLING_FILES = new Set([
  path.join(".codex", "hooks.json"),
  path.join("hooks", "hooks.json"),
]);
const skillCommand = `node .codex/skills/${SKILL_ID}/scripts/${CLI_FILE_NAME}`;

function output(value = {}) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const source = Buffer.concat(chunks).toString("utf8").trim();
  if (!source) return {};
  const value = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("hook input 必须是对象");
  return value;
}

function requireSessionId(input) {
  if (typeof input.session_id !== "string" || !input.session_id) {
    throw new Error("hook input 缺少 session_id");
  }
  return input.session_id;
}

function stateDirectory() {
  return process.env[ENVIRONMENT.CODEX_GATE_STATE_DIRECTORY] || path.join(os.tmpdir(), temporaryDirectoryName("codex-gate"));
}

function stateFile(projectRoot, sessionId) {
  const key = crypto
    .createHash("sha256")
    .update(`${path.resolve(projectRoot)}\u0000${sessionId}`)
    .digest("hex");
  return path.join(stateDirectory(), `${key}.json`);
}

function lockFile(file) {
  return `${file}.lock`;
}

async function withStateLock(file, action) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const lock = lockFile(file);
  let handle;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      handle = await fs.open(lock, "wx");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await delay(10);
    }
  }
  if (!handle) throw new Error("无法获取会话状态锁");
  try {
    return await action();
  } finally {
    await handle.close();
    await fs.rm(lock, { force: true });
  }
}

async function readState(file) {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    if (value?.schemaVersion !== STATE_SCHEMA_VERSION || !Array.isArray(value.files)) {
      throw new Error("会话状态 schema 不兼容");
    }
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeState(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value)}\n`);
  await fs.rename(temporary, file);
}

function isCodeFile(filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return false;
  const parts = filePath.split(path.sep);
  if (parts.some((part) => IGNORED_DIRECTORIES.has(part))) return false;
  const basename = path.basename(filePath);
  return CODE_BASENAMES.has(basename) || CODE_EXTENSIONS.has(path.extname(basename).toLowerCase());
}

function isMfDevFlowToolingPath(projectRoot, filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return false;
  const relative = path.relative(projectRoot, filePath);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  return (
    MF_DEV_FLOW_TOOLING_FILES.has(relative) ||
    MF_DEV_FLOW_TOOLING_PREFIXES.some(
      (prefix) => relative === prefix || relative.startsWith(`${prefix}${path.sep}`),
    )
  );
}

function isWorkspacePath(projectRoot, filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return false;
  const relative = path.relative(projectRoot, filePath);
  return Boolean(
    relative &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
  );
}

function normalizedSessionPath(projectRoot, filePath) {
  const relative = path.relative(projectRoot, filePath);
  if (relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    return relative;
  return filePath;
}

async function canonicalPath(filePath) {
  try {
    return await fs.realpath(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function installedSkillRoot() {
  const fallback = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const configured = process.env[ENVIRONMENT.HOME];
  return path.resolve(typeof configured === "string" && path.isAbsolute(configured) ? configured : fallback);
}

function mfDevFlowEnvironment(projectRoot) {
  return {
    ...process.env,
    [ENVIRONMENT.HOME]: installedSkillRoot(),
    [ENVIRONMENT.PROJECT_ROOT]: projectRoot,
  };
}

async function requiresMfDevFlowGate(projectRoot, filePath) {
  const canonicalFile = await canonicalPath(filePath);
  return (
    isWorkspacePath(projectRoot, canonicalFile) &&
    isCodeFile(canonicalFile) &&
    !isMfDevFlowToolingPath(projectRoot, canonicalFile)
  );
}

async function recordFileEdit(input, projectRoot) {
  if (!(await requiresMfDevFlowGate(projectRoot, input.file_path))) return;
  const sessionId = requireSessionId(input);
  const file = stateFile(projectRoot, sessionId);
  const sessionPath = normalizedSessionPath(projectRoot, await canonicalPath(input.file_path));
  await withStateLock(file, async () => {
    const state = (await readState(file)) ?? {
      schemaVersion: STATE_SCHEMA_VERSION,
      projectRoot: path.resolve(projectRoot),
      sessionId,
      files: [],
    };
    const observedAt = new Date().toISOString();
    const existing = state.files.find((entry) => entry.path === sessionPath);
    if (existing) existing.observedAt = observedAt;
    else state.files.push({ path: sessionPath, observedAt });
    state.updatedAt = observedAt;
    await writeState(file, state);
  });
}

function runMfDevFlow(projectRoot, args) {
  const script = path.join(installedSkillRoot(), "scripts", CLI_FILE_NAME);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: projectRoot,
      env: mfDevFlowEnvironment(projectRoot),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8") || `mf-dev-flow gate 退出码 ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
      } catch {
        reject(new Error("mf-dev-flow gate 未返回有效 JSON"));
      }
    });
  });
}

function runGate(projectRoot, manifestFile, sessionId) {
  return runMfDevFlow(projectRoot, [
    "gate",
    "--for-stop",
    "--session-files",
    manifestFile,
    "--session",
    sessionId,
  ]);
}

function writeFilePath(input) {
  const toolInput = input.tool_input ?? {};
  return toolInput.file_path || toolInput.path || input.file_path || null;
}

async function handleSessionStart(input) {
  const sessionId = requireSessionId(input);
  return {
    env: { [ENVIRONMENT.CODEX_SESSION_ID]: sessionId },
    additional_context:
      `${SKILL_ID} 项目交付代码门禁已启用。若本会话需要修改项目产品代码，先用当前会话 ID 领取或绑定任务：` +
      `\`${skillCommand} work claim --run <运行ID> --task <任务ID> --agent <agent-id> --session "$${ENVIRONMENT.CODEX_SESSION_ID}"\`；` +
      "若任务已领取，则改用 `work bind-session`。写入不再被拒绝；跨运行声明重叠由 `work plan` 预检拦截。收尾用 `work reconcile` 对账，未确认的跨运行触碰用 `work conflict-status` / `work conflict-resolve` 查看与确认。",
  };
}

async function handleBeforeWrite(input, projectRoot) {
  const rawFilePath = writeFilePath(input);
  if (!(await requiresMfDevFlowGate(projectRoot, rawFilePath))) return {};
  const sessionId = requireSessionId(input);
  // 写入不再被租约拒绝：仍调用 work lease --for-write 以记录触碰台账。
  await runMfDevFlow(projectRoot, [
    "work",
    "lease",
    "--for-write",
    "--session",
    sessionId,
    "--file",
    await canonicalPath(rawFilePath),
  ]);
  return { permission: "allow" };
}

async function refreshLease(input, projectRoot) {
  if (!(await requiresMfDevFlowGate(projectRoot, input.file_path))) return;
  await runMfDevFlow(projectRoot, [
    "work",
    "lease",
    "--for-write",
    "--session",
    requireSessionId(input),
    "--file",
    await canonicalPath(input.file_path),
  ]);
}

async function releaseSessionLeases(projectRoot, sessionId) {
  try {
    const result = await runMfDevFlow(projectRoot, [
      "work",
      "lease",
      "--release-session",
      sessionId,
    ]);
    return result?.verdict === "allow";
  } catch (error) {
    healthFailed = true;
    recordHookHealth({ root: projectRoot, adapter: "codex", event: process.argv[2], status: "degraded", error });
    process.stderr.write(HEALTH_WARNING + "\n");
    return false;
  }
}

function followupMessage(gate) {
  const reasons = gate.reasons.map((reason) => `- ${reason.code}: ${reason.message}`).join("\n");
  return [
    "mf-dev-flow 门禁尚未通过：请先回写本会话负责的任务执行记录，再结束会话。",
    reasons,
    "建议下一步：",
    gate.nextCommand || `${skillCommand} current`,
  ].join("\n");
}

async function handleStop(input, projectRoot) {
  const sessionId = requireSessionId(input);
  const file = stateFile(projectRoot, sessionId);
  return withStateLock(file, async () => {
    const state = await readState(file);
    if (!state?.files.length) {
      await releaseSessionLeases(projectRoot, sessionId);
      return {};
    }
    const gate = await runGate(projectRoot, file, sessionId);
    if (gate.verdict === "pass") {
      const warnings = Array.isArray(gate.auditWarnings) ? gate.auditWarnings : [];
      const released = await releaseSessionLeases(projectRoot, sessionId);
      // 有审计提醒时保留观测文件，便于后续 finish/merge/verify 继续读取过程证据。
      if (released && !warnings.length)
        await fs.rm(file, { force: true });
      if (warnings.length) {
        const lines = warnings.map((warning) => {
          const taskId = warning.taskId ? ` [${warning.taskId}]` : "";
          return `- ${warning.code}${taskId}: ${warning.message}`;
        });
        return {
          systemMessage: [
            "mf-dev-flow 审计提醒（不阻塞，请主 agent 复核）：",
            ...lines,
          ].join("\n"),
        };
      }
      return {};
    }
    if (gate.verdict !== "need_followup" || input.status !== "completed") {
      await releaseSessionLeases(projectRoot, sessionId);
      return {};
    }
    return { followup_message: followupMessage(gate) };
  });
}

async function main() {
  const [command] = process.argv.slice(2);
  const input = await readInput();
  const projectRoot = await canonicalPath(process.cwd());
  healthRoot = projectRoot;
  if (command === "session-start") output(await handleSessionStart(input));
  else if (command === "before-write") output(await handleBeforeWrite(input, projectRoot));
  else if (command === "after-file-edit") {
    await recordFileEdit(input, projectRoot);
    await refreshLease(input, projectRoot);
  } else if (command === "stop") output(await handleStop(input, projectRoot));
  else throw new Error("未知 hook 命令");
  if (command === "after-file-edit") output({});
}

main().then(() => {
  if (!healthFailed) recordHookHealth({ root: healthRoot, adapter: "codex", event: process.argv[2], status: "ok" });
}).catch(error => {
  recordHookHealth({ root: healthRoot, adapter: "codex", event: process.argv[2], status: "degraded", error });
  process.stderr.write(HEALTH_WARNING + "\n");
  output({ agent_message: HEALTH_WARNING, user_message: HEALTH_WARNING });
});
