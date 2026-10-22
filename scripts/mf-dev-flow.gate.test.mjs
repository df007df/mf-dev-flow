import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runDetail } from "../dashboard/server/state.js";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "mf-dev-flow.mjs");
const temporaryDirectories = [];
const stageIds = [
  "prototype_alignment",
  "api_mock",
  "technical_implementation",
  "end_to_end_acceptance",
];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture({ runStatus = "in_progress", execution = null, sessionFiles = [] } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-gate-"));
  temporaryDirectories.push(cwd);
  const runId = "delivery-gate-fixture";
  const runDir = path.join(cwd, ".mf-dev-flow", "delivery-runs", runId);
  writeJson(path.join(cwd, ".mf-dev-flow", "project.json"), {
    schemaVersion: 1,
    project: { name: "fixture" },
  });
  writeJson(path.join(cwd, ".mf-dev-flow", "current.json"), {
    schemaVersion: 1,
    active: { type: "delivery", id: runId },
  });
  writeJson(path.join(runDir, "run.json"), {
    schemaVersion: 1,
    id: runId,
    type: "delivery",
    title: "fixture",
    status: runStatus,
  });
  writeJson(path.join(runDir, "delivery-input.json"), {
    schemaVersion: 1,
    stages: stageIds.map((id, index) => ({
      id,
      status: index === 0 ? "in_progress" : "pending",
      updatedAt: "2026-09-03T09:00:00.000Z",
    })),
  });
  writeJson(path.join(runDir, "work-plan.json"), {
    schemaVersion: 1,
    tasks: [{ id: "mock-library", title: "Mock library", writes: ["src/mock"], features: [] }],
  });
  fs.mkdirSync(path.join(runDir, "screenshots"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "screenshots", "library-e2e.png"), "fixture");
  fs.writeFileSync(
    path.join(runDir, "plan.md"),
    [
      "# fixture · 开发计划",
      "",
      "## 实施切片",
      "",
      "接口契约、服务端筛选和客户端 URL 状态按顺序交付，并由独立验收任务复核。",
      "",
      "## 技术方案与实施决策",
      "",
      "查询参数在接口契约中定义，服务端执行筛选，客户端只维护 URL，以保持状态可分享和可回归。",
      "",
      "- [x] `mock-library` · fixture task",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(runDir, "implementation.md"),
    [
      "# fixture · 实现记录",
      "",
      "## 关键技术方案",
      "",
      "服务端作为唯一数据筛选边界，组件不直接造数或请求，以保证契约和界面行为一致。",
      "",
      "## 实际改动与行为",
      "",
      "新增学段查询并通过 URL 暴露筛选状态，用户刷新页面仍能得到同一组书目结果。",
      "",
      "## 未完成项和风险",
      "",
      "本测试夹具没有未完成项；真实运行应记录外部数据和兼容性风险。",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(runDir, "verification.md"),
    [
      "# fixture · 测试与原型回归",
      "",
      "## 测试执行记录",
      "",
      "执行 pnpm test 和功能 E2E，用例验证筛选 URL、可见书目和关键词搜索结果均符合预期。",
      "",
      "## 逻辑复核与原型对照",
      "",
      "逐项对照默认书库、学段选择和筛选结果，确认状态、文案和真实数据边界保持一致。",
      "",
      "## 截图证据与偏差处理",
      "",
      "screenshots/library-e2e.png 由真实验收路径采集，展示小学筛选结果；本夹具没有待处理偏差。",
      "",
    ].join("\n"),
  );
  if (execution) writeJson(path.join(runDir, "executions", "mock-library.json"), execution);
  const manifest = path.join(cwd, "session-files.json");
  writeJson(manifest, { schemaVersion: 1, files: sessionFiles });
  return { cwd, manifest };
}

function gate(fixtureValue, ...extraArgs) {
  const result = spawnSync(
    process.execPath,
    [script, "gate", "--for-stop", "--session-files", fixtureValue.manifest, ...extraArgs],
    { cwd: fixtureValue.cwd, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function command(cwd, ...args) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
}

function inputFile(item) {
  return path.join(
    item.cwd,
    ".mf-dev-flow",
    "delivery-runs",
    "delivery-gate-fixture",
    "delivery-input.json",
  );
}

function closeStages(item, status = "confirmed") {
  const input = JSON.parse(fs.readFileSync(inputFile(item), "utf8"));
  input.stages = input.stages.map((stage) => ({
    ...stage,
    status,
    summary: status === "not_applicable" ? "本运行明确不适用。" : "已留下阶段验收证据。",
  }));
  writeJson(inputFile(item), input);
}

test("停止门禁按会话绑定任务检查范围，不受另一运行的 current 影响", () => {
  const item = fixture({
    sessionFiles: [{ path: "src/pages/v2/shelf/index.scss" }],
  });
  const readerRunDir = path.join(
    item.cwd,
    ".mf-dev-flow",
    "delivery-runs",
    "delivery-gate-fixture",
  );
  writeJson(path.join(readerRunDir, "work-plan.json"), {
    schemaVersion: 1,
    tasks: [{ id: "reader-layout", title: "Reader", writes: ["src/pages/v2/reader"], features: [] }],
  });

  const trialRunId = "trial-gate-fixture";
  const trialRunDir = path.join(item.cwd, ".mf-dev-flow", "delivery-runs", trialRunId);
  writeJson(path.join(trialRunDir, "run.json"), {
    schemaVersion: 1,
    id: trialRunId,
    type: "delivery",
    status: "in_progress",
  });
  writeJson(path.join(trialRunDir, "delivery-input.json"), {
    schemaVersion: 1,
    stages: [{ id: "implementation", status: "in_progress" }],
  });
  writeJson(path.join(trialRunDir, "work-plan.json"), {
    schemaVersion: 1,
    tasks: [{ id: "trial-layout", title: "Trial", writes: ["src/pages/v2/shelf"], features: [] }],
  });
  writeJson(path.join(trialRunDir, "executions", "trial-layout.json"), {
    schemaVersion: 1,
    runId: trialRunId,
    taskId: "trial-layout",
    agent: "trial-agent",
    sessionId: "trial-session",
    status: "in_progress",
    changedFiles: [],
    tests: null,
    notes: [],
  });

  const result = gate(item, "--session", "trial-session");
  assert.equal(result.verdict, "need_followup");
  assert.equal(
    result.reasons.some((reason) => reason.code === "SESSION_FILE_OUTSIDE_TASK_SCOPE"),
    false,
  );
  assert.deepEqual(result.reasons.map((reason) => reason.code), ["TASK_EXECUTION_NOT_FINISHED"]);
  assert.equal(result.reasons[0].taskId, "trial-layout");
});

test("current 指向不存在的运行时，Stop 仍优先使用本会话的完成记录", () => {
  const item = fixture({
    execution: {
      schemaVersion: 1,
      taskId: "mock-library",
      agent: "agent-lib",
      sessionId: "session-a",
      status: "blocked",
      changedFiles: ["src/mock/route.ts"],
      updatedAt: "2026-09-03T10:01:00.000Z",
    },
    sessionFiles: [{ path: "src/mock/route.ts" }],
  });
  writeJson(path.join(item.cwd, ".mf-dev-flow", "current.json"), {
    active: { type: "delivery", id: "deleted-run" },
  });

  const result = gate(item, "--session", "session-a");
  assert.equal(result.verdict, "pass");
  assert.equal(result.resolvedRun.id, "delivery-gate-fixture");
});

test("多个会话任务覆盖同一改动时，Stop 返回歧义而不回退到 current", () => {
  const item = fixture({
    execution: {
      schemaVersion: 1,
      taskId: "mock-library",
      agent: "agent-a",
      sessionId: "shared-session",
      status: "in_progress",
      changedFiles: [],
      tests: null,
      notes: [],
    },
    sessionFiles: [{ path: "src/mock/route.ts" }],
  });
  const secondRunId = "second-session-run";
  const secondRunDir = path.join(item.cwd, ".mf-dev-flow", "delivery-runs", secondRunId);
  writeJson(path.join(secondRunDir, "run.json"), {
    schemaVersion: 1,
    id: secondRunId,
    type: "delivery",
    status: "in_progress",
  });
  writeJson(path.join(secondRunDir, "delivery-input.json"), {
    schemaVersion: 1,
    stages: [{ id: "implementation", status: "in_progress" }],
  });
  writeJson(path.join(secondRunDir, "work-plan.json"), {
    schemaVersion: 1,
    tasks: [{ id: "second-task", title: "Second", writes: ["src/mock"], features: [] }],
  });
  writeJson(path.join(secondRunDir, "executions", "second-task.json"), {
    schemaVersion: 1,
    runId: secondRunId,
    taskId: "second-task",
    agent: "agent-b",
    sessionId: "shared-session",
    status: "in_progress",
    changedFiles: [],
    tests: null,
    notes: [],
  });

  const result = gate(item, "--session", "shared-session");
  assert.equal(result.verdict, "need_followup");
  assert.deepEqual(result.reasons.map((reason) => reason.code), ["AMBIGUOUS_SESSION_BINDING"]);
});

afterEach(() => {
  while (temporaryDirectories.length)
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

test("改动已发生但任务未 work finish 时要求续跑", () => {
  const item = fixture({
    sessionFiles: [{ path: "src/mock/route.ts", observedAt: "2026-09-03T10:00:00.000Z" }],
  });
  const result = gate(item);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.verdict, "need_followup");
  assert.deepEqual(
    result.stages.map((stage) => stage.id),
    stageIds,
  );
  assert.equal(result.reasons[0].code, "TASK_EXECUTION_NOT_FINISHED");
  assert.match(result.nextCommand, /work finish/);
});

test("完成记录覆盖本会话改动且更新较新时通过", () => {
  const item = fixture({
    execution: {
      schemaVersion: 1,
      taskId: "mock-library",
      agent: "agent-lib",
      status: "done",
      changedFiles: ["src/mock/route.ts"],
      updatedAt: "2026-09-03T10:01:00.000Z",
    },
    sessionFiles: [{ path: "src/mock/route.ts", observedAt: "2026-09-03T10:00:00.000Z" }],
  });
  const result = gate(item);
  assert.equal(result.verdict, "pass");
  assert.equal(result.reasons.at(-1).code, "TASK_EXECUTION_CURRENT");
});

test("文件登记遗漏和越界只输出审计提醒，不阻塞 Stop", () => {
  const unrecorded = fixture({
    execution: {
      schemaVersion: 1,
      taskId: "mock-library",
      agent: "agent-lib",
      status: "done",
      changedFiles: [],
      updatedAt: "2026-09-03T10:01:00.000Z",
    },
    sessionFiles: [{ path: "src/mock/extra.ts" }],
  });
  const result = gate(unrecorded, "--session", "session-a");
  assert.equal(result.verdict, "pass");
  assert.equal(result.auditWarnings[0].code, "SESSION_FILE_NOT_RECORDED");
  assert.equal(result.reasons.at(-1).code, "AUDIT_WARNINGS_PRESENT");

  const outside = fixture({
    execution: {
      schemaVersion: 1,
      taskId: "mock-library",
      agent: "agent-lib",
      status: "done",
      changedFiles: ["src/mock/route.ts"],
      updatedAt: "2026-09-03T10:01:00.000Z",
    },
    sessionFiles: [{ path: "src/other.ts" }],
  });
  const outsideResult = gate(outside, "--session", "session-a");
  assert.equal(outsideResult.verdict, "pass");
  assert.equal(outsideResult.auditWarnings[0].code, "SESSION_FILE_OUTSIDE_TASK_SCOPE");
  assert.equal(outsideResult.reasons.at(-1).code, "AUDIT_WARNINGS_PRESENT");
});

test("回写早于最新改动只输出审计提醒，不阻塞 Stop", () => {
  const item = fixture({
    execution: {
      schemaVersion: 1,
      taskId: "mock-library",
      agent: "agent-lib",
      status: "done",
      changedFiles: ["src/mock/route.ts"],
      updatedAt: "2026-09-03T09:59:00.000Z",
    },
    sessionFiles: [{ path: "src/mock/route.ts", observedAt: "2026-09-03T10:00:00.000Z" }],
  });
  const result = gate(item);
  assert.equal(result.verdict, "pass");
  assert.equal(result.auditWarnings[0].code, "TASK_EXECUTION_STALE");
  assert.equal(result.reasons.at(-1).code, "AUDIT_WARNINGS_PRESENT");
});

test("没有代码改动不误伤", () => {
  const result = gate(fixture());
  assert.equal(result.verdict, "pass");
  assert.equal(result.reasons[0].code, "NO_SESSION_CODE_CHANGES");
});

test("done 或 skipped 的任务不阻塞后续阶段复用同一写入范围", () => {
  for (const status of ["done", "skipped"]) {
    const item = fixture({
      execution: {
        schemaVersion: 1,
        taskId: "mock-library",
        agent: "agent-lib",
        status,
        changedFiles: [],
        updatedAt: "2026-09-03T10:01:00.000Z",
      },
    });
    const input = JSON.parse(fs.readFileSync(inputFile(item), "utf8"));
    input.stages[0] = {
      ...input.stages[0],
      status: "confirmed",
      summary: "原型对齐已完成。",
    };
    writeJson(inputFile(item), input);

    const planned = command(
      item.cwd,
      "work",
      "plan",
      "--run",
      "delivery-gate-fixture",
      "--task",
      `next-stage-${status}`,
      "--title",
      "后续接口阶段",
      "--kind",
      "feature",
      "--scope",
      "governance",
      "--writes",
      "src/mock",
      "--phase",
      "api_mock",
    );
    assert.equal(planned.status, 0, planned.stderr);
  }
});

test("运行内并发允许后续任务共享 blocked 任务的写入范围", () => {
  const item = fixture({
    execution: {
      schemaVersion: 1,
      taskId: "mock-library",
      agent: "agent-lib",
      status: "blocked",
      changedFiles: [],
      updatedAt: "2026-09-03T10:01:00.000Z",
    },
  });
  const input = JSON.parse(fs.readFileSync(inputFile(item), "utf8"));
  input.stages[0] = {
    ...input.stages[0],
    status: "confirmed",
    summary: "原型对齐已完成。",
  };
  writeJson(inputFile(item), input);

  const planned = command(
    item.cwd,
    "work",
    "plan",
    "--run",
    "delivery-gate-fixture",
    "--task",
    "blocked-followup",
    "--title",
    "可共享运行内写入范围",
    "--kind",
    "feature",
    "--scope",
    "governance",
    "--writes",
    "src/mock",
    "--phase",
    "api_mock",
  );
  assert.equal(planned.status, 0, planned.stderr);
});

test("已 blocked 的 delivery 不强制续跑", () => {
  const item = fixture({
    runStatus: "blocked",
    sessionFiles: [{ path: "src/mock/route.ts", observedAt: "2026-09-03T10:00:00.000Z" }],
  });
  const result = gate(item);
  assert.equal(result.verdict, "pass");
  assert.equal(result.reasons[0].code, "NO_ACTIVE_IN_PROGRESS_DELIVERY");
});

test("--since 排除早于本会话的文件", () => {
  const item = fixture({
    sessionFiles: [{ path: "src/mock/route.ts", observedAt: "2026-09-03T09:00:00.000Z" }],
  });
  const result = gate(item, "--since", "2026-09-03T10:00:00.000Z");
  assert.equal(result.session.codeChanged, false);
  assert.equal(result.verdict, "pass");
});

test("任务完成不能绕过固定阶段：验证和 done 都要求阶段闭环", () => {
  const item = fixture({
    execution: {
      schemaVersion: 1,
      taskId: "mock-library",
      agent: "agent-lib",
      status: "done",
      changedFiles: [],
      updatedAt: "2026-09-03T10:01:00.000Z",
    },
  });
  const verify = command(
    item.cwd,
    "work",
    "verify",
    "--run",
    "delivery-gate-fixture",
    "--status",
    "passed",
    "--commands",
    "pnpm test",
    "--summary",
    "验证通过",
  );
  assert.notEqual(verify.status, 0);
  assert.match(verify.stderr, /开发阶段未闭环/);

  closeStages(item);
  const verified = command(
    item.cwd,
    "work",
    "verify",
    "--run",
    "delivery-gate-fixture",
    "--status",
    "passed",
    "--commands",
    "pnpm test",
    "--summary",
    "验证通过",
  );
  assert.equal(verified.status, 0, verified.stderr);
  const done = command(
    item.cwd,
    "run",
    "set",
    "--type",
    "delivery",
    "--id",
    "delivery-gate-fixture",
    "--status",
    "done",
    "--note",
    "全部阶段已闭环",
  );
  assert.equal(done.status, 0, done.stderr);
});

test("空报告或缺少 E2E 截图时 work verify 拒绝，Stop 仅核验任务完成记录", () => {
  const item = fixture({
    execution: {
      schemaVersion: 1,
      taskId: "mock-library",
      agent: "agent-lib",
      status: "done",
      changedFiles: ["src/mock/route.ts"],
      updatedAt: "2026-09-03T10:01:00.000Z",
    },
    sessionFiles: [{ path: "src/mock/route.ts", observedAt: "2026-09-03T10:00:00.000Z" }],
  });
  closeStages(item);
  fs.writeFileSync(
    path.join(item.cwd, ".mf-dev-flow", "delivery-runs", "delivery-gate-fixture", "implementation.md"),
    "# fixture · 实现记录\n\n## 关键技术方案\n\n待填写\n",
  );
  fs.rmSync(
    path.join(item.cwd, ".mf-dev-flow", "delivery-runs", "delivery-gate-fixture", "screenshots"),
    { recursive: true, force: true },
  );

  const verify = command(
    item.cwd,
    "work",
    "verify",
    "--run",
    "delivery-gate-fixture",
    "--status",
    "passed",
    "--commands",
    "pnpm test",
    "--summary",
    "验证通过",
  );
  assert.notEqual(verify.status, 0);
  assert.match(verify.stderr, /实现记录.*关键技术方案|全链路验收缺少归档的 E2E 截图/);

  const stop = gate(item);
  assert.equal(stop.verdict, "pass");
  assert.equal(stop.reasons.at(-1).code, "TASK_EXECUTION_CURRENT");
});

test("Stop 优先使用会话已完成记录，不受 current 指向的其他任务影响", () => {
  const item = fixture({
    sessionFiles: [{ path: "src/mock/route.ts", observedAt: "2026-09-03T10:00:00.000Z" }],
  });
  const root = path.join(item.cwd, ".mf-dev-flow");
  const archivedRun = "delivery-session-record";
  writeJson(path.join(root, "delivery-runs", archivedRun, "run.json"), {
    schemaVersion: 1,
    id: archivedRun,
    type: "delivery",
    title: "已完成任务",
    status: "blocked",
  });
  writeJson(path.join(root, "delivery-runs", archivedRun, "delivery-input.json"), {
    schemaVersion: 1,
    stages: stageIds.map((id) => ({ id, status: "blocked" })),
  });
  writeJson(path.join(root, "delivery-runs", archivedRun, "work-plan.json"), {
    schemaVersion: 1,
    tasks: [{ id: "session-task", title: "会话任务", writes: ["src/mock"], features: [] }],
  });
  writeJson(path.join(root, "delivery-runs", archivedRun, "executions", "session-task.json"), {
    schemaVersion: 2,
    taskId: "session-task",
    agent: "agent-session",
    sessionId: "session-a",
    status: "blocked",
    changedFiles: ["src/mock/route.ts"],
    updatedAt: "2026-09-03T10:01:00.000Z",
  });

  const result = gate(item, "--session", "session-a");
  assert.equal(result.verdict, "pass");
  assert.deepEqual(result.activeRun, {
    type: "delivery",
    id: "delivery-gate-fixture",
    status: "in_progress",
  });
  assert.deepEqual(result.resolvedRun, {
    type: "delivery",
    id: archivedRun,
    taskId: "session-task",
    source: "session-task-execution",
  });
  assert.equal(result.reasons.at(-1).code, "TASK_EXECUTION_CURRENT");
});

test("check 不再只检查报告文件存在，空模板会被拒绝", () => {
  const item = fixture();
  fs.writeFileSync(
    path.join(item.cwd, ".mf-dev-flow", "delivery-runs", "delivery-gate-fixture", "verification.md"),
    "# fixture · 测试与原型回归\n\n每次测试后追加。\n",
  );
  const checked = command(item.cwd, "check", "--type", "delivery", "--id", "delivery-gate-fixture");
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /交付报告未通过|测试与原型回归/);
});

test.skip("历史像素回归用例：仅保留迁移审计，不再作为视觉验收", () => {
  const item = fixture();
  const root = path.join(item.cwd, ".mf-dev-flow");
  const projectFile = path.join(root, "project.json");
  const project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  project.codeRoots = [
    { path: "mini", role: "mini", deliveryRoles: ["ui-client"], writeBoundary: "客户端" },
  ];
  project.visualRegression = { maxDiffPixelRatio: 0 };
  writeJson(projectFile, project);
  writeJson(path.join(root, "delivery-runs", "delivery-gate-fixture", "work-plan.json"), {
    schemaVersion: 1,
    tasks: [
      {
        id: "mock-library",
        title: "Mock library",
        phase: "delivery",
        scope: "product",
        writes: ["src/mock"],
        features: [],
        deliveryTarget: { path: "mini", deliveryRoles: ["ui-client"] },
        deliveryTargets: [{ path: "mini", deliveryRoles: ["ui-client"] }],
      },
    ],
  });
  writeJson(path.join(root, "delivery-runs", "delivery-gate-fixture", "executions", "mock-library.json"), {
    schemaVersion: 2,
    taskId: "mock-library",
    agent: "agent-ui",
    status: "in_progress",
  });
  const runFile = path.join(root, "delivery-runs", "delivery-gate-fixture", "run.json");
  const delivery = JSON.parse(fs.readFileSync(runFile, "utf8"));
  delivery.prototypeRun = "prototype-fixture";
  writeJson(runFile, delivery);
  const prototype = path.join(root, "prototype-runs", "prototype-fixture", "screenshots", "library.png");
  const ui = path.join(root, "delivery-runs", "delivery-gate-fixture", "screenshots", "library-ui.png");
  fs.mkdirSync(path.dirname(prototype), { recursive: true });
  fs.mkdirSync(path.dirname(ui), { recursive: true });
  const generated = spawnSync("magick", ["-size", "2x2", "xc:#ffffff", prototype], {
    encoding: "utf8",
  });
  assert.equal(generated.status, 0, generated.stderr);
  fs.copyFileSync(prototype, ui);
  const result = command(
    item.cwd,
    "visual",
    "compare",
    "--run",
    "delivery-gate-fixture",
    "--task",
    "mock-library",
    "--state",
    "library-default",
    "--prototype",
    ".mf-dev-flow/prototype-runs/prototype-fixture/screenshots/library.png",
    "--ui",
    ".mf-dev-flow/delivery-runs/delivery-gate-fixture/screenshots/library-ui.png",
    "--ui-project",
    "mini",
    "--action",
    "从书库入口进入默认状态",
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /passed/);
  const records = JSON.parse(
    fs.readFileSync(path.join(root, "delivery-runs", "delivery-gate-fixture", "visual-regressions.json"), "utf8"),
  );
  assert.equal(records.comparisons[0].uiProject, "mini");
  assert.ok(records.comparisons[0].pairId);
  assert.equal(records.comparisons[0].diffPixelRatio, 0);
  assert.ok(
    fs.existsSync(
      path.join(root, "delivery-runs", "delivery-gate-fixture", "screenshots", "visual-diffs", "library-default.png"),
    ),
  );
  const report = fs.readFileSync(
    path.join(root, "delivery-runs", "delivery-gate-fixture", "verification.md"),
    "utf8",
  );
  assert.match(report, /mf-dev-flow:visual-regression:start/);
  assert.match(report, /library-ui\.png/);
  const pairs = JSON.parse(
    fs.readFileSync(path.join(root, "delivery-runs", "delivery-gate-fixture", "validation-screenshot-pairs.json"), "utf8"),
  );
  assert.deepEqual(pairs.pairs[0].screenshots.map((shot) => shot.role), ["reference", "result"]);
  assert.deepEqual(
    pairs.pairs[0].screenshots.map((shot) => shot.sourceSystem.kind),
    ["prototype-run", "ui-client-project"],
  );
  assert.match(report, /mf-dev-flow:visual-pairs:start/);

  const changedUi = path.join(root, "delivery-runs", "delivery-gate-fixture", "screenshots", "library-ui-changed.png");
  const changed = spawnSync("magick", [ui, "-fill", "#000000", "-draw", "point 0,0", changedUi], {
    encoding: "utf8",
  });
  assert.equal(changed.status, 0, changed.stderr);
  const changedResult = command(
    item.cwd,
    "visual",
    "compare",
    "--run",
    "delivery-gate-fixture",
    "--task",
    "mock-library",
    "--state",
    "library-one-pixel-changed",
    "--prototype",
    ".mf-dev-flow/prototype-runs/prototype-fixture/screenshots/library.png",
    "--ui",
    ".mf-dev-flow/delivery-runs/delivery-gate-fixture/screenshots/library-ui-changed.png",
    "--ui-project",
    "mini",
    "--action",
    "修改一个像素以验证 AE 解析",
  );
  assert.equal(changedResult.status, 1);
  assert.match(changedResult.stdout, /failed/);
  const changedRecords = JSON.parse(
    fs.readFileSync(path.join(root, "delivery-runs", "delivery-gate-fixture", "visual-regressions.json"), "utf8"),
  );
  assert.equal(changedRecords.comparisons[1].diffPixels, 1);
  assert.equal(changedRecords.comparisons[1].diffPixelRatio, 0.25);
  assert.match(changedRecords.comparisons[1].metric.raw, /\(1\)/);

  project.visualRegression = {
    maxDiffPixelRatio: 1,
    criticalRegions: {
      "library-critical-region": [
        { id: "top-left", x: 0, y: 0, width: 1, height: 1, maxDiffPixelRatio: 0 },
      ],
    },
  };
  writeJson(projectFile, project);
  const criticalResult = command(
    item.cwd,
    "visual",
    "compare",
    "--run",
    "delivery-gate-fixture",
    "--task",
    "mock-library",
    "--state",
    "library-critical-region",
    "--prototype",
    ".mf-dev-flow/prototype-runs/prototype-fixture/screenshots/library.png",
    "--ui",
    ".mf-dev-flow/delivery-runs/delivery-gate-fixture/screenshots/library-ui-changed.png",
    "--ui-project",
    "mini",
    "--action",
    "全图可通过，但关键区域不能放过一个像素",
  );
  assert.equal(criticalResult.status, 1);
  const criticalRecords = JSON.parse(
    fs.readFileSync(path.join(root, "delivery-runs", "delivery-gate-fixture", "visual-regressions.json"), "utf8"),
  );
  assert.equal(criticalRecords.comparisons[2].diffPixelRatio, 0.25);
  assert.equal(criticalRecords.comparisons[2].criticalRegions[0].status, "failed");
  assert.equal(criticalRecords.comparisons[2].criticalRegions[0].diffPixels, 1);

  const automaticPrototype = path.join(root, "prototype-runs", "prototype-fixture", "screenshots", "library-automatic.png");
  const automaticUi = path.join(root, "delivery-runs", "delivery-gate-fixture", "screenshots", "library-automatic-ui.png");
  const automaticUiEdge = path.join(root, "delivery-runs", "delivery-gate-fixture", "screenshots", "library-automatic-edge-ui.png");
  const automaticGenerated = spawnSync("magick", ["-size", "100x100", "xc:#ffffff", automaticPrototype], {
    encoding: "utf8",
  });
  assert.equal(automaticGenerated.status, 0, automaticGenerated.stderr);
  const automaticChanged = spawnSync(
    "magick",
    [automaticPrototype, "-fill", "#000000", "-draw", "rectangle 20,20 49,49", automaticUi],
    { encoding: "utf8" },
  );
  assert.equal(automaticChanged.status, 0, automaticChanged.stderr);
  const edgeChanged = spawnSync(
    "magick",
    [automaticPrototype, "-fill", "#000000", "-stroke", "#000000", "-draw", "line 99,10 99,89", automaticUiEdge],
    { encoding: "utf8" },
  );
  assert.equal(edgeChanged.status, 0, edgeChanged.stderr);
  project.visualRegression = {
    maxDiffPixelRatio: 1,
    automaticGuards: {
      differenceThresholdPercent: 10,
      minComponentAreaPixels: 50,
      maxComponentAreaRatio: 0.01,
      rightEdge: { width: 4, maxDiffPixelRatio: 0.1 },
    },
  };
  writeJson(projectFile, project);
  const automaticComponentResult = command(
    item.cwd,
    "visual",
    "compare",
    "--run",
    "delivery-gate-fixture",
    "--task",
    "mock-library",
    "--state",
    "library-auto-components",
    "--prototype",
    ".mf-dev-flow/prototype-runs/prototype-fixture/screenshots/library-automatic.png",
    "--ui",
    ".mf-dev-flow/delivery-runs/delivery-gate-fixture/screenshots/library-automatic-ui.png",
    "--ui-project",
    "mini",
    "--action",
    "验证通用连通块门禁",
  );
  assert.equal(automaticComponentResult.status, 1);
  const componentRecords = JSON.parse(
    fs.readFileSync(path.join(root, "delivery-runs", "delivery-gate-fixture", "visual-regressions.json"), "utf8"),
  );
  assert.ok(componentRecords.comparisons[3].automaticAnalysis.oversizedComponentCount > 0);
  assert.equal(componentRecords.comparisons[3].automaticAnalysis.rightEdge.status, "passed");

  project.visualRegression.automaticGuards.maxComponentAreaRatio = 1;
  project.visualRegression.automaticGuards.rightEdge.maxDiffPixelRatio = 0;
  writeJson(projectFile, project);
  const automaticEdgeResult = command(
    item.cwd,
    "visual",
    "compare",
    "--run",
    "delivery-gate-fixture",
    "--task",
    "mock-library",
    "--state",
    "library-auto-edge",
    "--prototype",
    ".mf-dev-flow/prototype-runs/prototype-fixture/screenshots/library-automatic.png",
    "--ui",
    ".mf-dev-flow/delivery-runs/delivery-gate-fixture/screenshots/library-automatic-edge-ui.png",
    "--ui-project",
    "mini",
    "--action",
    "验证通用右边缘门禁",
  );
  assert.equal(automaticEdgeResult.status, 1);
  const edgeRecords = JSON.parse(
    fs.readFileSync(path.join(root, "delivery-runs", "delivery-gate-fixture", "visual-regressions.json"), "utf8"),
  );
  assert.equal(edgeRecords.comparisons[4].automaticAnalysis.oversizedComponentCount, 0);
  assert.equal(edgeRecords.comparisons[4].automaticAnalysis.rightEdge.status, "failed");
});

test("逐区审查归档同状态截图对，并以语义结论阻断偏差或不确定项", () => {
  const item = fixture();
  const root = path.join(item.cwd, ".mf-dev-flow");
  const projectFile = path.join(root, "project.json");
  const project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  project.codeRoots = [
    { path: "mini", role: "mini", deliveryRoles: ["ui-client"], writeBoundary: "客户端" },
  ];
  writeJson(projectFile, project);
  writeJson(path.join(root, "delivery-runs", "delivery-gate-fixture", "work-plan.json"), {
    schemaVersion: 1,
    tasks: [
      {
        id: "mock-library",
        title: "Mock library",
        phase: "delivery",
        scope: "product",
        writes: ["src/mock"],
        features: [],
        deliveryTarget: { path: "mini", deliveryRoles: ["ui-client"] },
        deliveryTargets: [{ path: "mini", deliveryRoles: ["ui-client"] }],
      },
    ],
  });
  writeJson(path.join(root, "delivery-runs", "delivery-gate-fixture", "executions", "mock-library.json"), {
    schemaVersion: 2,
    taskId: "mock-library",
    agent: "agent-ui",
    status: "in_progress",
  });
  const runFile = path.join(root, "delivery-runs", "delivery-gate-fixture", "run.json");
  const delivery = JSON.parse(fs.readFileSync(runFile, "utf8"));
  delivery.prototypeRun = "prototype-fixture";
  writeJson(runFile, delivery);
  const prototype = path.join(root, "prototype-runs", "prototype-fixture", "screenshots", "library.png");
  const ui = path.join(root, "delivery-runs", "delivery-gate-fixture", "screenshots", "library-ui.png");
  fs.mkdirSync(path.dirname(prototype), { recursive: true });
  fs.writeFileSync(prototype, "reference fixture");
  fs.writeFileSync(ui, "ui fixture");
  const regionReport = path.join(item.cwd, "region-report.json");
  const saveReport = (state, status = "passed") => {
    const check = (kind) => ({
      kind,
      status: kind === "layout" ? status : "passed",
      detail: `${kind} 已按业务区块核验`,
      ...(kind === "copy" ? { sourceVerified: true } : {}),
    });
    writeJson(regionReport, {
      schemaVersion: 1,
      analyzer: { provider: "fixture-image-analyzer", model: "semantic-regions-v1" },
      capture: {
        comparable: true,
        baseline: { device: "iPhone 12/13 Pro", scale: "100%", canvas: "390x844" },
        reference: { state, source: "HTML .phone business canvas" },
        result: { state, source: "WechatIDE simulator" },
      },
      excludedRegions: [
        { id: "native-header", reason: "微信原生状态栏和胶囊不属于业务画布" },
      ],
      regions: [
        {
          id: "home-header",
          order: 1,
          scope: "business",
          reference: { summary: "顶部品牌标题与入口" },
          result: { summary: "顶部品牌标题与入口" },
          checks: ["presence", "order", "layout", "copy", "visual", "interaction"].map(check),
        },
        {
          id: "bottom-navigation",
          order: 2,
          scope: "business",
          reference: { summary: "业务底部菜单" },
          result: { summary: "业务底部菜单" },
          checks: ["presence", "order", "layout", "copy", "visual", "interaction"].map(check),
        },
      ],
    });
  };
  const compare = (state) =>
    command(
      item.cwd,
      "visual",
      "compare",
      "--run",
      "delivery-gate-fixture",
      "--task",
      "mock-library",
      "--state",
      state,
      "--prototype",
      ".mf-dev-flow/prototype-runs/prototype-fixture/screenshots/library.png",
      "--ui",
      ".mf-dev-flow/delivery-runs/delivery-gate-fixture/screenshots/library-ui.png",
      "--ui-project",
      "mini",
      "--action",
      "从书库入口进入默认状态",
      "--region-report",
      "region-report.json",
    );

  saveReport("library-default");
  const passed = compare("library-default");
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /passed.*业务区块 2 个/);
  const reviewsFile = path.join(root, "delivery-runs", "delivery-gate-fixture", "visual-region-reviews.json");
  const reviews = JSON.parse(fs.readFileSync(reviewsFile, "utf8"));
  assert.equal(reviews.reviews[0].status, "passed");
  assert.equal(reviews.reviews[0].regions[1].id, "bottom-navigation");
  assert.equal(reviews.reviews[0].analyzer.model, "semantic-regions-v1");
  assert.ok(reviews.reviews[0].pairId);
  const verification = fs.readFileSync(
    path.join(root, "delivery-runs", "delivery-gate-fixture", "verification.md"),
    "utf8",
  );
  assert.match(verification, /mf-dev-flow:visual-region-review:start/);
  assert.match(verification, /bottom-navigation/);
  assert.ok(!fs.existsSync(path.join(root, "delivery-runs", "delivery-gate-fixture", "screenshots", "visual-diffs")));

  saveReport("library-layout-mismatch", "failed");
  const failed = compare("library-layout-mismatch");
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /failed/);

  saveReport("library-uncertain", "uncertain");
  const uncertain = compare("library-uncertain");
  assert.equal(uncertain.status, 1);
  assert.match(uncertain.stdout, /uncertain/);

  saveReport("different-state");
  const mismatchedState = compare("library-required-state");
  assert.notEqual(mismatchedState.status, 0);
  assert.match(mismatchedState.stderr, /必须同为状态 library-required-state/);
});

test("其他归档截图只接受显式登记的额外状态", () => {
  const item = fixture({
    execution: {
      schemaVersion: 2,
      taskId: "mock-library",
      agent: "agent-lib",
      status: "in_progress",
    },
  });
  const result = command(
    item.cwd,
    "visual",
    "archive-additional",
    "--run",
    "delivery-gate-fixture",
    "--task",
    "mock-library",
    "--state",
    "empty-result",
    "--screenshot",
    ".mf-dev-flow/delivery-runs/delivery-gate-fixture/screenshots/library-e2e.png",
    "--reason",
    "空态需单独说明",
    "--action",
    "筛选后等待空态出现",
  );
  assert.equal(result.status, 0, result.stderr);
  const detail = runDetail(path.join(item.cwd, ".mf-dev-flow"), "delivery", "delivery-gate-fixture");
  assert.equal(detail.additionalScreenshots.length, 1);
  assert.equal(detail.additionalScreenshots[0].state, "empty-result");
});

test("skipped 与 blocked 都要求明确的阶段结论，并在看板提示未闭环", () => {
  const item = fixture({
    execution: {
      schemaVersion: 1,
      taskId: "mock-library",
      agent: "agent-lib",
      status: "done",
      changedFiles: [],
      updatedAt: "2026-09-03T10:01:00.000Z",
    },
  });
  const detail = runDetail(path.join(item.cwd, ".mf-dev-flow"), "delivery", "delivery-gate-fixture");
  assert.equal(detail.stageGate.requiresAction, true);
  assert.match(detail.stageGate.problems.join("\n"), /原型对齐/);

  const skipped = command(
    item.cwd,
    "run",
    "set",
    "--type",
    "delivery",
    "--id",
    "delivery-gate-fixture",
    "--status",
    "skipped",
    "--note",
    "跳过",
  );
  assert.notEqual(skipped.status, 0);
  assert.match(skipped.stderr, /开发阶段未闭环/);

  const blocked = command(
    item.cwd,
    "run",
    "set",
    "--type",
    "delivery",
    "--id",
    "delivery-gate-fixture",
    "--status",
    "blocked",
    "--note",
    "阻塞",
  );
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /必须有一个阶段为 blocked/);

  const input = JSON.parse(fs.readFileSync(inputFile(item), "utf8"));
  input.stages[0] = { ...input.stages[0], status: "blocked", summary: "等待接口契约确认。" };
  writeJson(inputFile(item), input);
  const markedBlocked = command(
    item.cwd,
    "run",
    "set",
    "--type",
    "delivery",
    "--id",
    "delivery-gate-fixture",
    "--status",
    "blocked",
    "--note",
    "阶段阻塞已记录",
  );
  assert.equal(markedBlocked.status, 0, markedBlocked.stderr);
});

test("通用任务可记录运行阻塞而无需伪造 blocked 阶段", () => {
  const item = fixture();
  const file = inputFile(item);
  writeJson(file, { schemaVersion: 1, deliveryContract: { id: "generic-task", version: 1 }, stages: [] });
  const result = command(item.cwd, "run", "set", "--type", "delivery", "--id", "delivery-gate-fixture", "--status", "blocked", "--note", "外部测试环境暂时不可用");
  assert.equal(result.status, 0, result.stderr);
  const input = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(input.stages, []);
  const detail = runDetail(path.join(item.cwd, ".mf-dev-flow"), "delivery", "delivery-gate-fixture");
  assert.equal(detail.run.status, "blocked");
});
