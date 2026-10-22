// 任务内核记录（schemaVersion 1）：类型无关的一次任务执行记录。
// 结构层由命令写入、代码校验；提示词只决定节点判断与产出内容。
// 设计依据：flows/maintenance/graph-layer-m2-design.md（边/闭包为 M2，本模块只做形状与状态机）。
// ref 形状校验在本模块；ref 指向是否解析成功由 M2 `graph build --check` 负责。
import { GRAPH_REF_PREFIXES, graphRefPrefix } from "./object-ref.mjs";

export const KERNEL_SCHEMA_VERSION = 1;

export const TASK_STATUSES = ["pending","claimed","in_progress","blocked","completed","superseded","abandoned"];
export const RUN_STATUSES = ["open","in_progress","blocked","completed","superseded","abandoned"];
export const PROCESS_PROVENANCES = ["hook","declared","reconciled","none"];
export const TOUCHED_PROVENANCES = ["hook","declared","reconciled"];

// 图节点 kind（M2 §3.1 封闭集合）与 ref 前缀的映射；ref 前缀允许一对多 kind。
export const NODE_KINDS = ["prototype-group","prototype-entry","prototype-source-file","prd-source","feature","feature-group","system-card","code-file","project","task","release"];
export const REF_PREFIXES = GRAPH_REF_PREFIXES;

const ALLOWED_TRANSITIONS = {
  pending: ["claimed","superseded","abandoned"],
  claimed: ["in_progress","blocked","superseded","abandoned"],
  in_progress: ["blocked","completed","superseded","abandoned"],
  blocked: ["in_progress","superseded","abandoned"],
  completed: [],
  superseded: [],
  abandoned: [],
};

const isString = v => typeof v === "string" && v.length > 0;
const isStringArray = v => Array.isArray(v) && v.every(isString);

export function parseRef(ref) {
  if (!isString(ref)) return null;
  const prefix = graphRefPrefix(ref);
  if (!prefix) return null;
  const id = ref.slice(prefix.length + 1);
  return { prefix, id };
}

export function isValidRef(ref) { return parseRef(ref) !== null; }

export function statusTransitionAllowed(from, to) {
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

const RUN_TERMINAL_TASK_STATUSES = ["completed", "blocked", "superseded", "abandoned"];

/**
 * 主任务状态派生（M5-3 门禁）：子任务全部终态时 run 状态唯一确定为
 * blocked（存在阻塞）> completed（至少一项完成）> superseded > abandoned；
 * 仍有未完成子任务或无子任务时返回 null，表示保留执行中状态、不派生。
 * superseded=true（运行已被取代）优先于一切派生。
 */
export function deriveRunStatus(taskStatuses, { superseded = false } = {}) {
  if (superseded) return "superseded";
  const list = (taskStatuses ?? []).filter(Boolean);
  if (!list.length) return null;
  if (!list.every(status => RUN_TERMINAL_TASK_STATUSES.includes(status))) return null;
  if (list.some(status => status === "blocked")) return "blocked";
  if (list.some(status => status === "completed")) return "completed";
  if (list.some(status => status === "superseded")) return "superseded";
  return "abandoned";
}

/** 新建任务记录；typeRef 必须解析自 TaskType 注册表（调用方负责取值）。 */
export function newTaskRecord({ id, runId, typeRef, title, agent = "root", sourceRefs = [], parentTask = null, extensions = {}, at }) {
  const now = at ?? new Date().toISOString();
  return {
    schemaVersion: KERNEL_SCHEMA_VERSION,
    kind: "task",
    id,
    runId,
    typeRef,
    title,
    status: "pending",
    agent,
    sessionId: null,
    parentTask,
    subtasks: [],
    sourceRefs,
    touchedRefs: [],
    outputs: { reports: [], artifacts: [] },
    processData: { hookHealth: "unknown", provenance: "none", complete: false },
    phaseRef: null,
    extensions,
    timeline: [{ at: now, event: "created", by: `agent:${agent}` }],
    createdAt: now,
    updatedAt: now,
  };
}

export function appendTimeline(record, event, by) {
  const now = new Date().toISOString();
  record.timeline.push({ at: now, event, by });
  record.updatedAt = now;
  return record;
}

export function setTaskStatus(record, to) {
  if (!TASK_STATUSES.includes(to)) throw new Error(`未知任务状态：${to}`);
  if (!statusTransitionAllowed(record.status, to)) throw new Error(`非法任务状态迁移：${record.status} → ${to}`);
  record.status = to;
  return appendTimeline(record, `status:${to}`, `agent:${record.agent}`);
}

/**
 * hook 观测与 agent 声明对账（M2 §5，本模块提供纯函数，finish 命令消费）。
 * observed=hook 采集清单（可信）；declared=agent 传参清单。
 */
export function reconcileProcessData({ declared = [], observed = null, hookHealth = "unknown" }) {
  const norm = list => [...new Set(list)].sort();
  if (observed === null || hookHealth === "degraded") {
    return { changedFiles: norm(declared), provenance: "declared", complete: false, missing: [], extra: [] };
  }
  const d = new Set(norm(declared)), o = new Set(norm(observed));
  const missing = [...o].filter(f => !d.has(f)); // 观测有、声明无 → 调用方应拒绝完成
  const extra = [...d].filter(f => !o.has(f));   // 声明有、观测无 → 允许但降级
  return {
    changedFiles: norm([...d, ...o]),
    provenance: missing.length === 0 && extra.length === 0 ? "reconciled" : "declared",
    complete: missing.length === 0 && extra.length === 0,
    missing,
    extra,
  };
}

function refProblem(list, field, problems) {
  if (!Array.isArray(list)) { problems.push(`${field} 必须是数组`); return; }
  for (const item of list) {
    const ref = typeof item === "string" ? item : item?.ref;
    if (!isValidRef(ref)) problems.push(`${field} 含非法引用：${JSON.stringify(item)}`);
  }
}

export function validateTaskRecord(record) {
  const problems = [];
  if (!record || typeof record !== "object") return ["记录必须是对象"];
  if (record.schemaVersion !== KERNEL_SCHEMA_VERSION) problems.push(`schemaVersion 必须为 ${KERNEL_SCHEMA_VERSION}`);
  if (record.kind !== "task") problems.push("kind 必须为 task");
  for (const field of ["id","runId","title"]) if (!isString(record[field])) problems.push(`${field} 必填非空`);
  if (!record.typeRef || !isString(record.typeRef.id) || !Number.isInteger(record.typeRef.version) || record.typeRef.version < 1)
    problems.push("typeRef 必须为 {id, version>=1}");
  if (!TASK_STATUSES.includes(record.status)) problems.push(`status 非法：${record.status}`);
  if (!isString(record.agent)) problems.push("agent 必填非空");
  if (record.parentTask !== null && !isValidRef(record.parentTask)) problems.push(`parentTask 非法：${record.parentTask}`);
  refProblem(record.subtasks ?? [], "subtasks", problems);
  refProblem(record.sourceRefs ?? [], "sourceRefs", problems);
  if (!Array.isArray(record.touchedRefs)) problems.push("touchedRefs 必须是数组");
  else for (const t of record.touchedRefs) {
    if (!isValidRef(t?.ref)) problems.push(`touchedRefs.ref 非法：${JSON.stringify(t)}`);
    if (!TOUCHED_PROVENANCES.includes(t?.provenance)) problems.push(`touchedRefs.provenance 非法：${t?.provenance}`);
  }
  if (!record.outputs || !Array.isArray(record.outputs.reports) || !Array.isArray(record.outputs.artifacts))
    problems.push("outputs 必须含 reports[] 与 artifacts[]");
  const pd = record.processData ?? {};
  if (!PROCESS_PROVENANCES.includes(pd.provenance)) problems.push(`processData.provenance 非法：${pd.provenance}`);
  if (pd.complete === true && !["hook","reconciled"].includes(pd.provenance))
    problems.push("processData.complete=true 要求 provenance 为 hook/reconciled");
  if (!Array.isArray(record.timeline)) problems.push("timeline 必须是数组");
  else {
    let prev = "";
    record.timeline.forEach((entry, i) => {
      if (!isString(entry?.at) || !isString(entry?.event)) problems.push(`timeline[${i}] 需要 at 与 event`);
      else if (entry.at < prev) problems.push(`timeline[${i}] 时间乱序`);
      else prev = entry.at;
    });
  }
  if (record.extensions !== undefined && (typeof record.extensions !== "object" || record.extensions === null || Array.isArray(record.extensions)))
    problems.push("extensions 必须是对象");
  return problems;
}

export function validateRunRecord(record) {
  const problems = [];
  if (!record || typeof record !== "object") return ["记录必须是对象"];
  if (record.schemaVersion !== KERNEL_SCHEMA_VERSION) problems.push(`schemaVersion 必须为 ${KERNEL_SCHEMA_VERSION}`);
  if (record.kind !== "run") problems.push("kind 必须为 run");
  for (const field of ["id","title"]) if (!isString(record[field])) problems.push(`${field} 必填非空`);
  if (!record.typeRef || !isString(record.typeRef.id) || !Number.isInteger(record.typeRef.version))
    problems.push("typeRef 必须为 {id, version}");
  if (!RUN_STATUSES.includes(record.status)) problems.push(`status 非法：${record.status}`);
  refProblem(record.taskRefs ?? [], "taskRefs", problems);
  return problems;
}

const LEGACY_TASK_STATUS = {
  pending: "pending", claimed: "claimed", in_progress: "in_progress",
  blocked: "blocked", confirmed: "completed", done: "completed",
  completed: "completed", skipped: "abandoned", superseded: "superseded", abandoned: "abandoned",
};

/**
 * 旧 delivery 记录 → kernel 记录（M5 迁移与 M1 双写共用；纯转换不落盘）。
 * 输入为旧文件解析结果；不读文件系统，由调用方提供。
 */
export function normalizeDeliveryRun({ run, planTask, execution, typeRef, reportFiles = ["plan.md","impl.md","verification.md"] }) {
  const runRecord = {
    schemaVersion: KERNEL_SCHEMA_VERSION,
    kind: "run",
    id: run.id,
    typeRef,
    title: run.title,
    status:
      run.status === "done" ? "completed"
        : run.status === "blocked" ? "blocked"
        : run.status === "skipped" ? "superseded"
        : "in_progress",
    taskRefs: planTask ? [`task:${run.id}/${planTask.id}`] : [],
    createdAt: run.createdAt ?? null,
    updatedAt: run.updatedAt ?? null,
    legacy: { runDir: `delivery-runs/${run.id}` },
  };
  if (!planTask || !execution) return { runRecord, taskRecord: null };
  const timeline = [];
  if (execution.claimedAt) timeline.push({ at: execution.claimedAt, event: "claimed", by: `agent:${execution.agent ?? "root"}` });
  for (const attempt of execution.attempts ?? []) {
    if (attempt.startedAt) timeline.push({ at: attempt.startedAt, event: `attempt:${attempt.id}:start`, by: `agent:${attempt.agent ?? execution.agent ?? "root"}` });
    if (attempt.endedAt) timeline.push({ at: attempt.endedAt, event: `attempt:${attempt.id}:end`, by: `agent:${attempt.agent ?? execution.agent ?? "root"}` });
  }
  if (execution.updatedAt && (!timeline.length || execution.updatedAt > timeline[timeline.length - 1].at))
    timeline.push({ at: execution.updatedAt, event: "declared-updated", by: `agent:${execution.agent ?? "root"}` });
  const reconciled = execution.processData?.provenance === "reconciled";
  const taskRecord = {
    schemaVersion: KERNEL_SCHEMA_VERSION,
    kind: "task",
    id: `${run.id}/${planTask.id}`,
    runId: run.id,
    typeRef,
    title: planTask.title ?? execution.summary ?? planTask.id,
    status: LEGACY_TASK_STATUS[execution.status] ?? "in_progress",
    agent: execution.agent ?? "root",
    sessionId: execution.sessionId ?? null,
    parentTask: null,
    subtasks: [],
    sourceRefs: (planTask.leafFeatureIds ?? planTask.features ?? []).map(f => `feature:${f}`),
    touchedRefs: (execution.changedFiles ?? []).filter(f => f !== "none").map(f => ({ ref: `code:${f}`, provenance: reconciled ? "reconciled" : "declared" })),
    outputs: {
      reports: reportFiles.map(f => ({ file: f })),
      artifacts: (execution.stages ? Object.entries(execution.stages).flatMap(([stageId, s]) => (s?.artifacts ?? []).map(a => ({ stage: stageId, ...a }))) : []),
    },
    processData: execution.processData ?? { hookHealth: "unknown", provenance: "declared", complete: false },
    phaseRef: execution.targetPhase ?? null,
    extensions: { legacy: { targetPhase: execution.targetPhase ?? null, stages: execution.stages ?? {}, checkpoints: execution.checkpoints ?? [], summary: execution.summary ?? null, tests: execution.tests ?? null } },
    timeline,
    createdAt: execution.claimedAt ?? run.createdAt ?? timeline[0]?.at ?? null,
    updatedAt: execution.updatedAt ?? run.updatedAt ?? null,
    legacy: { executionFile: `delivery-runs/${run.id}/executions/${planTask.id}.json` },
  };
  return { runRecord, taskRecord };
}
