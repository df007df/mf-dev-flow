import { boundedPage } from '../prototype/core/paging.js';
import { STORE_DIRECTORY } from '../skill-identity.mjs';
// Flow module extracted from the existing runtime; shared gates retain one implementation.

import { hasPrototypeCatalog, planningPrototype, semanticRows, relatedQuestion, prototypeArchiveDirectory, prototypeArchiveExists } from "../prototype/client.mjs";

import path from "node:path";

import fs from "node:fs";

import { createHash } from "node:crypto";

import { readPrototypeRevision, prototypeImpact, impactHash, impactReviewProblems, prototypeDevelopmentProblems, deliveryImpactClosure } from "../../dashboard/server/prototype-impact.js";

import {
  featureAnalysisProblems,
  labelAssessmentHistory,
} from "../../dashboard/server/feature-analysis.js";

import { prototypeQuestionProblems } from "../../dashboard/server/state.js";

import { ACTIVE_DELIVERY_STATUSES, STORE, appendFeatureHistory, assertLeafFeatureIds, assertRelatedFeatureIds, compactBuild, createDeliveryRun, csv, currentFeatureMap, currentFile, defaultFeatureStages, deliveryDevelopmentRecords, ensureProject, ensureWorkPlan, executionFile, fail, featureEvidenceContext, featureHistoryFile, featureMapDeliveryCandidates, featureMapFile, gitValue, normalizeFeatureStages, now, openFeatureRisks, orderedFeatureGroups, orderedFeaturesInMap, planningDir, projectTaskStateToFeatureMap, prototypeDir, readFeatureHistory, readJson, readTaskLeafLinks, rebuildExecutionIndex, refinementBriefFile, refinementRuns, registerFeatureRisks, required, resolveFeatureRisk, resolveRun, runDir, slug, taskLeafLinksFile, timestamp, valueFor, writeFeatureMap, writeIfMissing, writeJson, writeRefinementCompactionArtifacts } from './shared.mjs';

export const FEATURE_PRIORITIES = /^P[0-4](?:-\d+)?$/;

export const FEATURE_STATES = new Set([
  "not_started",
  "in_progress",
  "blocked",
  "done",
  "skipped",
  "park",
]);

export const FEATURE_MIGRATION_TYPES = new Set([
  "split",
  "merge",
  "rename",
  "unchanged",
]);

export const FEATURE_MAP_SCHEMA_VERSION = 4;
/** Schema versions accepted on read. v3 leaves predate kind awareness and
 *  are normalized to kind=product on apply. v4 makes kind explicit and
 *  gates technical leaves with relaxed coverage requirements. */
export const FEATURE_MAP_READ_SCHEMA_VERSIONS = new Set([3, 4]);
export const FEATURE_KINDS = new Set(["product", "technical"]);

export const PROPOSAL_PATCH_SCHEMA_VERSION = 1;

export const PROPOSAL_PATCH_BYTES_MAX = 64_000;

export function nativeEvidencePath(value) { return typeof value === "string" && /^prototype\/analyses\/[^/]+\/(screenshots|evidence)\//.test(value); }

const reusableRefinementStatuses = new Set(["in_progress", "blocked"]);

function sameRefinementMap(left, right) {
  return impactHash(left ?? null) === impactHash(right ?? null);
}

function reusableRefinement(context, previousMap, scope) {
  return [...refinementRuns()]
    .reverse()
    .find((run) => {
      if (
        !reusableRefinementStatuses.has(run.run.status) ||
        (run.run.scope ?? "auto") !== scope
      )
        return false;
      const proposalFile = path.join(run.dir, "proposal.json");
      const previousMapFile = path.join(run.dir, "previous-map.json");
      if (!fs.existsSync(proposalFile) || !fs.existsSync(previousMapFile))
        return false;
      const proposal = readJson(proposalFile);
      return (
        proposal.evidenceCursor === context.evidenceCursor &&
        sameRefinementMap(readJson(previousMapFile), previousMap)
      );
    }) ?? null;
}

function resumeRefinement(run) {
  const current = fs.existsSync(currentFile())
    ? readJson(currentFile())
    : { schemaVersion: 1, active: null };
  if (!current.active?.type || current.active.type === "refinement")
    writeJson(currentFile(), {
      ...current,
      schemaVersion: 1,
      active: { type: "refinement", id: run.id },
      updatedAt: now(),
    });
  console.log(run.id);
  console.log(`规划事实未变化，复用已有 ${run.run.status === "blocked" ? "阻塞" : "进行中"}快照：${run.id}。`);
  console.log(`默认摘要：${refinementBriefFile(run)}`);
  console.log(`按组证据：run context --id ${run.id} --detail prototype|planning --group <ID>`);
}

function reuseAppliedFeatureMap(map) {
  console.log(map.sourceRun ?? "feature-map");
  console.log("规划事实未变化，当前功能地图已基于同一事实生效；无需新建快照。");
  console.log(`默认摘要：${planningDir()}/context-brief.md`);
}

function planningPublicationProblems(context) {
  const readiness = context?.prototype?.revision?.planningReadiness;
  if (!readiness) return [];
  const problems = [];
  if (readiness.status === "source_pending")
    problems.push(`当前原型来源待验收（已接受批次：${readiness.acceptedBatch ?? "无"}；活动批次：${readiness.activeBatch ?? "无"}）；已发布地图仍可使用，但不能 feature refine/apply 发布新地图`);
  if (readiness.status === "source_invalid")
    problems.push("已接受原型来源或证据不可核验；先按 prototype status 的缺口重新取证并接受");
  for (const item of readiness.scopeProblems ?? [])
    problems.push(`需求 ${item.id} 缺少有效影响范围：${item.problem}；用 groupId、entryIds 或 impactScope=global 修复后再 feature refine/apply`);
  return problems;
}

export function featureRefine() {
  ensureProject();
  if (!hasPrototypeCatalog(process.cwd())) for (const file of [
    path.join(prototypeDir(), "task.json"),
    path.join(prototypeDir(), "feature-index.json"),
    path.join(prototypeDir(), "coverage.json"),
  ]) {
    if (!fs.existsSync(file))
      fail("尚未建立长期原型真源；先完成 prototype init。");
  }
  rebuildExecutionIndex();
  const context = featureEvidenceContext();
  const publicationProblems = planningPublicationProblems(context);
  if (publicationProblems.length)
    fail(`功能地图暂不能刷新：\n- ${publicationProblems.join("\n- ")}`);
  const scope = valueFor("--scope") || "auto";
  const previousMap = fs.existsSync(featureMapFile())
    ? readJson(featureMapFile())
    : null;
  const existing = reusableRefinement(context, previousMap, scope);
  if (existing) {
    resumeRefinement(existing);
    return;
  }
  if (previousMap?.evidenceCursor === context.evidenceCursor) {
    reuseAppliedFeatureMap(previousMap);
    return;
  }
  const title = valueFor("--title") || "功能演进拆解";
  const id = `${timestamp()}-${slug(title)}`;
  const dir = runDir("refinement", id);
  const createdAt = now();
  const legacyFeatures = context.prototype.features;
  const impact = previousMap ? prototypeImpact(previousMap, context.prototype.revision) : null;
  const carryForwardMap =
    Array.isArray(previousMap?.features) &&
    previousMap.features.length &&
    Array.isArray(previousMap?.migrations) &&
    previousMap.migrations.length
      ? previousMap
      : null;
  writeJson(path.join(dir, "run.json"), {
    schemaVersion: 1,
    id,
    type: "refinement",
    title,
    scope,
    status: "in_progress",
    prototypeRun: context.prototype.task.source?.prototypeRun ?? null,
    createdAt,
    updatedAt: createdAt,
    notes: [
      {
        at: createdAt,
        note: "已冻结代码、原型、开发历史、系统卡片与范围文档证据；等待形成按功能块分组、上下顺序明确的叶子功能、迁移与依赖。",
      },
    ],
  });
  writeJson(path.join(dir, "context.json"), context);
  writeJson(path.join(dir, "previous-map.json"), previousMap);
  writeJson(path.join(dir, "prototype-impact.json"), impact);
  const priorRefinement =
    refinementRuns()
      .filter((run) => run.id !== id)
      .at(-1) ?? null;
  const refinementRun = {
    type: "refinement",
    id,
    dir,
    run: readJson(path.join(dir, "run.json")),
  };
  writeRefinementCompactionArtifacts(refinementRun, context, priorRefinement);
  writeJson(path.join(dir, "proposal.json"), {
    schemaVersion: FEATURE_MAP_SCHEMA_VERSION,
    runId: id,
    evidenceCursor: context.evidenceCursor,
    prototypeImpactId: impact?.id ?? null,
    impactReviews: [],
    groups:
      carryForwardMap?.groups ??
      legacyFeatures.map((feature, index) => ({
        id: feature.id,
        title: feature.title,
        rank: (index + 1) * 10,
        sourceFeatureIds: [feature.id],
      })),
    // 将当前已验证的功能结构作为提案起点，只刷新证据游标；这避免仅因开发历史
    // 变化而生成无法应用的空地图。后续通过 proposal-patch 按组增量修改。
    features:
      carryForwardMap?.features?.map(
        ({
          stages,
          taskRefs,
          updatedAt: ignoredUpdatedAt,
          implementationStatus,
          testStatus,
          prototypeStatus,
          planningRevision,
          reassessment,
          labelHistory,
          history,
          historySummary,
          developmentRecords,
          ...feature
        }) => feature,
      ) ?? [],
    migrations: [...(carryForwardMap?.migrations ?? []), ...(previousMap?.features ?? []).filter((feature) =>
      !(carryForwardMap?.migrations ?? []).some((migration) => migration.from?.includes(feature.id)))
      .map((feature) => ({ type: "unchanged", from: [feature.id], to: [feature.id], reason: "待本轮评估确认" }))],
    updatedAt: createdAt,
  });
  writeIfMissing(
    path.join(dir, "analysis.md"),
    `# ${title}\n\n## 证据快照\n\n- 原型功能块：${legacyFeatures.length} 个；入口：${context.prototype.sourceEntries.length} 个。\n- 历史开发任务：${context.development.totalTaskCount} 个；当前未结束：${context.development.activeTasks.length} 个。\n- 系统卡片：${context.systems.cards.length} 张。\n- 代码根：${context.codeRoots.length} 个；证据游标：\`${context.evidenceCursor}\`。\n\n先读 \`brief.md\`；具体事实通过 \`run context --detail <分区>\` 按分组分页读取。\`context.json\`、\`prototype-impact.json\`、\`previous-map.json\` 与 \`proposal.json\` 是完整审计/应用文件，不应直接装入模型上下文。每组结论写入小型 patch JSON，再执行 \`feature proposal-patch --run <ID> --from <patch.json>\` 增量合并。\n\n## 拆解判断\n\n- 待按用户目标、独立验收、代码/接口耦合与系统依赖重组功能块，并填写组内独立小功能点。\n- 页面状态本身不自动成为功能；同一用户结果与共享契约不可为了并发强拆。\n\n## 执行顺序与依赖\n\n- \`groups[].rank → features[].rank\` 从上到下就是当前评估与执行顺序；依赖必须指向更靠上的功能。\n- 优先服从功能范围、开放计划和已确认波次，再考虑关键路径、当前在制品、系统就绪度和阻塞风险；\`priority\` 与 \`wave\` 只保留为背景标签。\n\n## 历史迁移\n\n- 每个小补丁为涉及的旧功能登记 split / merge / rename / unchanged；历史任务文件不得改写。\n`,
  );
  ensureWorkPlan({
    type: "refinement",
    id,
    dir,
    run: readJson(path.join(dir, "run.json")),
  });
  const current = fs.existsSync(currentFile())
    ? readJson(currentFile())
    : { schemaVersion: 1, active: null };
  // 规划刷新是只读快照工作，不能遮蔽正在执行的开发运行。
  const active =
    current.active?.type && current.active.type !== "refinement"
      ? current.active
      : { type: "refinement", id };
  writeJson(currentFile(), {
    ...current,
    schemaVersion: 1,
    active,
    updatedAt: now(),
  });
  rebuildExecutionIndex();
  console.log(id);
  console.log(`默认摘要：${refinementBriefFile(refinementRun)}`);
  console.log(`审计快照（禁止整读）：${path.join(dir, "context.json")}`);
  console.log(`按组证据：run context --id ${id} --detail prototype|planning --group <ID>`);
  console.log(`提案（CLI 内部应用，禁止整读）：${path.join(dir, "proposal.json")}`);
  if (impact?.status === "review_required") console.log(`原型变更：必须逐项复评 ${impact.affected.length} 个既有功能；用 run context --id ${id} --detail planning --collection impact 分页读取清单。`);
}

function proposalPatchList(value, key) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail(`提案补丁的 ${key} 必须是数组`);
  return value;
}

function duplicateValues(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function upsertProposalRecords(current, incoming, key) {
  const next = [...current];
  for (const record of incoming) {
    const index = next.findIndex((item) => item?.[key] === record[key]);
    if (index === -1) next.push(record);
    else next[index] = record;
  }
  return next;
}

export function featureProposalPatch() {
  ensureProject();
  const run = resolveRun(required("--run"));
  if (run.type !== "refinement")
    fail("feature proposal-patch 只能更新 refinement 运行。");
  if (run.run.status !== "in_progress")
    fail("只能更新 in_progress 的 refinement 提案。");
  const inputFile = path.resolve(required("--from"));
  if (!fs.existsSync(inputFile) || !fs.statSync(inputFile).isFile())
    fail(`找不到提案补丁：${inputFile}`);
  const inputBytes = fs.statSync(inputFile).size;
  if (inputBytes > PROPOSAL_PATCH_BYTES_MAX)
    fail(`单次提案补丁不能超过 ${PROPOSAL_PATCH_BYTES_MAX} bytes；请按业务域拆分。`);
  const patch = readJson(inputFile);
  if (patch?.schemaVersion !== PROPOSAL_PATCH_SCHEMA_VERSION)
    fail(`提案补丁 schemaVersion 必须为 ${PROPOSAL_PATCH_SCHEMA_VERSION}`);
  const allowed = new Set([
    "schemaVersion",
    "groups",
    "features",
    "migrations",
    "impactReviews",
    "remove",
  ]);
  const unknown = Object.keys(patch).filter((key) => !allowed.has(key));
  if (unknown.length) fail(`提案补丁包含未知字段：${unknown.join("、")}`);
  const groups = proposalPatchList(patch.groups, "groups");
  const features = proposalPatchList(patch.features, "features");
  const migrations = proposalPatchList(patch.migrations, "migrations");
  const impactReviews = proposalPatchList(patch.impactReviews, "impactReviews");
  const remove = patch.remove ?? {};
  if (!remove || typeof remove !== "object" || Array.isArray(remove))
    fail("提案补丁的 remove 必须是对象");
  const allowedRemove = new Set(["groups", "features", "migrationsFrom", "impactReviews"]);
  const unknownRemove = Object.keys(remove).filter((key) => !allowedRemove.has(key));
  if (unknownRemove.length) fail(`提案补丁 remove 包含未知字段：${unknownRemove.join("、")}`);
  const removeGroups = proposalPatchList(remove.groups, "remove.groups");
  const removeFeatures = proposalPatchList(remove.features, "remove.features");
  const removeMigrations = proposalPatchList(remove.migrationsFrom, "remove.migrationsFrom");
  const removeReviews = proposalPatchList(remove.impactReviews, "remove.impactReviews");
  const identities = [
    ["groups", groups, "id"],
    ["features", features, "id"],
    ["impactReviews", impactReviews, "featureId"],
  ];
  for (const [name, records, key] of identities) {
    if (records.some((record) => !record || typeof record !== "object" || typeof record[key] !== "string" || !record[key].trim()))
      fail(`提案补丁的 ${name} 每项必须有 ${key}`);
    const duplicates = duplicateValues(records.map((record) => record[key]));
    if (duplicates.length) fail(`提案补丁的 ${name} 标识重复：${duplicates.join("、")}`);
  }
  if (migrations.some((migration) => !Array.isArray(migration?.from) || !migration.from.length ||
    migration.from.some((id) => typeof id !== "string" || !id.trim())))
    fail("提案补丁的 migrations 每项必须有非空 from");
  const incomingMigrationSources = migrations.flatMap((migration) => migration.from);
  const duplicateMigrationSources = duplicateValues(incomingMigrationSources);
  if (duplicateMigrationSources.length)
    fail(`同一补丁中的旧功能只能出现在一条 migration.from：${duplicateMigrationSources.join("、")}`);
  for (const [name, values] of [
    ["remove.groups", removeGroups],
    ["remove.features", removeFeatures],
    ["remove.migrationsFrom", removeMigrations],
    ["remove.impactReviews", removeReviews],
  ]) if (values.some((value) => typeof value !== "string" || !value.trim())) fail(`${name} 只能包含非空标识`);
  for (const [name, removed, incoming] of [
    ["groups", removeGroups, groups.map((record) => record.id)],
    ["features", removeFeatures, features.map((record) => record.id)],
    ["migrations", removeMigrations, incomingMigrationSources],
    ["impactReviews", removeReviews, impactReviews.map((record) => record.featureId)],
  ]) {
    const conflicts = removed.filter((id) => incoming.includes(id));
    if (conflicts.length) fail(`提案补丁不能同时删除并写入同一 ${name}：${conflicts.join("、")}`);
  }
  if (!(groups.length || features.length || migrations.length || impactReviews.length ||
    removeGroups.length || removeFeatures.length || removeMigrations.length || removeReviews.length))
    fail("提案补丁没有任何变更");

  const proposalFile = path.join(run.dir, "proposal.json");
  const proposal = readJson(proposalFile);
  const previousUpdatedAt = proposal.updatedAt ?? null;
  const removeGroupSet = new Set(removeGroups);
  const removeFeatureSet = new Set(removeFeatures);
  const removeMigrationSet = new Set(removeMigrations);
  const removeReviewSet = new Set(removeReviews);
  const replacementMigrationSet = new Set(incomingMigrationSources);
  proposal.groups = upsertProposalRecords(
    (proposal.groups ?? []).filter((record) => !removeGroupSet.has(record.id)),
    groups,
    "id",
  );
  proposal.features = upsertProposalRecords(
    (proposal.features ?? []).filter((record) => !removeFeatureSet.has(record.id)),
    features,
    "id",
  );
  proposal.migrations = [
    ...(proposal.migrations ?? []).filter((migration) =>
      !(migration.from ?? []).some((id) => removeMigrationSet.has(id) || replacementMigrationSet.has(id))),
    ...migrations,
  ];
  proposal.impactReviews = upsertProposalRecords(
    (proposal.impactReviews ?? []).filter((record) => !removeReviewSet.has(record.featureId)),
    impactReviews,
    "featureId",
  );
  proposal.updatedAt = now();
  writeJson(proposalFile, proposal);
  const audit = {
    ...patch,
    appliedAt: proposal.updatedAt,
    previousProposalUpdatedAt: previousUpdatedAt,
    source: path.relative(process.cwd(), inputFile),
  };
  const auditFile = path.join(
    run.dir,
    "proposal-patches",
    `${timestamp()}-${impactHash(audit).slice(0, 8)}.json`,
  );
  writeJson(auditFile, audit);
  console.log(JSON.stringify({
    schemaVersion: 1,
    runId: run.id,
    status: "patched",
    updatedAt: proposal.updatedAt,
    changed: {
      groups: groups.map((record) => record.id),
      features: features.map((record) => record.id),
      migrationsFrom: incomingMigrationSources,
      impactReviews: impactReviews.map((record) => record.featureId),
    },
    removed: {
      groups: removeGroups,
      features: removeFeatures,
      migrationsFrom: removeMigrations,
      impactReviews: removeReviews,
    },
    totals: {
      groups: proposal.groups.length,
      features: proposal.features.length,
      migrations: proposal.migrations.length,
      impactReviews: proposal.impactReviews.length,
    },
    audit: path.relative(STORE, auditFile),
  }, null, 2));
}

export function findDependencyCycle(features) {
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const visit = (id) => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    if (visited.has(id)) return null;
    visiting.add(id);
    stack.push(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };
  for (const id of byId.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

export function validFeatureRank(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function featureMapProblems(proposal, context, currentContext = null) {
  const problems = [];
  if (currentContext) problems.push(...planningPublicationProblems(currentContext));
  if (!FEATURE_MAP_READ_SCHEMA_VERSIONS.has(proposal?.schemaVersion))
    problems.push(
      `proposal.schemaVersion 必须为 ${[...FEATURE_MAP_READ_SCHEMA_VERSIONS].join(" 或 ")}`,
    );
  if (proposal?.evidenceCursor !== context.evidenceCursor)
    problems.push("proposal.evidenceCursor 与本运行 context.json 不一致");
  if (
    currentContext &&
    currentContext.evidenceCursor !== context.evidenceCursor
  )
    problems.push(
      "代码、原型、开发历史、系统卡片或范围文档已变化；请重新运行 feature refine",
    );
  const groups = proposal?.groups;
  const features = proposal?.features;
  const migrations = proposal?.migrations;
  if (!Array.isArray(groups) || !groups.length)
    problems.push("groups 至少保留一个稳定业务域");
  if (!Array.isArray(features) || !features.length)
    problems.push("features 至少包含一个可独立验收的叶子功能");
  if (!Array.isArray(migrations) || !migrations.length)
    problems.push("migrations 必须记录旧功能到当前叶子功能的迁移");
  if (
    problems.length &&
    (!Array.isArray(groups) ||
      !Array.isArray(features) ||
      !Array.isArray(migrations))
  )
    return problems;

  const duplicateIds = (items) => {
    const ids = items.map((item) => item?.id).filter(Boolean);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  };
  const groupIds = new Set(groups.map((group) => group?.id).filter(Boolean));
  const featureIds = new Set(
    features.map((feature) => feature?.id).filter(Boolean),
  );
  const featuresById = new Map(
    features.map((feature) => [feature?.id, feature]),
  );
  if (duplicateIds(groups).length)
    problems.push(`业务域 ID 重复：${duplicateIds(groups).join("、")}`);
  if (duplicateIds(features).length)
    problems.push(`叶子功能 ID 重复：${duplicateIds(features).join("、")}`);
  for (const id of groupIds) {
    if (featureIds.has(id)) problems.push(`业务域与叶子功能不能共用 ID：${id}`);
  }
  const duplicateRanks = (items) => {
    const ranks = items.map((item) => item?.rank).filter(validFeatureRank);
    return ranks.filter((rank, index) => ranks.indexOf(rank) !== index);
  };
  for (const group of groups) {
    if (!group?.id || !group?.title)
      problems.push(`业务域 ${group?.id || "<unknown>"} 缺少 id/title`);
    if (!validFeatureRank(group?.rank))
      problems.push(`业务域 ${group?.id || "<unknown>"} 的 rank 必须是正整数`);
  }
  if (duplicateRanks(groups).length)
    problems.push(
      `业务域 rank 重复：${[...new Set(duplicateRanks(groups))].join("、")}`,
    );

  const knownEntries = new Set(
    context.prototype.sourceEntries.map((entry) => entry.id),
  );
  const coverageByEntry = new Map(
    (context.prototype.coverage ?? []).map((entry) => [entry.id, entry]),
  );
  const mappedEntries = new Set();
  const knownSystems = new Set(context.systems.cards.map((card) => card.id));
  const knownQuestions = new Set((context.prototype.questions ?? []).map(item => item.id));
  const knownRequirements = new Set((context.prototype.requirements ?? []).map(item => item.id));
  for (const feature of features) {
    const kind = feature?.kind ?? "product";
    if (!FEATURE_KINDS.has(kind))
      problems.push(
        `叶子功能 ${feature?.id || "<unknown>"} 的 kind 无效：${kind}（必须是 product 或 technical）`,
      );
    const isProduct = kind === "product";
    if (
      !feature?.id ||
      !feature?.title ||
      !feature?.parentId ||
      (isProduct && !feature?.outcome)
    )
      problems.push(
        `叶子功能 ${feature?.id || "<unknown>"} 缺少 id/title/parentId${isProduct ? "/outcome" : ""}`,
      );
    problems.push(...featureAnalysisProblems(feature));
    if (!String(feature?.description ?? "").trim())
      problems.push(
        `叶子功能 ${feature?.id || "<unknown>"} 缺少概括性功能说明 description`,
      );
    if (
      !Array.isArray(feature?.developmentRequirements) ||
      !feature.developmentRequirements.length ||
      feature.developmentRequirements.some(
        (requirement) => !String(requirement ?? "").trim(),
      )
    )
      problems.push(
        `叶子功能 ${feature?.id || "<unknown>"} 必须提供非空的概括性 developmentRequirements`,
      );
    if (isProduct) {
      if (
        !Array.isArray(feature?.sourceEntries) ||
        !feature.sourceEntries.some(
          (entryId) => typeof entryId === "string" && entryId.trim(),
        )
      )
        problems.push(
          `叶子功能 ${feature?.id || "<unknown>"} 至少关联一个当前原型入口 sourceEntries`,
        );
    } else {
      if (
        !Array.isArray(feature?.systemCardRefs) ||
        !feature.systemCardRefs.some(
          (cardId) => typeof cardId === "string" && cardId.trim(),
        )
      )
        problems.push(
          `叶子功能 ${feature?.id || "<unknown>"} 作为技术叶子必须至少引用一张系统卡片 systemCardRefs`,
        );
    }
    if (feature?.parentId && !groupIds.has(feature.parentId))
      problems.push(
        `叶子功能 ${feature.id} 指向未知业务域：${feature.parentId}`,
      );
    // Phase 3 收尾校验：携带 reviews 决策块的叶子必须是完整可读的，否则 apply
    // 会把"已复评"写进地图却没有任何可追溯决策。注意 reassessment 还有 graph
    // 侧 { triggers: [...] } 形制（graph sync/flag/clear 落盘），那类不含 reviews、
    // 由 graph 自己管完整性，这里不介入。
    if (feature?.reassessment != null && "reviews" in feature.reassessment) {
      const reviews = feature.reassessment?.reviews;
      if (!Array.isArray(reviews) || !reviews.length)
        problems.push(
          `叶子功能 ${feature?.id || "<unknown>"} 的 reassessment 必须包含非空 reviews 决策块`,
        );
      else
        for (const review of reviews) {
          if (!["preserve", "revalidate"].includes(review?.deliveryImpact))
            problems.push(
              `叶子功能 ${feature?.id || "<unknown>"} 的复评决策缺少合法 deliveryImpact: preserve/revalidate`,
            );
          if (!["keep", "revise", "split", "merge", "retire", "add"].includes(review?.decision))
            problems.push(
              `叶子功能 ${feature?.id || "<unknown>"} 的复评决策 decision 无效：${review?.decision}`,
            );
          if (!String(review?.reason ?? "").trim())
            problems.push(
              `叶子功能 ${feature?.id || "<unknown>"} 的复评决策缺少 reason`,
            );
        }
    }
    if (!validFeatureRank(feature?.rank))
      problems.push(
        `叶子功能 ${feature?.id || "<unknown>"} 的 rank 必须是正整数`,
      );
    if (!FEATURE_PRIORITIES.test(String(feature?.priority ?? "")))
      problems.push(
        `叶子功能 ${feature?.id || "<unknown>"} 的 priority 无效：${feature?.priority}`,
      );
    if (!FEATURE_STATES.has(feature?.status))
      problems.push(
        `叶子功能 ${feature?.id || "<unknown>"} 的 status 无效：${feature?.status}`,
      );
    if (feature?.stages != null)
      problems.push(
        `叶子功能 ${feature?.id || "<unknown>"} 的阶段只能通过关联任务的 delivery stage 更新，不能在 proposal.json 手工修改`,
      );
    if (!Array.isArray(feature?.dependsOn))
      problems.push(
        `叶子功能 ${feature?.id || "<unknown>"} 的 dependsOn 必须是数组`,
      );
    for (const dependency of feature?.dependsOn ?? []) {
      if (!featureIds.has(dependency))
        problems.push(`叶子功能 ${feature.id} 依赖未知功能：${dependency}`);
      if (dependency === feature.id)
        problems.push(`叶子功能 ${feature.id} 不能依赖自身`);
      if (
        ["not_started", "in_progress", "blocked"].includes(feature?.status) &&
        ["park", "skipped"].includes(featuresById.get(dependency)?.status)
      )
        problems.push(
          `可开发叶子功能 ${feature.id} 不能依赖 ${featuresById.get(dependency).status} 功能：${dependency}`,
        );
    }
    for (const cardId of feature?.systemCardRefs ?? []) {
      if (!knownSystems.has(cardId))
        problems.push(`叶子功能 ${feature.id} 引用未知系统卡片：${cardId}`);
    }
    for (const id of feature.sourceQuestionIds ?? []) if (!knownQuestions.has(id)) problems.push(`叶子功能 ${feature.id} 引用未知问题：${id}`);
    for (const id of feature.sourceRequirementIds ?? []) if (!knownRequirements.has(id)) problems.push(`叶子功能 ${feature.id} 引用未知需求：${id}`);
    for (const entryId of feature?.sourceEntries ?? []) {
      if (!knownEntries.has(entryId))
        problems.push(`叶子功能 ${feature.id} 引用未知原型入口：${entryId}`);
      const observedEvidence = (
        coverageByEntry.get(entryId)?.evidence ?? []
      ).some(
        (evidence) =>
          evidence?.level === "observed" &&
          typeof evidence?.path === "string" &&
          (evidence.path.startsWith("screenshots/") || nativeEvidencePath(evidence.path)),
      );
      if (!observedEvidence)
        problems.push(
          `叶子功能 ${feature.id} 的原型入口 ${entryId} 缺少可展示的 observed 来源截图`,
        );
      mappedEntries.add(entryId);
    }
  }
  for (const group of groups) {
    const children = features.filter(
      (feature) => feature?.parentId === group.id,
    );
    if (!children.length)
      problems.push(`业务域 ${group.id} 至少需要一个叶子功能`);
    const duplicates = duplicateRanks(children);
    if (duplicates.length)
      problems.push(
        `业务域 ${group.id} 的叶子功能 rank 重复：${[...new Set(duplicates)].join("、")}`,
      );
  }
  for (const entryId of knownEntries) {
    if (!mappedEntries.has(entryId))
      problems.push(`原型入口尚未映射到叶子功能：${entryId}`);
  }
  const cycle = findDependencyCycle(features);
  if (cycle) problems.push(`叶子功能依赖存在环：${cycle.join(" → ")}`);
  const displayOrder = new Map(
    orderedFeaturesInMap(features, groups).map((feature, index) => [
      feature.id,
      index,
    ]),
  );
  for (const feature of features) {
    for (const dependency of feature?.dependsOn ?? []) {
      if (
        displayOrder.has(dependency) &&
        displayOrder.has(feature.id) &&
        displayOrder.get(dependency) >= displayOrder.get(feature.id)
      )
        problems.push(
          `叶子功能 ${feature.id} 的依赖 ${dependency} 必须排在它之前；功能地图从上到下就是评估与执行顺序`,
        );
    }
  }

  const migratedLegacyIds = new Set();
  for (const migration of migrations) {
    if (!FEATURE_MIGRATION_TYPES.has(migration?.type))
      problems.push(`迁移类型无效：${migration?.type}`);
    if (!Array.isArray(migration?.from) || !migration.from.length)
      problems.push("每条迁移必须有非空 from 数组");
    if (!Array.isArray(migration?.to) || !migration.to.length)
      problems.push("每条迁移必须有非空 to 数组");
    if (!migration?.reason) problems.push("每条迁移必须记录 reason");
    for (const id of migration?.from ?? []) migratedLegacyIds.add(id);
    for (const id of migration?.to ?? []) {
      if (!featureIds.has(id)) problems.push(`迁移指向未知叶子功能：${id}`);
    }
  }
  for (const feature of context.prototype.features) {
    if (!migratedLegacyIds.has(feature.id))
      problems.push(`旧功能缺少迁移记录：${feature.id}`);
  }
  return [...new Set(problems)];
}

export function featureApply() {
  ensureProject();
  rebuildExecutionIndex();
  const run = resolveRun(required("--from-run"));
  if (run.type !== "refinement")
    fail("feature apply 只能应用 refinement 运行。");
  const context = readJson(path.join(run.dir, "context.json"));
  const proposal = readJson(path.join(run.dir, "proposal.json"));
  const currentContext = featureEvidenceContext();
  const problems = featureMapProblems(proposal, context, currentContext);
  const previousMap = currentFeatureMap();
  const previousMapFile = path.join(run.dir, "previous-map.json");
  if (!context.prototype.revision || !fs.existsSync(previousMapFile)) {
    problems.push("此旧 refinement 缺少原型复评基线；重新 feature refine，不能回填旧快照");
  } else {
    problems.push(...impactReviewProblems({ previousMap: readJson(previousMapFile),
      currentMap: previousMap, revision: context.prototype.revision, proposal,
      records: deliveryDevelopmentRecords() }));
  }
  if (run.run.status === "done") problems.push("已应用的 refinement 不可重复应用或改写历史");
  writeJson(path.join(run.dir, "validation.json"), {
    schemaVersion: 1,
    runId: run.id,
    status: problems.length ? "failed" : "passed",
    problems,
    validatedAt: now(),
    evidenceCursor: currentContext.evidenceCursor,
  });
  if (problems.length) fail(`功能地图不能应用：\n- ${problems.join("\n- ")}`);
  const updatedAt = now();
  const groups = orderedFeatureGroups(proposal.groups);
  const features = orderedFeaturesInMap(proposal.features, groups);
  const previousFeatures = new Map(
    (previousMap?.features ?? []).map((feature) => [feature.id, feature]),
  );
  const developmentRecords = deliveryDevelopmentRecords();
  const map = {
    schemaVersion: FEATURE_MAP_SCHEMA_VERSION,
    sourceRun: run.id,
    prototypeRun: context.prototype.task.source?.prototypeRun ?? null,
    evidenceCursor: context.evidenceCursor,
    refinementEvidenceCursor: context.evidenceCursor,
    prototypeBaseline: context.prototype.revision,
    groups,
    features: features.map((feature) => {
      const reviews = (proposal.impactReviews ?? []).filter((review) => review.targets?.includes(feature.id));
      const revised = reviews.some((review) => review.deliveryImpact === "revalidate");
      const planningRevision = revised ? run.id : previousFeatures.get(feature.id)?.planningRevision ?? null;
      const related = developmentRecords.filter(
        (record) => record.featureId === feature.id && record.featureRevision === planningRevision,
      );
      const resetSkipped =
        !reviews.length &&
        related.length &&
        related.every((record) => record.taskStatus === "skipped");
      const kind = feature.kind ?? previousFeatures.get(feature.id)?.kind ?? "product";
      return {
        ...feature,
        kind,
        planningRevision,
        reassessment: reviews.length ? { status: "reviewed", runId: run.id, prototypeFingerprint: context.prototype.revision.fingerprint, reviews } : previousFeatures.get(feature.id)?.reassessment ?? null,
        status: resetSkipped ? "not_started" : feature.status,
        labelHistory: labelAssessmentHistory(
          feature,
          previousFeatures.get(feature.id),
          { at: updatedAt, runId: run.id },
        ),
        stages: revised || resetSkipped
          ? defaultFeatureStages()
          : normalizeFeatureStages(previousFeatures.get(feature.id) ?? feature),
        updatedAt,
      };
    }),
    migrations: proposal.migrations,
    updatedAt,
  };
  writeJson(path.join(run.dir, "application.json"), {
    schemaVersion: 1,
    runId: run.id,
    target: path.relative(STORE, featureMapFile()),
    status: "applied",
    appliedAt: updatedAt,
    prototypeImpactId: proposal.prototypeImpactId ?? null,
    impactReviews: proposal.impactReviews ?? [],
  });
  run.run.status = "done";
  run.run.updatedAt = updatedAt;
  run.run.notes.push({
    at: updatedAt,
    note: `功能地图已通过门禁并应用：${map.features.length} 个叶子功能。`,
  });
  writeJson(path.join(run.dir, "run.json"), run.run);
  const current = readJson(currentFile());
  if (current.active?.type === "refinement" && current.active?.id === run.id)
    current.active = null;
  writeJson(currentFile(), { ...current, updatedAt });
  rebuildExecutionIndex();
  map.evidenceCursor = featureEvidenceContext().evidenceCursor;
  writeFeatureMap(map);
  if (proposal.impactReviews?.length) {
    const history = readFeatureHistory();
    for (const feature of map.features.filter((item) => item.reassessment?.runId === run.id)) history.events.push({
      id: `planning-review-${impactHash([run.id, feature.id]).slice(0, 16)}`, type: "planning_reassessed",
      featureId: feature.id, runId: run.id, runTitle: run.run.title, at: updatedAt,
      taskId: null, summary: feature.reassessment.reviews.map((review) => review.reason).join("；"),
      decision: feature.reassessment.reviews.map((review) => review.decision).join("、"),
      previousMap: `refinement-runs/${run.id}/previous-map.json`, prototypeImpactId: proposal.prototypeImpactId,
    });
    history.updatedAt = updatedAt;
    writeJson(featureHistoryFile(), history);
  }
  compactBuild();
  console.log(
    `已应用 ${run.id}：${map.groups.length} 个业务域，${map.features.length} 个叶子功能。`,
  );
  console.log(path.join(planningDir(), "功能演进地图.md"));
}

export function featureStatus() {
  ensureProject();
  if (!fs.existsSync(featureMapFile())) {
    return console.log(
      "功能演进地图尚未建立；运行 `feature refine --scope auto` 创建证据快照和拆解提案。",
    );
  }
  rebuildExecutionIndex();
  const map = readJson(featureMapFile());
  const context = featureEvidenceContext();
  const impact = prototypeImpact(map, context.prototype.revision);
  const publicationProblems = planningPublicationProblems(context);
  const fresh = map.evidenceCursor === context.evidenceCursor && impact.status === "current";
  const counts = Object.fromEntries(
    [...FEATURE_STATES].map((status) => [
      status,
      (map.features ?? []).filter((feature) => feature.status === status)
        .length,
    ]),
  );
  console.log(
    `功能演进地图：${fresh ? "fresh" : "stale"} · 业务域 ${map.groups?.length ?? 0} · 叶子功能 ${map.features?.length ?? 0}`,
  );
  const kindCounts = (map.features ?? []).reduce(
    (counts, feature) => {
      counts[(feature.kind ?? "product") === "technical" ? "technical" : "product"] += 1;
      return counts;
    },
    { product: 0, technical: 0 },
  );
  console.log(
    `类型：产品 ${kindCounts.product} · 技术 ${kindCounts.technical}`,
  );
  console.log(
    `状态：未开始 ${counts.not_started} · 进行中 ${counts.in_progress} · 阻塞 ${counts.blocked} · 完成 ${counts.done} · PARK ${counts.park}`,
  );
  console.log(`来源：${map.sourceRun} · 更新：${map.updatedAt}`);
  if (impact.status !== "current") console.log(`原型变更复评：${impact.affected.length} 个既有功能待评估（含子功能和依赖下游）；用 feature impact 查看原因。`);
  if (publicationProblems.length) console.log(`规划发布门禁：${publicationProblems.join("；")}`);
  const delivery = deliveryImpactClosure(map);
  if (delivery.affected?.length)
    console.log(`技术发布复评：${delivery.affected.map((item) => `${item.id}（via ${item.via}）`).join("、")}；用 feature impact --trigger delivery 查看原因。`);
  if (!fresh)
    console.log(
      "下一步：最新事实已变化，运行 `feature refine --scope auto` 重新拆解；旧地图与历史运行会保留。",
    );
}

export function featureImpact() {
  ensureProject();
  const map = currentFeatureMap();
  if (!map) return console.log("功能地图尚未建立；先 feature refine。");
  const trigger = valueFor('--trigger') ?? 'prototype';
  if (!['prototype', 'delivery'].includes(trigger))
    fail('--trigger 只能是 prototype 或 delivery');
  if (trigger === 'delivery') {
    const delivery = deliveryImpactClosure(map);
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({
        schemaVersion: 1,
        trigger,
        status: delivery.status,
        releasedTechnicalIds: delivery.releasedTechnicalIds,
        affected: delivery.affected,
      }));
    } else console.log(JSON.stringify(delivery, null, 2));
    return;
  }
  // This diagnostic deliberately does not rebuild indexes or write evidence bundles.
  const impact = prototypeImpact(map, readPrototypeRevision(STORE));
  if (process.argv.includes('--json')) {
    const cursor = Number(valueFor('--cursor') ?? 0), limit = Number(valueFor('--limit') ?? 20);
    if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) fail('Invalid pagination');
    if (cursor > 0 && valueFor('--revision') !== impact.id) fail('Impact changed; restart cursor 0');
    const metadata = { status: impact.status, from: impact.from, to: impact.to, global: impact.global, affectedCount: impact.affected.length, assessedCount: impact.assessedFeatureIds.length };
    console.log(JSON.stringify(boundedPage(impact.affected.slice(cursor, cursor + limit).map(item => ({ type: 'impact', ...item })), { cursor, nextCursor: cursor + limit < impact.affected.length ? cursor + limit : null, revision: impact.id, metadata, maxBytes: valueFor('--max-bytes') ?? 16384 })));
  } else console.log(JSON.stringify(impact, null, 2));
}

const IMPL_SNAPSHOT_MOCK_PATTERN = /mock\w*|__mocks__|\bmsw\b|假数据/i;

const IMPL_SNAPSHOT_PLANNED_PATTERN =
  /not\s*implemented|not_implemented|\btodo\b|\bfixme\b|\bplanned\b|待实现|未实现|占位|假接口|\b501\b/i;

const IMPL_SNAPSHOT_IMPORT_PATTERNS = [
  /(?:^|\n)\s*import\s[^;\n]*?from\s*["']([^"'\n]+)["']/g,
  /(?:^|\n)\s*import\s*["']([^"'\n]+)["']/g,
  /(?:^|\n)\s*export\s[^;\n]*?from\s*["']([^"'\n]+)["']/g,
  /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
];

const IMPL_SNAPSHOT_SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  STORE_DIRECTORY,
]);

const IMPL_SNAPSHOT_SCAN_BYTES_MAX = 512 * 1024;

function implSnapshotMarkers(content) {
  const hits = { mock: new Map(), planned: new Map() };
  content.split("\n").forEach((line, index) => {
    const mock = line.match(IMPL_SNAPSHOT_MOCK_PATTERN);
    if (mock) implSnapshotRecordMarker(hits.mock, mock[0].toLowerCase(), index + 1);
    const planned = line.match(IMPL_SNAPSHOT_PLANNED_PATTERN);
    if (planned)
      implSnapshotRecordMarker(hits.planned, planned[0].toLowerCase(), index + 1);
  });
  return {
    mock: implSnapshotMarkerList(hits.mock),
    planned: implSnapshotMarkerList(hits.planned),
  };
}

function implSnapshotRecordMarker(map, token, line) {
  const entry = map.get(token) ?? [];
  if (entry.length < 3) entry.push(line);
  map.set(token, entry);
}

function implSnapshotMarkerList(map) {
  return [...map.entries()]
    .slice(0, 5)
    .map(([token, lines]) => ({ token, lines }));
}

function implSnapshotImports(content) {
  const found = new Set();
  for (const pattern of IMPL_SNAPSHOT_IMPORT_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      found.add(match[1]);
      if (found.size >= 20) return [...found];
    }
  }
  return [...found];
}

function implSnapshotFileEntry(file, relativeTo) {
  const stats = fs.statSync(file);
  const bytes = stats.size;
  const entry = {
    path: path.relative(relativeTo, file).split(path.sep).join("/"),
    bytes,
    sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
  };
  if (bytes > IMPL_SNAPSHOT_SCAN_BYTES_MAX) return entry;
  const content = fs.readFileSync(file, "utf8");
  entry.lines = content.split("\n").length;
  entry.markers = implSnapshotMarkers(content);
  if (/\.(m|c)?[jt]sx?$/.test(file)) entry.imports = implSnapshotImports(content);
  return entry;
}

function implSnapshotCollectFiles(directory, limit) {
  const files = [];
  let truncated = false;
  const walk = (dir) => {
    if (files.length >= limit) {
      truncated = true;
      return;
    }
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      if (entry.isDirectory()) {
        if (!IMPL_SNAPSHOT_SKIP_DIRECTORIES.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.isFile()) files.push(path.join(dir, entry.name));
    }
  };
  walk(directory);
  return { files, truncated };
}

function implSnapshotCodeRoot(project, resolved) {
  const root = (project.codeRoots ?? [])
    .map((item) => ({ ...item, location: path.resolve(process.cwd(), item.path) }))
    .find(
      (item) => resolved === item.location || resolved.startsWith(item.location + path.sep),
    );
  if (!root) return null;
  return {
    path: root.path,
    gitHead: gitValue(root.location, ["rev-parse", "HEAD"]),
    gitBranch: gitValue(root.location, ["branch", "--show-current"]),
  };
}

export function featureImplSnapshot() {
  const project = ensureProject();
  const map = currentFeatureMap();
  if (!map) return console.log("功能地图尚未建立；先 feature refine。");
  const id = required("--id");
  const feature = map.features.find((item) => item.id === id);
  if (!feature) fail(`功能地图中没有叶子功能：${id}`);
  // Read-only diagnostic: no index rebuild, no evidence writes; sha256 pins the
  // inspected revision so answers can cite it as evidence.
  const limit = Math.min(Math.max(Number(valueFor("--limit") ?? 40) || 40, 1), 200);
  const refs = (feature.codeRefs ?? []).map((ref) => {
    const resolved = path.resolve(process.cwd(), ref);
    const base = { ref, exists: fs.existsSync(resolved) };
    const codeRoot = base.exists ? implSnapshotCodeRoot(project, resolved) : null;
    if (codeRoot) base.codeRoot = codeRoot;
    if (!base.exists) return { ...base, kind: "missing" };
    if (fs.statSync(resolved).isDirectory()) {
      const { files, truncated } = implSnapshotCollectFiles(resolved, limit);
      return {
        ...base,
        kind: "directory",
        truncated,
        files: files.map((file) => implSnapshotFileEntry(file, process.cwd())),
      };
    }
    return { ...base, kind: "file", ...implSnapshotFileEntry(resolved, process.cwd()) };
  });
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        featureId: feature.id,
        title: feature.title,
        status: feature.status,
        snapshotAt: now(),
        refs,
        notice:
          "只读启发式快照；mock/planned 标记与 import 摘要是检索线索，不构成实现结论；回答需查看实际代码并核对来源，sha256 用于固定本次取证版本。",
      },
      null,
      2,
    ),
  );
}

export function featureLinkTask() {
  ensureProject();
  const run = resolveRun(required("--run"));
  if (run.type !== "delivery")
    fail("feature link-task 只能关联开发运行中的任务。");
  const plan = ensureWorkPlan(run);
  const taskId = slug(required("--task"));
  const task = plan.tasks.find((item) => item.id === taskId);
  if (!task) fail(`未规划任务：${taskId}`);
  const scope = valueFor("--scope") ?? "product";
  if (!new Set(["product", "technical", "governance"]).has(scope))
    fail("--scope 只能是 product、technical 或 governance");
  const leafFeatureIds = csv("--leaf-features");
  const relatedFeatureIds = csv("--related-features");
  if (scope === "product" || scope === "technical") {
    if (!leafFeatureIds.length)
      fail(
        scope === "technical"
          ? "技术任务必须通过 --leaf-features 关联至少一个技术叶子功能。"
          : "产品任务必须通过 --leaf-features 关联至少一个叶子功能。",
      );
    if (leafFeatureIds.length !== 1)
      fail("一个产品/技术任务只能关联一个叶子功能；请为每个功能分别登记任务。");
    assertLeafFeatureIds(leafFeatureIds);
    const bound = currentFeatureMap()?.features.find((feature) => feature.id === leafFeatureIds[0]);
    const boundKind = bound?.kind ?? "product";
    if (scope === "product" && boundKind === "technical")
      fail(`产品任务不能绑定技术叶子 ${leafFeatureIds[0]}；用 --scope technical 重新关联`);
    if (scope === "technical" && boundKind !== "technical")
      fail(`技术任务只能绑定 kind=technical 的叶子，${leafFeatureIds[0]} 当前为 ${boundKind}`);
  } else if (leafFeatureIds.length) fail("工程治理任务不能关联子叶功能。");
  if (relatedFeatureIds.length) {
    if (scope === "product")
      fail("产品任务不得登记 --related-features；用 --leaf-features 关联即可");
    assertRelatedFeatureIds(relatedFeatureIds);
  }
  const links = readTaskLeafLinks();
  const entry = {
    runId: run.id,
    taskId,
    scope,
    leafFeatureIds: scope === "governance" ? [] : [...new Set(leafFeatureIds)],
    relatedFeatureIds: [...new Set(relatedFeatureIds)],
    reason: required("--reason"),
    linkedAt: now(),
  };
  const index = links.links.findIndex(
    (link) => link.runId === run.id && link.taskId === taskId,
  );
  if (index === -1) links.links.push(entry);
  else links.links[index] = entry;
  links.updatedAt = entry.linkedAt;
  writeJson(taskLeafLinksFile(), links);
  projectTaskStateToFeatureMap(run, task, { at: entry.linkedAt });
  appendFeatureHistory(run, task, "task_linked", {
    at: entry.linkedAt,
    taskStatus: fs.existsSync(executionFile(run, task.id))
      ? readJson(executionFile(run, task.id)).status
      : "pending",
    summary: `任务关联已${
      scope === "product"
        ? "迁移到子叶功能"
        : scope === "technical"
          ? "迁移到技术叶子"
          : "标记为工程治理，不进入原型流程"
    }。`,
    decision: entry.reason,
  });
  console.log(`已关联 ${run.id}/${taskId}：${scope}`);
}

export function unansweredQuestionsForFeature(map, feature) {
  if (hasPrototypeCatalog(process.cwd())) return semanticRows(process.cwd(), "questions").filter(q => q.status !== "resolved" && relatedQuestion(q, map, feature));
  const questionIndex = readJson(
    path.join(prototypeDir(), "open-questions.json"),
    {
      questions: [],
    },
  );
  const group = (map.groups ?? []).find((item) => item.id === feature.parentId);
  const sourceFeatureIds = new Set(group?.sourceFeatureIds ?? []);
  const sourceEntries = new Set(feature.sourceEntries ?? []);
  return (questionIndex.questions ?? []).filter(
    (question) =>
      question.status !== "resolved" &&
      (sourceFeatureIds.has(question.featureId) ||
        (question.evidence ?? []).some((evidence) =>
          sourceEntries.has(evidence.entryId),
        )),
  );
}

export function singleFeatureStartProblems(candidates, feature) {
  const problems = [];
  if (feature.status !== "not_started")
    problems.push(
      `功能点 ${feature.id} 当前为 ${feature.status}；只能新建未开始功能的开发运行。进行中的功能请续做已有任务。`,
    );
  if ((feature.blockers ?? []).length)
    problems.push(
      `功能点 ${feature.id} 仍有地图阻塞项：${feature.blockers.join("；")}`,
    );
  const questionProblems = prototypeQuestionProblems(STORE);
  if (questionProblems.length)
    problems.push(
      `原型待确认问题索引不满足门禁：${questionProblems.join("；")}`,
    );
  const unanswered = unansweredQuestionsForFeature(candidates.map, feature);
  if (unanswered.length)
    problems.push(
      `功能点 ${feature.id} 仍有未回答的功能疑问：${unanswered.map((item) => item.id).join("、")}`,
    );
  const featuresById = new Map(
    (candidates.map.features ?? []).map((item) => [item.id, item]),
  );
  for (const dependencyId of feature.dependsOn ?? []) {
    const dependency = featuresById.get(dependencyId);
    if (!dependency || dependency.status !== "done")
      problems.push(`功能点 ${feature.id} 的前置功能尚未完成：${dependencyId}`);
  }
  const activeRecords = deliveryDevelopmentRecords().filter(
    (record) =>
      record.featureId === feature.id &&
      ACTIVE_DELIVERY_STATUSES.has(record.taskStatus),
  );
  if (activeRecords.length)
    problems.push(
      `功能点 ${feature.id} 已有进行中的任务：${activeRecords.map((record) => `${record.runId}/${record.taskId}`).join("、")}；请先续做，不得重复新建开发运行。`,
    );
  return [...new Set(problems)];
}

export function featureStart() {
  ensureProject();
  const id = slug(required("--id"));
  const candidates = featureMapDeliveryCandidates();
  const feature = (candidates.map.features ?? []).find(
    (item) => item.id === id,
  );
  if (!feature) fail(`不是当前功能地图中的叶子功能：${id}`);
  const problems = singleFeatureStartProblems(candidates, feature);
  if (problems.length) fail(`不能开始功能点开发：\n- ${problems.join("\n- ")}`);
  const runId = createDeliveryRun({
    title: valueFor("--title") || `功能点开发（${feature.title}）`,
    prototypeRun: candidates.prototypeRun,
    input: {
      source: "feature-map",
      intensity: "focused",
      deliveryProcess: valueFor("--process"),
      taskDescription: `指定单一叶子功能 ${feature.id} 完整开发；按任务输入与类型约定完成交付及总控验证。`,
      features: [feature],
      extraction: {
        sourceFile: "planning/feature-map.json",
        sourceRun: candidates.map.sourceRun,
        selection: "single_leaf_feature_gate",
        featureId: feature.id,
        gateCheckedAt: now(),
      },
    },
  });
  console.log(runId);
}

function leafFeatureForRisk(mapFile) {
  const id = slug(required("--id"));
  if (!fs.existsSync(featureMapFile())) fail("尚无功能地图；风险台账需要先完成规划。");
  const map = readJson(featureMapFile());
  const feature = (map.features ?? []).find((item) => item.id === id);
  if (!feature) fail(`不是当前功能地图中的叶子功能：${id}`);
  return { id, feature };
}

export function featureRiskAdd() {
  ensureProject();
  const { id } = leafFeatureForRisk();
  const text = required("--text");
  const [entry] = registerFeatureRisks([id], [text], {
    runId: valueFor("--run") ?? null,
    taskId: valueFor("--task") ?? null,
    stageId: valueFor("--stage") ?? "manual",
  });
  if (!entry) fail("风险登记失败：功能点未写入。");
  console.log(`已登记风险 ${entry.id} → ${id}：${entry.text}`);
}

export function featureRiskResolve() {
  ensureProject();
  const { id } = leafFeatureForRisk();
  const riskId = required("--risk");
  const entry = resolveFeatureRisk(id, riskId, valueFor("--note") ?? null);
  if (!entry) fail(`功能 ${id} 没有风险条目：${riskId}`);
  console.log(`已关闭风险 ${riskId} → ${id}${entry.resolution ? `：${entry.resolution}` : ""}`);
}

export function featureRisks() {
  ensureProject();
  const { feature } = leafFeatureForRisk();
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        featureId: feature.id,
        risks: (feature.risks ?? []).map((risk) => ({
          id: risk.id,
          text: risk.text,
          status: risk.status ?? "open",
          source: risk.source ?? null,
          createdAt: risk.createdAt,
          updatedAt: risk.updatedAt ?? null,
          resolution: risk.resolution ?? null,
        })),
      },
      null,
      2,
    )}\n`,
  );
}
