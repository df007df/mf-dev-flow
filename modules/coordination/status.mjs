import fs from "node:fs";
import path from "node:path";

import { validateCoordinationEvent } from "./contracts.mjs";
import { isCoordinationIdentity } from "./identity.mjs";
import { STORE_DIRECTORY } from "../skill-identity.mjs";

export const COORDINATION_STATUS_SCHEMA_VERSION = 1;
export const COORDINATION_STATUS_DEFAULT_LIMIT = 20;
export const COORDINATION_STATUS_MAX_LIMIT = 50;

const MAX_IDENTITY_BYTES = 64 * 1024;
const MAX_EVENT_BYTES = 1024 * 1024;
const NEXT = "Outbox 仅在显式注入时启用；当前没有网络同步。";

function assertLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > COORDINATION_STATUS_MAX_LIMIT) {
    throw new Error(`coordination status limit 必须是 1 到 ${COORDINATION_STATUS_MAX_LIMIT} 的整数`);
  }
  return limit;
}

function directoryState(file) {
  try {
    const stat = fs.lstatSync(file);
    return !stat.isSymbolicLink() && stat.isDirectory() ? "ready" : "invalid";
  } catch (error) {
    return error?.code === "ENOENT" ? "absent" : "invalid";
  }
}

function regularFile(file, maxBytes) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maxBytes) return { state: "invalid", text: null };
    return { state: "ready", text: fs.readFileSync(file, "utf8") };
  } catch (error) {
    return error?.code === "ENOENT"
      ? { state: "absent", text: null }
      : { state: "invalid", text: null };
  }
}

function identityStatus(file) {
  const record = regularFile(file, MAX_IDENTITY_BYTES);
  if (record.state === "absent") return { state: "absent", installationId: null };
  if (record.state !== "ready") return { state: "invalid", installationId: null };
  try {
    const identity = JSON.parse(record.text);
    return isCoordinationIdentity(identity)
      ? { state: "ready", installationId: identity.installationId }
      : { state: "invalid", installationId: null };
  } catch {
    return { state: "invalid", installationId: null };
  }
}

function publicEvent(event) {
  return {
    eventId: event.eventId,
    idempotencyKey: event.idempotencyKey,
    occurredAt: event.occurredAt,
    transition: { reason: event.transition.reason, to: event.transition.to },
    task: {
      ref: event.subject.ref,
      runRef: event.snapshot.runRef,
      title: event.snapshot.title,
      status: event.snapshot.status,
    },
  };
}

function newestFirst(left, right) {
  if (left.occurredAt !== right.occurredAt) return left.occurredAt < right.occurredAt ? 1 : -1;
  if (left.eventId === right.eventId) return 0;
  return left.eventId < right.eventId ? -1 : 1;
}

function emptyOutbox(state = "absent") {
  return { state, queuedCount: 0, invalidCount: 0, events: [] };
}

function outboxStatus(directory, limit) {
  const outboxDirectory = path.join(directory, "outbox");
  const outboxDirectoryState = directoryState(outboxDirectory);
  if (outboxDirectoryState === "absent") return emptyOutbox();
  if (outboxDirectoryState !== "ready") return { ...emptyOutbox("degraded") };

  const queuedDirectory = path.join(outboxDirectory, "queued");
  const queuedDirectoryState = directoryState(queuedDirectory);
  if (queuedDirectoryState === "absent") return emptyOutbox("ready");
  if (queuedDirectoryState !== "ready") return { ...emptyOutbox("degraded") };

  let names;
  try {
    names = fs.readdirSync(queuedDirectory).filter(name => name.endsWith(".json")).sort();
  } catch {
    return { ...emptyOutbox("degraded") };
  }

  const events = [];
  let invalidCount = 0;
  for (const name of names) {
    const record = regularFile(path.join(queuedDirectory, name), MAX_EVENT_BYTES);
    if (record.state !== "ready") {
      invalidCount += 1;
      continue;
    }
    try {
      const event = JSON.parse(record.text);
      if (validateCoordinationEvent(event).length || name !== `${event.eventId}.json`) {
        invalidCount += 1;
        continue;
      }
      events.push(publicEvent(event));
    } catch {
      invalidCount += 1;
    }
  }

  events.sort(newestFirst);
  return {
    state: invalidCount ? "degraded" : "ready",
    queuedCount: events.length,
    invalidCount,
    events: events.slice(0, limit),
  };
}

function report(state, identity, outbox) {
  return {
    schemaVersion: COORDINATION_STATUS_SCHEMA_VERSION,
    mode: "local-only",
    state,
    identity,
    outbox,
    next: NEXT,
  };
}

function degradedReport() {
  return report(
    "degraded",
    { state: "invalid", installationId: null },
    emptyOutbox("degraded"),
  );
}

/**
 * 只读汇总本地 coordination Outbox。不存在时不会创建 `.mf-dev-flow`；
 * 故障仅投影为状态，绝不返回本机路径或原始错误。
 */
export function coordinationStatus({ projectRoot = process.cwd(), limit = COORDINATION_STATUS_DEFAULT_LIMIT } = {}) {
  const safeLimit = assertLimit(limit);
  if (typeof projectRoot !== "string" || !projectRoot) throw new Error("coordination status projectRoot 必填");
  const root = path.resolve(projectRoot);
  const mfDevFlowDirectory = path.join(root, STORE_DIRECTORY);
  const mfDevFlowDirectoryState = directoryState(mfDevFlowDirectory);
  if (mfDevFlowDirectoryState === "absent") {
    return report("not-enabled", { state: "absent", installationId: null }, emptyOutbox());
  }
  if (mfDevFlowDirectoryState !== "ready") return degradedReport();

  const coordinationDirectory = path.join(mfDevFlowDirectory, "coordination");
  const coordinationDirectoryState = directoryState(coordinationDirectory);
  if (coordinationDirectoryState === "absent") {
    return report("not-enabled", { state: "absent", installationId: null }, emptyOutbox());
  }
  if (coordinationDirectoryState !== "ready") return degradedReport();

  const identity = identityStatus(path.join(coordinationDirectory, "identity.json"));
  const outbox = outboxStatus(coordinationDirectory, safeLimit);
  return report(
    identity.state === "invalid" || outbox.state === "degraded" ? "degraded" : "ready",
    identity,
    outbox,
  );
}
