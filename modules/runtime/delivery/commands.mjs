// Delivery command family — delivery start / stage / artifact / supersede commands.
// Extracted from runtime/delivery.mjs (structural split; behavior unchanged).

import path from "node:path";

import fs from "node:fs";

import crypto from "node:crypto";

import { prototypeDevelopmentProblems } from "../../../dashboard/server/prototype-impact.js";

import {
  loadCapabilityRegistry,
  requireCapabilityGates,
} from "../../capabilities/registry.mjs";

import {
  hasPrototypeCatalog,
  prototypeArchiveExists,
  semanticRows,
} from "../../prototype/client.mjs";

import { stageAgentFor } from "../../delivery/processes.mjs";

import {
  DELIVERY_STAGE_CLOSED_STATUSES,
  DELIVERY_STAGE_STATUSES,
  DELIVERY_STAGES,
  isGenericDelivery,
  stageSummaryProblems,
  taskStageDefinitions,
} from "../../../dashboard/server/delivery-contract.js";

import {
  apiMockScreenshotProblems,
  miniappScreenshotProblems,
} from "./evidence.mjs";

import {
  assertStageAgent,
  assertTaskPrototypeCurrent,
  executionBlocksParallelWork,
  featureDependencyClosure,
  nextOpenDeliveryStage,
  selectPrototypeFeatures,
  DELIVERY_INTENSITIES,
  DELIVERY_SOURCES,
} from "./helpers.mjs";

import {
  STORE,
  UI_DELIVERY_ROLE,
  appendFeatureHistory,
  canonicalTaskPhase,
  createDeliveryRun,
  csv,
  currentFeatureMap,
  currentFile,
  deliveryInput,
  deliveryInputFile,
  ensureProject,
  ensureWorkPlan,
  executionFile,
  fail,
  featureMapDeliveryCandidates,
  flagValues,
  isContinuousDeliveryTask,
  now,
  openFeatureRisks,
  orderFeatureCandidates,
  projectTaskStateToFeatureMap,
  prototypeDeliveryCandidates,
  prototypeDir,
  readJson,
  registerFeatureRisks,
  required,
  resolveRun,
  riskSegmentFromSummary,
  slug,
  stageRecord,
  syncDeliveryReports,
  taskHasDeliveryRole,
  taskLeafFeatureIds,
  taskLeafLink,
  timestamp,
  validationScreenshotPairProblems,
  valueFor,
  visualRegionReviewProblems,
  writeJson,
} from "../shared.mjs";

export function deliveryStart() {
  ensureProject();
  const prototypeProblems = prototypeDevelopmentProblems(STORE, currentFeatureMap());
  if (prototypeProblems.length) fail(prototypeProblems.join("\n"));
  const source = required("--source");
  if (!DELIVERY_SOURCES.has(source))
    fail("--source 只能是 prototype、feature-map 或 manual");
  const intensity = required("--intensity");
  if (!DELIVERY_INTENSITIES.has(intensity))
    fail("--intensity 只能是 focused、standard 或 high");
  const deliveryProcess = valueFor("--process");

  if (source === "prototype") {
    const candidates = prototypeDeliveryCandidates();
    const requested = csv("--features");
    const requestedEntries = csv("--entries");
    const scopedCandidates = selectPrototypeFeatures(
      candidates.features,
      requestedEntries,
    );
    const features = requested.length
      ? requested.map((id) =>
          scopedCandidates.find((feature) => feature.id === id),
        )
      : scopedCandidates;
    const unknown = requested.filter(
      (id) => !scopedCandidates.some((feature) => feature.id === id),
    );
    if (unknown.length) fail(`不是待开发原型功能块：${unknown.join("、")}`);
    if (requestedEntries.length && !features.length)
      fail(`原型真源中没有匹配入口：${requestedEntries.join("、")}`);
    if (!features.length) fail("长期原型真源中没有可自动提取的未完成功能块。");
    const title =
      valueFor("--title") || `原型功能块开发（${features.length} 项）`;
    const id = createDeliveryRun({
      title,
      prototypeRun: candidates.prototypeRun,
      input: {
        source,
        intensity,
        deliveryProcess,
        taskDescription: `从完整原型图流程自动提取 ${features.length} 个未完成功能块。`,
        features,
        extraction: {
          sourceFile: hasPrototypeCatalog(process.cwd()) ? "prototype/catalog.sqlite" : "prototype/feature-index.json",
          sourceRun: candidates.prototypeRun,
          selection: requested.length
            ? "explicit_features"
            : requestedEntries.length
              ? "entries_scope"
              : "all_unfinished_features",
          entries: requestedEntries,
          extractedAt: now(),
        },
      },
    });
    return console.log(id);
  }

  if (source === "feature-map") {
    const candidates = featureMapDeliveryCandidates();
    const requested = csv("--features");
    const requestedEntries = csv("--entries");
    const entryScoped = requestedEntries.length
      ? candidates.features.filter((feature) =>
          (feature.sourceEntries ?? []).some((entry) =>
            requestedEntries.includes(entry),
          ),
        )
      : candidates.features;
    const availableIds = new Set(entryScoped.map((feature) => feature.id));
    const unknown = requested.filter((id) => !availableIds.has(id));
    if (unknown.length) fail(`不是当前可开发叶子功能：${unknown.join("、")}`);
    let features = requested.length
      ? featureDependencyClosure(candidates.features, requested)
      : requestedEntries.length
        ? featureDependencyClosure(
            candidates.features,
            entryScoped.map((feature) => feature.id),
          )
        : entryScoped;
    features = orderFeatureCandidates(features);
    if (!features.length) fail("功能演进地图中没有匹配的可开发叶子功能。");
    const title =
      valueFor("--title") || `叶子功能开发（${features.length} 项）`;
    const id = createDeliveryRun({
      title,
      prototypeRun: candidates.prototypeRun,
      input: {
        source,
        intensity,
        deliveryProcess,
        taskDescription: `从功能演进地图提取 ${features.length} 个叶子功能，并按功能块/叶子功能从上到下顺序排列。`,
        features,
        extraction: {
          sourceFile: "planning/feature-map.json",
          sourceRun: candidates.map.sourceRun,
          selection: requested.length
            ? "explicit_features_with_dependencies"
            : requestedEntries.length
              ? "entries_scope"
              : "all_actionable_leaf_features",
          entries: requestedEntries,
          extractedAt: now(),
        },
      },
    });
    return console.log(id);
  }

  const taskDescription = required("--task");
  const title = required("--title");
  const canonicalTaskFile = path.join(prototypeDir(), "task.json");
  const canonicalIndexFile = path.join(prototypeDir(), "feature-index.json");
  const candidates =
    (hasPrototypeCatalog(process.cwd()) || fs.existsSync(canonicalTaskFile) && fs.existsSync(canonicalIndexFile))
      ? prototypeDeliveryCandidates()
      : { prototypeRun: null, features: [] };
  const prototypeRun = valueFor("--prototype-run") || candidates.prototypeRun;
  if (
    !prototypeRun ||
    !prototypeArchiveExists(STORE, prototypeRun)
  )
    fail("手工开发任务也必须关联一个可用原型运行；使用 --prototype-run 指定。");
  const requested = csv("--features");
  const features = requested.map(
    (id) =>
      candidates.features.find((feature) => feature.id === id) ?? {
        id,
        title: id,
      },
  );
  const id = createDeliveryRun({
    title,
    prototypeRun,
    input: {
      source,
      intensity,
      deliveryProcess,
      taskDescription,
      features,
      extraction: null,
    },
  });
  console.log(id);
}

/**
 * 视觉对比门禁要求 visual-compare 能力已注册且声明对应门禁归属。
 * 能力只提供判定口径（原子事实）；字段结构由外层 region-report schema 定义，
 * 能力不承载也不返回复杂字段结构。加载不到位时给出按需加载指引。
 */
function requireVisualCompareCapability() {
  try {
    return requireCapabilityGates(loadCapabilityRegistry(), "visual-compare", [
      "visual_validation_pair",
      "visual_region_review",
    ]);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function featureAcceptanceCriteria(task) {
  return (
    taskStageDefinitions(task)
      .find((stage) => stage.id === "end_to_end_acceptance")
      ?.acceptanceCriteria ?? []
  ).filter((criterion) => criterion.origin === "feature-acceptance-case");
}

export function acceptanceCaseCompletionProblems(task, execution) {
  const results = execution?.acceptanceCases ?? {};
  return featureAcceptanceCriteria(task).flatMap((criterion) => {
    const result = results[criterion.id];
    if (!result) return ['验收用例 ' + criterion.id + ' 尚未记录结果'];
    if (!['passed', 'not_applicable'].includes(result.status))
      return ['验收用例 ' + criterion.id + ' 状态为 ' + result.status + '，不能确认最终验收'];
    if (result.status === 'passed' && (!Array.isArray(result.evidence) || !result.evidence.length))
      return ['验收用例 ' + criterion.id + ' 已通过但未关联本阶段截图证据'];
    return [];
  });
}

export function deliveryStage() {
  ensureProject();
  const run = resolveRun(required("--run"));
  if (run.type !== "delivery") fail("delivery stage 只能更新开发运行。");
  const input = deliveryInput(run);
  if (!input)
    fail("此运行没有 delivery-input.json；旧运行请在计划中补齐方案确认记录。");
  const taskId = slug(required("--task"));
  const plan = ensureWorkPlan(run);
  const task = plan.tasks.find((item) => item.id === taskId);
  if (!task) fail(`未规划任务：${taskId}`);
  if (
    taskLeafLink(run, task).scope !== "governance" &&
    !taskLeafFeatureIds(run, task).length
  )
    fail(`工程治理任务或未关联子叶功能的任务不能更新功能阶段。`);
  const executionFilePath = executionFile(run, taskId);
  if (
    !fs.existsSync(executionFilePath) ||
    readJson(executionFilePath).status !== "in_progress"
  )
    fail(`任务 ${taskId} 必须已领取且进行中，才能更新关联功能点阶段。`);
  const stageId = required("--stage");
  if (
    !isContinuousDeliveryTask(task) &&
    canonicalTaskPhase(task.phase) !== stageId
  )
    fail(
      `任务 ${taskId} 属于 ${canonicalTaskPhase(task.phase)}，不能更新 ${stageId} 阶段。`,
    );
  const stageDefinitions = taskStageDefinitions(task);
  const stageIndex = stageDefinitions.findIndex((stage) => stage.id === stageId);
  const legacyStageIndex =
    input.stages?.findIndex((stage) => stage.id === stageId) ?? -1;
  if (stageIndex === -1 && legacyStageIndex === -1)
    fail(`未知开发阶段：${stageId}`);
  const stageDefinition =
    stageDefinitions.find((definition) => definition.id === stageId) ??
    input.stages?.[legacyStageIndex];
  const execution = readJson(executionFilePath);
  const activeStage = nextOpenDeliveryStage(task, execution);
  const activeProfile = activeStage
    ? stageAgentFor(task, activeStage.id)
    : null;
  if (activeProfile && stageId !== activeStage.id)
    fail(`当前应先执行 ${activeStage.id} 阶段，不能更新 ${stageId}。`);
  if (activeProfile) assertStageAgent(task, stageId, execution.agent);
  const targetIndex = stageDefinitions.findIndex(
    (stage) => stage.id === (execution.targetPhase || stageDefinitions.at(-1)?.id),
  );
  if (isContinuousDeliveryTask(task) && stageIndex > targetIndex)
    fail(
      `本次任务目标阶段为 ${execution.targetPhase}，不得推进到 ${stageId}。`,
    );
  const status = required("--status");
  if (["in_progress", "confirmed", "done", "not_applicable"].includes(status)) assertTaskPrototypeCurrent(run, task);
  if (!DELIVERY_STAGE_STATUSES.has(status)) fail("开发阶段状态不合法。");
  const stage = input.stages?.find((item) => item.id === stageId);
  if (!stage) fail(`开发输入缺少阶段：${stageId}`);
  if (["confirmed", "done", "not_applicable"].includes(status)) {
    const dependencies =
      stageIndex === -1
        ? input.stages.slice(0, legacyStageIndex)
        : stageDefinitions.slice(0, stageIndex).map((definition) =>
            stageRecord(input, definition.id),
          );
    const pendingDependency = dependencies.find(
      (item) => !["confirmed", "done", "not_applicable"].includes(item.status),
    );
    if (pendingDependency)
      fail(
        `前置阶段尚未确认：${pendingDependency.id}（${pendingDependency.status}）`,
      );
  }
  if (
    stageDefinition?.evidenceGates.includes(
      "visual_validation_pair",
    ) &&
    ["confirmed", "done"].includes(status) &&
    taskHasDeliveryRole(task, UI_DELIVERY_ROLE)
  ) {
    requireVisualCompareCapability();
    const screenshotProblems = validationScreenshotPairProblems(run, task);
    if (screenshotProblems.length)
      fail(`不能确认 UI 验证阶段：\n- ${screenshotProblems.join("\n- ")}`);
  }
  if (
    stageDefinition?.evidenceGates.includes("visual_region_review") &&
    ["confirmed", "done"].includes(status)
  ) {
    requireVisualCompareCapability();
    const previousStatus = stage.status;
    stage.status = status;
    const visualProblems = visualRegionReviewProblems(run);
    stage.status = previousStatus;
    if (visualProblems.length)
      fail(`不能确认全链路测试：\n- ${visualProblems.join("\n- ")}`);
  }
  if (
    stageDefinition?.evidenceGates.includes("api_mock_evidence") &&
    ["confirmed", "done"].includes(status)
  ) {
    const screenshotProblems = apiMockScreenshotProblems(run, task);
    if (screenshotProblems.length)
      fail(`不能确认接口 Mock：\n- ${screenshotProblems.join("\n- ")}`);
  }
  if (
    stageDefinition?.evidenceGates.includes("miniapp_ui_evidence") &&
    ["confirmed", "done"].includes(status)
  ) {
    const screenshotProblems = miniappScreenshotProblems(run, task);
    if (screenshotProblems.length)
      fail(`不能确认小程序 UI 阶段：\n- ${screenshotProblems.join("\n- ")}`);
  }
  const summary = required("--summary");
  if (
    stageId === "end_to_end_acceptance" &&
    ["confirmed", "done"].includes(status)
  ) {
    const acceptanceProblems = acceptanceCaseCompletionProblems(task, execution);
    if (acceptanceProblems.length)
      fail("不能确认端到端验收：\\n- " + acceptanceProblems.join("\\n- "));
  }
  if (
    isContinuousDeliveryTask(task) &&
    DELIVERY_STAGE_CLOSED_STATUSES.has(status)
  ) {
    const reportProblems = stageSummaryProblems(
      stageDefinition,
      summary,
    );
    if (reportProblems.length)
      fail(`不能确认阶段报告：\n- ${reportProblems.join("\n- ")}`);
  }
  if (
    stageDefinition?.evidenceGates.includes("dataflow_svg_evidence") &&
    ["confirmed", "done"].includes(status)
  ) {
    const diagrams = stageArtifactsOfType(run, stage, "dataflow_svg", /\.svg$/i);
    if (!diagrams.length)
      fail(
        "不能确认技术方案：数据系统流转图未登记。请将 SVG 保存到运行目录并执行 delivery stage-artifact --stage technical_solution --kind dataflow_svg --file <svg> --caption <系统+数据+对应接口说明>（可多张）后重试；文字描述不构成门禁证据。",
      );
  }
  if (
    stageDefinition?.evidenceGates.includes("technical_requirement_confirmed") &&
    ["confirmed", "done"].includes(status)
  ) {
    // Legacy projects without a prototype catalog have no catalog-bound
    // technical requirements to confirm, so the gate no-ops (same guard as
    // impact.mjs readPrototypeRevision: hasPrototypeCatalog(path.dirname(STORE))).
    const rows = hasPrototypeCatalog(path.dirname(STORE))
      ? semanticRows(path.dirname(STORE), "requirements")
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const unconfirmed = [];
    for (const featureId of taskLeafFeatureIds(run, task)) {
      const feature = currentFeatureMap()?.features.find((f) => f.id === featureId);
      for (const id of feature?.sourceRequirementIds ?? []) {
        const req = byId.get(id);
        if (req?.kind === "technical" && req.status !== "confirmed")
          unconfirmed.push(`${id}(${req.status})`);
      }
    }
    if (unconfirmed.length)
      fail(
        `不能确认技术方案：关联技术要求尚未与用户确认：${unconfirmed.join("、")}。请完成 brainstorming 确认后执行 prototype requirement update --status confirmed，并完成复评收敛（graph sync → feature impact → feature refine → feature apply）后重试。`,
      );
  }
  if (
    stageDefinition?.evidenceGates.includes("dev_plan_evidence") &&
    ["confirmed", "done"].includes(status)
  ) {
    const plans = stageArtifactsOfType(run, stage, "dev_plan", /\.md$/i);
    if (!plans.length)
      fail(
        "不能确认技术方案：writing-plans 计划未登记。请将 plan.md 保存到运行目录并执行 delivery stage-artifact --stage technical_solution --kind dev_plan --file <md> --caption <计划说明> 后重试；文字描述不构成门禁证据。",
      );
  }
  if (
    stageDefinition?.evidenceGates.includes("e2e_screenshot_evidence") &&
    ["confirmed", "done"].includes(status)
  ) {
    const shots = stageArtifactsOfType(
      run,
      stage,
      "e2e_screenshot",
      /\.(png|jpe?g|webp)$/i,
    );
    if (!shots.length)
      fail(
        "不能确认端到端验收：本阶段尚未登记 E2E 截图证据。请用 delivery stage-artifact --stage end_to_end_acceptance --kind e2e_screenshot --file <截图> --caption <流程与状态说明> 登记真实截图；早期阶段归档的截图不继承为本阶段门禁证据。",
      );
  }
  const riskTexts = flagValues("--risk");
  if (
    stageDefinition?.evidenceGates.includes("risk_ledger") &&
    ["confirmed", "done"].includes(status)
  ) {
    const riskSegment = riskSegmentFromSummary(summary);
    if (riskSegment && !riskTexts.length) {
      const alreadyLedgered = openFeatureRisks(taskLeafFeatureIds(run, task)).some(
        (risk) =>
          risk.source?.runId === run.id &&
          risk.source?.taskId === task.id &&
          risk.source?.stageId === stageId,
      );
      if (!alreadyLedgered)
        fail(
          `不能确认${stageDefinition.title ?? stageId}：“风险/下一步”留有挂账项，但未登记到功能点。请在同一命令中为每条留项追加 --risk "<条目>"（可多个）；确无留项时把该字段改写为“无”。`,
        );
    }
  }
  if (riskTexts.length) {
    const registered = registerFeatureRisks(
      taskLeafFeatureIds(run, task),
      riskTexts,
      { runId: run.id, taskId: task.id, stageId },
    );
    if (registered.length) {
      stage.riskLedger ??= [];
      stage.riskLedger.push(
        ...registered.map((risk) => ({
          riskId: risk.id,
          featureId: risk.featureId,
          text: risk.text,
          addedAt: risk.createdAt,
        })),
      );
    }
  }
  stage.status = status;
  stage.summary = summary;
  stage.updatedAt = now();
  input.updatedAt = stage.updatedAt;
  writeJson(deliveryInputFile(run), input);
  execution.stages ??= {};
  execution.stages[stageId] = {
    status,
    summary: stage.summary,
    updatedAt: stage.updatedAt,
  };
  if (
    isContinuousDeliveryTask(task) &&
    stageId === execution.targetPhase &&
    DELIVERY_STAGE_CLOSED_STATUSES.has(status)
  ) {
    execution.checkpoints ??= [];
    execution.checkpoints.push({
      at: stage.updatedAt,
      targetPhase: stageId,
      status: "reached",
      summary: stage.summary,
    });
  }
  execution.updatedAt = stage.updatedAt;
  writeJson(executionFilePath, execution);
  run.run.updatedAt = stage.updatedAt;
  run.run.notes ??= [];
  run.run.notes.push({
    at: stage.updatedAt,
    note: `${stage.title}：${status} · ${stage.summary}`,
  });
  if (status === "blocked") run.run.status = "blocked";
  else if (run.run.status === "blocked") run.run.status = "in_progress";
  writeJson(path.join(run.dir, "run.json"), run.run);
  appendFeatureHistory(run, task, "stage_updated", {
    at: stage.updatedAt,
    taskStatus: "in_progress",
    summary: stage.summary,
    blocker: status === "blocked" ? stage.summary : null,
    decision: valueFor("--decision"),
    stage: { id: stageId, title: stage.title, status, summary: stage.summary },
  });
  projectTaskStateToFeatureMap(run, task, {
    stage,
    acceptanceResults: execution.acceptanceCases ?? null,
    at: stage.updatedAt,
  });
  syncDeliveryReports(run);
  console.log(`已更新 ${run.id} / ${taskId} / ${stageId}：${status}`);
}

export function deliveryAcceptance() {
  ensureProject();
  const run = resolveRun(required("--run"));
  if (run.type !== "delivery") fail("delivery acceptance 只能用于开发运行。");
  const input = deliveryInput(run);
  if (!input) fail("此运行没有 delivery-input.json。");
  const taskId = slug(required("--task"));
  const task = ensureWorkPlan(run).tasks.find((item) => item.id === taskId);
  if (!task) fail("未规划任务：" + taskId);
  const executionPath = executionFile(run, taskId);
  if (!fs.existsSync(executionPath) || readJson(executionPath).status !== "in_progress")
    fail("任务 " + taskId + " 必须已领取且进行中，才能记录验收用例结果。");
  const execution = readJson(executionPath);
  const finalStage = taskStageDefinitions(task).find(
    (stage) => stage.id === "end_to_end_acceptance",
  );
  if (!finalStage) fail("任务没有 end_to_end_acceptance 阶段。");
  const activeStage = nextOpenDeliveryStage(task, execution);
  if (activeStage && activeStage.id !== "end_to_end_acceptance")
    fail("当前应先执行 " + activeStage.id + " 阶段，不能记录最终验收用例。");
  const id = required("--case");
  const criterion = featureAcceptanceCriteria(task).find(
    (item) => item.id === id,
  );
  if (!criterion)
    fail("验收用例不属于该任务冻结的最终验收范围：" + id);
  const status = required("--status");
  if (!["passed", "failed", "not_applicable"].includes(status))
    fail("--status 只能是 passed、failed 或 not_applicable");
  const summary = required("--summary");
  const evidence = csv("--evidence");
  const stage = stageRecord(input, "end_to_end_acceptance");
  const artifacts = new Set(
    (stage?.artifacts ?? [])
      .filter((item) => item.kind === "e2e_screenshot")
      .map((item) => item.file),
  );
  if (status === "passed" && !evidence.length)
    fail("通过的验收用例必须通过 --evidence 关联至少一张 e2e_screenshot。");
  const unknownEvidence = evidence.filter((file) => !artifacts.has(file));
  if (unknownEvidence.length)
    fail("验收用例引用的证据未登记为 end_to_end_acceptance/e2e_screenshot：" + unknownEvidence.join("、"));
  const updatedAt = now();
  execution.acceptanceCases ??= {};
  execution.acceptanceCases[id] = {
    status,
    summary,
    evidence,
    updatedAt,
  };
  execution.updatedAt = updatedAt;
  writeJson(executionPath, execution);
  appendFeatureHistory(run, task, "acceptance_case_recorded", {
    at: updatedAt,
    taskStatus: "in_progress",
    summary: id + "：" + status + " · " + summary,
    stage: {
      id: "end_to_end_acceptance",
      title: finalStage.title,
      status,
      summary,
    },
  });
  projectTaskStateToFeatureMap(run, task, {
    acceptanceResults: execution.acceptanceCases,
    at: updatedAt,
  });
  syncDeliveryReports(run);
  console.log("已记录 " + run.id + " / " + taskId + " / " + id + "：" + status);
}

// Stage-scoped evidence artifacts (dataflow SVGs, E2E screenshots). Files are
// copied into the run so later stages can never reuse earlier-stage evidence.
export const STAGE_ARTIFACT_KINDS = {
  dataflow_svg: /\.svg$/i,
  dev_plan: /\.md$/i,
  e2e_screenshot: /\.(png|jpe?g|webp)$/i,
  note: /.*/,
};
const MAX_STAGE_ARTIFACT_BYTES = 2 * 1024 * 1024;

function stageArtifactsOfType(run, stage, kind, pattern) {
  return (stage.artifacts ?? []).filter(
    (artifact) =>
      artifact.kind === kind &&
      pattern.test(String(artifact.file ?? "")) &&
      fs.existsSync(path.resolve(run.dir, artifact.file ?? "")),
  );
}

export function deliveryStageArtifact() {
  ensureProject();
  const run = resolveRun(required("--run"));
  if (run.type !== "delivery") fail("delivery stage-artifact 只能用于开发运行。");
  const input = deliveryInput(run);
  if (!input) fail("此运行没有 delivery-input.json。");
  const taskId = slug(required("--task"));
  const plan = ensureWorkPlan(run);
  const task = plan.tasks.find((item) => item.id === taskId);
  if (!task) fail(`未规划任务：${taskId}`);
  const executionFilePath = executionFile(run, taskId);
  if (
    !fs.existsSync(executionFilePath) ||
    readJson(executionFilePath).status !== "in_progress"
  )
    fail(`任务 ${taskId} 必须已领取且进行中，才能登记阶段产物。`);
  const stageId = required("--stage");
  const stage = input.stages?.find((item) => item.id === stageId);
  if (!stage) fail(`开发输入缺少阶段：${stageId}`);
  if (DELIVERY_STAGE_CLOSED_STATUSES.has(stage.status))
    fail(`阶段 ${stageId} 已闭环，不能再登记产物；请在新一次运行中补充证据。`);
  const execution = readJson(executionFilePath);
  const activeStage = nextOpenDeliveryStage(task, execution);
  if (activeStage && activeStage.id !== stageId)
    fail(`当前应先执行 ${activeStage.id} 阶段，不能为 ${stageId} 登记产物。`);
  const kind = required("--kind");
  const pattern = STAGE_ARTIFACT_KINDS[kind];
  if (!pattern)
    fail(
      `--kind 只能是 ${Object.keys(STAGE_ARTIFACT_KINDS).join("、")}。`,
    );
  const sourcePath = path.resolve(process.cwd(), required("--file"));
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile())
    fail(`产物文件不存在：${sourcePath}`);
  if (!pattern.test(sourcePath))
    fail(`阶段产物 ${kind} 文件类型不符：${path.basename(sourcePath)}`);
  const bytes = fs.statSync(sourcePath).size;
  if (bytes > MAX_STAGE_ARTIFACT_BYTES)
    fail(`阶段产物超过 ${MAX_STAGE_ARTIFACT_BYTES / 1024 / 1024}MB：${path.basename(sourcePath)}`);
  const caption = required("--caption");
  const directory = path.join(
    run.dir,
    "evidence",
    "stage-artifacts",
    taskId,
    stageId,
  );
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `${timestamp()}-${path.basename(sourcePath)}`);
  fs.copyFileSync(sourcePath, target);
  const record = {
    kind,
    file: path.relative(run.dir, target),
    caption,
    bytes,
    sha256: crypto
      .createHash("sha256")
      .update(fs.readFileSync(target))
      .digest("hex"),
    addedAt: now(),
  };
  stage.artifacts ??= [];
  stage.artifacts.push(record);
  input.updatedAt = record.addedAt;
  writeJson(deliveryInputFile(run), input);
  run.run.updatedAt = record.addedAt;
  run.run.notes ??= [];
  run.run.notes.push({
    at: record.addedAt,
    note: `阶段产物（${stageId}/${kind}）：${record.file} · ${caption}`,
  });
  writeJson(path.join(run.dir, "run.json"), run.run);
  syncDeliveryReports(run);
  console.log(`已登记 ${taskId}/${stageId} 阶段产物（${kind}）：${record.file}`);
}

export function deliverySupersede() {
  ensureProject();
  const run = resolveRun(required("--run"));
  if (run.type !== "delivery") fail("delivery supersede 只能用于开发运行。");
  const plan = ensureWorkPlan(run);
  const active = plan.tasks.filter((task) => {
    const file = executionFile(run, task.id);
    return (
      fs.existsSync(file) && executionBlocksParallelWork(task, readJson(file))
    );
  });
  if (active.length)
    fail(
      `仍有进行中任务，先完成或阻塞处理后再取代运行：${active.map((task) => task.id).join("、")}`,
    );
  const reason = required("--reason");
  const input = deliveryInput(run);
  if (!input) fail("此运行没有 delivery-input.json。");
  const supersededAt = now();
  input.supersessions ??= [];
  input.supersessions.push({
    at: supersededAt,
    reason,
    priorStages: (input.stages ?? []).map((stage) => ({
      id: stage.id,
      status: stage.status,
      summary: stage.summary,
      updatedAt: stage.updatedAt,
    })),
  });
  for (const stage of input.stages ?? []) {
    if (!["confirmed", "done", "not_applicable"].includes(stage.status)) {
      stage.status = "not_applicable";
      stage.summary = `运行已由逐功能任务方案取代：${reason}`;
      stage.updatedAt = supersededAt;
    }
  }
  input.updatedAt = supersededAt;
  writeJson(deliveryInputFile(run), input);
  run.run.status = "skipped";
  run.run.updatedAt = supersededAt;
  run.run.notes ??= [];
  run.run.notes.push({ at: supersededAt, note: `已取代并跳过：${reason}` });
  writeJson(path.join(run.dir, "run.json"), run.run);
  const current = readJson(currentFile());
  if (current.active?.type === "delivery" && current.active?.id === run.id)
    current.active = null;
  writeJson(currentFile(), { ...current, updatedAt: supersededAt });
  syncDeliveryReports(run);
  console.log(`已取代并跳过 ${run.id}`);
}

export function deliveryImplementationProblems(run) {
  if (run.type !== "delivery") return [];
  const input = deliveryInput(run);
  if (!input || isGenericDelivery(input)) return [];
  const mock = stageRecord(input, "api_mock");
  if (!mock || !["confirmed", "done", "not_applicable"].includes(mock.status))
    return [
      "开发输入尚未完成原型对齐和接口 Mock；先确认前两阶段或记录不适用理由",
    ];
  return [];
}

export function deliveryMockProblems(run) {
  if (run.type !== "delivery") return [];
  const input = deliveryInput(run);
  if (!input || isGenericDelivery(input)) return [];
  const alignment = stageRecord(input, "prototype_alignment");
  if (!alignment) return ["开发输入缺少原型对齐阶段"];
  if (!["confirmed", "done", "not_applicable"].includes(alignment.status))
    return ["原型对齐尚未确认，不能登记接口 Mock 任务"];
  const mock = stageRecord(input, "api_mock");
  if (!mock) return ["开发输入缺少接口 Mock 阶段"];
  if (mock.status === "blocked")
    return ["接口 Mock 阶段已阻塞，不能领取 Mock 任务"];
  return [];
}

export function deliveryAcceptanceProblems(run) {
  if (run.type !== "delivery") return [];
  const input = deliveryInput(run);
  if (!input || isGenericDelivery(input)) return [];
  const implementation = stageRecord(input, "technical_implementation");
  if (
    !implementation ||
    !["confirmed", "done", "not_applicable"].includes(implementation.status)
  )
    return ["技术实现尚未确认，不能登记全链路测试任务"];
  return [];
}
