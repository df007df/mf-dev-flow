// Delivery command family — shared constants and generic helpers.
// Extracted from runtime/delivery.mjs (structural split; behavior unchanged).

import path from "node:path";

import fs from "node:fs";

import { stageAgentFor } from "../../delivery/processes.mjs";

import {
  deliveryStageById,
  taskStageDefinitions,
  DELIVERY_STAGES,
  DELIVERY_TASK_PHASE,
  DELIVERY_STAGE_CLOSED_STATUSES,
} from "../../../dashboard/server/delivery-contract.js";

import {
  UI_DELIVERY_ROLE,
  canonicalFilePath,
  continuousTaskHasOpenStages,
  csv,
  deliveryRoles,
  fail,
  fileLeasesFile,
  normalizeScope,
  now,
  projectCardFile,
  projectCardId,
  readJson,
  scopeCovers,
  taskPrototypeProblems,
  valueFor,
  writeJson,
} from "../shared.mjs";

export const DELIVERY_INTENSITIES = new Set(["focused", "standard", "high"]);

export const DELIVERY_SOURCES = new Set(["prototype", "feature-map", "manual"]);

export const API_DELIVERY_ROLE = "api-provider";

export const GATE_SCHEMA_VERSION = 1;

export const DEFAULT_FILE_LEASE_TTL_SECONDS = 300;

export function rootPath(root) {
  return normalizeScope(
    path.relative(process.cwd(), path.resolve(process.cwd(), root.path)),
  );
}

export function deliveryTargetRequired(project) {
  return (project.codeRoots ?? []).some((root) => deliveryRoles(root).length);
}

export function projectRootForDeliveryTarget(project, value) {
  const requested = normalizeScope(value ?? "");
  const requestedAbsolute =
    typeof value === "string" && path.isAbsolute(value)
      ? path.resolve(value)
      : null;
  return (project.codeRoots ?? []).find(
    (root) =>
      rootPath(root) === requested ||
      root.role === value ||
      (requestedAbsolute !== null &&
        path.resolve(process.cwd(), root.path) === requestedAbsolute),
  );
}

export function expectedDeliveryRoles(phase) {
  return (
    deliveryStageById(phase)?.ownerRoles ?? [
      UI_DELIVERY_ROLE,
      API_DELIVERY_ROLE,
    ]
  );
}

export function projectCardForDelivery(root) {
  const file = projectCardFile(projectCardId(root));
  if (!fs.existsSync(file))
    fail(
      `交付项目 ${root.path} 缺少项目卡片；先执行 project check --root ${root.path}。`,
    );
  const card = readJson(file);
  if (card.status !== "passed")
    fail(`交付项目 ${root.path} 的项目卡片不是 passed；先解决其检查问题。`);
  if (!card.documentation?.testing?.e2eEvidencePolicy)
    fail(
      `交付项目 ${root.path} 的项目卡片缺少结构化 E2E 截图规则；先刷新项目卡片。`,
    );
  return card;
}

export function taskDeliveryTargets(
  project,
  scope,
  writes,
  phase,
  generic = false,
  stageDefinitions = DELIVERY_STAGES,
) {
  const requested = csv("--projects");
  const legacyRequested = valueFor("--project");
  if (legacyRequested) requested.push(legacyRequested);
  const uniqueRequested = [...new Set(requested)];
  const required = scope === "product" && deliveryTargetRequired(project);
  if (!uniqueRequested.length) {
    if (required)
      fail(
        "产品任务必须通过 --projects 绑定实际交付代码根；不能默认落到第一个项目。",
      );
    return [];
  }
  const roots = uniqueRequested.map((requestedRoot) => {
    const root = projectRootForDeliveryTarget(project, requestedRoot);
    if (!root) fail(`未登记的交付项目：${requestedRoot}`);
    return root;
  });
  const allRoles = new Set(roots.flatMap((root) => deliveryRoles(root)));
  const requiredRoles = new Set(
    stageDefinitions.flatMap((stage) => stage.ownerRoles ?? []),
  );
  if (
    scope === "product" &&
    required &&
    !generic &&
    phase === DELIVERY_TASK_PHASE &&
    [...requiredRoles].some((role) => !allRoles.has(role))
  )
    fail(
      `连续产品任务必须绑定覆盖所有阶段的代码根：${[...requiredRoles].join("、")}。`,
    );
  if (scope === "product" && phase !== DELIVERY_TASK_PHASE) {
    const expected = expectedDeliveryRoles(phase);
    if (
      !roots.some((root) =>
        deliveryRoles(root).some((role) => expected.includes(role)),
      )
    )
      fail(`${phase} 阶段必须交付到 ${expected.join(" 或 ")} 项目。`);
  }
  const outOfProject = writes.filter(
    (write) => !roots.some((root) => scopeCovers(rootPath(root), write)),
  );
  if (outOfProject.length)
    fail(
      `任务写入范围必须以交付项目 ${roots.map((root) => rootPath(root)).join(" 或 ")}/ 开头：${outOfProject.join("、")}`,
    );
  const targets = roots.map((root) => {
    const card =
      scope === "product" && phase === DELIVERY_TASK_PHASE && !generic
        ? projectCardForDelivery(root)
        : null;
    const target = {
      path: root.path,
      role: root.role,
      deliveryRoles: deliveryRoles(root),
    };
    if (card)
      Object.assign(target, {
        projectCardId: card.id,
        projectCardCheckedAt: card.checkedAt ?? null,
        e2eEvidencePolicy:
          card.documentation?.testing?.e2eEvidencePolicy ?? null,
      });
    return target;
  });
  return targets;
}

export function writeFileLeases(run, value) {
  value.updatedAt = now();
  writeJson(fileLeasesFile(run), value);
}

export function scopesOverlap(left, right) {
  const a = canonicalFilePath(left);
  const b = canonicalFilePath(right);
  return scopeCovers(a, b) || scopeCovers(b, a);
}

export function executionIsResumableCheckpoint(task, execution) {
  return (
    execution?.status === "done" &&
    continuousTaskHasOpenStages(task, execution) &&
    (execution.checkpoints ?? []).some(
      (checkpoint) => checkpoint.status === "validated",
    )
  );
}

export function assertStageAgent(task, stageId, agent) {
  const profile = stageAgentFor(task, stageId);
  if (profile && profile.id !== agent)
    fail(
      `阶段 ${stageId} 必须由 agent ${profile.id} 执行，不能由 ${agent} 领取或续做。`,
    );
  return profile;
}

export function nextOpenDeliveryStage(task, execution = null) {
  return taskStageDefinitions(task).find(
    (stage) =>
      !DELIVERY_STAGE_CLOSED_STATUSES.has(execution?.stages?.[stage.id]?.status),
  );
}

export function executionBlocksParallelWork(task, execution) {
  return (
    execution?.status === "in_progress" ||
    executionIsResumableCheckpoint(task, execution) ||
    execution?.status === "blocked"
  );
}

export function activeExecutionAttempt(execution) {
  return [...(execution.attempts ?? [])]
    .reverse()
    .find((attempt) => attempt.status === "in_progress");
}

export function beginExecutionAttempt(execution, { agent, sessionId, targetPhase }) {
  execution.attempts ??= [];
  const attempt = {
    id: `attempt-${execution.attempts.length + 1}`,
    agent,
    status: "in_progress",
    sessionId,
    targetPhase,
    startedAt: now(),
    endedAt: null,
    summary: null,
  };
  execution.attempts.push(attempt);
  return attempt;
}

export function closeExecutionAttempt(execution, { status, summary, at = now() }) {
  let attempt = activeExecutionAttempt(execution);
  if (!attempt && !(execution.attempts ?? []).length) {
    execution.attempts = [
      {
        id: "attempt-1",
        agent: execution.agent ?? null,
        status: "in_progress",
        sessionId: execution.sessionId ?? null,
        targetPhase: execution.targetPhase ?? null,
        startedAt: execution.claimedAt ?? at,
        endedAt: null,
        summary: null,
      },
    ];
    attempt = execution.attempts[0];
  }
  if (!attempt) return null;
  attempt.status = status;
  attempt.endedAt = at;
  attempt.summary = summary;
  return attempt;
}

export function assertTaskPrototypeCurrent(run, task) {
  const problems = taskPrototypeProblems(run, task);
  if (problems.length) fail(problems.join("\n"));
}

export function featureDependencyClosure(allFeatures, requestedIds) {
  const byId = new Map(allFeatures.map((feature) => [feature.id, feature]));
  const selected = new Set();
  const visit = (id) => {
    const feature = byId.get(id);
    if (!feature || selected.has(id)) return;
    selected.add(id);
    for (const dependency of feature.dependsOn ?? []) visit(dependency);
  };
  for (const id of requestedIds) visit(id);
  return allFeatures.filter((feature) => selected.has(feature.id));
}

export function selectPrototypeFeatures(features, entries) {
  if (!entries.length) return features;
  return features
    .map((feature) => {
      const selectedEntries = (feature.sourceEntries ?? []).filter((entry) =>
        entries.includes(entry),
      );
      return selectedEntries.length ? { ...feature, selectedEntries } : null;
    })
    .filter(Boolean);
}
