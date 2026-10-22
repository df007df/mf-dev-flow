import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDeliveryRun } from "../record.mjs";
import { projectTaskLifecycleEvent } from "../projection.mjs";

function kernelRecords() {
  const run = { id: "run-x", title: "T", status: "in_progress", createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T01:00:00Z" };
  const planTask = { id: "task-a", title: "A", features: [], writes: ["src"] };
  const execution = {
    runId: "run-x", taskId: "task-a", agent: "root", sessionId: "s", status: "in_progress",
    claimedAt: "2026-09-08T00:10:00Z", updatedAt: "2026-09-08T00:50:00Z",
    changedFiles: ["src/a.ts"], stages: {}, attempts: [],
  };
  return normalizeDeliveryRun({
    run, planTask, execution, typeRef: { id: "generic-delivery", version: 1 },
  });
}

function project(overrides = {}) {
  const { runRecord, taskRecord } = kernelRecords();
  const base = {
    runRecord,
    taskRecord,
    publication: { reason: "claimed", taskId: "task-a" },
    origin: { installationId: "inst-test", actor: { kind: "local-agent", id: "root" } },
  };
  return projectTaskLifecycleEvent({ ...base, ...overrides });
}

test("投影只发布白名单字段且不泄露 kernel 私有数据", () => {
  const { runRecord, taskRecord } = kernelRecords();
  const event = project({
    runRecord: { ...runRecord, legacy: { runDir: "/tmp/run-secret" } },
    taskRecord: {
      ...taskRecord,
      sessionId: "session-secret",
      legacy: { executionFile: "/tmp/secret/execution.json" },
      extensions: { rawPrompt: "never publish" },
      outputs: { reports: [{ file: "/tmp/report" }], artifacts: [] },
      touchedRefs: [{ ref: "code:src/a.ts", provenance: "declared" }],
      timeline: [{ at: "2026-09-08T00:00:00Z", event: "private", by: "agent:root" }],
    },
  });
  assert.equal(event.subject.ref, "mf-dev-flow:task:kernel/run-x/task-a");
  assert.equal(event.snapshot.status, "in_progress");
  assert.deepEqual(event.refs, []);
  assert.deepEqual(event.evidence, []);
  const serialized = JSON.stringify(event);
  for (const secret of ["session-secret", "/tmp/secret", "never publish", "/tmp/report", "src/a.ts", "private"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("claimed 发布只接受领取中的 task 状态", () => {
  assert.equal(project().transition.reason, "claimed");
  const { taskRecord } = kernelRecords();
  assert.throws(() => project({ taskRecord: { ...taskRecord, status: "completed" } }), /claimed/);
});

test("finished 发布只接受终态 task 状态", () => {
  const { taskRecord } = kernelRecords();
  const event = project({
    taskRecord: { ...taskRecord, status: "completed" },
    publication: { reason: "finished", taskId: "task-a" },
  });
  assert.equal(event.transition.reason, "finished");
  assert.throws(() => project({ publication: { reason: "finished", taskId: "task-a" } }), /finished/);
});

test("publication.taskId 必须严格匹配 kernel task id", () => {
  assert.throws(() => project({ publication: { reason: "claimed", taskId: "other-task" } }), /taskId/);
});
