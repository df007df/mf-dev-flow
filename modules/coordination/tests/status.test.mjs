import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { objectRefFor } from "../../kernel/object-ref.mjs";
import { createLifecycleEvent } from "../contracts.mjs";
import { createLocalOutboxPublisher } from "../local-outbox.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-coordination-status-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function event({ taskId, title, occurredAt }) {
  return createLifecycleEvent({
    origin: { installationId: "inst-status", actor: { kind: "local-agent", id: "agent-status" } },
    workspaceRef: objectRefFor("project", "project"),
    subject: { kind: "task", ref: objectRefFor("task", "kernel", "run-status", taskId) },
    transition: { reason: "claimed", to: "in_progress" },
    snapshot: {
      runRef: objectRefFor("run", "kernel", "run-status"),
      title,
      status: "in_progress",
      updatedAt: occurredAt,
    },
    occurredAt,
    refs: [],
    evidence: [],
  });
}

test("status 以最新优先的公开摘要展示 queued 事件，limit 不改变总数", async (t) => {
  const { coordinationStatus } = await import("../status.mjs");
  const root = fixture(t);
  const publisher = createLocalOutboxPublisher({ projectRoot: root, installationId: "inst-status" });
  publisher.publish(event({ taskId: "task-old", title: "旧任务", occurredAt: "2026-09-12T00:00:00.000Z" }));
  publisher.publish(event({ taskId: "task-new", title: "新任务", occurredAt: "2026-09-12T01:00:00.000Z" }));

  const result = coordinationStatus({ projectRoot: root, limit: 1 });
  assert.deepEqual(
    {
      state: result.state,
      installation: result.identity.installationId,
      identityState: result.identity.state,
      outboxState: result.outbox.state,
      queuedCount: result.outbox.queuedCount,
      invalidCount: result.outbox.invalidCount,
      events: result.outbox.events.map(item => ({
        occurredAt: item.occurredAt,
        reason: item.transition.reason,
        taskRef: item.task.ref,
        runRef: item.task.runRef,
        title: item.task.title,
        status: item.task.status,
      })),
    },
    {
      state: "ready",
      installation: "inst-status",
      identityState: "ready",
      outboxState: "ready",
      queuedCount: 2,
      invalidCount: 0,
      events: [{
        occurredAt: "2026-09-12T01:00:00.000Z",
        reason: "claimed",
        taskRef: "mf-dev-flow:task:kernel/run-status/task-new",
        runRef: "mf-dev-flow:run:kernel/run-status",
        title: "新任务",
        status: "in_progress",
      }],
    },
  );
  assert.equal(JSON.stringify(result).includes("agent-status"), false);
  assert.equal(JSON.stringify(result).includes("local-agent"), false);
});

test("status 将损坏的 queued 文件计为 degraded，且不泄露本地路径", async (t) => {
  const { coordinationStatus } = await import("../status.mjs");
  const root = fixture(t);
  const queued = path.join(root, ".mf-dev-flow", "coordination", "outbox", "queued");
  fs.mkdirSync(queued, { recursive: true });
  fs.writeFileSync(path.join(queued, "broken.json"), "{not JSON");

  const result = coordinationStatus({ projectRoot: root });
  assert.deepEqual(
    { state: result.state, identity: result.identity.state, outbox: result.outbox.state, queued: result.outbox.queuedCount, invalid: result.outbox.invalidCount, events: result.outbox.events },
    { state: "degraded", identity: "absent", outbox: "degraded", queued: 0, invalid: 1, events: [] },
  );
  assert.equal(JSON.stringify(result).includes(root), false);
});

test("status 将无效 identity 与符号链接事件安全地降级", async (t) => {
  const { coordinationStatus } = await import("../status.mjs");
  const root = fixture(t);
  const coordination = path.join(root, ".mf-dev-flow", "coordination");
  const queued = path.join(coordination, "outbox", "queued");
  const external = path.join(root, "external-event.json");
  fs.mkdirSync(queued, { recursive: true });
  fs.writeFileSync(path.join(coordination, "identity.json"), "{not identity}");
  fs.writeFileSync(external, JSON.stringify(event({ taskId: "external", title: "不应读取", occurredAt: "2026-09-12T02:00:00.000Z" })));
  fs.symlinkSync(external, path.join(queued, "linked.json"));

  const result = coordinationStatus({ projectRoot: root });
  assert.deepEqual(
    {
      state: result.state,
      identity: result.identity,
      outbox: {
        state: result.outbox.state,
        queuedCount: result.outbox.queuedCount,
        invalidCount: result.outbox.invalidCount,
        events: result.outbox.events,
      },
    },
    {
      state: "degraded",
      identity: { state: "invalid", installationId: null },
      outbox: { state: "degraded", queuedCount: 0, invalidCount: 1, events: [] },
    },
  );
  assert.equal(JSON.stringify(result).includes("不应读取"), false);
  assert.equal(JSON.stringify(result).includes(root), false);
});
