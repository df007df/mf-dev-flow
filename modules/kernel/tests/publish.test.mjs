import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { createLocalOutboxPublisher } from "../../coordination/local-outbox.mjs";
import { normalizeDeliveryRun } from "../record.mjs";
import { publishKernelRecords, selectPublicationTask } from "../publish.mjs";

const cleanup = [];
after(() => {
  for (const directory of cleanup) fs.rmSync(directory, { recursive: true, force: true });
});

function records() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-publish-"));
  cleanup.push(projectRoot);
  const run = {
    id: "run-x", title: "T", status: "in_progress",
    createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T01:00:00Z",
  };
  const planTask = { id: "task-a", title: "A", features: [], writes: ["src"] };
  const execution = {
    runId: run.id, taskId: "task-a", agent: "root", sessionId: "s",
    status: "in_progress", claimedAt: "2026-09-08T00:10:00Z",
    updatedAt: "2026-09-08T00:50:00Z", changedFiles: ["src/a.ts"], stages: {}, attempts: [],
  };
  const { runRecord, taskRecord } = normalizeDeliveryRun({
    run, planTask, execution, typeRef: { id: "generic-delivery", version: 1 },
  });
  runRecord.taskRefs = [`task:${taskRecord.id}`];
  return {
    projectRoot, runRecord, taskRecords: [taskRecord],
    publication: { reason: "claimed", taskId: "task-a" },
    origin: { installationId: "inst-test", actor: { kind: "local-agent", id: "root" } },
    kernelTaskPath: path.join(projectRoot, ".mf-dev-flow", "tasks", "run-x", "task-a.json"),
  };
}

test("默认 NullPublisher 只写 kernel，不创建 coordination", () => {
  const { projectRoot, runRecord, taskRecords, publication } = records();
  const result = publishKernelRecords({ projectRoot, runRecord, taskRecords, publication });
  assert.deepEqual(result.coordination, { state: "disabled", eventIds: [], warning: null });
  assert.equal(fs.existsSync(path.join(projectRoot, ".mf-dev-flow", "tasks", "run-x", "task-a.json")), true);
  assert.equal(fs.existsSync(path.join(projectRoot, ".mf-dev-flow", "coordination")), false);
});

test("公开 selectPublicationTask 精确选择唯一任务并保持 fail-closed", () => {
  const item = records();
  assert.equal(
    selectPublicationTask(item.taskRecords, item.publication),
    item.taskRecords[0],
  );
  assert.throws(
    () => selectPublicationTask(item.taskRecords, { reason: "claimed", taskId: "missing" }),
    /协同发布任务不存在或不唯一/,
  );
  assert.throws(
    () => selectPublicationTask(item.taskRecords, { reason: "other", taskId: "task-a" }),
    /协同 publication 必须含 claimed\/finished reason 与非空 taskId/,
  );
});

test("显式 Outbox 发布发生在 kernel 写入成功之后", () => {
  const { projectRoot, runRecord, taskRecords, publication, origin, kernelTaskPath } = records();
  const outbox = createLocalOutboxPublisher({ projectRoot, installationId: "inst-test" });
  const publisher = {
    enabled: true,
    publish(event) {
      assert.equal(fs.existsSync(kernelTaskPath), true, "publish 前 kernel 必须已落盘");
      return outbox.publish(event);
    },
  };
  const result = publishKernelRecords({
    projectRoot, runRecord, taskRecords, publication, coordinationPublisher: publisher, origin,
  });
  assert.equal(result.localCommitted, true);
  assert.equal(result.coordination.state, "queued");
});

test("Outbox 降级不回滚已经写入的 kernel", () => {
  const { projectRoot, runRecord, taskRecords, publication, origin, kernelTaskPath } = records();
  const degradedPublisher = {
    enabled: true,
    publish: () => ({ state: "degraded", eventIds: [], warning: "协同 Outbox 写入失败" }),
  };
  const result = publishKernelRecords({
    projectRoot, runRecord, taskRecords, publication, coordinationPublisher: degradedPublisher, origin,
  });
  assert.equal(result.localCommitted, true);
  assert.deepEqual(result.coordination, {
    state: "degraded", eventIds: [], warning: "协同 Outbox 写入失败",
  });
  assert.equal(fs.existsSync(kernelTaskPath), true);
});

test("协同缺少 origin、投影异常或发布器抛错时不回滚 kernel", () => {
  const withoutOriginRecords = records();
  const withoutOrigin = publishKernelRecords({
    projectRoot: withoutOriginRecords.projectRoot,
    runRecord: withoutOriginRecords.runRecord,
    taskRecords: withoutOriginRecords.taskRecords,
    publication: withoutOriginRecords.publication,
    coordinationPublisher: { enabled: true, publish() {} },
  });
  assert.deepEqual(withoutOrigin.coordination, {
    state: "degraded", eventIds: [], warning: "协同发布失败",
  });
  assert.equal(fs.existsSync(withoutOriginRecords.kernelTaskPath), true);

  const projectionRecords = records();
  projectionRecords.taskRecords[0].status = "completed";
  const projectionFailure = publishKernelRecords({
    projectRoot: projectionRecords.projectRoot,
    runRecord: projectionRecords.runRecord,
    taskRecords: projectionRecords.taskRecords,
    publication: projectionRecords.publication,
    coordinationPublisher: { enabled: true, publish() {} },
    origin: projectionRecords.origin,
  });
  assert.deepEqual(projectionFailure.coordination, {
    state: "degraded", eventIds: [], warning: "协同发布失败",
  });
  assert.equal(fs.existsSync(projectionRecords.kernelTaskPath), true);

  const throwingRecords = records();
  const throwingPublisher = {
    enabled: true,
    publish() { throw new Error("network must not escape"); },
  };
  const result = publishKernelRecords({
    projectRoot: throwingRecords.projectRoot,
    runRecord: throwingRecords.runRecord,
    taskRecords: throwingRecords.taskRecords,
    publication: throwingRecords.publication,
    coordinationPublisher: throwingPublisher,
    origin: throwingRecords.origin,
  });
  assert.deepEqual(result.coordination, {
    state: "degraded", eventIds: [], warning: "协同发布失败",
  });
  assert.equal(fs.existsSync(throwingRecords.kernelTaskPath), true);
});

test("publication task 缺失或不唯一时在 kernel 写入前 fail-closed", () => {
  const missing = records();
  assert.throws(
    () => publishKernelRecords({
      projectRoot: missing.projectRoot,
      runRecord: missing.runRecord,
      taskRecords: missing.taskRecords,
      publication: { reason: "claimed", taskId: "missing" },
    }),
    /协同发布任务不存在或不唯一/,
  );
  assert.equal(fs.existsSync(path.join(missing.projectRoot, ".mf-dev-flow", "tasks")), false);

  const duplicate = records();
  assert.throws(
    () => publishKernelRecords({
      projectRoot: duplicate.projectRoot,
      runRecord: duplicate.runRecord,
      taskRecords: [duplicate.taskRecords[0], { ...duplicate.taskRecords[0] }],
      publication: duplicate.publication,
    }),
    /协同发布任务不存在或不唯一/,
  );
  assert.equal(fs.existsSync(path.join(duplicate.projectRoot, ".mf-dev-flow", "tasks")), false);
});

test("非法 publication 在 kernel 写入前 fail-closed", () => {
  for (const publication of [
    { reason: "other", taskId: "task-a" },
    { reason: "claimed", taskId: "" },
  ]) {
    const item = records();
    assert.throws(() => publishKernelRecords({
      projectRoot: item.projectRoot,
      runRecord: item.runRecord,
      taskRecords: item.taskRecords,
      publication,
    }));
    assert.equal(fs.existsSync(path.join(item.projectRoot, ".mf-dev-flow", "tasks")), false);
  }
});

test("显式假值 publication 在 kernel 写入前 fail-closed", () => {
  for (const publication of [false, "", 0, Number.NaN]) {
    const item = records();
    assert.throws(
      () => publishKernelRecords({
        projectRoot: item.projectRoot,
        runRecord: item.runRecord,
        taskRecords: item.taskRecords,
        publication,
      }),
      /协同 publication 必须含 claimed\/finished reason 与非空 taskId/,
    );
    assert.equal(fs.existsSync(path.join(item.projectRoot, ".mf-dev-flow")), false);
  }
});

test("null、省略或显式 undefined publication 时不调用启用的 publisher", () => {
  for (const publicationCase of ["omitted", "null", "undefined"]) {
    const { projectRoot, runRecord, taskRecords, kernelTaskPath } = records();
    let called = false;
    const publisher = {
      enabled: true,
      publish() {
        called = true;
        throw new Error("不应调用");
      },
    };
    const baseInput = { projectRoot, runRecord, taskRecords, coordinationPublisher: publisher };
    const result = publicationCase === "omitted"
      ? publishKernelRecords(baseInput)
      : publicationCase === "null"
        ? publishKernelRecords({ ...baseInput, publication: null })
        : publishKernelRecords({ ...baseInput, publication: undefined });
    assert.equal(called, false);
    assert.equal(result.localCommitted, true);
    assert.deepEqual(result.coordination, { state: "disabled", eventIds: [], warning: null });
    assert.equal(fs.existsSync(kernelTaskPath), true);
    assert.equal(fs.existsSync(path.join(projectRoot, ".mf-dev-flow", "coordination")), false);
  }
});

test("kernel 校验失败时 fail-closed 且不调用 publisher", () => {
  const { projectRoot, runRecord, taskRecords, publication, origin } = records();
  taskRecords[0].status = "invalid";
  let called = false;
  const publisher = {
    enabled: true,
    publish() {
      called = true;
      return { state: "queued", eventIds: ["event-x"], warning: null };
    },
  };
  assert.throws(() => publishKernelRecords({
    projectRoot, runRecord, taskRecords, publication, coordinationPublisher: publisher, origin,
  }), /kernel 任务记录非法/);
  assert.equal(called, false);
  assert.equal(fs.existsSync(path.join(projectRoot, ".mf-dev-flow", "tasks")), false);
});
