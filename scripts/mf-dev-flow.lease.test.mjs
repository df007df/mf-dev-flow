import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { projectRootForDeliveryTarget } from "../modules/runtime/delivery/helpers.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "mf-dev-flow.mjs");
const temporaryDirectories = [];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture({ overlapping = true } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-lease-"));
  const runId = "delivery-lease-fixture";
  const runDir = path.join(cwd, ".mf-dev-flow", "delivery-runs", runId);
  temporaryDirectories.push(cwd);
  writeJson(path.join(cwd, ".mf-dev-flow", "project.json"), { schemaVersion: 1 });
  writeJson(path.join(cwd, ".mf-dev-flow", "current.json"), {
    schemaVersion: 1,
    active: { type: "delivery", id: runId },
  });
  writeJson(path.join(runDir, "run.json"), {
    schemaVersion: 1,
    id: runId,
    type: "delivery",
    status: "in_progress",
    notes: [],
  });
  writeJson(path.join(runDir, "work-plan.json"), {
    schemaVersion: 1,
    tasks: [
      { id: "task-a", title: "Task A", writes: ["src/shared"], features: ["a"] },
      {
        id: "task-b",
        title: "Task B",
        writes: [overlapping ? "src/shared" : "src/other"],
        features: ["b"],
      },
    ],
  });
  writeJson(path.join(runDir, "executions", "task-a.json"), {
    schemaVersion: 1,
    runId,
    taskId: "task-a",
    agent: "agent-a",
    sessionId: "session-a",
    status: "in_progress",
    changedFiles: [],
    tests: null,
    notes: [],
  });
  writeJson(path.join(runDir, "executions", "task-b.json"), {
    schemaVersion: 1,
    runId,
    taskId: "task-b",
    agent: "agent-b",
    sessionId: "session-b",
    status: "in_progress",
    changedFiles: [],
    tests: null,
    notes: [],
  });
  return { cwd, runId, runDir };
}

function parallelRunFixture({
  trialTaskId = "trial-layout",
  trialSession = "trial-session",
  readerTaskId = "reader-layout",
  readerWrites = ["src/pages/v2/reader"],
  readerSession = "reader-session",
} = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-parallel-lease-"));
  const trialRunId = "trial-delivery";
  const readerRunId = "reader-delivery";
  const trialRunDir = path.join(cwd, ".mf-dev-flow", "delivery-runs", trialRunId);
  const readerRunDir = path.join(cwd, ".mf-dev-flow", "delivery-runs", readerRunId);
  temporaryDirectories.push(cwd);
  writeJson(path.join(cwd, ".mf-dev-flow", "project.json"), { schemaVersion: 1 });
  writeJson(path.join(cwd, ".mf-dev-flow", "current.json"), {
    schemaVersion: 1,
    active: { type: "delivery", id: readerRunId },
  });
  for (const [runId, runDir, taskId, writes, sessionId] of [
    [trialRunId, trialRunDir, trialTaskId, ["src/pages/v2/shelf"], trialSession],
    [readerRunId, readerRunDir, readerTaskId, readerWrites, readerSession],
  ]) {
    writeJson(path.join(runDir, "run.json"), {
      schemaVersion: 1,
      id: runId,
      type: "delivery",
      status: "in_progress",
      notes: [],
    });
    writeJson(path.join(runDir, "work-plan.json"), {
      schemaVersion: 1,
      tasks: [{ id: taskId, title: taskId, writes, features: [] }],
    });
    writeJson(path.join(runDir, "executions", `${taskId}.json`), {
      schemaVersion: 1,
      runId,
      taskId,
      agent: `${taskId}-agent`,
      sessionId,
      status: "in_progress",
      changedFiles: [],
      tests: null,
      notes: [],
    });
  }
  return { cwd, readerRunDir, readerRunId, trialRunDir, trialRunId, trialTaskId };
}

function command(item, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: item.cwd,
    encoding: "utf8",
  });
  const source = result.stdout.trim();
  return { ...result, json: source.startsWith("{") ? JSON.parse(source) : null };
}

// 跨运行写入范围预检：两个进行中运行，各自可继续登记通用任务。
function planOverlapFixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-plan-overlap-"));
  temporaryDirectories.push(cwd);
  writeJson(path.join(cwd, ".mf-dev-flow", "project.json"), { schemaVersion: 1 });
  writeJson(path.join(cwd, ".mf-dev-flow", "current.json"), {
    schemaVersion: 1,
    active: { type: "delivery", id: "run-alpha" },
  });
  const runs = [
    ["run-alpha", ["src/pages/v2"]],
    ["run-beta", ["src/pages/v2/review"]],
  ];
  for (const [runId, writes] of runs) {
    const runDir = path.join(cwd, ".mf-dev-flow", "delivery-runs", runId);
    writeJson(path.join(runDir, "run.json"), {
      schemaVersion: 1,
      id: runId,
      type: "delivery",
      status: "in_progress",
      notes: [],
    });
    writeJson(path.join(runDir, "delivery-input.json"), {
      schemaVersion: 1,
      intensity: "focused",
      source: "manual",
      deliveryContract: { id: "generic-task", version: 1 },
      tasks: [],
    });
    writeJson(path.join(runDir, "work-plan.json"), {
      schemaVersion: 1,
      runId,
      runType: "delivery",
      tasks: [
        { id: "seeded", title: "seeded", kind: "generic", scope: "governance", writes },
      ],
    });
  }
  return { cwd };
}

function planCommand(item, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: item.cwd,
    encoding: "utf8",
  });
}

function leaseStoreLockFile(item) {
  const leaseStore = path.join(
    fs.realpathSync(item.cwd),
    ".mf-dev-flow",
    "delivery-runs",
    item.runId,
    "file-leases.json",
  );
  return path.join(
    item.cwd,
    ".mf-dev-flow",
    "file-lease-store-locks",
    `${crypto.createHash("sha256").update(leaseStore).digest("hex")}.lock`,
  );
}

function fileTouchesPath(item) {
  return path.join(item.cwd, ".mf-dev-flow", "file-touches.json");
}

function fileTouchLockFile(item) {
  const ledger = path.join(
    fs.realpathSync(item.cwd),
    ".mf-dev-flow",
    "file-touches.json",
  );
  return path.join(
    item.cwd,
    ".mf-dev-flow",
    "file-touch-locks",
    `${crypto.createHash("sha256").update(ledger).digest("hex")}.lock`,
  );
}

afterEach(() => {
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

test("绝对交付目标可匹配当前工作区代码根", () => {
  const root = { path: ".", role: "primary", deliveryRoles: ["ui-client"] };
  const project = { codeRoots: [root] };

  assert.equal(projectRootForDeliveryTarget(project, process.cwd()), root);
});

test("同一运行内不同任务会话可共享同文件写入", () => {
  const item = fixture();
  const file = path.join(item.cwd, "src", "shared", "route.ts");
  const first = command(item, [
    "work",
    "lease",
    "--for-write",
    "--session",
    "session-a",
    "--file",
    file,
  ]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.json.verdict, "allow");

  const second = command(item, [
    "work",
    "lease",
    "--for-write",
    "--session",
    "session-b",
    "--file",
    file,
  ]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.json.verdict, "allow");
  assert.equal(second.json.taskId, "task-b");

  const conflicts = command(item, ["work", "conflict-status", "--run", item.runId]);
  assert.equal(conflicts.status, 0, conflicts.stderr);
  assert.equal(conflicts.json.crossRunTouches.length, 0);
  // 同运行两次触碰都留痕，且都带稳定 id，供 conflict-resolve 引用。
  assert.equal(conflicts.json.touches.length, 2);
  assert.deepEqual(
    conflicts.json.touches.map((touch) => touch.id),
    ["touch-0", "touch-1"],
  );
});

test("同一会话可绑定同运行多个任务并共享文件租约", () => {
  const item = fixture();
  const taskBFile = path.join(item.runDir, "executions", "task-b.json");
  writeJson(taskBFile, {
    ...JSON.parse(fs.readFileSync(taskBFile, "utf8")),
    sessionId: "session-a",
  });
  const file = path.join(item.cwd, "src", "shared", "route.ts");

  for (const taskId of ["task-a", "task-b"]) {
    const result = command(item, [
      "work",
      "lease",
      "--for-write",
      "--session",
      "session-a",
      "--file",
      file,
      "--run",
      item.runId,
      "--task",
      taskId,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.verdict, "allow");
    assert.equal(result.json.taskId, taskId);
  }
});

test("全局 current 指向另一任务时，按会话和文件为所属任务记录触碰", () => {
  const item = parallelRunFixture();
  const file = path.join(item.cwd, "src", "pages", "v2", "shelf", "index.scss");
  const result = command(item, [
    "work",
    "lease",
    "--for-write",
    "--session",
    "trial-session",
    "--file",
    file,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.verdict, "allow");
  assert.equal(result.json.taskId, "trial-layout");
  // 触碰台账是全局的；租约文件不再被写入。
  const ledgerFile = fileTouchesPath(item);
  assert.equal(fs.existsSync(ledgerFile), true);
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  assert.equal(ledger.schemaVersion, 1);
  const touch = ledger.touches.at(-1);
  assert.equal(typeof touch.at, "string");
  assert.equal(Array.isArray(touch.observations), true);
  assert.equal(
    touch.file,
    path.join(fs.realpathSync(item.cwd), "src", "pages", "v2", "shelf", "index.scss"),
  );
  assert.equal(touch.runId, "trial-delivery");
  assert.equal(touch.taskId, "trial-layout");
  assert.equal(touch.sessionId, "trial-session");
  assert.equal(
    fs.existsSync(path.join(item.trialRunDir, "file-leases.json")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(item.readerRunDir, "file-leases.json")),
    false,
  );
});

test("原型待复评不再拒绝写入，记为 prototype-reassessment-required 观测", () => {
  const item = fixture();
  // 产品任务引用叶子功能但缺少当前功能地图 → taskPrototypeProblems 非空。
  const planFile = path.join(item.runDir, "work-plan.json");
  writeJson(planFile, {
    schemaVersion: 1,
    tasks: [
      {
        id: "task-a",
        title: "Task A",
        scope: "product",
        leafFeatureIds: ["a1"],
        writes: ["src/shared"],
        features: ["a"],
      },
    ],
  });
  const file = path.join(item.cwd, "src", "shared", "route.ts");
  const result = command(item, [
    "work",
    "lease",
    "--for-write",
    "--session",
    "session-a",
    "--file",
    file,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.verdict, "allow");
  assert.ok(result.json.observations.includes("prototype-reassessment-required"));
  // 降级为观测，不再返回拒绝用的 reason。
  assert.equal("reason" in result.json, false);
});

test("未绑定会话在有活跃运行时也记录触碰，身份为空并标记 no-active-run", () => {
  const item = fixture();
  const file = path.join(item.cwd, "src", "shared", "route.ts");
  // 存在进行中运行，但该会话未绑定到任何任务：旧实现会以 SESSION_NOT_BOUND 拒绝，
  // 新实现必须仍然放行并留下一条身份为空的全局触碰。
  const result = command(item, [
    "work",
    "lease",
    "--for-write",
    "--session",
    "session-unbound",
    "--file",
    file,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.verdict, "allow");
  assert.equal(result.json.taskId, null);
  assert.ok(result.json.observations.includes("no-active-run"));

  const ledgerFile = fileTouchesPath(item);
  assert.equal(fs.existsSync(ledgerFile), true);
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  const touch = ledger.touches.at(-1);
  assert.equal(
    touch.file,
    path.join(fs.realpathSync(item.cwd), "src", "shared", "route.ts"),
  );
  assert.equal(touch.runId, null);
  assert.equal(touch.taskId, null);
  assert.equal(touch.agent, null);
  assert.equal(touch.sessionId, "session-unbound");
  assert.equal(typeof touch.at, "string");
  assert.equal(Array.isArray(touch.observations), true);
  assert.ok(touch.observations.includes("no-active-run"));
  assert.equal(fs.existsSync(path.join(item.runDir, "file-leases.json")), false);
});

test("跨运行写入范围重叠时不再拒绝，记为 cross-run-scope 观测", () => {
  const item = parallelRunFixture({
    readerWrites: ["src/pages/v2/shelf"],
  });
  const file = path.join(item.cwd, "src", "pages", "v2", "shelf", "index.scss");
  const readerLease = command(item, [
    "work",
    "lease",
    "--for-write",
    "--session",
    "reader-session",
    "--file",
    file,
  ]);
  assert.equal(readerLease.status, 0, readerLease.stderr);
  assert.equal(readerLease.json.verdict, "allow");
  assert.ok(readerLease.json.observations.includes("cross-run-scope"));
});

test("跨运行同名任务和同一会话也不再拒绝，记为 cross-run-scope 观测", () => {
  const item = parallelRunFixture({
    readerTaskId: "trial-layout",
    readerWrites: ["src/pages/v2/shelf"],
    readerSession: "trial-session",
  });
  const file = path.join(item.cwd, "src", "pages", "v2", "shelf", "index.scss");
  const result = command(item, [
    "work",
    "lease",
    "--for-write",
    "--session",
    "trial-session",
    "--file",
    file,
    "--run",
    item.readerRunId,
    "--task",
    "trial-layout",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.verdict, "allow");
  assert.ok(result.json.observations.includes("cross-run-scope"));
});

test("文件租约的原子锁被占用时仍然放行，触碰记录为 no-op", () => {
  const item = fixture();
  const file = path.join(item.cwd, "src", "shared", "route.ts");
  // 新实现只用文件触碰台账锁；持锁时 recordFileTouch 直接返回，绝不阻塞调用方。
  writeJson(fileTouchLockFile(item), {
    acquiredAt: new Date().toISOString(),
    pid: 1,
  });

  const result = command(item, [
    "work",
    "lease",
    "--for-write",
    "--session",
    "session-a",
    "--file",
    file,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.verdict, "allow");
  // 触碰锁被占用时放弃写台账：不阻塞调用方，也不留下半写入。
  assert.equal(fs.existsSync(fileTouchesPath(item)), false);
  assert.equal(fs.existsSync(path.join(item.runDir, "file-leases.json")), false);
});

test("旧租约存储锁不再影响写入，触碰仍被记录", () => {
  const item = fixture({ overlapping: false });
  const file = path.join(item.cwd, "src", "shared", "route.ts");
  // 遗留的租约存储锁对新写入路径应当完全惰性；若实现重新引入存储锁拒绝，本用例会失败。
  writeJson(leaseStoreLockFile(item), {
    acquiredAt: new Date().toISOString(),
    pid: 1,
  });

  const result = command(item, [
    "work",
    "lease",
    "--for-write",
    "--session",
    "session-a",
    "--file",
    file,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.verdict, "allow");
  assert.notEqual(result.json.reason?.code, "FILE_LEASE_ACQUISITION_IN_PROGRESS");
  assert.equal("retryAfterSeconds" in result.json, false);
  // 触碰不经过租约存储锁，必须照常记录到全局台账。
  const ledgerFile = fileTouchesPath(item);
  assert.equal(fs.existsSync(ledgerFile), true);
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  assert.ok(
    ledger.touches.some(
      (touch) =>
        touch.file ===
        path.join(fs.realpathSync(item.cwd), "src", "shared", "route.ts"),
    ),
  );
  assert.equal(fs.existsSync(path.join(item.runDir, "file-leases.json")), false);
});

test("会话释放恒为 allow 且不改动任何租约文件", () => {
  const item = fixture();
  const leaseFile = path.join(item.runDir, "file-leases.json");
  const leaseContent = {
    schemaVersion: 1,
    runId: item.runId,
    updatedAt: null,
    leases: [{ file: "src/shared/route.ts", taskId: "task-a", sessionId: "session-a" }],
    conflicts: [],
  };
  writeJson(leaseFile, leaseContent);
  writeJson(leaseStoreLockFile(item), {
    acquiredAt: new Date().toISOString(),
    pid: 1,
  });

  const result = command(item, ["work", "lease", "--release-session", "session-a"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.verdict, "allow");
  assert.equal(result.json.released, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(leaseFile, "utf8")), leaseContent);
});

test("冲突状态报告跨运行触碰，冲突解决改为给触碰追加确认记录", () => {
  const item = fixture();
  const touchedFile = path.join(fs.realpathSync(item.cwd), "src", "shared", "route.ts");
  // 触碰台账是全局 append-only 的；每个条目按下标获得稳定 id（touch-<index>）。
  // updatedAt 故意留成旧哨兵值，用于验证确认会刷新台账时间。
  writeJson(fileTouchesPath(item), {
    schemaVersion: 1,
    updatedAt: "2020-01-01T00:00:00.000Z",
    touches: [
      {
        // 历史条目若自带 id，输出时必须让位于按下标合成的稳定 id（防止 status/resolve 脱钩）。
        id: "legacy-bogus",
        at: new Date().toISOString(),
        file: touchedFile,
        runId: item.runId,
        taskId: "task-a",
        sessionId: "session-a",
        agent: "agent-a",
        observations: ["cross-run-scope"],
      },
    ],
  });

  const status = command(item, ["work", "conflict-status", "--run", item.runId]);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.json.schemaVersion, 1);
  assert.deepEqual(status.json.run, {
    id: item.runId,
    type: "delivery",
    status: "in_progress",
  });
  // 本运行的触碰带稳定 id 浮出，未确认的跨运行触碰可被定位。
  assert.equal(status.json.touches.length, 1);
  assert.equal(status.json.touches[0].id, "touch-0");
  assert.equal(status.json.touches[0].file, touchedFile);
  assert.equal(status.json.crossRunTouches.length, 1);
  assert.equal(status.json.crossRunTouches[0].id, "touch-0");
  assert.equal(status.json.crossRunTouches[0].runId, item.runId);
  assert.equal(status.json.crossRunTouches[0].taskId, "task-a");
  assert.equal(status.json.crossRunTouches[0].sessionId, "session-a");
  assert.ok(
    status.json.crossRunTouches[0].observations.includes("cross-run-scope"),
  );

  const conflictId = status.json.crossRunTouches[0].id;
  const resolved = command(item, [
    "work",
    "conflict-resolve",
    "--run",
    item.runId,
    "--conflict",
    conflictId,
    "--summary",
    "已确认：与另一运行共享同一文件，按目录切分后继续",
  ]);
  assert.equal(resolved.status, 0, resolved.stderr);

  const ledger = JSON.parse(fs.readFileSync(fileTouchesPath(item), "utf8"));
  const confirmed = ledger.touches[0];
  // 输出层的合成 id 不落盘；确认只改确认字段，不改条目原样（含历史遗留 id）。
  assert.equal(confirmed.id, "legacy-bogus");
  assert.equal(confirmed.file, touchedFile);
  assert.equal(typeof confirmed.confirmedAt, "string");
  assert.equal(confirmed.confirmedBy, null);
  assert.equal(
    confirmed.confirmation,
    "已确认：与另一运行共享同一文件，按目录切分后继续",
  );
  // 确认必须刷新台账 updatedAt（与 recordFileTouch 一致），不能停留在旧哨兵值。
  assert.equal(typeof ledger.updatedAt, "string");
  assert.notEqual(ledger.updatedAt, "2020-01-01T00:00:00.000Z");
  // 确认后该触碰不再是未确认冲突。
  const after = command(item, ["work", "conflict-status", "--run", item.runId]);
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.json.crossRunTouches.length, 0);

  // 重复确认必须失败，镜像旧的"已处理不能重复关闭"语义。
  const again = command(item, [
    "work",
    "conflict-resolve",
    "--run",
    item.runId,
    "--conflict",
    conflictId,
    "--summary",
    "重复确认",
  ]);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /触碰已确认，不能重复确认/);

  // 不存在的触碰 id 必须失败，而不是静默无操作。
  const missing = command(item, [
    "work",
    "conflict-resolve",
    "--run",
    item.runId,
    "--conflict",
    "touch-999",
    "--summary",
    "不应成功",
  ]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /找不到触碰记录/);
});

test("merge-check 把未确认跨运行触碰列为审计提醒，确认后消失", () => {
  const item = fixture();
  // 两个任务都终态，mergeProblems 才无阻塞，merge-check 才会走到审计提醒输出。
  for (const taskId of ["task-a", "task-b"]) {
    const file = path.join(item.runDir, "executions", `${taskId}.json`);
    writeJson(file, {
      ...JSON.parse(fs.readFileSync(file, "utf8")),
      status: "done",
      summary: "fixture done",
      tests: "fixture",
    });
  }
  const touchedFile = path.join(
    fs.realpathSync(item.cwd),
    "src",
    "shared",
    "route.ts",
  );
  writeJson(fileTouchesPath(item), {
    schemaVersion: 1,
    updatedAt: "2020-01-01T00:00:00.000Z",
    touches: [
      {
        at: new Date().toISOString(),
        file: touchedFile,
        runId: item.runId,
        taskId: "task-a",
        sessionId: "session-a",
        agent: "agent-a",
        observations: ["cross-run-scope"],
      },
    ],
  });

  const merged = command(item, ["work", "merge-check", "--run", item.runId]);
  assert.equal(merged.status, 0, merged.stderr);
  assert.match(merged.stdout, /审计提醒（不阻塞合并，请主 agent 复核）/);
  assert.ok(
    merged.stdout.includes(
      `未确认的跨运行触碰：${touchedFile}（运行 ${item.runId} 与另一运行声明范围重叠，需 work conflict-resolve 确认）`,
    ),
    merged.stdout,
  );

  const resolved = command(item, [
    "work",
    "conflict-resolve",
    "--run",
    item.runId,
    "--conflict",
    "touch-0",
    "--summary",
    "已确认共享文件",
  ]);
  assert.equal(resolved.status, 0, resolved.stderr);

  // 确认后同一 merge-check 不再输出该提醒（提醒只针对未确认触碰）。
  const mergedAgain = command(item, ["work", "merge-check", "--run", item.runId]);
  assert.equal(mergedAgain.status, 0, mergedAgain.stderr);
  assert.equal(mergedAgain.stdout.includes("未确认的跨运行触碰："), false);
  assert.match(mergedAgain.stdout, /审计提醒：无。/);
});

test("同一文件被另一运行触碰后，后续写入记为 concurrent-same-file", () => {
  const item = parallelRunFixture({
    readerWrites: ["src/pages/v2/shelf"],
  });
  const file = path.join(item.cwd, "src", "pages", "v2", "shelf", "index.scss");
  const canonicalFile = path.join(
    fs.realpathSync(item.cwd),
    "src",
    "pages",
    "v2",
    "shelf",
    "index.scss",
  );

  // 运行 A（reader）先触碰该文件：此前的台账里没有它，不会记为并发同文件。
  const first = command(item, [
    "work",
    "lease",
    "--for-write",
    "--session",
    "reader-session",
    "--file",
    file,
  ]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.json.verdict, "allow");
  assert.equal(
    first.json.observations.includes("concurrent-same-file"),
    false,
  );

  // 运行 B（trial）随后触碰同一文件：台账里已有另一 runId 的同文件触碰。
  const second = command(item, [
    "work",
    "lease",
    "--for-write",
    "--session",
    "trial-session",
    "--file",
    file,
  ]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.json.verdict, "allow");
  assert.ok(second.json.observations.includes("concurrent-same-file"));

  const ledger = JSON.parse(fs.readFileSync(fileTouchesPath(item), "utf8"));
  const last = ledger.touches.at(-1);
  assert.equal(last.file, canonicalFile);
  assert.equal(last.runId, "trial-delivery");
  assert.ok(last.observations.includes("concurrent-same-file"));
});

test("仅在锁记录的进程已退出时回收遗留锁", () => {
  const item = fixture();
  const file = path.join(item.cwd, "src", "shared", "route.ts");
  const canonicalFile = path.join(
    fs.realpathSync(item.cwd),
    "src",
    "shared",
    "route.ts",
  );
  const lock = path.join(
    item.cwd,
    ".mf-dev-flow",
    "file-lease-locks",
    `${crypto.createHash("sha256").update(canonicalFile).digest("hex")}.lock`,
  );
  writeJson(lock, { acquiredAt: "2020-01-01T00:00:00.000Z", pid: 99_999_999 });

  const result = command(item, [
    "work",
    "lease",
    "--for-write",
    "--session",
    "session-a",
    "--file",
    file,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.verdict, "allow");
});

test("同一会话跨重叠运行不再拒绝，记为 cross-run-scope 观测", () => {
  const item = parallelRunFixture({
    readerWrites: ["src/pages/v2/shelf"],
    readerSession: "trial-session",
  });
  const file = path.join(item.cwd, "src", "pages", "v2", "shelf", "index.scss");
  const result = command(item, [
    "work",
    "lease",
    "--for-write",
    "--session",
    "trial-session",
    "--file",
    file,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.verdict, "allow");
  assert.ok(result.json.observations.includes("cross-run-scope"));

  const explicit = command(item, [
    "work",
    "lease",
    "--for-write",
    "--session",
    "trial-session",
    "--file",
    file,
    "--run",
    item.trialRunId,
    "--task",
    "trial-layout",
  ]);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.equal(explicit.json.verdict, "allow");
  assert.ok(explicit.json.observations.includes("cross-run-scope"));
});

test("重排允许同运行任务继续共享写入范围", () => {
  const item = fixture({ overlapping: false });
  const accepted = command(item, [
    "work",
    "replan",
    "--run",
    item.runId,
    "--task",
    "task-b",
    "--writes",
    "src/shared",
    "--reason",
    "运行内并发共享文件",
  ]);
  assert.equal(accepted.status, 0, accepted.stderr);
  const plan = JSON.parse(fs.readFileSync(path.join(item.runDir, "work-plan.json"), "utf8"));
  assert.deepEqual(plan.tasks.find((task) => task.id === "task-b").writes, ["src/shared"]);
  assert.equal(plan.replans.length, 1);
});

test("重排允许复用 done 任务的写入范围", () => {
  const item = fixture({ overlapping: false });
  const taskAFile = path.join(item.runDir, "executions", "task-a.json");
  writeJson(taskAFile, { ...JSON.parse(fs.readFileSync(taskAFile, "utf8")), status: "done" });

  const accepted = command(item, [
    "work",
    "replan",
    "--run",
    item.runId,
    "--task",
    "task-b",
    "--writes",
    "src/shared",
    "--reason",
    "前置任务已完成，进入后续阶段",
  ]);
  assert.equal(accepted.status, 0, accepted.stderr);
});

test("跨运行写入范围重叠时拒绝登记新任务并列出相交运行", () => {
  const item = planOverlapFixture();
  const plan = (args) => planCommand(item, args);

  const denied = plan([
    "work", "plan",
    "--run", "run-beta",
    "--task", "overlap-task",
    "--title", "重叠任务",
    "--kind", "generic",
    "--scope", "governance",
    "--writes", "src/pages/v2/review",
  ]);
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /写入范围与进行中运行重叠/);
  assert.match(denied.stderr, /run-alpha/);
  // 拒绝时不得落盘任务，避免留下半登记状态。
  const planFile = path.join(item.cwd, ".mf-dev-flow", "delivery-runs", "run-beta", "work-plan.json");
  const tasks = JSON.parse(fs.readFileSync(planFile, "utf8")).tasks;
  assert.equal(tasks.some((task) => task.id === "overlap-task"), false);
});

test("--allow-overlap 显式确认后放行并保留审计理由", () => {
  const item = planOverlapFixture();
  const runPlan = (args) => planCommand(item, args);

  const allowed = runPlan([
    "work", "plan",
    "--run", "run-beta",
    "--task", "overlap-task",
    "--title", "重叠任务",
    "--kind", "generic",
    "--scope", "governance",
    "--writes", "src/pages/v2/review",
    "--allow-overlap", "已知情：仅共享目录、实际改不同子文件",
  ]);
  assert.equal(allowed.status, 0, allowed.stderr);

  const stored = JSON.parse(fs.readFileSync(path.join(item.cwd, ".mf-dev-flow", "delivery-runs", "run-beta", "work-plan.json"), "utf8"));
  assert.equal(stored.tasks.some((task) => task.id === "overlap-task"), true);
  assert.equal(stored.overlaps.length, 1);
  assert.deepEqual(stored.overlaps[0].otherRunIds, ["run-alpha"]);
  assert.deepEqual(stored.overlaps[0].scopes, ["src/pages/v2"]);
  assert.equal(stored.overlaps[0].reason, "已知情：仅共享目录、实际改不同子文件");
});

test("不重叠的跨运行写入范围仍可直接登记", () => {
  const item = planOverlapFixture();
  const result = planCommand(item, [
    "work", "plan",
    "--run", "run-beta",
    "--task", "disjoint-task",
    "--title", "独立任务",
    "--kind", "generic",
    "--scope", "governance",
    "--writes", "src/consumer-app/services",
  ]);
  assert.equal(result.status, 0, result.stderr);
});

test("重排不能绕过跨运行预检与 work plan 保持一致", () => {
  const item = planOverlapFixture();
  const deny = planCommand(item, [
    "work", "replan",
    "--run", "run-beta",
    "--task", "seeded",
    "--writes", "src/pages/v2",
    "--reason", "扩大范围到整目录",
  ]);
  assert.notEqual(deny.status, 0);
  assert.match(deny.stderr, /写入范围与进行中运行重叠/);
  assert.match(deny.stderr, /run-alpha/);

  const allow = planCommand(item, [
    "work", "replan",
    "--run", "run-beta",
    "--task", "seeded",
    "--writes", "src/pages/v2",
    "--reason", "扩大范围到整目录",
    "--allow-overlap", "已知情：与主题运行共享目录",
  ]);
  assert.equal(allow.status, 0, allow.stderr);
  const stored = JSON.parse(fs.readFileSync(path.join(item.cwd, ".mf-dev-flow", "delivery-runs", "run-beta", "work-plan.json"), "utf8"));
  assert.equal(stored.overlaps.at(-1).via, "replan");
  assert.deepEqual(stored.overlaps.at(-1).otherRunIds, ["run-alpha"]);
});
