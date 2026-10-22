import { createHash } from "node:crypto";

import { parseObjectRef } from "../kernel/object-ref.mjs";

export const COORDINATION_SCHEMA_VERSION = 1;
export const COORDINATION_EVENT_TYPE = "work.lifecycle.changed";
export const COORDINATION_ARTIFACT_KINDS = Object.freeze([
  "project", "project-card", "system-card", "prd-source", "prd-batch",
  "prototype-group", "prototype-entry", "prototype-source", "feature-group",
  "feature", "run", "task", "release", "code-file",
]);

const ARTIFACT_KIND_SET = new Set(COORDINATION_ARTIFACT_KINDS);
const EVIDENCE_KINDS = new Set(["git-commit", "test-run"]);
const EVIDENCE_STATUSES = new Set(["passed", "failed", "unknown"]);
const TRANSITION_REASONS = new Set(["claimed", "finished"]);
const CLAIMED_STATUSES = new Set(["claimed", "in_progress"]);
const FINISHED_STATUSES = new Set(["blocked", "completed", "superseded", "abandoned"]);
const EVENT_KEYS = new Set([
  "schemaVersion", "type", "origin", "workspaceRef", "subject", "transition",
  "snapshot", "occurredAt", "refs", "evidence", "idempotencyKey", "eventId",
]);
const INPUT_KEYS = new Set([...EVENT_KEYS].filter(key => key !== "idempotencyKey" && key !== "eventId"));
const IDEMPOTENCY_KEY_PATTERN = /^sha256:[a-f0-9]{64}$/;
const EVENT_ID_PATTERN = /^evt_[a-f0-9]{64}$/;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function codePointCompare(left, right) {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index].codePointAt(0) - rightPoints[index].codePointAt(0);
    if (difference) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

/** 只接受普通 JSON 数据，并将对象键按 Unicode 码点稳定排序。 */
export function canonicalJson(value) {
  const ancestors = new Set();

  function encode(item) {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("canonicalJson 不接受非有限数字");
      return JSON.stringify(item);
    }
    if (typeof item === "undefined" || typeof item === "function" || typeof item === "symbol" || typeof item === "bigint")
      throw new Error(`canonicalJson 不接受 ${typeof item}`);
    if (Array.isArray(item)) {
      if (ancestors.has(item)) throw new Error("canonicalJson 不接受循环引用");
      ancestors.add(item);
      try {
        const values = [];
        for (let index = 0; index < item.length; index += 1) {
          if (!Object.hasOwn(item, index)) throw new Error("canonicalJson 不接受稀疏数组");
          values.push(encode(item[index]));
        }
        return `[${values.join(",")}]`;
      } finally {
        ancestors.delete(item);
      }
    }
    if (!isPlainObject(item)) throw new Error("canonicalJson 只接受普通对象");
    if (ancestors.has(item)) throw new Error("canonicalJson 不接受循环引用");
    ancestors.add(item);
    try {
      return `{${Object.keys(item).sort(codePointCompare).map(key => `${JSON.stringify(key)}:${encode(item[key])}`).join(",")}}`;
    } finally {
      ancestors.delete(item);
    }
  }

  return encode(value);
}

function objectRefProblem(ref, expectedKind, field, problems) {
  const parsed = parseObjectRef(ref);
  if (!parsed || parsed.kind !== expectedKind) problems.push(`${field} 必须是 ${expectedKind} Object Ref V1`);
}

function keysProblem(value, allowedKeys, field, problems) {
  if (!isPlainObject(value)) {
    problems.push(`${field} 必须是对象`);
    return false;
  }
  for (const key of Object.keys(value)) if (!allowedKeys.has(key)) problems.push(`${field} 含未知字段：${key}`);
  return true;
}

function validateCommon(event, allowedKeys) {
  const problems = [];
  if (!keysProblem(event, allowedKeys, "事件", problems)) return problems;
  if (event.schemaVersion !== COORDINATION_SCHEMA_VERSION) problems.push(`schemaVersion 必须为 ${COORDINATION_SCHEMA_VERSION}`);
  if (event.type !== COORDINATION_EVENT_TYPE) problems.push(`type 必须为 ${COORDINATION_EVENT_TYPE}`);
  if (keysProblem(event.origin, new Set(["installationId", "actor"]), "origin", problems)) {
    if (!isNonEmptyString(event.origin.installationId)) problems.push("origin.installationId 必填非空");
    if (keysProblem(event.origin.actor, new Set(["kind", "id"]), "origin.actor", problems)) {
      if (!isNonEmptyString(event.origin.actor.kind)) problems.push("origin.actor.kind 必填非空");
      else if (event.origin.actor.kind !== "local-agent") problems.push("origin.actor.kind 必须为 local-agent");
      if (!isNonEmptyString(event.origin.actor.id)) problems.push("origin.actor.id 必填非空");
    }
  }
  objectRefProblem(event.workspaceRef, "project", "workspaceRef", problems);
  if (keysProblem(event.subject, new Set(["kind", "ref"]), "subject", problems)) {
    if (event.subject.kind !== "task") problems.push("subject.kind 必须为 task");
    objectRefProblem(event.subject.ref, "task", "subject.ref", problems);
  }
  const hasTransition = keysProblem(event.transition, new Set(["reason", "to"]), "transition", problems);
  if (hasTransition) {
    if (!isNonEmptyString(event.transition.reason)) problems.push("transition.reason 必填非空");
    if (!isNonEmptyString(event.transition.to)) problems.push("transition.to 必填非空");
  }
  const hasSnapshot = keysProblem(event.snapshot, new Set(["runRef", "title", "status", "updatedAt"]), "snapshot", problems);
  if (hasSnapshot) {
    objectRefProblem(event.snapshot.runRef, "run", "snapshot.runRef", problems);
    for (const field of ["title", "status", "updatedAt"]) {
      if (!isNonEmptyString(event.snapshot[field])) problems.push(`snapshot.${field} 必填非空`);
    }
  }
  if (hasTransition) {
    const { reason, to } = event.transition;
    if (!TRANSITION_REASONS.has(reason)) problems.push("transition.reason 必须为 claimed 或 finished");
    if (reason === "claimed" && !CLAIMED_STATUSES.has(to))
      problems.push("claimed transition.to 必须为 claimed 或 in_progress");
    if (reason === "finished" && !FINISHED_STATUSES.has(to))
      problems.push("finished transition.to 必须为 blocked、completed、superseded 或 abandoned");
    if (hasSnapshot) {
      const { status } = event.snapshot;
      if (reason === "claimed" && !CLAIMED_STATUSES.has(status))
        problems.push("claimed snapshot.status 必须为 claimed 或 in_progress");
      if (reason === "finished" && !FINISHED_STATUSES.has(status))
        problems.push("finished snapshot.status 必须为 blocked、completed、superseded 或 abandoned");
      if (isNonEmptyString(to) && isNonEmptyString(status) && to !== status)
        problems.push("transition.to 必须等于 snapshot.status");
    }
  }
  if (!isNonEmptyString(event.occurredAt)) problems.push("occurredAt 必填非空");
  if (!Array.isArray(event.refs)) problems.push("refs 必须是数组");
  else event.refs.forEach((artifact, index) => {
    if (!isPlainObject(artifact) || Object.keys(artifact).some(key => key !== "kind" && key !== "ref")) {
      problems.push(`refs[${index}] 必须是 ArtifactRef`);
      return;
    }
    const parsed = parseObjectRef(artifact.ref);
    if (!ARTIFACT_KIND_SET.has(artifact.kind) || !parsed || parsed.kind !== artifact.kind)
      problems.push(`refs[${index}] 必须是白名单 ArtifactRef`);
  });
  if (!Array.isArray(event.evidence)) problems.push("evidence 必须是数组");
  else event.evidence.forEach((evidence, index) => {
    if (!isPlainObject(evidence) || Object.keys(evidence).some(key => key !== "kind" && key !== "key" && key !== "status")) {
      problems.push(`evidence[${index}] 非法`);
      return;
    }
    if (!EVIDENCE_KINDS.has(evidence.kind) || !isNonEmptyString(evidence.key)
      || (evidence.status !== undefined && !EVIDENCE_STATUSES.has(evidence.status))) problems.push(`evidence[${index}] 非法`);
  });
  return problems;
}

function hashEvent(event) {
  return createHash("sha256").update(canonicalJson(event)).digest("hex");
}

/** 从不含签名字段的公开事实稳定派生幂等键。 */
export function idempotencyKeyFor(eventWithoutIds) {
  return `sha256:${hashEvent(eventWithoutIds)}`;
}

/** 从合法幂等键确定性派生事件 ID，拒绝任何非 V1 键。 */
export function eventIdFor(idempotencyKey) {
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new Error("idempotencyKey 非法");
  }
  return `evt_${idempotencyKey.slice("sha256:".length)}`;
}

export function createLifecycleEvent(input) {
  const event = { ...input, schemaVersion: COORDINATION_SCHEMA_VERSION, type: COORDINATION_EVENT_TYPE };
  const problems = validateCommon(event, INPUT_KEYS);
  if (problems.length) throw new Error(`无效 coordination event：${problems.join("；")}`);
  const idempotencyKey = idempotencyKeyFor(event);
  return { ...event, idempotencyKey, eventId: eventIdFor(idempotencyKey) };
}

/** 验证外部事件并返回问题列表；不读写文件系统。 */
export function validateCoordinationEvent(event) {
  const problems = validateCommon(event, EVENT_KEYS);
  if (!isPlainObject(event)) return problems;
  if (typeof event.idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(event.idempotencyKey)) problems.push("idempotencyKey 非法");
  if (typeof event.eventId !== "string" || !EVENT_ID_PATTERN.test(event.eventId)) problems.push("eventId 非法");
  if (problems.length) return problems;
  const { idempotencyKey, eventId, ...unsignedEvent } = event;
  let expectedIdempotencyKey;
  try {
    expectedIdempotencyKey = idempotencyKeyFor(unsignedEvent);
  } catch (error) {
    return [`事件无法规范化：${error.message}`];
  }
  if (idempotencyKey !== expectedIdempotencyKey) problems.push("idempotencyKey 与公开事实不匹配");
  if (eventId !== eventIdFor(expectedIdempotencyKey)) problems.push("eventId 与公开事实不匹配");
  return problems;
}
