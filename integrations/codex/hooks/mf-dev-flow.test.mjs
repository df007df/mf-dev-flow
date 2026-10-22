import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { mfDevFlowLabel } from "../../../modules/workflow/version.mjs";

const mfDevFlowRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const hookScript = path.join(mfDevFlowRoot, "integrations", "codex", "hooks", "mf-dev-flow.mjs");
const policyEngineScript = path.join(mfDevFlowRoot, "integrations", "codex", "hooks", "policy-engine.mjs");
const temporaryDirectories = [];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-codex-hook-"));
  const runId = "codex-hook-fixture";
  const runDir = path.join(cwd, ".mf-dev-flow", "delivery-runs", runId);
  fs.mkdirSync(path.join(cwd, ".codex", "skills", "mf-dev-flow", "integrations", "codex", "hooks"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".codex", "skills", "mf-dev-flow", "scripts"), { recursive: true });
  fs.copyFileSync(hookScript, path.join(cwd, ".codex", "skills", "mf-dev-flow", "integrations", "codex", "hooks", "mf-dev-flow.mjs"));
  fs.copyFileSync(policyEngineScript, path.join(cwd, ".codex", "skills", "mf-dev-flow", "integrations", "codex", "hooks", "policy-engine.mjs"));
  for (const name of ["modules", "dashboard"]) fs.symlinkSync(path.join(mfDevFlowRoot, name), path.join(cwd, ".codex/skills/mf-dev-flow", name), "dir");
  fs.copyFileSync(path.join(mfDevFlowRoot, "scripts", "mf-dev-flow.mjs"), path.join(cwd, ".codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs"));
  writeJson(path.join(cwd, ".mf-dev-flow", "project.json"), { schemaVersion: 1 });
  writeJson(path.join(cwd, ".mf-dev-flow", "current.json"), {
    active: { type: "delivery", id: runId },
  });
  writeJson(path.join(runDir, "run.json"), {
    schemaVersion: 1,
    id: runId,
    type: "delivery",
    status: "in_progress",
  });
  writeJson(path.join(runDir, "delivery-input.json"), {
    schemaVersion: 1,
    stages: [
      { id: "implementation", status: "in_progress", updatedAt: "2026-09-04T09:00:00.000Z" },
    ],
  });
  writeJson(path.join(runDir, "work-plan.json"), {
    schemaVersion: 1,
    tasks: [{ id: "mock-library", title: "Mock library", writes: ["src/mock"], features: [] }],
  });
  temporaryDirectories.push(cwd);
  return { cwd, runDir, stateDir: path.join(cwd, "hook-state") };
}

function symlinkedSkillFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-codex-symlink-"));
  const cwd = path.join(root, "consumer-project");
  const skillRoot = path.join(root, "external-skill-project", ".codex", "skills", "mf-dev-flow");
  const runId = "symlink-run";
  const runDir = path.join(cwd, ".mf-dev-flow", "delivery-runs", runId);
  const skillFiles = [
    "integrations/codex/hooks/mf-dev-flow.mjs",
    "integrations/codex/hooks/policy-engine.mjs",
    "scripts/mf-dev-flow.mjs",
  ];
  for (const relative of skillFiles) {
    const destination = path.join(skillRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(mfDevFlowRoot, relative), destination);
  }
  for (const name of ["modules", "dashboard"])
    fs.symlinkSync(
      path.join(mfDevFlowRoot, name),
      path.join(skillRoot, name),
      "dir",
    );
  fs.mkdirSync(path.join(cwd, ".codex", "skills"), { recursive: true });
  fs.symlinkSync(skillRoot, path.join(cwd, ".codex", "skills", "mf-dev-flow"), "dir");
  writeJson(path.join(cwd, ".mf-dev-flow", "project.json"), { schemaVersion: 1 });
  writeJson(path.join(cwd, ".mf-dev-flow", "current.json"), {
    active: { type: "delivery", id: runId },
  });
  writeJson(path.join(runDir, "run.json"), {
    schemaVersion: 1,
    id: runId,
    type: "delivery",
    status: "in_progress",
  });
  writeJson(path.join(runDir, "work-plan.json"), {
    schemaVersion: 1,
    tasks: [{ id: "symlink-task", title: "Symlink task", writes: ["src"], features: [] }],
  });
  writeJson(path.join(runDir, "executions", "symlink-task.json"), {
    schemaVersion: 1,
    runId,
    taskId: "symlink-task",
    agent: "root",
    sessionId: "codex-session-1",
    status: "in_progress",
    targetPhase: "implementation",
    stages: { implementation: { status: "in_progress" } },
  });
  temporaryDirectories.push(root);
  return { cwd, runDir, stateDir: path.join(cwd, "hook-state"), skillRoot };
}

function hook(item, input) {
  const result = spawnSync(
    process.execPath,
    [path.join(item.cwd, ".codex", "skills", "mf-dev-flow", "integrations", "codex", "hooks", "mf-dev-flow.mjs")],
    {
      cwd: item.cwd,
      input: JSON.stringify({ cwd: item.cwd, session_id: "codex-session-1", ...input }),
      encoding: "utf8",
      env: { ...process.env, MF_DEV_FLOW_HOOK_HEALTH_DIR: path.join(item.cwd, "health"), MF_DEV_FLOW_CODEX_GATE_STATE_DIR: item.stateDir },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function policyEngine(item, command, input) {
  const result = spawnSync(
    process.execPath,
    [path.join(item.skillRoot, "integrations", "codex", "hooks", "policy-engine.mjs"), command],
    {
      cwd: item.cwd,
      input: JSON.stringify({ cwd: item.cwd, session_id: "codex-session-1", ...input }),
      encoding: "utf8",
      env: {
        ...process.env,
        MF_DEV_FLOW_HOME: fs.realpathSync(item.skillRoot),
        MF_DEV_FLOW_PROJECT_ROOT: item.cwd,
        MF_DEV_FLOW_HOOK_HEALTH_DIR: path.join(item.cwd, "health"),
        MF_DEV_FLOW_CODEX_GATE_STATE_DIR: item.stateDir,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

afterEach(() => {
  while (temporaryDirectories.length)
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

test("Codex SessionStart returns model context with session id", () => {
  const item = fixture();
  const result = hook(item, { hook_event_name: "SessionStart", source: "startup" });
  assert.equal(result.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(result.hookSpecificOutput.additionalContext, new RegExp(mfDevFlowLabel().replace(/[.]/g, "\\.")));
  assert.match(result.hookSpecificOutput.additionalContext, /codex-session-1/);
  assert.match(result.hookSpecificOutput.additionalContext, /work claim/);
});

test("a project consuming mf-dev-flow through a symlink reads its own delivery binding", () => {
  const item = symlinkedSkillFixture();
  assert.equal(
    fs.realpathSync(path.join(item.cwd, ".codex", "skills", "mf-dev-flow")),
    fs.realpathSync(item.skillRoot),
  );
  const result = hook(item, { hook_event_name: "SessionStart", source: "startup" });
  const context = result.hookSpecificOutput.additionalContext;
  assert.match(context, /绑定 symlink-run\/symlink-task/);
  assert.match(context, /work delivery-brief --run symlink-run --task symlink-task/);
});

test("an external physical skill home supplies policy commands after the consumer entry link is absent", () => {
  const item = symlinkedSkillFixture();
  fs.unlinkSync(path.join(item.cwd, ".codex", "skills", "mf-dev-flow"));
  const file = path.join(item.cwd, "src", "physical-home.ts");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "export {};\n");
  const result = policyEngine(item, "before-write", { file_path: file });
  assert.equal(result.permission, "allow");
  const ledger = JSON.parse(
    fs.readFileSync(path.join(item.cwd, ".mf-dev-flow", "file-touches.json"), "utf8"),
  );
  assert.equal(ledger.touches.at(-1).file, fs.realpathSync(file));
  assert.equal(ledger.touches.at(-1).sessionId, "codex-session-1");
});

test("mf-dev-flow_delivery receives checkpoint context and may stop at a validated intermediate phase", () => {
  const item = fixture();
  const started = hook(item, {
    hook_event_name: "SubagentStart",
    agent_id: "agent-delivery-1",
    agent_type: "mf-dev-flow_delivery",
  });
  assert.equal(started.hookSpecificOutput.hookEventName, "SubagentStart");
  assert.match(started.hookSpecificOutput.additionalContext, /通用任务没有预设阶段，省略 target_phase/);
  assert.match(started.hookSpecificOutput.additionalContext, /同一个任务/);

  writeJson(path.join(item.runDir, "work-plan.json"), {
    schemaVersion: 1,
    tasks: [
      {
        id: "feature-delivery",
        title: "Feature delivery",
        scope: "product",
        phase: "delivery",
        writes: ["src"],
        features: [],
      },
    ],
  });
  writeJson(path.join(item.runDir, "executions", "feature-delivery.json"), {
    schemaVersion: 1,
    runId: "codex-hook-fixture",
    taskId: "feature-delivery",
    agent: "mf-dev-flow_delivery",
    sessionId: "codex-session-1",
    status: "in_progress",
    targetPhase: "api_mock",
    stages: {
      prototype_alignment: { status: "confirmed" },
      api_mock: { status: "confirmed" },
    },
    checkpoints: [{ targetPhase: "api_mock", status: "reached" }],
    notes: [],
  });
  const stopped = hook(item, {
    hook_event_name: "SubagentStop",
    agent_id: "agent-delivery-1",
    agent_type: "mf-dev-flow_delivery",
    stop_hook_active: false,
  });
  assert.deepEqual(stopped, {});
  const execution = JSON.parse(
    fs.readFileSync(path.join(item.runDir, "executions", "feature-delivery.json"), "utf8"),
  );
  assert.equal(execution.status, "done");
  assert.equal(execution.checkpoints.at(-1).status, "validated");
  assert.equal(execution.attempts.at(-1).status, "done");
});

test("main agent Stop allows a validated intermediate checkpoint without finishing the task", () => {
  const item = fixture();
  writeJson(path.join(item.runDir, "work-plan.json"), {
    schemaVersion: 1,
    tasks: [
      {
        id: "feature-delivery",
        title: "Feature delivery",
        scope: "product",
        phase: "delivery",
        writes: ["src"],
        features: [],
      },
    ],
  });
  writeJson(path.join(item.runDir, "executions", "feature-delivery.json"), {
    schemaVersion: 1,
    runId: "codex-hook-fixture",
    taskId: "feature-delivery",
    agent: "root",
    sessionId: "codex-session-1",
    status: "in_progress",
    targetPhase: "api_mock",
    stages: {
      prototype_alignment: { status: "confirmed" },
      api_mock: { status: "confirmed" },
    },
    checkpoints: [{ targetPhase: "api_mock", status: "reached" }],
    notes: [],
  });
  const stopped = hook(item, { hook_event_name: "Stop", stop_hook_active: false });
  assert.deepEqual(stopped, {});
  const execution = JSON.parse(
    fs.readFileSync(path.join(item.runDir, "executions", "feature-delivery.json"), "utf8"),
  );
  assert.equal(execution.status, "done");
  assert.equal(execution.checkpoints.at(-1).status, "validated");
  assert.equal(execution.attempts.at(-1).status, "done");
});

test("Codex PreToolUse no longer denies an unbound code patch", () => {
  const item = fixture();
  const result = hook(item, {
    hook_event_name: "PreToolUse",
    tool_name: "apply_patch",
    tool_input: {
      command:
        "*** Begin Patch\n*** Update File: src/mock/route.ts\n@@\n+export {};\n*** End Patch",
    },
  });
  assert.notEqual(result.hookSpecificOutput?.permissionDecision, "deny");
  // 证明未绑定路径确实走到了 work lease --for-write（而非被 requiresMfDevFlowGate 跳过）：
  // 触碰台账必须留下一条身份为空的记录。真正的分支覆盖在 lease 测试中。
  const ledgerFile = path.join(item.cwd, ".mf-dev-flow", "file-touches.json");
  assert.equal(fs.existsSync(ledgerFile), true);
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  const touch = ledger.touches.at(-1);
  assert.equal(touch.file, path.join(fs.realpathSync(item.cwd), "src", "mock", "route.ts"));
  assert.equal(touch.runId, null);
  assert.equal(touch.sessionId, "codex-session-1");
  assert.ok(touch.observations.includes("no-active-run"));
});

test("Codex PreToolUse ignores a code-looking patch outside the workspace", () => {
  const item = fixture();
  const outside = path.join(os.tmpdir(), "mf-dev-flow-outside-patch.json");
  const result = hook(item, {
    hook_event_name: "PreToolUse",
    tool_name: "apply_patch",
    tool_input: {
      command: `*** Begin Patch\n*** Add File: ${outside}\n+{}\n*** End Patch`,
    },
  });
  assert.deepEqual(result, {});
});

test("Codex PreToolUse allows a patch inside the bound task scope", () => {
  const item = fixture();
  writeJson(path.join(item.runDir, "executions", "mock-library.json"), {
    schemaVersion: 1,
    runId: "codex-hook-fixture",
    taskId: "mock-library",
    agent: "agent-library",
    sessionId: "codex-session-1",
    status: "in_progress",
    changedFiles: [],
    tests: null,
    notes: [],
  });
  const result = hook(item, {
    hook_event_name: "PreToolUse",
    tool_name: "apply_patch",
    tool_input: {
      command:
        "*** Begin Patch\n*** Update File: src/mock/route.ts\n@@\n+export {};\n*** End Patch",
    },
  });
  assert.deepEqual(result, {});
});

test("Codex mf-dev-flow skill and hook maintenance bypasses task leases and tracking", () => {
  const item = fixture();
  const patch =
    "*** Begin Patch\n*** Update File: .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs\n@@\n+// maintenance\n*** End Patch";
  const before = hook(item, {
    hook_event_name: "PreToolUse",
    tool_name: "apply_patch",
    tool_input: { command: patch },
  });
  assert.deepEqual(before, {});
  const after = hook(item, {
    hook_event_name: "PostToolUse",
    tool_name: "apply_patch",
    tool_input: { command: patch },
  });
  assert.deepEqual(after, {});
  assert.equal(fs.existsSync(item.stateDir), false);
});

test("Codex PostToolUse records a patch and Stop asks for mf-dev-flow follow-up", () => {
  const item = fixture();
  const patch =
    "*** Begin Patch\n*** Update File: src/mock/route.ts\n@@\n+export {};\n*** End Patch";
  fs.mkdirSync(path.join(item.cwd, "src", "mock"), { recursive: true });
  fs.writeFileSync(path.join(item.cwd, "src", "mock", "route.ts"), "export {};\n");
  hook(item, {
    hook_event_name: "PostToolUse",
    tool_name: "apply_patch",
    tool_input: { command: patch },
  });
  const [manifestName] = fs.readdirSync(item.stateDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(item.stateDir, manifestName), "utf8"));
  assert.deepEqual(
    manifest.files.map((entry) => entry.path),
    ["src/mock/route.ts"],
  );
  const result = hook(item, { hook_event_name: "Stop", stop_hook_active: false });
  assert.equal(result.decision, "block");
  assert.match(result.reason, /work finish/);
});

test("Codex SessionEnd releases state without steering the conversation", () => {
  const item = fixture();
  const result = hook(item, { hook_event_name: "SessionEnd", reason: "other" });
  assert.deepEqual(result, {});
});

test('Edit and Write file_path inputs no longer deny through the lease gate', () => {
  const item = fixture();
  const filePath = path.join(item.cwd, 'src/mock/direct.ts');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'export {};\n');
  for (const tool_name of ['Edit', 'Write']) {
    const result = hook(item, { hook_event_name: 'PreToolUse', tool_name, tool_input: { file_path: filePath } });
    assert.deepEqual(result, {});
  }
});

test('startup/resume/clear/compact all return bounded routing context without state writes', () => {
  const item = fixture();
  for (const source of ['startup', 'resume', 'clear', 'compact']) {
    const result = hook(item, { hook_event_name: 'SessionStart', source });
    const context = result.hookSpecificOutput.additionalContext;
    assert.match(context, /未选定/); assert.ok(Buffer.byteLength(context) <= 2048);
  }
  assert.equal(fs.existsSync(path.join(item.cwd, '.mf-dev-flow/prototype')), false);
  assert.equal(fs.existsSync(item.stateDir), false);
});


test("adapter failure stays fail-open but exposes safe health and retains failure after recovery", () => {
  const item = fixture();
  fs.writeFileSync(path.join(item.cwd, '.mf-dev-flow/current.json'), 'invalid fixture JSON with SECRET_SENTINEL');
  const failed = hook(item, { hook_event_name: 'SessionStart' });
  assert.match(failed.systemMessage, /adapter_degraded/);
  assert.doesNotMatch(JSON.stringify(failed), /SECRET_SENTINEL/);
  const readHealth = () => {
    const result = spawnSync(process.execPath, [path.join(item.cwd, '.codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs'), 'flow', 'health'], { cwd: item.cwd, encoding: 'utf8', env: { ...process.env, MF_DEV_FLOW_HOOK_HEALTH_DIR: path.join(item.cwd, 'health') } });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  assert.equal(readHealth().status, 'degraded');
  writeJson(path.join(item.cwd, '.mf-dev-flow/current.json'), { active: null });
  hook(item, { hook_event_name: 'SessionStart' });
  const healthy = readHealth();
  assert.equal(healthy.status, 'observed');
  assert.ok(healthy.events.find(event => event.event === 'SessionStart').lastFailure);
  assert.doesNotMatch(JSON.stringify(healthy), /SECRET_SENTINEL/);
});
