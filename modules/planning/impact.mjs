import fs from "node:fs";
import { hasPrototypeCatalog, publicPrototypeRevision, semanticRows, relatedQuestion } from "../prototype/client.mjs";
import path from "node:path";
import crypto from "node:crypto";
import { featureAnalysisProblems } from "../../dashboard/server/feature-analysis.js";
import { STORE_DIRECTORY } from "../skill-identity.mjs";

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const impactHash = (value) => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const text = (value) => typeof value === "string" && Boolean(value.trim());
const list = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(values)].sort();
const readJson = (file, fallback = null) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
const fileHash = (file) => {
  try { return fs.statSync(file).isFile() ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "not-file"; }
  catch { return "missing"; }
};

// Read-only content fingerprints, not a prototype scan or proof of coverage.
// Include prose/questions even when the caller did not update a timestamp/version.
export function readPrototypeRevision(store) {
  const root = path.dirname(store);
  if (hasPrototypeCatalog(root)) return publicPrototypeRevision(root, { planning: true });
  const directory = path.join(store, "prototype");
  const index = readJson(path.join(directory, "feature-index.json"), {});
  const coverage = readJson(path.join(directory, "coverage.json"), {});
  const questions = readJson(path.join(directory, "open-questions.json"), {});
  const task = readJson(path.join(directory, "task.json"), {});
  const project = readJson(path.join(store, "project.json"), {});
  const docFile = path.join(directory, "原型图流程.md");
  const document = fs.existsSync(docFile) ? fs.readFileSync(docFile, "utf8") : "";
  const sections = new Map();
  let globalDocument = "";
  // A published group is an H1 report with exactly one explicit stable ID.
  // Unattributable text is global: conservative invalidation, never silently ignored.
  for (const section of document.split(/(?=^# )/m)) {
    const ids = [...section.matchAll(/^- 分组 ID：`([^`]+)`\s*$/gm)].map((match) => match[1]);
    if (ids.length === 1 && !sections.has(ids[0])) sections.set(ids[0], section);
    else globalDocument += section;
  }
  const entries = list(coverage.sourceInventory?.entries);
  const groups = list(index.features).map((group) => ({
    id: group.id,
    hash: impactHash({ group, entryIds: entries.filter((entry) => entry.feature === group.id).map((entry) => entry.id).sort(), document: sections.get(group.id) ?? null,
      questions: list(questions.questions).filter((question) => question.featureId === group.id) }),
    entryIds: unique([...list(group.sourceEntries), ...entries.filter((entry) => entry.feature === group.id).map((entry) => entry.id)]),
  }));
  const sourceFiles = unique([
    ...list(coverage.sourceInventory?.sourceFiles).map((source) => source.path),
    ...(text(project.prototype?.location) && !/^https?:/i.test(project.prototype.location) ? [project.prototype.location] : []),
  ].filter(text)).map((ref) => ({ path: ref, hash: fileHash(path.resolve(root, ref)) }));
  const sourceProblems = sourceFiles.filter((source) => {
    const expected = list(coverage.sourceInventory?.sourceFiles).find((item) => item.path === source.path)?.sha256;
    return source.hash === "missing" || source.hash === "not-file" || (expected && expected !== source.hash);
  }).map((source) => `原型源码 ${source.path} 与已归档覆盖基线不一致/不可读取；先补证并更新长期真源`);
  const screenshotHash = (evidence) => {
    if (!task.source?.prototypeRun || !text(evidence?.path)) return null;
    const file = path.resolve(store, "prototype-runs", task.source.prototypeRun, evidence.path);
    return file.startsWith(`${path.resolve(store)}${path.sep}`) ? fileHash(file) : "outside-archive";
  };
  const entryRevisions = entries.map((entry) => ({ id: entry.id, groupId: entry.feature,
    hash: impactHash({ entry, coverage: list(coverage.coverage).filter((item) => item.id === entry.id)
      .map((item) => ({ ...item, screenshotHashes: list(item.evidence).map(screenshotHash) })) }) }));
  const groupIds = new Set(groups.map((group) => group.id));
  const global = impactHash({ globalDocument,
    orphanSections: [...sections].filter(([id]) => !groupIds.has(id)),
    orphanQuestions: list(questions.questions).filter((question) => !groupIds.has(question.featureId)),
    source: task.source, status: task.status, registration: project.prototype, sourceFiles,
    inventory: { ...coverage.sourceInventory, entries: undefined },
    interactions: coverage.sourceInteractionInventory,
  });
  const files = Object.fromEntries(["task.json", "feature-index.json", "coverage.json", "open-questions.json", "原型图流程.md"]
    .map((name) => [name, fileHash(path.join(directory, name))]));
  const revision = { schemaVersion: 1, groups, entries: entryRevisions, global, files, sourceFiles, sourceProblems };
  return { ...revision, fingerprint: impactHash(revision) };
}

export function prototypeImpact(map, revision) {
  const previous = map?.prototypeBaseline;
  const changed = !previous || previous.fingerprint !== revision.fingerprint;
  const changedIds = (before, after) => {
    const old = new Map(list(before).map((item) => [item.id, item.hash]));
    const next = new Map(list(after).map((item) => [item.id, item.hash]));
    return unique([...old.keys(), ...next.keys()]).filter((id) => old.get(id) !== next.get(id));
  };
  const groupIds = changedIds(previous?.groups, revision.groups);
  const entryIds = changedIds(previous?.entries, revision.entries);
  const requirementIds = changedIds(previous?.requirements, revision.requirements);
  const questionIds = changedIds(previous?.questions, revision.questions);
  // A file-only change outside known groups/entries is not safely localizable.
  const global = changed && (!previous || previous.schemaVersion !== 1 || previous.global !== revision.global || (!groupIds.length && !entryIds.length));
  const reasons = new Map();
  const add = (id, reason) => { if (!reasons.has(id)) reasons.set(id, new Set()); reasons.get(id).add(reason); };
  const nodes = [...list(map?.groups), ...list(map?.features)];
  if (changed) for (const node of nodes) {
    if (global) add(node.id, previous ? "global_or_unattributed_change" : "legacy_baseline_missing");
    if (list(node.sourceRequirementIds).some(id => requirementIds.includes(id))) add(node.id, "user_requirement_changed");
    if (list(node.sourceQuestionIds).some(id => questionIds.includes(id))) add(node.id, "question_answer_changed");
    if (list(node.sourceFeatureIds).some((id) => groupIds.includes(id))) add(node.id, "prototype_group_changed");
    if (list(node.sourceEntries).some((id) => entryIds.includes(id))) add(node.id, "prototype_entry_changed");
    // Entry ownership may survive a renamed/deleted group.
    if ([...list(previous?.groups), ...list(revision.groups)].some((group) => groupIds.includes(group.id) && list(group.entryIds).some((id) => list(node.sourceEntries).includes(id))))
      add(node.id, "prototype_group_changed");
  }
  // Fixed point: every descendant (no depth limit), then reverse dependency closure.
  let size;
  do {
    size = reasons.size;
    for (const migration of list(map?.migrations)) if (list(migration.from).some((id) => groupIds.includes(id) || reasons.has(id)))
      for (const id of list(migration.to)) add(id, "migration_descendant");
    for (const node of nodes) {
      if (reasons.has(node.parentId)) add(node.id, `descendant:${node.parentId}`);
      for (const dependency of list(node.dependsOn)) if (reasons.has(dependency)) add(node.id, `dependent:${dependency}`);
    }
  } while (size !== reasons.size);
  const affected = list(map?.features).filter((feature) => reasons.has(feature.id)).map((feature) => ({
    id: feature.id, status: feature.status, reasons: [...reasons.get(feature.id)].sort(),
  }));
  const result = { schemaVersion: 1, from: previous?.fingerprint ?? null, to: revision.fingerprint,
    status: changed ? "review_required" : "current", global, changedGroupIds: groupIds,
    changedEntryIds: entryIds, changedRequirementIds: requirementIds, changedQuestionIds: questionIds, assessedFeatureIds: list(map?.features).map(f => f.id), affected, baselineMissing: !previous };
  return { ...result, id: impactHash(result) };
}

export const planningFields = (feature) => Object.fromEntries([
  "id", "parentId", "title", "rank", "outcome", "description", "developmentRequirements", "sourceEntries",
  "sourceRequirementIds", "sourceQuestionIds", "scopeRefs", "moduleRefs", "codeRefs", "systemCardRefs", "priority", "wave", "status", "dependsOn", "blockers",
].map((key) => [key, feature?.[key] ?? null]));
const deliveryFields = (feature) => Object.fromEntries(Object.entries(planningFields(feature)).filter(([key]) => !["priority", "wave", "rank"].includes(key)));

// Recomputed from the frozen old map; an editable affected-ID list is never authority.
export function impactReviewProblems({ previousMap, revision, proposal, currentMap, records = [] }) {
  const problems = [...list(revision.sourceProblems)];
  if (previousMap?.prototypeBaseline && impactHash(previousMap.prototypeBaseline.sourceFiles) !== impactHash(revision.sourceFiles)
    && impactHash(previousMap.prototypeBaseline.files) === impactHash(revision.files))
    problems.push("原型源码已变，但长期原型真源尚未更新；先按原型流程补证，不能直接刷新规划基线");
  if (impactHash(previousMap) !== impactHash(currentMap)) problems.push("功能地图已变化；重新 feature refine，不能覆盖其他规划/执行更新");
  if (!previousMap) return problems;
  const impact = prototypeImpact(previousMap, revision);
  // A technical leaf that has shipped leaves its dependent product leaves with
  // an open delivery-side reassessment obligation, independent of any
  // prototype change. Treat those as mandatory review targets so the proposal
  // cannot silently ship without a documented preserve/revalidate decision.
  const delivery = deliveryImpactRecords(previousMap, records);
  const deliveryRequired = new Set(delivery.affected.map((item) => item.id));
  if (impact.status === "current" && !deliveryRequired.size) return problems;
  if (impact.status !== "current" && proposal.prototypeImpactId !== impact.id)
    problems.push("prototypeImpactId 与冻结的原型变更影响不一致");
  const reviews = list(proposal.impactReviews);
  const previousById = new Map(list(previousMap.features).map((feature) => [feature.id, feature]));
  const nextById = new Map(list(proposal.features).map((feature) => [feature.id, feature]));
  const requiredIds = new Set(impact.affected.map((item) => item.id));
  for (const id of deliveryRequired) requiredIds.add(id);
  // Newly added features must also explain their direction; retired features remain traceable.
  for (const feature of list(proposal.features)) if (!previousById.has(feature.id)) requiredIds.add(feature.id);
  for (const review of reviews) if (!requiredIds.has(review?.featureId)) problems.push(`未知或无须复评的功能：${review?.featureId}`);
  for (const id of requiredIds) {
    const matches = reviews.filter((review) => review?.featureId === id);
    if (matches.length !== 1) { problems.push(`功能 ${id} 必须且只能有一条 impactReviews 复评结论`); continue; }
    const review = matches[0];
    const old = previousById.get(id);
    if (!new Set(["keep", "revise", "split", "merge", "retire", "add"]).has(review.decision)) problems.push(`功能 ${id} 复评 decision 无效`);
    if ((old && review.decision === "add") || (!old && review.decision !== "add")) problems.push(`功能 ${id} 新增/既有复评类型不一致`);
    if (!text(review.reason)) problems.push(`功能 ${id} 缺少复评原因`);
    if (!["preserve", "revalidate"].includes(review.deliveryImpact)) problems.push(`功能 ${id} 必须评估 deliveryImpact: preserve/revalidate`);
    if (review.decision === "keep" && review.deliveryImpact !== "preserve") problems.push(`功能 ${id} keep 应保持原交付版本`);
    if (["split", "merge", "retire", "add"].includes(review.decision) && review.deliveryImpact !== "revalidate") problems.push(`功能 ${id} 结构/范围变化必须重新验收`);
    if (old && review.decision === "revise" && review.deliveryImpact === "preserve" && impactHash(deliveryFields(old)) !== impactHash(deliveryFields(nextById.get(id))))
      problems.push(`功能 ${id} 不只是 P/W/rank 或分析理由变化，不能 preserve 旧交付验收`);
    for (const field of ["scope", "status", "dependencies", "priority", "wave", "acceptance"])
      if (!text(review.checks?.[field])) problems.push(`功能 ${id} 缺少 checks.${field} 评估理由`);
    for (const kind of ["prototype", "code", "system"])
      if (!list(review.evidence).some((item) => item?.kind === kind && text(item.ref) && text(item.note))) problems.push(`功能 ${id} 缺少 ${kind} 复评证据`);
    const targets = list(review.targets);
    if (!targets.length || unique(targets).length !== targets.length || targets.some((target) => !nextById.has(target))) problems.push(`功能 ${id} targets 必须唯一且存在于新地图`);
    if (old && !list(proposal.migrations).some((migration) => list(migration.from).includes(id) && targets.every((target) => list(migration.to).includes(target))))
      problems.push(`旧叶子功能 ${id} 缺少到复评 targets 的迁移，不能只迁移原型分组`);
    if (["keep", "revise", "retire", "add"].includes(review.decision) && (targets.length !== 1 || targets[0] !== id)) problems.push(`功能 ${id} 的 ${review.decision} 必须保留自身 ID`);
    if (review.decision === "split" && targets.length < 2) problems.push(`功能 ${id} split 至少需要两个目标`);
    if (review.decision === "merge" && !list(proposal.migrations).some((migration) => list(migration.from).includes(id) && list(migration.from).filter((from) => previousById.has(from)).length >= 2)) problems.push(`功能 ${id} merge 缺少多个旧叶子来源`);
    if (review.decision === "keep" && impactHash(planningFields(old)) !== impactHash(planningFields(nextById.get(id)))) problems.push(`功能 ${id} 声称 keep 却修改了范围、状态、依赖或 P/W`);
    if (review.decision === "retire" && !["park", "skipped"].includes(nextById.get(id)?.status)) problems.push(`功能 ${id} retire 必须保留为 park/skipped`);
    for (const target of targets) {
      const feature = nextById.get(target);
      if (!feature) continue;
      if (!feature.analysis) problems.push(`功能 ${target} 必须补齐详细 analysis`);
      problems.push(...featureAnalysisProblems(feature));
      if (review.deliveryImpact === "revalidate" && review.decision !== "retire" && !["not_started", "blocked", "park"].includes(feature.status)) problems.push(`变更后的功能 ${target} 必须待开发/阻塞/暂缓，不能继承旧 done 或进行中结论`);
    }
    const tasks = records.filter((record) => record.featureId === id);
    for (const task of tasks) {
      const decisions = list(review.taskDecisions).filter((item) => item.runId === task.runId && item.taskId === task.taskId);
      if (decisions.length !== 1 || !text(decisions[0].reason)) { problems.push(`功能 ${id} 必须评估历史任务 ${task.runId}/${task.taskId}`); continue; }
      const action = decisions[0].action;
      if (!["continue", "historical", "superseded"].includes(action)) problems.push(`任务 ${task.taskId} 的复评 action 无效`);
      const active = task.taskStatus !== "skipped" && (task.taskStatus !== "done" || task.continuationOpen);
      if (active && (review.deliveryImpact !== "preserve" || action !== "continue")) problems.push(`任务 ${task.runId}/${task.taskId} 仍在执行旧范围；先按授权 work supersede，再重新 refine`);
      if (!active && action === "continue") problems.push(`历史终态任务 ${task.taskId} 不能记为 continue`);
      if (action === "superseded" && task.taskStatus !== "skipped") problems.push(`任务 ${task.taskId} 尚未实际 supersede/skipped`);
    }
  }
  // Never silently drop or mutate an old leaf outside the computed impact closure.
  for (const old of list(previousMap.features)) if (!requiredIds.has(old.id)) {
    if (!nextById.has(old.id) || impactHash(planningFields(old)) !== impactHash(planningFields(nextById.get(old.id))))
      problems.push(`未受影响功能 ${old.id} 被改写；本次原型复评须保留，其他重组另开 refinement`);
  }
  return unique(problems);
}

export function prototypeDevelopmentProblems(store, map, featureIds = null) {
  if (!map) return [];
  try {
    const revision = readPrototypeRevision(store);
    const impact = prototypeImpact(map, revision);
    const selected = featureIds ?? list(map.features).map((feature) => feature.id);
    const affected = impact.affected.filter((feature) => selected.includes(feature.id));
    const missing = selected.filter((id) => !list(map.features).some((feature) => feature.id === id));
    const problems = [...list(revision.sourceProblems), ...missing.map((id) => `功能 ${id} 已迁移/移除；旧任务不能继续写入`)];
    if (hasPrototypeCatalog(path.dirname(store))) {
      const questions = semanticRows(path.dirname(store), 'questions').filter(q => q.status !== 'resolved');
      const requirements = new Map(semanticRows(path.dirname(store), 'requirements').map(r => [r.id, r]));
      for (const feature of list(map.features).filter(f => selected.includes(f.id))) {
        for (const question of questions.filter(q => relatedQuestion(q, map, feature))) problems.push(`功能 ${feature.id} 的原型问题 ${question.id} 尚未回答`);
        for (const id of feature.sourceRequirementIds ?? []) {
          const requirement = requirements.get(id);
          if (!requirement || (requirement.status !== 'confirmed' && !(requirement.kind === 'technical' && requirement.status === 'proposed')))
            problems.push(`功能 ${feature.id} 的用户需求 ${id} 尚未确认或已撤回`);
        }
      }
    }
    if (affected.length || (featureIds === null && impact.status !== "current"))
      problems.push(`原型变更复评门禁：${affected.map((feature) => feature.id).join("、") || "新增或未归属范围"}；先 feature impact → feature refine → 逐项复评 → feature apply`);
    // Technical-release impact: a technical leaf that just shipped may
    // invalidate the user-facing flow for any product leaf that depends on
    // it. Surface a gate so those product leaves cannot start new tasks
    // without a delivery-side impact review that documents preserve/revalidate.
    const delivery = deliveryImpactClosure(map, store);
    if (delivery.affected?.length) {
      const selectedDelivery = featureIds == null
        ? delivery.affected
        : delivery.affected.filter((item) => featureIds.includes(item.id));
      if (selectedDelivery.length)
        problems.push(`技术发布复评门禁：${selectedDelivery.map((item) => `${item.id}（via ${item.via}）`).join("、")}；先 feature impact --trigger delivery → 增补 impactReviews → feature refine → feature apply`);
    }
    return problems;
  } catch (error) { return [`原型变更复评门禁无法核验：${error.message}`]; }
}

// 功能复评读取调用 CLI 所在工作区；不要让 Dashboard 构建期追踪整个工作区。
const STORE_ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd(), STORE_DIRECTORY);

function scanDeliveryClosure(store = STORE_ROOT) {
  const records = [];
  const base = path.join(store, "delivery-runs");
  if (!fs.existsSync(base)) return records;
  for (const runId of fs.readdirSync(base)) {
    const runDir = path.join(base, runId);
    const planFile = path.join(runDir, "work-plan.json");
    if (!fs.existsSync(planFile)) continue;
    const plan = readJson(planFile, {});
    const runRecord = readJson(path.join(runDir, "run.json"), {});
    for (const task of plan.tasks ?? []) {
      const executionFile = path.join(runDir, "executions", `${task.id}.json`);
      const execution = readJson(executionFile, null);
      const taskStatus = execution?.status ?? (runRecord.status === "skipped" ? "skipped" : "pending");
      for (const featureId of task.leafFeatureIds ?? []) {
        records.push({
          runId,
          taskId: task.id,
          taskScope: task.scope ?? "governance",
          taskStatus,
          featureId,
          updatedAt: execution?.updatedAt ?? task.createdAt ?? runRecord.updatedAt ?? null,
        });
      }
    }
  }
  return records.sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
}

/**
 * Project a technical→product impact closure from an explicit delivery record
 * list: any product leaf that dependsOn a technical leaf whose latest delivery
 * record is `done` is reported as affected unless already documented by a
 * `reassessment.reviews` decision in the given map.
 */
export function deliveryImpactRecords(map, records) {
  if (!map) return { status: "no_map", releasedTechnicalIds: [], affected: [] };
  const featureById = new Map((map.features ?? []).map((feature) => [feature.id, feature]));
  const releasedTechnicalIds = new Set();
  for (const record of list(records)) {
    if (record.taskScope !== "technical") continue;
    if (record.taskStatus !== "done") continue;
    const feature = featureById.get(record.featureId);
    if (!feature || (feature.kind ?? "product") !== "technical") continue;
    releasedTechnicalIds.add(feature.id);
  }
  if (!releasedTechnicalIds.size) {
    return { status: "current", releasedTechnicalIds: [], affected: [] };
  }
  const dependents = new Map();
  for (const feature of map.features ?? []) {
    if ((feature.kind ?? "product") !== "product") continue;
    for (const dependency of feature.dependsOn ?? []) {
      if (releasedTechnicalIds.has(dependency)) {
        const list = dependents.get(dependency) ?? [];
        list.push(feature.id);
        dependents.set(dependency, list);
      }
    }
  }
  const reviewed = new Set();
  for (const feature of map.features ?? []) {
    const reviews = feature.reassessment?.reviews ?? [];
    for (const review of reviews) {
      if (["preserve", "revalidate"].includes(review.deliveryImpact)) {
        for (const target of review.targets ?? []) reviewed.add(target);
      }
    }
  }
  const affected = [];
  for (const [technicalId, productIds] of dependents) {
    for (const productId of productIds) {
      if (reviewed.has(productId)) continue;
      affected.push({
        id: productId,
        via: technicalId,
        reasons: [`technical_release:${technicalId}`],
      });
    }
  }
  return {
    status: affected.length ? "review_required" : "current",
    releasedTechnicalIds: [...releasedTechnicalIds].sort(),
    affected,
  };
}

/**
 * Scan the store's delivery runs and delegate to deliveryImpactRecords.
 * Kept as the CLI-facing entry point; the records-taking form is used by
 * impactReviewProblems so the projection can be validated in isolation.
 */
export function deliveryImpactClosure(map, store = STORE_ROOT) {
  return deliveryImpactRecords(map, scanDeliveryClosure(store));
}
