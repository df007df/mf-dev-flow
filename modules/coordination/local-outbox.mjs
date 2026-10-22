import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { canonicalJson, validateCoordinationEvent } from "./contracts.mjs";
import {
  COORDINATION_IDENTITY_SCHEMA_VERSION,
  isCoordinationIdentity,
  isCoordinationInstallationId,
} from "./identity.mjs";
import { assertCoordinationPublisher, publicationResult } from "./publisher.mjs";
import { STORE_DIRECTORY } from "../skill-identity.mjs";

const IDENTITY_WARNING = "协同 Outbox identity 不可用";
const WRITE_WARNING = "协同 Outbox 写入失败";
const COLLISION_WARNING = "协同 Outbox 事件冲突";

function invalidEvent(problems) {
  throw new Error(`协同事件非法：${problems.join("；")}`);
}

function identityFile(coordinationDirectory) {
  return path.join(coordinationDirectory, "identity.json");
}

function inspectIdentity(file, requestedInstallationId) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isCoordinationIdentity(parsed)) return null;
  if (requestedInstallationId && parsed.installationId !== requestedInstallationId) return null;
  return parsed;
}

function existingIdentity(file) {
  try {
    return fs.existsSync(file) ? inspectIdentity(file) : null;
  } catch {
    return null;
  }
}

function removeOwnTemporary(file) {
  try { fs.rmSync(file, { force: true }); } catch { /* best-effort cleanup */ }
}

function writeOwnedTemporary(file, content, markCreated) {
  const descriptor = fs.openSync(file, "wx");
  markCreated();
  try {
    const bytes = Buffer.from(content, "utf8");
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (!Number.isSafeInteger(written) || written <= 0) throw new Error("协同 Outbox 临时文件写入不完整");
      offset += written;
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function existingEventResult(file, event) {
  const existing = canonicalJson(JSON.parse(fs.readFileSync(file, "utf8")));
  return existing === canonicalJson(event)
    ? publicationResult({ state: "queued", eventIds: [event.eventId] })
    : publicationResult({ state: "degraded", warning: COLLISION_WARNING });
}

export function createLocalOutboxPublisher({ projectRoot, installationId } = {}) {
  if (typeof projectRoot !== "string" || !projectRoot) throw new Error("协同 Outbox projectRoot 必填");
  if (installationId !== undefined && !isCoordinationInstallationId(installationId))
    throw new Error("协同 Outbox installationId 必须为非空字符串");

  const coordinationDirectory = path.join(path.resolve(projectRoot), STORE_DIRECTORY, "coordination");
  const queuedDirectory = path.join(coordinationDirectory, "outbox", "queued");
  // 构造期只读既有 identity；不存在时仅生成内存值，绝不创建 coordination 文件。
  const advertisedInstallationId = installationId
    ?? existingIdentity(identityFile(coordinationDirectory))?.installationId
    ?? randomUUID();

  function ensureIdentity() {
    const file = identityFile(coordinationDirectory);
    try {
      if (fs.existsSync(file)) return inspectIdentity(file, advertisedInstallationId);
      fs.mkdirSync(coordinationDirectory, { recursive: true });
      const identity = {
        schemaVersion: COORDINATION_IDENTITY_SCHEMA_VERSION,
        installationId: advertisedInstallationId,
      };
      const temporary = `${file}.${process.pid}.tmp`;
      let temporaryCreated = false;
      try {
        writeOwnedTemporary(temporary, `${canonicalJson(identity)}\n`, () => { temporaryCreated = true; });
        try {
          // link() creates the final name exclusively in this same directory;
          // unlike rename(), it can never replace a concurrent writer's file.
          fs.linkSync(temporary, file);
        } catch (error) {
          if (temporaryCreated) removeOwnTemporary(temporary);
          temporaryCreated = false;
          if (error?.code === "EEXIST") return inspectIdentity(file, advertisedInstallationId);
          throw error;
        }
        removeOwnTemporary(temporary);
        temporaryCreated = false;
      } catch (error) {
        if (temporaryCreated) removeOwnTemporary(temporary);
        throw error;
      }
      return identity;
    } catch {
      return null;
    }
  }

  const publisher = {
    enabled: true,
    publish(event) {
      const problems = validateCoordinationEvent(event);
      if (problems.length) invalidEvent(problems);

      // 显式 ID 或构造期公开的默认 UUID 不一致时，不能先落 identity 再报告失败。
      if (event.origin.installationId !== advertisedInstallationId)
        return publicationResult({ state: "degraded", warning: IDENTITY_WARNING });

      const identity = ensureIdentity();
      if (!identity || identity.installationId !== event.origin.installationId)
        return publicationResult({ state: "degraded", warning: IDENTITY_WARNING });

      const target = path.join(queuedDirectory, `${event.eventId}.json`);
      let temporary = null;
      let temporaryCreated = false;
      try {
        fs.mkdirSync(queuedDirectory, { recursive: true });
        if (fs.existsSync(target)) return existingEventResult(target, event);
        temporary = path.join(queuedDirectory, `${event.eventId}.${process.pid}.tmp`);
        writeOwnedTemporary(temporary, `${canonicalJson(event)}\n`, () => { temporaryCreated = true; });
        try {
          // link() makes the immutable final name an exclusive commit point.
          fs.linkSync(temporary, target);
        } catch (error) {
          if (temporaryCreated) removeOwnTemporary(temporary);
          temporaryCreated = false;
          if (error?.code === "EEXIST") return existingEventResult(target, event);
          throw error;
        }
        removeOwnTemporary(temporary);
        temporaryCreated = false;
        temporary = null;
        return publicationResult({ state: "queued", eventIds: [event.eventId] });
      } catch {
        if (temporaryCreated) removeOwnTemporary(temporary);
        return publicationResult({ state: "degraded", warning: WRITE_WARNING });
      }
    },
  };
  Object.defineProperty(publisher, "installationId", {
    value: advertisedInstallationId,
    enumerable: true,
  });
  return assertCoordinationPublisher(publisher);
}
