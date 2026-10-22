// 变更传播图层构建（M2）。graph.json 是可重建索引，不是第二真源：
// 节点真相在各真源文件（feature-map、prd/、system/、tasks/），本文件只存摘要、边、指纹与投影。
// 设计依据 flows/maintenance/graph-layer-m2-design.md §3；边写入方是 apply/finish（M5 接线），
// v1 由 build 从既有声明字段回填（feature-map refs、kernel touchedRefs、findings affectsLinks）。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { hasPrototypeCatalog, planningPrototype } from "../prototype/client.mjs";
import { computePrototypeFingerprints } from "./prototype-fingerprints.mjs";
import { formatObjectRef, graphRefKind } from "../kernel/object-ref.mjs";
import { STORE_DIRECTORY } from "../skill-identity.mjs";

export const GRAPH_SCHEMA_VERSION = 1;
export const graphFile = projectRoot => path.join(projectRoot, STORE_DIRECTORY, "graph", "graph.json");
export const graphReportFile = projectRoot => path.join(projectRoot, STORE_DIRECTORY, "graph", "rebuild-report.md");

export const PROPAGATION_KINDS = new Set(["scope-ref", "evidence-for", "parent", "depends-on", "sourced-from"]);
export const SINK_PREFIXES = new Set(["task", "code"]); // 记录型节点是传播终点，不参与置脏

// (kind → 允许的前缀组合)。ref 形如 前缀:标识；prototype 前缀按归属细分 group/entry。
const EDGE_COMBOS = {
  "scope-ref": { from: ["feature"], to: ["prototype", "prd", "system"] },
  "evidence-for": { from: ["prd", "system", "release"], to: ["prototype", "feature", "source"] },
  parent: { from: ["feature", "prototype"], to: ["feature", "feature-group", "prototype"] }, // 校验按前缀粒度；prototype 的 group/entry 细分由节点 kind 承担
  "depends-on": { from: ["feature"], to: ["feature"] },
  implements: { from: ["task"], to: ["feature", "prototype", "prd"] },
  "observed-change": { from: ["task"], to: ["code"] },
  "sourced-from": { from: ["prototype"], to: ["source"] }, // 分组/入口依赖其源文件（M2 §3.2）；git 变动文件沿此边反查分组
};

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

export function sha256(text) {
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

const refPrefix = ref => graphRefKind(ref) ?? String(ref).slice(0, String(ref).indexOf(":") || String(ref).length);
const readJsonSafe = file => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
};
const safeObjectRef = (kind, key) => {
  try { return formatObjectRef({ kind, key }); } catch { return null; }
};
function objectRefForGraphNode(ref, kind) {
  const separator = String(ref).indexOf(":");
  if (separator <= 0 || separator === String(ref).length - 1) return null;
  const key = String(ref).slice(separator + 1);
  const objectKind = {
    "prototype-group": "prototype-group",
    "prototype-entry": "prototype-entry",
    "prototype-source-file": "prototype-source",
    "feature-group": "feature-group",
    feature: "feature",
    "prd-source": "prd-source",
    "system-card": "system-card",
    "code-file": "code-file",
  }[kind];
  // task Graph Ref 没有记录 run 的存储类型；只有真源读取方可以确定 kernel/delivery/... 命名空间。
  // release 在当前 mf-dev-flow 也没有公开真源，不能把格式化引用伪装成可定位对象。
  return objectKind ? safeObjectRef(objectKind, key) : null;
}
const FEATURE_VOLATILE = ["updatedAt", "reassessment", "stages", "status", "implStatus", "labelHistory", "planningRevision", "taskLinks"];
const CARD_VOLATILE = ["changeLog", "lastVerifiedAt", "updatedAt"];
const TASK_VOLATILE = ["updatedAt", "timeline", "createdAt"];

function reassessmentTriggers(feature) {
  const legacy = feature.reassessment;
  if (!legacy || typeof legacy !== "object") return [];
  const list = Array.isArray(legacy.triggers) ? legacy.triggers : (legacy.prototypeFingerprint ? [{
    triggerRef: "prototype:legacy-baseline",
    triggerKind: "prototype-group",
    triggerFingerprint: legacy.prototypeFingerprint,
    status: legacy.status,
    dirtyAt: legacy.reviewedAt ?? null,
    clearedByTask: legacy.runId ?? null,
  }] : []);
  return list
    .filter(trigger => trigger && typeof trigger.triggerRef === "string")
    .map(trigger => ({
      triggerRef: trigger.triggerRef,
      triggerKind: trigger.triggerKind ?? null,
      triggerFingerprint: trigger.triggerFingerprint ?? null,
      dirtyAt: trigger.dirtyAt ?? null,
      // legacy refinement 写入 {status:"reviewed", runId} 表示“已由 runId 这次复评处理完”，迁移为 cleared；
      // 未复核的漂移（如 status:"stale"）保持 open，交由 dispatch 复评。
      status: ["fresh", "cleared", "done", "reviewed"].includes(trigger.status) ? "cleared" : "open",
      clearedByTask: trigger.clearedByTask ?? null,
    }))
    .sort((a, b) => (a.triggerRef < b.triggerRef ? -1 : 1));
}

// 复评触发读写（M6）：真源永远是 feature-map 的 features[].reassessment，
// graph.json 只是投影索引（reassessment 在 FEATURE_VOLATILE 内，不参与节点指纹）。
// 复用 reassessmentTriggers 的读投影，写侧统一落到 {triggers:[...]} 新形制，
// 旧形制（legacy 对象）原样存到 reassessment.legacy 保留复评审计。
export const featureTriggers = reassessmentTriggers;

function featureInMap(map, featureRef) {
  const id = String(featureRef).replace(/^feature:/, "");
  return (map.features ?? []).find((feature) => feature.id === id) ?? null;
}

function ensureTriggersArray(feature) {
  const current = feature.reassessment;
  if (current && Array.isArray(current.triggers)) return current;
  const migrated = { triggers: reassessmentTriggers(feature) };
  if (current && typeof current === "object") migrated.legacy = current;
  feature.reassessment = migrated;
  return migrated;
}

// 显式置脏：来源（原型分组/PRD/系统卡）指纹变化被检出后，由复评流程写入 open 触发。
// 同 triggerRef 且同指纹已 open → 幂等无变化（防重复置脏，对应广播风暴熔断的 triggerFingerprint 去重）。
export function flagFeatureTrigger(map, { featureRef, triggerRef, triggerKind = null, triggerFingerprint = null, source = null, at = null }) {
  const feature = featureInMap(map, featureRef);
  if (!feature) return { changed: false, reason: `功能点不存在：${featureRef}` };
  const container = ensureTriggersArray(feature);
  const existing = container.triggers.find((trigger) => trigger.triggerRef === triggerRef);
  if (existing && existing.status === "open" && existing.triggerFingerprint === triggerFingerprint)
    return { changed: false, reason: "相同指纹的 open 触发已存在（幂等）", featureRef, triggerRef };
  const entry = {
    ...(existing ?? {}),
    triggerRef,
    triggerKind: triggerKind ?? existing?.triggerKind ?? null,
    triggerFingerprint: triggerFingerprint ?? existing?.triggerFingerprint ?? null,
    status: "open",
    dirtyAt: at,
    clearedByTask: null,
    clearedAt: null,
    source: source ?? existing?.source ?? null,
  };
  if (existing) Object.assign(existing, entry);
  else container.triggers.push(entry);
  container.triggers.sort((left, right) => (left.triggerRef < right.triggerRef ? -1 : 1));
  return { changed: true, featureRef, triggerRef };
}

// 漂移自动置脏（M6）：复用 prototypeImpact 的只读判定，把“受影响功能 × 其实际依赖的来源”
// 显式写成 open 触发（遵循“状态显式写入”原则，不让看板 join 推导）。
// triggerRef 精确到来源（分组/入口/需求/问题）；继承型（descendant/dependent/migration）或
// 不可归属（global/legacy-baseline-missing）落一个 prototype:drift 兜底触发，保证不漏脏。
// 同 triggerRef+同指纹幂等（广播风暴：一次漂移只置一次脏，复评前重复 sync 不叠加）。
export function syncDriftTriggers(map, impact, { at = null } = {}) {
  if (!impact || impact.status !== "review_required")
    return { changed: false, status: impact?.status ?? "unknown", flagged: [], skipped: [] };
  const changedEntries = new Set(impact.changedEntryIds ?? []);
  const changedGroups = new Set(impact.changedGroupIds ?? []);
  const changedRequirements = new Set(impact.changedRequirementIds ?? []);
  const changedQuestions = new Set(impact.changedQuestionIds ?? []);
  const byId = new Map((map.features ?? []).map((feature) => [feature.id, feature]));
  const flagged = [], skipped = [];
  for (const item of impact.affected ?? []) {
    const feature = byId.get(item.id);
    if (!feature) { skipped.push({ feature: item.id, reason: "功能点不在当前地图（可能已迁移/移除）" }); continue; }
    const reasons = new Set(item.reasons ?? []);
    const triggers = [];
    for (const entry of feature.sourceEntries ?? []) if (changedEntries.has(entry)) triggers.push({ triggerRef: `prototype:${entry}`, triggerKind: "prototype-entry" });
    for (const group of feature.sourceFeatureIds ?? []) if (changedGroups.has(group)) triggers.push({ triggerRef: `prototype:${group}`, triggerKind: "prototype-group" });
    for (const requirement of feature.sourceRequirementIds ?? []) if (changedRequirements.has(requirement)) triggers.push({ triggerRef: `requirement:${requirement}`, triggerKind: null });
    for (const question of feature.sourceQuestionIds ?? []) if (changedQuestions.has(question)) triggers.push({ triggerRef: `question:${question}`, triggerKind: null });
    const inherited = [...reasons].some(reason => reason.startsWith("descendant:") || reason.startsWith("dependent:") || reason === "migration_descendant" || reason === "global_or_unattributed_change" || reason === "legacy_baseline_missing");
    if (!triggers.length || inherited || impact.global) triggers.push({ triggerRef: "prototype:drift", triggerKind: "prototype-group" });
    for (const trigger of triggers) {
      const result = flagFeatureTrigger(map, {
        featureRef: `feature:${feature.id}`,
        triggerRef: trigger.triggerRef,
        triggerKind: trigger.triggerKind,
        triggerFingerprint: impact.to,
        source: `impact:${impact.id}`,
        at,
      });
      if (result.changed) flagged.push({ feature: feature.id, triggerRef: trigger.triggerRef });
    }
  }
  return { changed: flagged.length > 0, status: "review_required", flagged, skipped };
}

// 显式清脏：复评任务完成后，把该功能点全部 open 触发落为 cleared（记录 clearedByTask/clearedAt）。
// 已 cleared 或无触发 → 无变化；不做指纹推导（“显式写入状态”原则），open 只能由 flagFeatureTrigger 产生。
export function clearFeatureTriggers(map, { featureRef, clearedByTask, at = null }) {
  const feature = featureInMap(map, featureRef);
  if (!feature) return { changed: false, reason: `功能点不存在：${featureRef}` };
  const container = ensureTriggersArray(feature);
  const cleared = [];
  for (const trigger of container.triggers) {
    if (trigger.status !== "open") continue;
    trigger.status = "cleared";
    trigger.clearedByTask = clearedByTask;
    trigger.clearedAt = at;
    cleared.push(trigger.triggerRef);
  }
  return { changed: cleared.length > 0, featureRef, cleared };
}

class Builder {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.problems = [];
    this.entryRefs = new Set();
  }

  inferKind(ref) {
    const prefix = refPrefix(ref);
    if (prefix === "prototype") return this.entryRefs.has(ref) ? "prototype-entry" : "prototype-group";
    return { feature: "feature", "feature-group": "feature-group", prd: "prd-source", system: "system-card", code: "code-file", source: "prototype-source-file", task: "task", release: "release", project: "project" }[prefix] ?? "unknown";
  }

  ensureNode(ref, patch = {}) {
    if (typeof ref !== "string" || !ref.includes(":")) {
      this.problems.push(`非法引用被跳过：${JSON.stringify(ref)}`);
      return null;
    }
    let node = this.nodes.get(ref);
    if (!node) {
      node = { ref, kind: this.inferKind(ref), objectRef: null, label: null, truthPointer: null, fingerprint: null, reassessment: [] };
      this.nodes.set(ref, node);
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === null) continue;
      if (key === "kind") { if (node.kind === "prototype-group" && this.entryRefs.has(ref)) node.kind = "prototype-entry"; continue; }
      if (node[key] === null || node[key] === undefined || (Array.isArray(node[key]) && !node[key].length)) node[key] = value;
    }
    if (!node.objectRef) node.objectRef = objectRefForGraphNode(ref, node.kind);
    return node;
  }

  addEdge(from, to, kind, declaredBy) {
    if (!from || !to || !this.ensureNode(from) || !this.ensureNode(to)) return null;
    const combo = EDGE_COMBOS[kind];
    if (!combo || !combo.from.includes(refPrefix(from)) || !combo.to.includes(refPrefix(to))) {
      this.problems.push(`边组合不合法：${from} -[${kind}]-> ${to}`);
      return null;
    }
    const id = `edge:${sha256(`${kind}|${from}|${to}|${declaredBy}`).slice("sha256:".length, "sha256:".length + 16)}`;
    if (this.edges.has(id)) return this.edges.get(id);
    const edge = { id, kind, from, to, declaredBy: declaredBy ?? null, basisFingerprint: null, at: null };
    this.edges.set(id, edge);
    return edge;
  }
}

/** 从真源构建图数据（纯读，不落盘）。prototypeView 供测试注入；生产经 planningPrototype 读 catalog。 */
export function buildGraph(projectRoot, options = {}) {
  const store = path.join(projectRoot, STORE_DIRECTORY);
  const builder = new Builder();
  const notes = [];

  // —— feature-map：节点 + scope-ref/parent/depends-on 边 + reassessment 投影 ——
  const map = readJsonSafe(path.join(store, "planning", "feature-map.json"));
  const entryRefs = new Set();
  for (const feature of map?.features ?? []) for (const entry of feature.sourceEntries ?? []) entryRefs.add(`prototype:${entry}`);
  builder.entryRefs = entryRefs;

  // —— catalog 分组/入口指纹（M3b）：读失败如实报告，不猜测范围 ——
  let catalogView = options.prototypeView ?? null;
  if (!catalogView && hasPrototypeCatalog(projectRoot)) {
    try {
      catalogView = planningPrototype(projectRoot);
    } catch (error) {
      builder.problems.push(`catalog 视图不可用，分组指纹缺省：${String(error.message ?? error).slice(0, 200)}`);
    }
  }
  const fps = catalogView ? computePrototypeFingerprints(catalogView) : null;
  if (fps) {
    for (const entryId of fps.entries.keys()) entryRefs.add(`prototype:${entryId}`);
    for (const [groupId, fingerprint] of fps.groups)
      builder.ensureNode(`prototype:${groupId}`, { fingerprint, truthPointer: `prototype/catalog.sqlite#group/${groupId}` });
    for (const [entryId, fingerprint] of fps.entries) {
      builder.ensureNode(`prototype:${entryId}`, { fingerprint, truthPointer: `prototype/catalog.sqlite#entry/${entryId}` });
      const groupId = fps.entryGroup.get(entryId);
      if (groupId && fps.groups.has(groupId)) builder.addEdge(`prototype:${entryId}`, `prototype:${groupId}`, "parent", "catalog");
    }
    if (fps.globalIssues) notes.push(`存在 ${fps.globalIssues} 条无法归属的需求/问题，已保守计入全部分组指纹（协议：不可安全归属→整图复评）。`);
  }

  const groupIds = new Set((map?.groups ?? []).map(group => group.id));
  for (const group of map?.groups ?? []) builder.ensureNode(`feature-group:${group.id}`, { kind: "feature-group", label: group.title ?? null, truthPointer: "planning/feature-map.json#groups" });
  for (const feature of map?.features ?? []) {
    const ref = `feature:${feature.id}`;
    const stripped = Object.fromEntries(Object.entries(feature).filter(([key]) => !FEATURE_VOLATILE.includes(key)));
    builder.ensureNode(ref, { label: feature.title ?? null, truthPointer: "planning/feature-map.json#features", fingerprint: sha256(stableStringify(stripped)), reassessment: reassessmentTriggers(feature) });
    if (feature.parentId)
      builder.addEdge(ref, groupIds.has(feature.parentId) ? `feature-group:${feature.parentId}` : `feature:${feature.parentId}`, "parent", "feature-map");
    for (const dependency of feature.dependsOn ?? []) builder.addEdge(ref, `feature:${dependency}`, "depends-on", "feature-map");
    for (const scope of feature.scopeRefs ?? []) {
      const ref2 = scope.includes(":") ? scope : `prototype:${scope}`;
      builder.addEdge(ref, ref2, "scope-ref", "feature-map");
    }
    for (const entry of feature.sourceEntries ?? []) builder.addEdge(ref, `prototype:${entry}`, "scope-ref", "feature-map:sourceEntries");
    for (const card of feature.systemCardRefs ?? []) builder.addEdge(ref, `system:${card}`, "scope-ref", "feature-map:systemCardRefs");
  }

  // —— PRD：来源节点 + findings affectsLinks ——
  const manifest = readJsonSafe(path.join(store, "prd", "manifest.json"));
  for (const source of manifest?.sources ?? []) {
    const file = path.join(store, "prd", "sources", `${source.id}.md`);
    let fingerprint = null;
    if (fs.existsSync(file)) fingerprint = sha256(fs.readFileSync(file, "utf8"));
    builder.ensureNode(`prd:${source.id}`, { label: source.title ?? source.id, truthPointer: `prd/sources/${source.id}.md`, fingerprint });
  }
  const analysesDir = path.join(store, "prd", "analyses");
  if (fs.existsSync(analysesDir)) {
    for (const batch of fs.readdirSync(analysesDir).sort()) {
      const findings = readJsonSafe(path.join(analysesDir, batch, "findings.json"));
      for (const link of findings?.affectsLinks ?? []) {
        if (!link?.sourceId || !link?.to) continue;
        builder.addEdge(`prd:${link.sourceId}`, link.to, "evidence-for", `prd-findings:${batch}`);
      }
    }
  }

  // —— 系统卡片 ——
  const cards = readJsonSafe(path.join(store, "system", "cards.json"));
  for (const card of cards?.cards ?? []) {
    const stripped = Object.fromEntries(Object.entries(card).filter(([key]) => !CARD_VOLATILE.includes(key)));
    builder.ensureNode(`system:${card.id}`, { label: card.title ?? card.id, truthPointer: "system/cards.json", fingerprint: sha256(stableStringify(stripped)) });
  }

  // —— kernel 任务记录：task 节点 + implements/observed-change 边 ——
  const tasksRoot = path.join(store, "tasks");
  const kernelTaskRefs = new Set();
  if (fs.existsSync(tasksRoot)) {
    for (const entry of fs.readdirSync(tasksRoot).sort()) {
      const full = path.join(tasksRoot, entry);
      if (!fs.statSync(full).isDirectory()) continue;
      for (const taskFile of fs.readdirSync(full).sort()) {
        const record = readJsonSafe(path.join(full, taskFile));
        if (record?.kind !== "task") continue;
        const ref = `task:${record.id}`;
        kernelTaskRefs.add(ref);
        const stripped = Object.fromEntries(Object.entries(record).filter(([key]) => !TASK_VOLATILE.includes(key)));
        builder.ensureNode(ref, {
          label: record.title ?? null,
          objectRef: safeObjectRef("task", `kernel/${record.id}`),
          truthPointer: `tasks/${entry}/${taskFile}`,
          fingerprint: sha256(stableStringify(stripped)),
        });
        for (const source of record.sourceRefs ?? []) builder.addEdge(ref, source, "implements", `kernel:${record.id}`);
        for (const touched of record.touchedRefs ?? []) {
          builder.addEdge(ref, touched.ref, "observed-change", `kernel:${record.id}`);
          const local = path.join(projectRoot, touched.ref.slice("code:".length));
          if (touched.ref.startsWith("code:") && !fs.existsSync(local))
            builder.problems.push(`code 文件不存在（可能已删除/改名）：${touched.ref}`);
        }
      }
    }
  }
  // —— 执行索引兜底 implements（kernel 尚未覆盖的历史运行；已覆盖的以 kernel 为单一真源，不产平行边）——
  const index = readJsonSafe(path.join(store, "execution-index.json"));
  for (const run of index?.runs ?? []) {
    for (const task of run.tasks ?? []) {
      if (kernelTaskRefs.has(`task:${run.id}/${task.id}`)) continue;
      if (!(task.features ?? []).length) continue;
      builder.ensureNode(`task:${run.id}/${task.id}`, {
        objectRef: safeObjectRef("task", `${run.type}/${run.id}/${task.id}`),
      });
      for (const feature of task.features) builder.addEdge(`task:${run.id}/${task.id}`, `feature:${feature}`, "implements", "execution-index");
    }
  }

  if (!fps && [...builder.nodes.values()].some(node => node.kind.startsWith("prototype-")))
    notes.push("无 catalog 视图：prototype 节点指纹为空，置脏依赖复评任务 apply 显式登记（M2 §3.5）。");

  const nodes = [...builder.nodes.values()].sort((a, b) => (a.ref < b.ref ? -1 : 1));
  const edges = [...builder.edges.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const graph = { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges };
  return { graph, problems: [...new Set(builder.problems)], notes };
}

/** 与已存 graph.json 比较（漂移只报事实，不推断）。 */
export function driftAgainst(previous, next) {
  if (!previous) return null;
  const oldNodes = new Map(previous.nodes.map(node => [node.ref, node]));
  const newNodes = new Map(next.nodes.map(node => [node.ref, node]));
  const drift = { addedNodes: [], removedNodes: [], fingerprintChanged: [] };
  for (const ref of [...newNodes.keys()].sort()) if (!oldNodes.has(ref)) drift.addedNodes.push(ref);
  for (const ref of [...oldNodes.keys()].sort()) if (!newNodes.has(ref)) drift.removedNodes.push(ref);
  for (const [ref, node] of [...newNodes.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const old = oldNodes.get(ref);
    if (old && old.fingerprint !== node.fingerprint)
      drift.fingerprintChanged.push({ ref, from: old.fingerprint, to: node.fingerprint });
  }
  return drift.addedNodes.length || drift.removedNodes.length || drift.fingerprintChanged.length ? drift : null;
}

/** 构建并落盘（原子、字节确定）；check=true 只比较不写。 */
export function writeGraph(projectRoot, { check = false, prototypeView = null } = {}) {
  const { graph, problems, notes } = buildGraph(projectRoot, { prototypeView });
  const serialized = `${stableStringify(graph)}\n`;
  const file = graphFile(projectRoot);
  const previous = readJsonSafe(file);
  const drift = driftAgainst(previous, graph);
  if (check) return { matches: !drift && stableStringify(previous) === serialized.trim(), drift, problems, notes, counts: { nodes: graph.nodes.length, edges: graph.edges.length } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, serialized);
  fs.renameSync(temporary, file);
  const lines = [
    `# graph build 报告`,
    ``,
    `- 生成：${new Date().toISOString()}`,
    `- 节点 ${graph.nodes.length}，边 ${graph.edges.length}`,
    drift ? `- 相对上次构建：+${drift.addedNodes.length} -${drift.removedNodes.length} 指纹变化 ${drift.fingerprintChanged.length}` : `- 相对上次构建：无漂移`,
  ];
  if (problems.length) lines.push(``, `## 问题（不猜测，逐条列出）`, ...problems.map(p => `- ${p}`));
  if (notes.length) lines.push(``, ...notes.map(n => `> 备注：${n}`));
  fs.writeFileSync(graphReportFile(projectRoot), `${lines.join("\n")}\n`);
  return { written: true, drift, problems, notes, counts: { nodes: graph.nodes.length, edges: graph.edges.length } };
}

export function loadGraph(projectRoot) {
  const graph = readJsonSafe(graphFile(projectRoot));
  return graph?.schemaVersion === GRAPH_SCHEMA_VERSION && Array.isArray(graph.nodes) && Array.isArray(graph.edges) ? graph : null;
}
