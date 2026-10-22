import { createLifecycleEvent } from "../coordination/contracts.mjs";
import { objectRefFor } from "./object-ref.mjs";

const CLAIMED_STATUSES = new Set(["claimed", "in_progress"]);
const FINISHED_STATUSES = new Set(["blocked", "completed", "superseded", "abandoned"]);

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || !value) throw new Error(`${field} 必填非空`);
  return value;
}

/** 将已验证的 kernel task 最小化投影为公开 lifecycle event。 */
export function projectTaskLifecycleEvent({ runRecord, taskRecord, publication, origin }) {
  const runId = requireNonEmptyString(runRecord?.id, "runRecord.id");
  const taskRecordId = requireNonEmptyString(taskRecord?.id, "taskRecord.id");
  if (taskRecord.runId !== runId) throw new Error("taskRecord.runId 必须匹配 runRecord.id");
  const prefix = `${taskRecord.runId}/`;
  if (!taskRecordId.startsWith(prefix) || taskRecordId.length === prefix.length) throw new Error("taskRecord.id 必须以 runId/taskId 表示");
  const taskId = taskRecord.id.slice(prefix.length);
  if (!publication || publication.taskId !== taskId) throw new Error("publication.taskId 必须严格匹配 task id");
  if (publication.reason === "claimed") {
    if (!CLAIMED_STATUSES.has(taskRecord.status)) throw new Error("claimed publication 只接受 claimed 或 in_progress task");
  } else if (publication.reason === "finished") {
    if (!FINISHED_STATUSES.has(taskRecord.status)) throw new Error("finished publication 只接受终态 task");
  } else {
    throw new Error("publication.reason 必须为 claimed 或 finished");
  }

  const taskRef = objectRefFor("task", "kernel", taskRecord.runId, taskId);
  const runRef = objectRefFor("run", "kernel", runId);
  const workspaceRef = objectRefFor("project", "project");
  return createLifecycleEvent({
    origin,
    workspaceRef,
    subject: { kind: "task", ref: taskRef },
    transition: { reason: publication.reason, to: taskRecord.status },
    snapshot: {
      runRef,
      title: requireNonEmptyString(taskRecord.title, "taskRecord.title"),
      status: requireNonEmptyString(taskRecord.status, "taskRecord.status"),
      updatedAt: requireNonEmptyString(taskRecord.updatedAt, "taskRecord.updatedAt"),
    },
    occurredAt: taskRecord.updatedAt,
    refs: [],
    evidence: [],
  });
}
