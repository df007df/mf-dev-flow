import { nullPublisher } from "../coordination/null-publisher.mjs";
import { assertCoordinationPublisher, publicationResult } from "../coordination/publisher.mjs";
import { writeLocalKernelRecords } from "./local-file-sink.mjs";
import { projectTaskLifecycleEvent } from "./projection.mjs";

export function selectPublicationTask(taskRecords, publication) {
  if (
    publication === null
    || typeof publication !== "object"
    || Array.isArray(publication)
    || !["claimed", "finished"].includes(publication.reason)
    || typeof publication.taskId !== "string"
    || !publication.taskId
  ) {
    throw new Error("协同 publication 必须含 claimed/finished reason 与非空 taskId");
  }
  const matches = taskRecords.filter(
    record => record?.id === `${record?.runId}/${publication.taskId}`,
  );
  if (matches.length !== 1) throw new Error("协同发布任务不存在或不唯一");
  return matches[0];
}

export function publishKernelRecords({
  projectRoot,
  runRecord,
  taskRecords,
  publication = null,
  coordinationPublisher = nullPublisher,
  origin = null,
}) {
  assertCoordinationPublisher(coordinationPublisher);
  const taskRecord = publication === null ? null : selectPublicationTask(taskRecords, publication);
  writeLocalKernelRecords({ projectRoot, runRecord, taskRecords });
  if (publication === null || coordinationPublisher.enabled === false) {
    return { localCommitted: true, coordination: nullPublisher.publish(null) };
  }
  try {
    if (!origin) throw new Error("协同发布缺少 origin");
    const event = projectTaskLifecycleEvent({ runRecord, taskRecord, publication, origin });
    return {
      localCommitted: true,
      coordination: publicationResult(coordinationPublisher.publish(event)),
    };
  } catch {
    return {
      localCommitted: true,
      coordination: publicationResult({ state: "degraded", warning: "协同发布失败" }),
    };
  }
}
