import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inferTaskTypeRef, hookStateFile, hookStateCandidates, readHookObservations, writeKernelRecords } from "../sync.mjs";
import { writeLocalKernelRecords } from "../local-file-sink.mjs";
import { normalizeDeliveryRun, validateTaskRecord } from "../record.mjs";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/mf-dev-flow.mjs");
const backfillDirs = [];
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
// 一个最小可回填的交付运行：work-plan 任务含 technical_solution → feature-development@2；
// execution 已 done（映射为 completed），changedFiles 提供 declared touchedRefs。
function backfillFixture(runStatus = "done") {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-backfill-")));
  backfillDirs.push(root);
  const store = path.join(root, ".mf-dev-flow");
  writeJson(path.join(store, "project.json"), { schemaVersion: 1 });
  const runId = "20260908-000000Z-回填样例";
  const runDir = path.join(store, "delivery-runs", runId);
  writeJson(path.join(runDir, "run.json"), { id: runId, type: "delivery", title: "回填样例", status: runStatus, createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T01:00:00Z" });
  writeJson(path.join(runDir, "work-plan.json"), { schemaVersion: 1, runId, runType: "delivery", createdAt: "2026-09-08T00:00:00Z", tasks: [{ id: "feat-a", title: "功能点 A", kind: "feature", leafFeatureIds: ["fa"], stageDefinitions: [{ id: "prototype_alignment" }, { id: "technical_solution" }, { id: "development" }, { id: "end_to_end_acceptance" }], createdAt: "2026-09-08T00:00:00Z" }] });
  writeJson(path.join(runDir, "executions", "feat-a.json"), { schemaVersion: 1, runId, taskId: "feat-a", agent: "root", status: "done", claimedAt: "2026-09-08T00:10:00Z", updatedAt: "2026-09-08T00:50:00Z", changedFiles: ["src/a.ts"], stages: { prototype_alignment: { status: "confirmed" }, technical_solution: { status: "confirmed" }, development: { status: "confirmed" }, end_to_end_acceptance: { status: "confirmed" } } });
  return { root, runId };
}
function runBackfill(root, extra = []) {
  return spawnSync(process.execPath, [cli, "kernel", "backfill", ...extra, "--json"], { cwd: root, encoding: "utf8" });
}

function kernelRecords() {
  const run = { id: "run-x", title: "T", status: "in_progress", createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T01:00:00Z" };
  const planTask = { id: "task-a", title: "A", features: [], writes: ["src"] };
  const execution = { runId: run.id, taskId: "task-a", agent: "root", sessionId: "s", status: "in_progress", claimedAt: "2026-09-08T00:10:00Z", updatedAt: "2026-09-08T00:50:00Z", changedFiles: ["src/a.ts"], stages: {}, attempts: [] };
  const { runRecord, taskRecord } = normalizeDeliveryRun({ run, planTask, execution, typeRef: { id: "generic-delivery", version: 1 } });
  runRecord.taskRefs = [`task:${taskRecord.id}`];
  return { runRecord, taskRecords: [taskRecord] };
}

const stateDirs = [];
function freshStateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-hook-state-"));
  stateDirs.push(dir);
  return dir;
}

test("inferTaskTypeRef 按任务显式声明推断，历史缺省回退旧契约", () => {
  assert.deepEqual(inferTaskTypeRef({ stageDefinitions: [] }), { id: "generic-delivery", version: 1 });
  assert.deepEqual(inferTaskTypeRef({ stageDefinitions: [{ id: "prototype_alignment" }, { id: "technical_solution" }] }), { id: "feature-development", version: 2 });
  assert.deepEqual(inferTaskTypeRef({ stageDefinitions: [{ id: "prototype_alignment" }, { id: "development" }] }), { id: "feature-development", version: 1 });
  assert.deepEqual(inferTaskTypeRef({}), { id: "feature-development", version: 1 });
});

test("hook 观测读取：路径归一、时间窗过滤与三态健康", () => {
  const previousEnv = process.env.MF_DEV_FLOW_CODEX_GATE_STATE_DIR;
  process.env.MF_DEV_FLOW_CODEX_GATE_STATE_DIR = freshStateDir();
  try {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-hook-root-"));
    const file = hookStateFile(projectRoot, "session-a");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      files: [
        { path: "./src/observed.ts", observedAt: "2026-09-08T01:00:00Z" },
        { path: "src/before-claim.ts", observedAt: "2026-09-07T00:00:00Z" },
        { path: "src/observed.ts", observedAt: "2026-09-08T02:00:00Z" },
      ],
    }));
    const seen = readHookObservations({ projectRoot, sessionId: "session-a", since: "2026-09-07T12:00:00Z" });
    assert.equal(seen.health, "observed");
    assert.deepEqual(seen.files, ["src/observed.ts"]);
    assert.deepEqual(readHookObservations({ projectRoot, sessionId: "no-such", since: null }), { health: "none", files: [] });
    assert.deepEqual(readHookObservations({ projectRoot, sessionId: null, since: null }), { health: "none", files: [] });
    fs.writeFileSync(file, "{not json");
    assert.equal(readHookObservations({ projectRoot, sessionId: "session-a" }).health, "degraded");
  } finally {
    if (previousEnv === undefined) delete process.env.MF_DEV_FLOW_CODEX_GATE_STATE_DIR;
    else process.env.MF_DEV_FLOW_CODEX_GATE_STATE_DIR = previousEnv;
  }
});

test("writeKernelRecords 校验后落盘，非法记录抛错", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-kernel-out-"));
  const { runRecord, taskRecords } = kernelRecords();
  writeKernelRecords({ projectRoot, runRecord, taskRecords });
  const written = JSON.parse(fs.readFileSync(path.join(projectRoot, ".mf-dev-flow", "tasks", "run-x", "task-a.json"), "utf8"));
  assert.deepEqual(validateTaskRecord(written), []);
  assert.equal(written.processData.complete, false);
  assert.throws(
    () => writeKernelRecords({ projectRoot, runRecord, taskRecords: [{ ...taskRecords[0], status: "finished" }] }),
    /kernel 任务记录非法/,
  );
});

test("LocalKernelFileSink 与兼容 facade 写入字节一致", () => {
  const left = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-kernel-left-"));
  const right = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-kernel-right-"));
  const { runRecord, taskRecords } = kernelRecords();
  writeLocalKernelRecords({ projectRoot: left, runRecord, taskRecords });
  writeKernelRecords({ projectRoot: right, runRecord, taskRecords });
  assert.deepEqual(
    fs.readFileSync(path.join(left, ".mf-dev-flow", "tasks", "run-x", "task-a.json")),
    fs.readFileSync(path.join(right, ".mf-dev-flow", "tasks", "run-x", "task-a.json")),
  );
});

test("LocalKernelFileSink 保留非法 task 的 kernel 错误", () => {
  const { runRecord, taskRecords } = kernelRecords();
  assert.throws(
    () => writeLocalKernelRecords({
      projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-kernel-invalid-")),
      runRecord, taskRecords: [{ ...taskRecords[0], status: "finished" }],
    }),
    /kernel 任务记录非法/,
  );
});

test("reconciled 的 processData 透传到 kernel touchedRefs", () => {
  const run = { id: "run-y", title: "T", status: "in_progress" };
  const { taskRecord } = normalizeDeliveryRun({
    run,
    planTask: { id: "t", title: "T", features: ["f1"] },
    execution: { runId: "run-y", taskId: "t", agent: "root", status: "in_progress", changedFiles: ["src/a.ts", "none"], processData: { hookHealth: "observed", provenance: "reconciled", complete: true } },
    typeRef: { id: "generic-delivery", version: 1 },
  });
  assert.equal(taskRecord.touchedRefs[0].provenance, "reconciled");
  assert.equal(taskRecord.touchedRefs.length, 1);
  assert.equal(taskRecord.processData.complete, true);
  assert.deepEqual(taskRecord.sourceRefs, ["feature:f1"]);
});

test("M5 回填 CLI：dry-run 只报告不落盘", () => {
  const { root, runId } = backfillFixture();
  const result = runBackfill(root, ["--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.mode, "dry-run");
  assert.equal(out.count, 1);
  assert.deepEqual(out.problems, []);
  assert.equal(out.runs[0].runId, runId);
  assert.deepEqual(out.runs[0].typeRef, { id: "feature-development", version: 2 });
  assert.equal(out.runs[0].status, "completed");
  assert.deepEqual(out.runs[0].taskRefs, [`task:${runId}/feat-a`]);
  assert.equal(out.runs[0].written, false);
  assert.equal(fs.existsSync(path.join(root, ".mf-dev-flow", "tasks")), false, "dry-run 不得写 tasks/");
});

test("M5 回填 CLI：写入内核记录，与实时同构且可幂等重跑", () => {
  const { root, runId } = backfillFixture();
  const result = runBackfill(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mode, "write");
  assert.equal(fs.existsSync(path.join(root, ".mf-dev-flow", "coordination")), false, "回填默认不创建 coordination/");
  const runFile = path.join(root, ".mf-dev-flow", "tasks", `${runId}.json`);
  const taskFile = path.join(root, ".mf-dev-flow", "tasks", runId, "feat-a.json");
  assert.ok(fs.existsSync(runFile) && fs.existsSync(taskFile));
  const runRecord = JSON.parse(fs.readFileSync(runFile, "utf8"));
  assert.equal(runRecord.kind, "run");
  assert.equal(runRecord.status, "completed");
  assert.deepEqual(runRecord.taskRefs, [`task:${runId}/feat-a`]);
  const task = JSON.parse(fs.readFileSync(taskFile, "utf8"));
  assert.deepEqual(validateTaskRecord(task), []);
  assert.equal(task.kind, "task");
  assert.deepEqual(task.typeRef, { id: "feature-development", version: 2 });
  assert.deepEqual(task.sourceRefs, ["feature:fa"]);
  assert.deepEqual(task.touchedRefs, [{ ref: "code:src/a.ts", provenance: "declared" }]);
  assert.equal(task.status, "completed");
  // 记录仅由归档内容决定，无墙钟时间：重跑字节一致
  const before = fs.readFileSync(taskFile);
  runBackfill(root);
  assert.deepEqual(fs.readFileSync(taskFile), before);
});

test("M5 回填 CLI：--run 定向单运行，缺失则报错退出", () => {
  const { root, runId } = backfillFixture();
  const ok = runBackfill(root, ["--run", runId]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).count, 1);
  const missing = runBackfill(root, ["--run", "不存在的运行"]);
  assert.notEqual(missing.status, 0);
});

test("M5 回填 CLI：blocked 运行迁移为 blocked，未领取任务不产任务记录", () => {
  const { root, runId } = backfillFixture("blocked");
  // 删除 execution → 该任务未领取，回填只产 run 记录（0 任务）
  fs.rmSync(path.join(root, ".mf-dev-flow", "delivery-runs", runId, "executions", "feat-a.json"));
  const out = JSON.parse(runBackfill(root).stdout);
  assert.deepEqual(out.runs[0].taskRefs, []);
  assert.equal(out.runs[0].status, "blocked");
});

test("M5 回填 CLI：子任务全部终态但 run.json 滞后 in_progress → 派生修复为 done", () => {
  const { root, runId } = backfillFixture("in_progress"); // run.json 滞后，execution 已 done
  const out = JSON.parse(runBackfill(root).stdout);
  assert.equal(out.statusRepairs, 1);
  const runJson = JSON.parse(fs.readFileSync(path.join(root, ".mf-dev-flow", "delivery-runs", runId, "run.json"), "utf8"));
  assert.equal(runJson.status, "done");
  assert.ok(runJson.notes.some(note => /主任务状态派生/.test(note.note)));
  const kernelRun = JSON.parse(fs.readFileSync(path.join(root, ".mf-dev-flow", "tasks", `${runId}.json`), "utf8"));
  assert.equal(kernelRun.status, "completed");
  // 幂等：二次回填不再派生
  const again = JSON.parse(runBackfill(root).stdout);
  assert.equal(again.statusRepairs, 0);
});

test("M5 回填 CLI：子任务 blocked → 主任务派生为 blocked", () => {
  const { root, runId } = backfillFixture("in_progress");
  fs.writeFileSync(path.join(root, ".mf-dev-flow", "delivery-runs", runId, "executions", "feat-a.json"), JSON.stringify({ schemaVersion: 1, runId, taskId: "feat-a", agent: "root", status: "blocked", summary: "被接口阻塞" }));
  const out = JSON.parse(runBackfill(root).stdout);
  assert.equal(out.statusRepairs, 1);
  const runJson = JSON.parse(fs.readFileSync(path.join(root, ".mf-dev-flow", "delivery-runs", runId, "run.json"), "utf8"));
  assert.equal(runJson.status, "blocked");
  const kernelRun = JSON.parse(fs.readFileSync(path.join(root, ".mf-dev-flow", "tasks", `${runId}.json`), "utf8"));
  assert.equal(kernelRun.status, "blocked");
});

test("M5 回填 CLI：被取代（skipped）运行不可被派生复活", () => {
  const { root, runId } = backfillFixture("skipped");
  const out = JSON.parse(runBackfill(root).stdout);
  assert.equal(out.statusRepairs, 0);
  const runJson = JSON.parse(fs.readFileSync(path.join(root, ".mf-dev-flow", "delivery-runs", runId, "run.json"), "utf8"));
  assert.equal(runJson.status, "skipped");
  const kernelRun = JSON.parse(fs.readFileSync(path.join(root, ".mf-dev-flow", "tasks", `${runId}.json`), "utf8"));
  assert.equal(kernelRun.status, "superseded");
});
