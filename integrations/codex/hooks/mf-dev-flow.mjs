#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HEALTH_WARNING, recordHookHealth } from "../../../modules/workflow/hook-health.mjs";
import { hookContext } from "../../../modules/workflow/route.mjs";
import { CLI_FILE_NAME, ENVIRONMENT, SKILL_ID, temporaryDirectoryName } from "../../../modules/skill-identity.mjs";

/**
 * Hook adapter shared by Codex and the project-scoped ZCode plugin.
 *
 * The policy engine lives beside this adapter and accepts the internal
 * session-oriented command contract; this file translates Codex lifecycle
 * events to that contract and maps results back to the host hook output.
 */

let healthEvent = "unknown", healthFailed = false, healthRoot = process.cwd();
function degraded(error) {
  healthFailed = true;
  recordHookHealth({ root: healthRoot, adapter: "codex", event: healthEvent, status: "degraded", error });
  process.stderr.write(HEALTH_WARNING + "\n");
}

function output(value = {}) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const source = Buffer.concat(chunks).toString("utf8").trim();
  if (!source) return {};
  const value = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Codex hook input must be an object");
  }
  return value;
}

function sessionCwd(input) {
  const cwd = path.resolve(typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd());
  try {
    return fs.realpathSync(cwd);
  } catch {
    return cwd;
  }
}

function installedSkillRoot() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  try {
    return fs.realpathSync(root);
  } catch {
    return root;
  }
}

function childEnvironment(projectRoot, skillRoot, extra = {}) {
  return {
    ...process.env,
    [ENVIRONMENT.HOME]: skillRoot,
    [ENVIRONMENT.PROJECT_ROOT]: projectRoot,
    ...extra,
  };
}

function sessionId(input) {
  return typeof input.session_id === "string" && input.session_id ? input.session_id : null;
}

function stateDirectory() {
  return process.env[ENVIRONMENT.CODEX_GATE_STATE_DIRECTORY] || path.join(os.tmpdir(), temporaryDirectoryName("codex-gate"));
}

function canonicalFilePath(value) {
  let current = path.resolve(value);
  const suffix = [];
  while (true) {
    try {
      return path.join(fs.realpathSync(current), ...suffix);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(value);
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function asAbsoluteFile(root, value) {
  if (typeof value !== "string" || !value || value === "/dev/null") return null;
  return canonicalFilePath(path.isAbsolute(value) ? value : path.resolve(root, value));
}

function patchFiles(input) {
  const toolInput = input.tool_input ?? {};
  const command =
    typeof toolInput === "string"
      ? toolInput
      : typeof toolInput.command === "string"
        ? toolInput.command
        : typeof toolInput.patch === "string"
          ? toolInput.patch
          : "";
  const values = [];
  const add = (value) => {
    const file = asAbsoluteFile(sessionCwd(input), value?.trim());
    if (file && !values.includes(file)) values.push(file);
  };

  if (typeof toolInput === "object") { add(toolInput.file_path); add(toolInput.path); }
  for (const match of command.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm))
    add(match[1]);
  for (const match of command.matchAll(/^\*\*\* Move to: (.+)$/gm)) add(match[1]);
  for (const match of command.matchAll(/^\+\+\+ (?:b\/)?(.+)$/gm)) add(match[1]);
  return values;
}

function isMfDevFlowToolingFile(root, file) {
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  return (
    relative === path.join(".codex", "hooks.json") ||
    relative === path.join("hooks", "hooks.json") ||
    [
      path.join(".agents", "skills", SKILL_ID),
      path.join(".codex", "skills", SKILL_ID),
      path.join(".zcode"),
      path.join(".zcode-plugin"),
    ].some((prefix) => relative === prefix || relative.startsWith(`${prefix}${path.sep}`))
  );
}

function isWorkspaceFile(root, file) {
  const relative = path.relative(root, file);
  return Boolean(
    relative &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
  );
}

function policyInput(input, command, filePath) {
  const id = sessionId(input);
  if (!id) throw new Error("Codex hook input missing session_id");
  return {
    session_id: id,
    file_path: filePath,
    tool_input: filePath ? { file_path: filePath } : undefined,
    status: input.stop_hook_active ? "active" : "completed",
    loop_count: input.stop_hook_active ? 1 : 0,
    cwd: input.cwd,
    hook_event_name: input.hook_event_name,
  };
}

function runPolicyEngine(skillRoot, projectRoot, command, input, filePath) {
  const script = path.join(skillRoot, "integrations", "codex", "hooks", "policy-engine.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, command], {
      cwd: projectRoot,
      env: childEnvironment(projectRoot, skillRoot, {
        [ENVIRONMENT.CODEX_GATE_STATE_DIRECTORY]: stateDirectory(),
      }),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(Buffer.concat(stderr).toString("utf8") || `policy engine exited with ${code}`),
        );
        return;
      }
      try {
        const text = Buffer.concat(stdout).toString("utf8").trim();
        const result = text ? JSON.parse(text) : {};
        if (result.agent_message?.startsWith("[mf-dev-flow adapter_degraded]")) throw new Error("mf-dev-flow policy engine degraded");
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(policyInput(input, command, filePath)));
  });
}

function runMfDevFlow(skillRoot, projectRoot, args) {
  const script = path.join(skillRoot, "scripts", CLI_FILE_NAME);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: projectRoot,
      env: childEnvironment(projectRoot, skillRoot),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8") || `mf-dev-flow exited with ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

async function handleSessionStart(input, root) {
  const context = hookContext({ root, session: sessionId(input) });
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } };
}

function isMfDevFlowDeliveryAgent(input) {
  return input.agent_type === "mf-dev-flow_delivery";
}

async function handleSubagentStart(input) {
  if (!isMfDevFlowDeliveryAgent(input)) return {};
  return {
    hookSpecificOutput: {
      hookEventName: "SubagentStart",
      additionalContext:
        "mf-dev-flow_delivery 仅执行父 agent 指定的同一个任务。确认收到运行 ID、任务 ID 与父会话 ID；领取/绑定后先运行 work delivery-brief 读取本任务要求。通用任务没有预设阶段，省略 target_phase，完成实际工作与验证后执行 work finish。只有任务声明了阶段时才接受 target_phase；中间检查点验证后本次并发执行会置为 done，后续绑定同一连续任务并创建新的执行尝试。",
    },
  };
}

async function handleSubagentStop(input, skillRoot, projectRoot) {
  if (!isMfDevFlowDeliveryAgent(input)) return {};
  const result = await runMfDevFlow(skillRoot, projectRoot, [
    "work",
    "checkpoint-gate",
    "--session",
    sessionId(input),
    "--agent",
    input.agent_type,
  ]);
  if (result.verdict === "need_followup" && !input.stop_hook_active)
    return { decision: "block", reason: result.reason };
  return {};
}

async function handlePreToolUse(input, skillRoot, projectRoot) {
  const files = patchFiles(input);
  const workspace = projectRoot;
  const projectFiles = files.filter(
    (file) =>
      isWorkspaceFile(workspace, file) &&
      !isMfDevFlowToolingFile(workspace, file),
  );
  if (!projectFiles.length) return {};
  for (const file of projectFiles) {
    const result = await runPolicyEngine(skillRoot, projectRoot, "before-write", input, file);
    if (result.permission === "deny")
      return deny(result.agent_message || result.user_message || "mf-dev-flow denied this write");
  }
  return {};
}

async function handlePostToolUse(input, skillRoot, projectRoot) {
  const workspace = projectRoot;
  for (const file of patchFiles(input).filter(
    (file) =>
      isWorkspaceFile(workspace, file) &&
      !isMfDevFlowToolingFile(workspace, file),
  ))
    await runPolicyEngine(skillRoot, projectRoot, "after-file-edit", input, file);
  return {};
}

async function handleStop(input, skillRoot, projectRoot) {
  if (input.stop_hook_active) return {};
  // A main-agent delivery task may intentionally stop after an intermediate
  // target phase. Let the task's checkpoint gate validate and release that
  // continuation point before the terminal-completion policy gate runs.
  const checkpoint = await runMfDevFlow(skillRoot, projectRoot, [
    "work",
    "checkpoint-gate",
    "--session",
    sessionId(input),
    "--agent",
    "root",
  ]).catch(error => { degraded(error); return null; });
  if (checkpoint?.verdict === "pass") return {};
  const result = await runPolicyEngine(skillRoot, projectRoot, "stop", input);
  if (result.followup_message) return { decision: "block", reason: result.followup_message };
  if (result.systemMessage) return { systemMessage: result.systemMessage };
  return {};
}

async function handleSessionEnd(input, skillRoot, projectRoot) {
  // SessionEnd is advisory in Codex, but it is still the right place to
  // release leases when a user archives/closes a thread without another Stop.
  await runPolicyEngine(skillRoot, projectRoot, "stop", { ...input, stop_hook_active: true });
  return {};
}

async function main() {
  const input = await readInput();
  const projectRoot = sessionCwd(input);
  const skillRoot = installedSkillRoot();
  healthRoot = projectRoot;
  const event = input.hook_event_name || process.argv[2];
  healthEvent = event;
  if (!sessionId(input)) return output({});
  if (event === "SessionStart" || process.argv[2] === "session-start")
    return output(await handleSessionStart(input, projectRoot));
  if (event === "SubagentStart") return output(await handleSubagentStart(input));
  if (event === "PreToolUse" || process.argv[2] === "before-write")
    return output(await handlePreToolUse(input, skillRoot, projectRoot));
  if (event === "PostToolUse" || process.argv[2] === "after-file-edit")
    return output(await handlePostToolUse(input, skillRoot, projectRoot));
  if (event === "Stop" || process.argv[2] === "stop")
    return output(await handleStop(input, skillRoot, projectRoot));
  if (event === "SubagentStop")
    return output(await handleSubagentStop(input, skillRoot, projectRoot));
  if (event === "SessionEnd" || process.argv[2] === "session-end")
    return output(await handleSessionEnd(input, skillRoot, projectRoot));
  output({});
}

main().then(() => {
  if (!healthFailed) recordHookHealth({ root: healthRoot, adapter: "codex", event: healthEvent, status: "ok" });
}).catch(error => {
  degraded(error);
  output({ systemMessage: HEALTH_WARNING });
});
