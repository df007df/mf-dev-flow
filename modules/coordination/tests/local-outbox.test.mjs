import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { canonicalJson, createLifecycleEvent } from "../contracts.mjs";
import { nullPublisher } from "../null-publisher.mjs";
import { createLocalOutboxPublisher } from "../local-outbox.mjs";
import { publicationResult } from "../publisher.mjs";
import { objectRefFor } from "../../kernel/object-ref.mjs";

const cleanup = [];
after(() => {
  for (const directory of cleanup) fs.rmSync(directory, { recursive: true, force: true });
});

function temporaryRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(root);
  return root;
}

function validEvent(overrides = {}) {
  const snapshot = {
    runRef: objectRefFor("run", "kernel", "run-x"),
    title: "A", status: "in_progress", updatedAt: "2026-09-12T00:00:00.000Z",
  };
  return createLifecycleEvent({
    origin: {
      installationId: "inst-test",
      actor: { kind: "local-agent", id: "root" },
      ...(overrides.origin ?? {}),
    },
    workspaceRef: objectRefFor("project", "project"),
    subject: { kind: "task", ref: objectRefFor("task", "kernel", "run-x", "task-a") },
    transition: { reason: "claimed", to: "in_progress" },
    snapshot: { ...snapshot, ...(overrides.snapshot ?? {}) },
    occurredAt: "2026-09-12T00:00:00.000Z", refs: [], evidence: [],
  });
}

function identityPath(root) {
  return path.join(root, ".mf-dev-flow", "coordination", "identity.json");
}

function queuedPath(root, event) {
  return path.join(root, ".mf-dev-flow", "coordination", "outbox", "queued", `${event.eventId}.json`);
}

test("NullPublisher 完全无副作用", () => {
  assert.deepEqual(nullPublisher.publish(validEvent()), {
    state: "disabled", eventIds: [], warning: null,
  });
});

test("publicationResult 严格校验公开结果形状", () => {
  assert.throws(() => publicationResult({ state: "other" }), /未知协同发布状态/);
  assert.throws(() => publicationResult({ state: "queued", eventIds: [""] }), /eventIds/);
  assert.throws(() => publicationResult({ state: "queued", warning: "" }), /warning/);
});

test("Outbox 首次写入 identity 与 queued event", () => {
  const root = temporaryRoot("mf-dev-flow-outbox-");
  const publisher = createLocalOutboxPublisher({ projectRoot: root, installationId: "inst-test" });
  const result = publisher.publish(validEvent());
  assert.equal(result.state, "queued");
  assert.equal(fs.existsSync(path.join(root, ".mf-dev-flow", "coordination", "identity.json")), true);
  assert.equal(fs.existsSync(path.join(root, ".mf-dev-flow", "coordination", "outbox", "queued", `${validEvent().eventId}.json`)), true);
  assert.equal(
    fs.readFileSync(path.join(root, ".mf-dev-flow", "coordination", "identity.json"), "utf8"),
    '{"installationId":"inst-test","schemaVersion":1}\n',
  );
  assert.equal(fs.readFileSync(queuedPath(root, validEvent()), "utf8"), `${canonicalJson(validEvent())}\n`);
});

test("Outbox 发布不会改写输入事件的 origin、key 或 eventId", () => {
  const projectRoot = temporaryRoot("mf-dev-flow-outbox-input-immutable-");
  const event = validEvent();
  const before = JSON.parse(JSON.stringify(event));
  const result = createLocalOutboxPublisher({ projectRoot, installationId: "inst-test" }).publish(event);
  assert.deepEqual(result, { state: "queued", eventIds: [event.eventId], warning: null });
  assert.deepEqual(event, before);
});

test("默认 UUID identity 可在构造 event 前读取且构造无副作用", () => {
  const projectRoot = temporaryRoot("mf-dev-flow-outbox-default-id-");
  const publisher = createLocalOutboxPublisher({ projectRoot });
  assert.equal(fs.existsSync(path.join(projectRoot, ".mf-dev-flow")), false);
  const advertisedInstallationId = publisher.installationId;
  assert.equal(Object.getOwnPropertyDescriptor(publisher, "installationId")?.writable, false);
  assert.match(advertisedInstallationId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(publisher.publish(validEvent({ origin: { installationId: advertisedInstallationId } })).state, "queued");
  const persistedInstallationId = JSON.parse(fs.readFileSync(identityPath(projectRoot), "utf8")).installationId;
  assert.equal(persistedInstallationId, advertisedInstallationId);
  assert.equal(publisher.publish(validEvent({ origin: { installationId: advertisedInstallationId }, snapshot: { title: "B" } })).state, "queued");
  assert.equal(JSON.parse(fs.readFileSync(identityPath(projectRoot), "utf8")).installationId, advertisedInstallationId);
});

test("显式 installationId 与 event origin 不一致时不会创建 identity 或 queued event", () => {
  const projectRoot = temporaryRoot("mf-dev-flow-outbox-explicit-origin-mismatch-");
  const publisher = createLocalOutboxPublisher({ projectRoot, installationId: "inst-local" });
  const event = validEvent({ origin: { installationId: "inst-event" } });
  assert.deepEqual(publisher.publish(event), {
    state: "degraded", eventIds: [], warning: "协同 Outbox identity 不可用",
  });
  assert.equal(fs.existsSync(identityPath(projectRoot)), false);
  assert.equal(fs.existsSync(queuedPath(projectRoot, event)), false);
});

test("已持久化 local identity 与 event origin 不一致时不会生成 queued event", () => {
  const projectRoot = temporaryRoot("mf-dev-flow-outbox-persisted-origin-mismatch-");
  fs.mkdirSync(path.dirname(identityPath(projectRoot)), { recursive: true });
  fs.writeFileSync(identityPath(projectRoot), '{"installationId":"inst-persisted","schemaVersion":1}\n');
  const publisher = createLocalOutboxPublisher({ projectRoot });
  const event = validEvent({ origin: { installationId: "inst-event" } });
  assert.equal(publisher.installationId, "inst-persisted");
  assert.deepEqual(publisher.publish(event), {
    state: "degraded", eventIds: [], warning: "协同 Outbox identity 不可用",
  });
  assert.equal(fs.existsSync(queuedPath(projectRoot, event)), false);
});

test("同一 eventId 的相同事件幂等成功，内容不同则 degraded", () => {
  const projectRoot = temporaryRoot("mf-dev-flow-outbox-duplicate-");
  const event = validEvent();
  const publisher = createLocalOutboxPublisher({ projectRoot, installationId: "inst-test" });
  assert.equal(publisher.publish(event).state, "queued");
  assert.equal(publisher.publish(event).state, "queued");
  const file = path.join(projectRoot, ".mf-dev-flow", "coordination", "outbox", "queued", `${event.eventId}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...event, snapshot: { ...event.snapshot, title: "冲突" } }));
  assert.equal(publisher.publish(event).state, "degraded");
});

test("损坏 identity 或非法事件不会留下 queued 文件", () => {
  const projectRoot = temporaryRoot("mf-dev-flow-outbox-identity-");
  fs.mkdirSync(path.join(projectRoot, ".mf-dev-flow", "coordination"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".mf-dev-flow", "coordination", "identity.json"), "{坏 JSON");
  const publisher = createLocalOutboxPublisher({ projectRoot });
  assert.equal(publisher.publish(validEvent()).state, "degraded");
  assert.equal(fs.existsSync(path.join(projectRoot, ".mf-dev-flow", "coordination", "outbox")), false);
  const freshRoot = temporaryRoot("mf-dev-flow-outbox-invalid-");
  assert.throws(() => createLocalOutboxPublisher({ projectRoot: freshRoot, installationId: "inst-test" }).publish({}), /协同事件/);
  assert.equal(fs.existsSync(path.join(freshRoot, ".mf-dev-flow")), false);
});

test("outbox 目录被普通文件占用时返回不含路径的 degraded", () => {
  const projectRoot = temporaryRoot("mf-dev-flow-outbox-directory-");
  const outbox = path.join(projectRoot, ".mf-dev-flow", "coordination", "outbox");
  fs.mkdirSync(path.dirname(outbox), { recursive: true });
  fs.writeFileSync(outbox, "not-a-directory");
  const result = createLocalOutboxPublisher({ projectRoot, installationId: "inst-test" }).publish(validEvent());
  assert.deepEqual(result, { state: "degraded", eventIds: [], warning: "协同 Outbox 写入失败" });
  assert.equal(result.warning.includes(projectRoot), false);
});

test("预存 identity 不会被覆盖，传入不匹配 ID 会 degraded", () => {
  const projectRoot = temporaryRoot("mf-dev-flow-outbox-identity-mismatch-");
  fs.mkdirSync(path.dirname(identityPath(projectRoot)), { recursive: true });
  fs.writeFileSync(identityPath(projectRoot), '{"installationId":"inst-existing","schemaVersion":1}\n');
  const publisher = createLocalOutboxPublisher({ projectRoot, installationId: "inst-requested" });
  assert.equal(publisher.installationId, "inst-requested");
  const event = validEvent({ origin: { installationId: "inst-requested" } });
  const result = publisher.publish(event);
  assert.deepEqual(result, { state: "degraded", eventIds: [], warning: "协同 Outbox identity 不可用" });
  assert.equal(fs.readFileSync(identityPath(projectRoot), "utf8"), '{"installationId":"inst-existing","schemaVersion":1}\n');
  assert.equal(fs.existsSync(queuedPath(projectRoot, event)), false);
});

test("竞争身份最终提交后若 event origin 不一致则不入队", () => {
  const projectRoot = temporaryRoot("mf-dev-flow-outbox-identity-race-");
  const stable = '{"installationId":"inst-winner","schemaVersion":1}\n';
  const target = identityPath(projectRoot);
  const originalRename = fs.renameSync;
  const originalLink = fs.linkSync;
  const installWinner = (source, destination) => {
    if (destination === target && !fs.existsSync(destination)) fs.writeFileSync(destination, stable);
  };
  fs.renameSync = (source, destination) => { installWinner(source, destination); return originalRename(source, destination); };
  fs.linkSync = (source, destination) => { installWinner(source, destination); return originalLink(source, destination); };
  try {
    const publisher = createLocalOutboxPublisher({ projectRoot });
    const event = validEvent({ origin: { installationId: publisher.installationId ?? "inst-contender" } });
    assert.deepEqual(publisher.publish(event), {
      state: "degraded", eventIds: [], warning: "协同 Outbox identity 不可用",
    });
    assert.equal(fs.existsSync(queuedPath(projectRoot, event)), false);
  } finally {
    fs.renameSync = originalRename;
    fs.linkSync = originalLink;
  }
  assert.equal(fs.readFileSync(target, "utf8"), stable);
});

test("竞争者在最终提交前写入同 eventId 时不被覆盖且返回 collision", () => {
  const projectRoot = temporaryRoot("mf-dev-flow-outbox-race-");
  const event = validEvent();
  const competing = validEvent({ snapshot: { title: "竞争者" } });
  fs.mkdirSync(path.dirname(identityPath(projectRoot)), { recursive: true });
  fs.writeFileSync(identityPath(projectRoot), '{"installationId":"inst-test","schemaVersion":1}\n');
  const target = queuedPath(projectRoot, event);
  const originalRename = fs.renameSync;
  const originalLink = fs.linkSync;
  const installCompetitor = (source, destination) => {
    if (destination === target && !fs.existsSync(destination)) fs.writeFileSync(destination, `${JSON.stringify(competing)}\n`);
  };
  fs.renameSync = (source, destination) => {
    installCompetitor(source, destination);
    return originalRename(source, destination);
  };
  fs.linkSync = (source, destination) => {
    installCompetitor(source, destination);
    return originalLink(source, destination);
  };
  try {
    const result = createLocalOutboxPublisher({ projectRoot, installationId: "inst-test" }).publish(event);
    assert.deepEqual(result, { state: "degraded", eventIds: [], warning: "协同 Outbox 事件冲突" });
  } finally {
    fs.renameSync = originalRename;
    fs.linkSync = originalLink;
  }
  assert.equal(fs.readFileSync(target, "utf8"), `${JSON.stringify(competing)}\n`);
});

test("预占临时文件不会被 Outbox 清理", () => {
  const projectRoot = temporaryRoot("mf-dev-flow-outbox-foreign-temp-");
  const event = validEvent();
  const temporary = path.join(projectRoot, ".mf-dev-flow", "coordination", "outbox", "queued", `${event.eventId}.${process.pid}.tmp`);
  fs.mkdirSync(path.dirname(temporary), { recursive: true });
  fs.writeFileSync(identityPath(projectRoot), '{"installationId":"inst-test","schemaVersion":1}\n');
  fs.writeFileSync(temporary, "foreign temporary content");
  const result = createLocalOutboxPublisher({ projectRoot, installationId: "inst-test" }).publish(event);
  assert.deepEqual(result, { state: "degraded", eventIds: [], warning: "协同 Outbox 写入失败" });
  assert.equal(fs.readFileSync(temporary, "utf8"), "foreign temporary content");
  assert.equal(fs.existsSync(queuedPath(projectRoot, event)), false);
});

test("预占 identity 临时文件不会被 Outbox 清理", () => {
  const projectRoot = temporaryRoot("mf-dev-flow-outbox-foreign-identity-temp-");
  const event = validEvent();
  const temporary = `${identityPath(projectRoot)}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(temporary), { recursive: true });
  fs.writeFileSync(temporary, "foreign identity temporary content");
  const result = createLocalOutboxPublisher({ projectRoot, installationId: "inst-test" }).publish(event);
  assert.deepEqual(result, { state: "degraded", eventIds: [], warning: "协同 Outbox identity 不可用" });
  assert.equal(fs.readFileSync(temporary, "utf8"), "foreign identity temporary content");
  assert.equal(fs.existsSync(identityPath(projectRoot)), false);
  assert.equal(fs.existsSync(queuedPath(projectRoot, event)), false);
});

test("自身创建的临时文件在最终提交失败后被清理", () => {
  const projectRoot = temporaryRoot("mf-dev-flow-outbox-own-temp-");
  const event = validEvent();
  fs.mkdirSync(path.dirname(identityPath(projectRoot)), { recursive: true });
  fs.writeFileSync(identityPath(projectRoot), '{"installationId":"inst-test","schemaVersion":1}\n');
  const originalRename = fs.renameSync;
  const originalLink = fs.linkSync;
  const rejectFinalization = (source, destination) => {
    if (destination === queuedPath(projectRoot, event)) {
      const error = new Error("finalization denied");
      error.code = "EACCES";
      throw error;
    }
  };
  fs.renameSync = (source, destination) => { rejectFinalization(source, destination); return originalRename(source, destination); };
  fs.linkSync = (source, destination) => { rejectFinalization(source, destination); return originalLink(source, destination); };
  try {
    const result = createLocalOutboxPublisher({ projectRoot, installationId: "inst-test" }).publish(event);
    assert.deepEqual(result, { state: "degraded", eventIds: [], warning: "协同 Outbox 写入失败" });
  } finally {
    fs.renameSync = originalRename;
    fs.linkSync = originalLink;
  }
  const temporary = path.join(projectRoot, ".mf-dev-flow", "coordination", "outbox", "queued", `${event.eventId}.${process.pid}.tmp`);
  assert.equal(fs.existsSync(temporary), false);
});

test("identity 临时文件打开后写入失败会清理、关闭并允许同一发布器重试", () => {
  const projectRoot = temporaryRoot("mf-dev-flow-outbox-identity-write-failure-");
  const publisher = createLocalOutboxPublisher({ projectRoot, installationId: "inst-test" });
  const temporary = `${identityPath(projectRoot)}.${process.pid}.tmp`;
  const originalWrite = fs.writeSync;
  const originalClose = fs.closeSync;
  let closes = 0;
  fs.writeSync = () => {
    const error = new Error("disk full");
    error.code = "ENOSPC";
    throw error;
  };
  fs.closeSync = (descriptor) => { closes += 1; return originalClose(descriptor); };
  try {
    assert.deepEqual(publisher.publish(validEvent()), {
      state: "degraded", eventIds: [], warning: "协同 Outbox identity 不可用",
    });
  } finally {
    fs.writeSync = originalWrite;
    fs.closeSync = originalClose;
  }
  assert.equal(closes, 1);
  assert.equal(fs.existsSync(temporary), false);
  assert.equal(publisher.publish(validEvent()).state, "queued");
});

test("event 临时文件打开后写入失败会清理、关闭并允许同一发布器重试", () => {
  const projectRoot = temporaryRoot("mf-dev-flow-outbox-event-write-failure-");
  const event = validEvent();
  fs.mkdirSync(path.dirname(identityPath(projectRoot)), { recursive: true });
  fs.writeFileSync(identityPath(projectRoot), '{"installationId":"inst-test","schemaVersion":1}\n');
  const publisher = createLocalOutboxPublisher({ projectRoot, installationId: "inst-test" });
  const temporary = path.join(projectRoot, ".mf-dev-flow", "coordination", "outbox", "queued", `${event.eventId}.${process.pid}.tmp`);
  const originalWrite = fs.writeSync;
  const originalClose = fs.closeSync;
  let closes = 0;
  fs.writeSync = () => {
    const error = new Error("disk full");
    error.code = "ENOSPC";
    throw error;
  };
  fs.closeSync = (descriptor) => { closes += 1; return originalClose(descriptor); };
  try {
    assert.deepEqual(publisher.publish(event), {
      state: "degraded", eventIds: [], warning: "协同 Outbox 写入失败",
    });
  } finally {
    fs.writeSync = originalWrite;
    fs.closeSync = originalClose;
  }
  assert.equal(closes, 1);
  assert.equal(fs.existsSync(temporary), false);
  assert.equal(publisher.publish(event).state, "queued");
});
