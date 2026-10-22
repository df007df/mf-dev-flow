// TaskType 注册表：跨流程任务类型的统一登记处（M1）。
// registry.json 是清单；processFile 指向各类型的阶段契约（新旧两种格式并存）。
// 校验取两种既有契约的最小公共集，不强制旧文件补字段；dispatch/extensions 槽为新增类型能力。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_KINDS } from "../kernel/record.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadRegistry(root = here) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "registry.json"), "utf8"));
  const entries = raw.types.map(entry => {
    const file = path.resolve(root, entry.processFile);
    return { ...entry, file, process: JSON.parse(fs.readFileSync(file, "utf8")) };
  });
  return { schemaVersion: raw.schemaVersion, entries };
}

/** 解析类型：显式版本取精确；缺省取最新非 superseded 版本。 */
export function resolveType(entries, id, version = null) {
  const matches = entries.filter(e => e.id === id);
  if (!matches.length) return null;
  if (version !== null) return matches.find(e => e.version === version) ?? null;
  const live = matches.filter(e => e.status !== "superseded");
  const pool = live.length ? live : matches;
  return pool.reduce((a, b) => (b.version > a.version ? b : a));
}

/** 列表视图：每 id 一条最新可发布版本摘要（含被替代版本计数）。 */
export function listSummary(entries) {
  const byId = new Map();
  for (const entry of entries) {
    const current = byId.get(entry.id);
    if (!current) { byId.set(entry.id, { id: entry.id, versions: [], superseded: 0 }); }
    const item = byId.get(entry.id);
    if (entry.status === "superseded") item.superseded += 1;
    else item.versions.push(entry.version);
  }
  return [...byId.values()].map(item => {
    const latest = resolveType(entries, item.id);
    return {
      id: item.id,
      latestVersion: latest?.version ?? null,
      supersededVersions: item.superseded,
      title: latest?.process?.title ?? latest?.title ?? null,
      flow: latest?.flow ?? null,
      stageIds: (latest?.process?.stages ?? []).map(s => s.id),
      hasDispatch: Boolean(latest?.process?.dispatch?.length),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

const STAGE_REQUIRED = ["id","agentFile"];

/** 单个类型条目的契约校验；返回 problems[]，空即通过。 */
export function typeProblems(entry) {
  const problems = [];
  const process = entry?.process;
  if (!process) return ["缺少 process 内容"];
  if (!Number.isInteger(process.schemaVersion)) problems.push("process.schemaVersion 必须为整数");
  if (!entry.legacyProcessId && process.id !== entry.id)
    problems.push(`process.id (${process.id}) 与注册 id (${entry.id}) 不一致；别名请标 legacyProcessId`);
  if (process.version !== entry.version) problems.push(`process.version (${process.version}) 与注册 version (${entry.version}) 不一致`);
  if (!Array.isArray(process.stages) || !process.stages.length) problems.push("stages 必须为非空数组");
  else for (const stage of process.stages) {
    for (const field of STAGE_REQUIRED) if (typeof stage[field] !== "string" || !stage[field]) problems.push(`stage ${stage.id ?? "?"} 缺少 ${field}`);
    if (stage.agentFile) {
      const file = path.resolve(path.dirname(entry.file), stage.agentFile);
      if (!fs.existsSync(file)) problems.push(`stage ${stage.id} 的 agentFile 不存在：${stage.agentFile}`);
    }
  }
  const seenStage = new Set();
  for (const stage of process.stages ?? []) {
    if (seenStage.has(stage.id)) problems.push(`stage id 重复：${stage.id}`);
    seenStage.add(stage.id);
  }
  for (const rule of process.dispatch ?? []) {
    const triggers = Array.isArray(rule.whenDirty) ? rule.whenDirty : [rule.whenDirty];
    for (const t of triggers) if (!NODE_KINDS.includes(t)) problems.push(`dispatch.whenDirty 未知 kind：${t}`);
    if (!NODE_KINDS.includes(rule.affects)) problems.push(`dispatch.affects 未知 kind：${rule.affects}`);
    if (rule.autoCreate !== false) problems.push("dispatch.autoCreate 必须为 false（闭包只产建议，不自动建运行）");
    if (rule.batching !== "per-trigger") problems.push("dispatch.batching 必须为 per-trigger（防任务扇出爆炸）");
    if (typeof rule.openTaskType !== "string" || !rule.openTaskType) problems.push("dispatch.openTaskType 必填");
  }
  if (process.extensions !== undefined && (typeof process.extensions !== "object" || process.extensions === null))
    problems.push("extensions 必须是对象");
  return problems;
}

/** 全表校验。 */
export function registryProblems(registry) {
  const problems = [];
  const keys = new Set();
  for (const entry of registry.entries) {
    const key = `${entry.id}@${entry.version}`;
    if (keys.has(key)) problems.push(`注册重复：${key}`);
    keys.add(key);
    if (!isFlowName(entry.flow)) problems.push(`${key} 的 flow 未登记：${entry.flow}`);
    for (const problem of typeProblems(entry)) problems.push(`${key}: ${problem}`);
    for (const rule of entry.process?.dispatch ?? []) {
      const target = resolveType(registry.entries, rule.openTaskType);
      if (!target) problems.push(`${key}: dispatch.openTaskType 未注册：${rule.openTaskType}`);
    }
  }
  return problems;
}

function isFlowName(flow) {
  try {
    const file = path.resolve(here, "../workflow/registry.json");
    const flows = JSON.parse(fs.readFileSync(file, "utf8")).flows.map(f => f.id);
    return flows.includes(flow);
  } catch { return false; }
}
