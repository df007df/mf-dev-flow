import assert from "node:assert/strict";
import test from "node:test";

import { objectRefFor } from "../../kernel/object-ref.mjs";
import {
  COORDINATION_ARTIFACT_KINDS,
  COORDINATION_EVENT_TYPE,
  COORDINATION_SCHEMA_VERSION,
  canonicalJson,
  createLifecycleEvent,
  eventIdFor,
  idempotencyKeyFor,
  validateCoordinationEvent,
} from "../contracts.mjs";

function lifecycleInput(overrides = {}) {
  const base = {
    origin: { installationId: "inst-test", actor: { kind: "local-agent", id: "root" } },
    workspaceRef: objectRefFor("project", "project"),
    subject: { kind: "task", ref: objectRefFor("task", "kernel", "run-x", "task-a") },
    transition: { reason: "claimed", to: "in_progress" },
    snapshot: {
      runRef: objectRefFor("run", "kernel", "run-x"),
      title: "A", status: "in_progress", updatedAt: "2026-09-12T00:00:00.000Z",
    },
    occurredAt: "2026-09-12T00:00:00.000Z", refs: [], evidence: [],
  };
  return {
    ...base, ...overrides,
    origin: { ...base.origin, ...(overrides.origin ?? {}) },
    transition: { ...base.transition, ...(overrides.transition ?? {}) },
    snapshot: { ...base.snapshot, ...(overrides.snapshot ?? {}) },
  };
}

test("同一公开事实的 key 与 eventId 对对象键顺序稳定", () => {
  const firstSnapshot = {
    runRef: objectRefFor("run", "kernel", "run-x"),
    title: "A",
    status: "in_progress",
    updatedAt: "2026-09-12T00:00:00.000Z",
  };
  const secondSnapshot = {
    updatedAt: "2026-09-12T00:00:00.000Z",
    status: "in_progress",
    title: "A",
    runRef: objectRefFor("run", "kernel", "run-x"),
  };
  assert.notDeepEqual(Object.keys(firstSnapshot), Object.keys(secondSnapshot));
  const first = createLifecycleEvent({ ...lifecycleInput(), snapshot: firstSnapshot });
  const second = createLifecycleEvent({ ...lifecycleInput(), snapshot: secondSnapshot });
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.equal(first.eventId, second.eventId);
  assert.match(first.idempotencyKey, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.eventId, /^evt_[a-f0-9]{64}$/);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.type, "work.lifecycle.changed");
});

test("公开签名 helper 与生命周期事件共用稳定派生", () => {
  const unsignedEvent = {
    ...lifecycleInput(),
    schemaVersion: COORDINATION_SCHEMA_VERSION,
    type: COORDINATION_EVENT_TYPE,
  };
  const idempotencyKey = idempotencyKeyFor(unsignedEvent);
  const reorderedUnsignedEvent = {
    type: unsignedEvent.type,
    schemaVersion: unsignedEvent.schemaVersion,
    evidence: unsignedEvent.evidence,
    refs: unsignedEvent.refs,
    occurredAt: unsignedEvent.occurredAt,
    snapshot: {
      updatedAt: unsignedEvent.snapshot.updatedAt,
      status: unsignedEvent.snapshot.status,
      title: unsignedEvent.snapshot.title,
      runRef: unsignedEvent.snapshot.runRef,
    },
    transition: { to: unsignedEvent.transition.to, reason: unsignedEvent.transition.reason },
    subject: { ref: unsignedEvent.subject.ref, kind: unsignedEvent.subject.kind },
    workspaceRef: unsignedEvent.workspaceRef,
    origin: {
      actor: { id: unsignedEvent.origin.actor.id, kind: unsignedEvent.origin.actor.kind },
      installationId: unsignedEvent.origin.installationId,
    },
  };
  assert.notDeepEqual(Object.keys(unsignedEvent), Object.keys(reorderedUnsignedEvent));
  assert.equal(idempotencyKeyFor(reorderedUnsignedEvent), idempotencyKey);
  assert.match(idempotencyKey, /^sha256:[a-f0-9]{64}$/);
  assert.equal(eventIdFor(idempotencyKey), `evt_${idempotencyKey.slice("sha256:".length)}`);

  const event = createLifecycleEvent(lifecycleInput());
  assert.equal(event.idempotencyKey, idempotencyKey);
  assert.equal(event.eventId, eventIdFor(idempotencyKey));
  assert.throws(() => eventIdFor("sha256:not-a-digest"), /idempotencyKey/);
  assert.throws(() => eventIdFor({ toString: null }), /idempotencyKey/);
});

test("只接受现有 Object Ref V1 ArtifactRef", () => {
  assert.deepEqual(validateCoordinationEvent(createLifecycleEvent(lifecycleInput())), []);
  assert.throws(
    () => createLifecycleEvent(lifecycleInput({ refs: [{ kind: "requirement", ref: "mf-dev-flow:requirement:r-1" }] })),
    /ArtifactRef/,
  );
  assert.throws(
    () => createLifecycleEvent(lifecycleInput({ refs: [{ kind: "feature", ref: objectRefFor("task", "kernel", "run-x", "task-a") }] })),
    /ArtifactRef/,
  );
});

test("canonicalJson 以码点排序且拒绝非 JSON 值", () => {
  assert.equal(canonicalJson({ "\u{10000}": 1, z: 2, a: [true, null] }), '{"a":[true,null],"z":2,"𐀀":1}');
  for (const value of [undefined, () => {}, Symbol("x"), 1n, new Date(), Infinity, { x: undefined }]) {
    assert.throws(() => canonicalJson(value), /canonicalJson/);
  }
  assert.throws(() => canonicalJson(new Array(1)), /canonicalJson/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /循环/);
});

test("验证返回问题数组并拒绝非法证据", () => {
  const event = createLifecycleEvent(lifecycleInput({
    evidence: [{ kind: "test-run", key: "node --test", status: "passed" }],
  }));
  assert.deepEqual(validateCoordinationEvent(event), []);
  assert.throws(
    () => createLifecycleEvent(lifecycleInput({ evidence: [{ kind: "path", key: "/tmp/private" }] })),
    /evidence/,
  );
  const invalid = { ...event, origin: { ...event.origin, installationId: "" } };
  assert.ok(validateCoordinationEvent(invalid).some(problem => problem.includes("installationId")));
});

test("坏的签名字段只返回格式问题而不抛出", () => {
  const event = createLifecycleEvent(lifecycleInput());
  for (const field of ["idempotencyKey", "eventId"]) {
    const malformed = { ...event, [field]: { toString: null } };
    assert.doesNotThrow(() => validateCoordinationEvent(malformed));
    assert.ok(validateCoordinationEvent(malformed).some(problem => problem.includes(field)));
  }
});

test("语义仍合法的生命周期篡改会被公开签名识别", () => {
  const event = createLifecycleEvent(lifecycleInput({
    transition: { reason: "claimed", to: "in_progress" },
    snapshot: { status: "in_progress" },
  }));
  const tampered = {
    ...event,
    transition: { ...event.transition, to: "claimed" },
    snapshot: { ...event.snapshot, status: "claimed" },
  };

  let problems;
  assert.doesNotThrow(() => { problems = validateCoordinationEvent(tampered); });
  assert.deepEqual(problems, [
    "idempotencyKey 与公开事实不匹配",
    "eventId 与公开事实不匹配",
  ]);
});

test("V1 lifecycle 只接受本地 agent 和已声明的状态迁移", () => {
  const invalidCases = [
    {
      name: "remote actor",
      input: lifecycleInput({ origin: { actor: { kind: "remote-human", id: "alice" } } }),
      tamper: event => ({
        ...event,
        origin: { ...event.origin, actor: { ...event.origin.actor, kind: "remote-human" } },
      }),
      expected: [/origin\.actor\.kind 必须为 local-agent/],
    },
    {
      name: "unsupported reason",
      input: lifecycleInput({ transition: { reason: "deleted" } }),
      tamper: event => ({ ...event, transition: { ...event.transition, reason: "deleted" } }),
      expected: [/transition\.reason 必须为 claimed 或 finished/],
    },
    {
      name: "arbitrary status",
      input: lifecycleInput({ transition: { to: "queued" }, snapshot: { status: "queued" } }),
      tamper: event => ({
        ...event,
        transition: { ...event.transition, to: "queued" },
        snapshot: { ...event.snapshot, status: "queued" },
      }),
      expected: [
        /claimed.*transition\.to.*claimed 或 in_progress/,
        /claimed.*snapshot\.status.*claimed 或 in_progress/,
      ],
    },
    {
      name: "claimed completed",
      input: lifecycleInput({ transition: { to: "completed" }, snapshot: { status: "completed" } }),
      tamper: event => ({
        ...event,
        transition: { ...event.transition, to: "completed" },
        snapshot: { ...event.snapshot, status: "completed" },
      }),
      expected: [
        /claimed.*transition\.to.*claimed 或 in_progress/,
        /claimed.*snapshot\.status.*claimed 或 in_progress/,
      ],
    },
    {
      name: "transition snapshot mismatch",
      input: lifecycleInput({ snapshot: { status: "claimed" } }),
      tamper: event => ({ ...event, snapshot: { ...event.snapshot, status: "claimed" } }),
      expected: [/transition\.to 必须等于 snapshot\.status/],
    },
    {
      name: "finished active status",
      input: lifecycleInput({ transition: { reason: "finished", to: "in_progress" } }),
      tamper: event => ({ ...event, transition: { ...event.transition, reason: "finished" } }),
      expected: [
        /finished.*transition\.to.*blocked、completed、superseded 或 abandoned/,
        /finished.*snapshot\.status.*blocked、completed、superseded 或 abandoned/,
      ],
    },
  ];

  for (const invalid of invalidCases) {
    for (const expected of invalid.expected) {
      assert.throws(() => createLifecycleEvent(invalid.input), expected, invalid.name);
    }
    const tampered = invalid.tamper(createLifecycleEvent(lifecycleInput()));
    const problems = validateCoordinationEvent(tampered);
    for (const expected of invalid.expected) {
      assert.ok(problems.some(problem => expected.test(problem)), `${invalid.name}: ${problems.join("；")}`);
    }
  }

  const finished = createLifecycleEvent(lifecycleInput({
    transition: { reason: "finished", to: "completed" },
    snapshot: { status: "completed" },
  }));
  assert.deepEqual(validateCoordinationEvent(finished), []);
});

test("V1 lifecycle 接受所有允许的 reason 与状态组合", () => {
  const validCases = [
    ["claimed", "claimed"],
    ["claimed", "in_progress"],
    ["finished", "blocked"],
    ["finished", "completed"],
    ["finished", "superseded"],
    ["finished", "abandoned"],
  ];

  for (const [reason, status] of validCases) {
    const event = createLifecycleEvent(lifecycleInput({
      transition: { reason, to: status },
      snapshot: { status },
    }));
    assert.deepEqual(validateCoordinationEvent(event), [], `${reason}/${status}`);
  }
});

test("V1 常量公开完整且事件不可夹带未声明字段", () => {
  assert.equal(COORDINATION_SCHEMA_VERSION, 1);
  assert.equal(COORDINATION_EVENT_TYPE, "work.lifecycle.changed");
  assert.ok(COORDINATION_ARTIFACT_KINDS.includes("task"));
  assert.throws(() => createLifecycleEvent(lifecycleInput({ extra: "not-public" })), /未知字段/);
});
