const STATES = new Set(["disabled", "queued", "degraded"]);

export function publicationResult({ state, eventIds = [], warning = null }) {
  if (!STATES.has(state)) throw new Error(`未知协同发布状态：${state}`);
  if (!Array.isArray(eventIds) || !eventIds.every(id => typeof id === "string" && id))
    throw new Error("协同 eventIds 必须为非空字符串数组");
  if (warning !== null && (typeof warning !== "string" || !warning))
    throw new Error("协同 warning 必须为 null 或非空字符串");
  return { state, eventIds: [...eventIds], warning };
}

export function assertCoordinationPublisher(publisher) {
  if (!publisher || typeof publisher.enabled !== "boolean" || typeof publisher.publish !== "function")
    throw new Error("协同发布器必须含 enabled:boolean 与 publish(event)");
  return publisher;
}
