import test from "node:test";
import assert from "node:assert/strict";
import {
  KERNEL_SCHEMA_VERSION, newTaskRecord, validateTaskRecord, validateRunRecord,
  setTaskStatus, statusTransitionAllowed, parseRef, isValidRef,
  reconcileProcessData, normalizeDeliveryRun, deriveRunStatus,
} from "../record.mjs";

const TYPE = { id: "feature-development", version: 2 };

test("新建任务记录合法且时间线含 created", () => {
  const record = newTaskRecord({ id: "run-1/task-a", runId: "run-1", typeRef: TYPE, title: "示例", sourceRefs: ["feature:reader-core"] });
  assert.equal(validateTaskRecord(record).length, 0);
  assert.equal(record.status, "pending");
  assert.equal(record.schemaVersion, KERNEL_SCHEMA_VERSION);
  assert.equal(record.timeline[0].event, "created");
});

test("非法结构逐项被拒", () => {
  const record = newTaskRecord({ id: "r/t", runId: "r", typeRef: TYPE, title: "x" });
  record.status = "finished";
  record.sourceRefs = ["widget:1"];
  record.touchedRefs = [{ ref: "code:a.ts", provenance: "guessed" }];
  record.processData = { hookHealth: "ok", provenance: "reconciled", complete: true };
  record.timeline = [{ at: "2026-09-08T00:00:00Z", event: "b" }, { at: "2026-09-07T00:00:00Z", event: "a" }];
  const problems = validateTaskRecord(record);
  assert.ok(problems.some(p => p.includes("status 非法")));
  assert.ok(problems.some(p => p.includes("sourceRefs")));
  assert.ok(problems.some(p => p.includes("provenance 非法")));
  assert.ok(problems.some(p => p.includes("时间乱序")));
});

test("complete=true 要求 hook/reconciled 来源", () => {
  const record = newTaskRecord({ id: "r/t", runId: "r", typeRef: TYPE, title: "x" });
  record.processData = { hookHealth: "ok", provenance: "declared", complete: true };
  assert.ok(validateTaskRecord(record).some(p => p.includes("complete=true")));
});

test("ref 形状校验", () => {
  assert.deepEqual(parseRef("prototype:g1"), { prefix: "prototype", id: "g1" });
  assert.deepEqual(parseRef("feature-group:reading"), { prefix: "feature-group", id: "reading" });
  assert.equal(parseRef("code:a b.ts"), null);
  assert.equal(parseRef("nonsense:x"), null);
  assert.equal(isValidRef("task:r/t"), true);
});

test("状态机：合法迁移记录时间线，非法迁移抛错", () => {
  const record = newTaskRecord({ id: "r/t", runId: "r", typeRef: TYPE, title: "x" });
  setTaskStatus(record, "claimed");
  setTaskStatus(record, "in_progress");
  setTaskStatus(record, "blocked");
  setTaskStatus(record, "in_progress");
  setTaskStatus(record, "completed");
  assert.equal(record.status, "completed");
  assert.equal(statusTransitionAllowed("completed", "in_progress"), false);
  assert.throws(() => setTaskStatus(record, "in_progress"), /非法任务状态迁移/);
  assert.ok(record.timeline.some(e => e.event === "status:completed"));
});

test("对账三态：reconciled / missing 拒绝 / declared-only 降级", () => {
  const ok = reconcileProcessData({ declared: ["src/a.ts", "src/b.ts"], observed: ["src/b.ts", "src/a.ts"] });
  assert.equal(ok.provenance, "reconciled");
  assert.equal(ok.complete, true);
  const missing = reconcileProcessData({ declared: ["src/a.ts"], observed: ["src/a.ts", "src/c.ts"] });
  assert.deepEqual(missing.missing, ["src/c.ts"]);
  assert.equal(missing.complete, false);
  const extra = reconcileProcessData({ declared: ["src/a.ts", "src/z.ts"], observed: ["src/a.ts"] });
  assert.deepEqual(extra.extra, ["src/z.ts"]);
  assert.equal(extra.provenance, "declared");
  const degraded = reconcileProcessData({ declared: ["src/a.ts"], observed: null, hookHealth: "degraded" });
  assert.equal(degraded.complete, false);
  assert.deepEqual(degraded.changedFiles, ["src/a.ts"]);
});

test("旧 delivery 记录迁移为合法 kernel 记录", () => {
  const run = { id: "20260907-075204Z-登录承接", type: "delivery", title: "登录承接", status: "done", createdAt: "2026-09-07T07:52:04Z", updatedAt: "2026-09-07T12:00:00Z" };
  const planTask = { id: "account-trial", title: "登录承接实现", features: ["account-trial-entry"], writes: ["src/pages/v2/"], status: "confirmed" };
  const execution = {
    schemaVersion: 2, runId: run.id, taskId: planTask.id, agent: "root", sessionId: "sess-1",
    status: "confirmed", targetPhase: "delivery", claimedAt: "2026-09-07T08:00:00Z", updatedAt: "2026-09-07T11:50:00Z",
    summary: "结论：完成", changedFiles: ["src/pages/v2/home/index.tsx"], tests: "39/39",
    notes: [], checkpoints: [], stages: { development: { status: "confirmed", artifacts: [{ kind: "dataflow_svg", file: "flow.svg" }] } },
    attempts: [{ id: "attempt-1", agent: "root", status: "done", sessionId: "sess-1", startedAt: "2026-09-07T08:00:05Z", endedAt: "2026-09-07T11:49:00Z" }],
  };
  const { runRecord, taskRecord } = normalizeDeliveryRun({ run, planTask, execution, typeRef: TYPE });
  assert.equal(validateRunRecord(runRecord).length, 0);
  assert.equal(validateTaskRecord(taskRecord).length, 0);
  assert.deepEqual(runRecord.taskRefs, ["task:20260907-075204Z-登录承接/account-trial"]);
  assert.equal(taskRecord.status, "completed");
  assert.deepEqual(taskRecord.sourceRefs, ["feature:account-trial-entry"]);
  assert.deepEqual(taskRecord.touchedRefs, [{ ref: "code:src/pages/v2/home/index.tsx", provenance: "declared" }]);
  assert.equal(taskRecord.processData.complete, false);
  assert.equal(taskRecord.outputs.artifacts[0].kind, "dataflow_svg");
  assert.equal(taskRecord.extensions.legacy.summary, "结论：完成");
  const { runRecord: openRun } = normalizeDeliveryRun({ run: { ...run, status: "blocked" }, planTask, execution, typeRef: TYPE });
  assert.equal(openRun.status, "blocked");
});

test("deriveRunStatus：全部终态才派生，终态结果按 blocked > completed > superseded > abandoned", () => {
  // 未全部终态 → 保留执行中状态，不派生
  assert.equal(deriveRunStatus(["in_progress", "completed"]), null);
  assert.equal(deriveRunStatus(["completed", "pending"]), null);
  assert.equal(deriveRunStatus([]), null);
  assert.equal(deriveRunStatus(null), null);
  // 全 completed
  assert.equal(deriveRunStatus(["completed", "completed"]), "completed");
  // 存在 blocked（即使其余全完成）
  assert.equal(deriveRunStatus(["completed", "blocked"]), "blocked");
  // 完成 + 放弃/取代混合 → completed
  assert.equal(deriveRunStatus(["completed", "abandoned"]), "completed");
  assert.equal(deriveRunStatus(["completed", "superseded"]), "completed");
  // 无 completed：superseded 优先，否则 abandoned
  assert.equal(deriveRunStatus(["superseded", "abandoned"]), "superseded");
  assert.equal(deriveRunStatus(["abandoned", "abandoned"]), "abandoned");
  // 运行被取代优先于一切派生
  assert.equal(deriveRunStatus(["completed"], { superseded: true }), "superseded");
});

test("normalizeDeliveryRun：skipped（被取代）运行映射为 superseded", () => {
  const run = { id: "r-skip", type: "delivery", title: "被取代", status: "skipped" };
  const { runRecord } = normalizeDeliveryRun({ run, planTask: null, execution: null, typeRef: { id: "generic-delivery", version: 1 } });
  assert.equal(runRecord.status, "superseded");
  assert.deepEqual(validateRunRecord(runRecord), []);
});
