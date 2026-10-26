// Delivery command family — task lifecycle (work plan/claim/bind/finish/lease) and kernel records.
// Extracted from runtime/delivery.mjs (structural split; behavior unchanged).

import path from "node:path";

import fs from "node:fs";

import crypto from "node:crypto";

import {
  freezeTaskType,
  freezeValidationProfile,
  readableRunEvidence,
  validationDecisionProblems,
  resolveValidationDecision,
  taskTypeProblems,
} from "../../delivery/types.mjs";

import { stageAgentFor } from "../../delivery/processes.mjs";

import { prototypeDevelopmentProblems } from "../../../dashboard/server/prototype-impact.js";

import {
  inferTaskTypeRef,
  readHookObservations,
  writeKernelRecords,
} from "../../kernel/sync.mjs";

import { normalizeDeliveryRun, deriveRunStatus } from "../../kernel/record.mjs";
import { publishKernelRecords } from "../../kernel/publish.mjs";
import { applyFeatureAcceptanceCases } from "../acceptance-cases.mjs";
import { PRIVATE_STORE_DIRECTORY, SKILL_ID, STORE_DIRECTORY } from "../../skill-identity.mjs";

import {
  DELIVERY_STAGES,
  DELIVERY_STAGE_CLOSED_STATUSES,
  DELIVERY_TASK_PHASE,
  deliveryContractForInput,
  isGenericDelivery,
  renderDeliveryBrief,
  renderGenericDeliveryBrief,
  taskStageDefinitions,
} from "../../../dashboard/server/delivery-contract.js";

import {
  deliveryAcceptanceProblems,
  deliveryImplementationProblems,
  deliveryMockProblems,
} from "./commands.mjs";

import {
  assertStageAgent,
  assertTaskPrototypeCurrent,
  beginExecutionAttempt,
  closeExecutionAttempt,
  executionBlocksParallelWork,
  executionIsResumableCheckpoint,
  nextOpenDeliveryStage,
  projectRootForDeliveryTarget,
  rootPath,
  scopesOverlap,
  taskDeliveryTargets,
} from "./helpers.mjs";

import {
  ACTIVE_DELIVERY_STATUSES,
  FILE_LEASE_SCHEMA_VERSION,
  STORE,
  UI_DELIVERY_ROLE,
  appendFeatureHistory,
  assertLeafFeatureIds,
  canonicalFilePath,
  canonicalTaskPhase,
  csv,
  currentFeatureMap,
  currentFile,
  deliveryInput,
  deliveryReportProblems,
  deliveryStageClosureProblems,
  ensureProject,
  ensureWorkPlan,
  executionFile,
  executionIndexFile,
  executionIsFinalTerminal,
  fail,
  fileLeasesFile,
  gitCommitBlob,
  gitValue,
  gitWorktreeBlob,
  isContinuousDeliveryTask,
  listRuns,
  mergeAuditReminders,
  mergeProblems,
  now,
  projectTaskStateToFeatureMap,
  readFileLeases,
  readJson,
  rebuildExecutionIndex,
  required,
  resolveRun,
  runCoversFile,
  scopeCovers,
  slug,
  syncDeliveryReports,
  taskCoversFile,
  taskDeliveryTargetsFor,
  taskLeafFeatureIds,
  taskPrototypeProblems,
  assertRelatedFeatureIds,
  terminal,
  valueFor,
  workPlanFile,
  writeJson,
} from "../shared.mjs";

// 运行级写入范围是所有任务 writes 的并集；同运行内可共享，跨运行必须互不相交。
function runWriteScopes(plan) {
  return (plan.tasks ?? []).flatMap((task) => task.writes ?? []);
}

// 跨运行写入范围预检：声明范围只是意图，但并发模型把它当互斥单位，所以重叠
// 在开工前暴露，而不是等到写盘时以整目录锁的形式挡住后续运行。
function crossRunOverlap(run, prospectiveWrites) {
  return activeDeliveryWorkPlans()
    .filter((entry) => entry.run.id !== run.id)
    .map((entry) => ({
      runId: entry.run.id,
      scopes: runWriteScopes(entry.plan).filter((scope) =>
        prospectiveWrites.some((write) => scopesOverlap(scope, write)),
      ),
    }))
    .filter((entry) => entry.scopes.length);
}

function overlapFailure(overlappingRuns) {
  return (
    `写入范围与进行中运行重叠：${overlappingRuns
      .map((entry) => `${entry.runId}（${entry.scopes.join("、")}）`)
      .join("；")}；先结束其中之一，或用 --allow-overlap <理由> 显式确认并发共享范围。`
  );
}

export function workPlan() {
  const project = ensureProject();
  const run = resolveRun(required("--run"));
  const plan = ensureWorkPlan(run);
  const generic = isGenericDelivery(deliveryInput(run));
  const id = slug(required("--task"));
  const kind = required("--kind");
  if (plan.tasks.some((task) => task.id === id)) fail(`任务已存在：${id}`);
  const scope = valueFor("--scope") ?? "product";
  if (!new Set(["product", "technical", "governance"]).has(scope))
    fail("--scope 只能是 product、technical 或 governance");
  const leafFeatureIds = csv("--leaf-features");
  const legacyFeatures = csv("--features");
  const features = leafFeatureIds.length ? leafFeatureIds : legacyFeatures;
  const relatedFeatureIds = csv("--related-features");
  const writes = csv("--writes");
  if (scope === "product" || scope === "technical") {
    if (!features.length)
      fail(
        scope === "technical"
          ? "技术任务必须通过 --leaf-features 声明至少一个技术叶子功能 ID"
          : "产品任务必须通过 --leaf-features 声明至少一个子叶功能 ID",
      );
    if (features.length !== 1)
      fail("一个产品/技术任务只能关联一个叶子功能；请为每个功能分别登记任务。");
    assertLeafFeatureIds(features);
    const bound = currentFeatureMap()?.features.find((feature) => feature.id === features[0]);
    const boundKind = bound?.kind ?? "product";
    if (scope === "product" && boundKind === "technical")
      fail(`产品任务不能绑定技术叶子 ${features[0]}；用 --scope technical 重新登记`);
    if (scope === "technical" && boundKind !== "technical")
      fail(`技术任务只能绑定 kind=technical 的叶子，${features[0]} 当前为 ${boundKind}`);
    if (relatedFeatureIds.length)
      fail("产品/技术任务不得登记 --related-features；用 --leaf-features 关联即可");
    const problems = prototypeDevelopmentProblems(STORE, currentFeatureMap(), features);
    for (const id of features) {
      const current = currentFeatureMap()?.features.find((feature) => feature.id === id);
      const input = deliveryInput(run)?.featureInputs?.find((feature) => feature.id === id);
      if ((current?.planningRevision ?? null) !== (input?.planningRevision ?? null))
        problems.push(`功能 ${id} 的交付运行输入属于旧规划版本；先从新地图创建交付输入，不能在旧输入上换任务 ID 绕过复评`);
    }
    if (problems.length) fail(problems.join("\n"));
  } else if (features.length)
    fail("工程治理任务不得关联子叶功能；省略 --features/--leaf-features。");
  if (relatedFeatureIds.length && scope === "governance") {
    assertRelatedFeatureIds(relatedFeatureIds);
  }
  if (!writes.length) fail("--writes 至少声明一个写入范围");
  const requestedPhase = valueFor("--phase");
  const phase = generic
    ? DELIVERY_TASK_PHASE
    : scope === "product" && !requestedPhase && !valueFor("--project")
      ? DELIVERY_TASK_PHASE
      : canonicalTaskPhase(requestedPhase || "technical_implementation");
  if (
    !generic && scope !== "product" &&
    !DELIVERY_STAGES.some((stage) => stage.id === phase)
  )
    fail("工程治理任务 --phase 只能是四个标准开发阶段之一。");
  if (generic && requestedPhase)
    fail("此任务类型尚未声明阶段；请省略 --phase。");
  if (!generic && valueFor("--validation-profile"))
    fail("--validation-profile 仅适用于通用任务；连续产品交付沿用冻结阶段契约。");
  let validationProfile = null;
  if (generic) {
    try {
      validationProfile = freezeValidationProfile(valueFor("--validation-profile"));
    } catch (error) {
      fail(error?.message ?? String(error));
    }
  }
  const baseStageDefinitions = generic
    ? []
    : (deliveryInput(run)?.stages ?? DELIVERY_STAGES).map(
        ({ status, summary, updatedAt, ...stage }) => stage,
      );
  const featureAcceptanceSnapshot =
    scope === "governance" || features.length !== 1
      ? null
      : deliveryInput(run)?.featureAcceptanceCases?.[features[0]] ?? null;
  const stageDefinitions = generic
    ? []
    : applyFeatureAcceptanceCases(
        baseStageDefinitions,
        featureAcceptanceSnapshot,
      );
  const deliveryTargets = taskDeliveryTargets(
    project,
    scope,
    writes,
    phase,
    generic,
    stageDefinitions,
  );
  const dependsOn = csv("--depends-on");
  for (const dependency of dependsOn) {
    if (!plan.tasks.some((task) => task.id === dependency))
      fail(`依赖任务不存在：${dependency}`);
  }
  for (const task of plan.tasks) {
    const priorExecutionFile = executionFile(run, task.id);
    const priorExecution = fs.existsSync(priorExecutionFile)
      ? readJson(priorExecutionFile)
      : null;
    // 已完成或明确跳过的阶段只保留审计记录，不再占用后续串行阶段的功能/文件范围。
    // blocked 仍需保留冲突保护，直到总控记录协调结论或重新规划。
    if (!executionBlocksParallelWork(task, priorExecution)) continue;
    const featureConflict = features.some((feature) =>
      taskLeafFeatureIds(run, task).includes(feature),
    );
    if (featureConflict) {
      fail(
        `任务 ${id} 与 ${task.id} 关联同一功能；应合并到同一 agent，而非并发拆分。`,
      );
    }
  }
  // 跨运行写入范围预检（并发编排 §拆分规则）：默认拒绝，显式确认才允许共享。
  const overlappingRuns = crossRunOverlap(run, writes);
  const overlapReason = valueFor("--allow-overlap");
  if (overlappingRuns.length && !overlapReason)
    fail(overlapFailure(overlappingRuns));
  if (overlappingRuns.length) {
    plan.overlaps ??= [];
    plan.overlaps.push({
      at: now(),
      taskId: id,
      otherRunIds: overlappingRuns.map((entry) => entry.runId),
      scopes: [...new Set(overlappingRuns.flatMap((entry) => entry.scopes))],
      reason: overlapReason,
    });
  }
  plan.tasks.push({
    id,
    title: required("--title"),
    kind,
    phase,
    ...(generic
      ? { stageDefinitions: [], taskType: freezeTaskType(kind), validationProfile }
      : { stageDefinitions }),
    scope,
    leafFeatureIds: scope === "governance" ? [] : features,
    featureRevision: scope !== "governance" ? currentFeatureMap()?.features.find((feature) => feature.id === features[0])?.planningRevision ?? null : null,
    relatedFeatureIds,
    deliveryTargets,
    deliveryTarget:
      deliveryTargets.find((target) =>
        target.deliveryRoles.includes(UI_DELIVERY_ROLE),
      ) ??
      deliveryTargets[0] ??
      null,
    reads: csv("--reads"),
    writes,
    dependsOn,
    coupling: valueFor("--coupling") || "无共享写入、状态或契约耦合",
    verification: valueFor("--verify") || "待总 agent 指定",
    createdAt: now(),
  });
  writeJson(workPlanFile(run), plan);
  recordTreeSnapshot(run, { taskId: id, kind: "plan" });
  appendFeatureHistory(run, plan.tasks.at(-1), "task_planned", {
    taskStatus: "pending",
    summary: "任务已登记，等待领取。",
  });
  rebuildExecutionIndex();
  syncDeliveryReports(run);
  console.log(`已登记 ${run.id}/${id}`);
}

const GIT_PROCESS_PREFIXES = [
  `${STORE_DIRECTORY}/`,
  `${PRIVATE_STORE_DIRECTORY}/`,
  `.agents/skills/${SKILL_ID}/`,
  `.codex/skills/${SKILL_ID}/`,
];

function sha256File(file) {
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

function gitStatusEntries(root) {
  const output = gitValue(root, [
    "-c", "core.quotePath=false",
    "-c", "status.renames=false",
    "status", "--porcelain", "-z", "--untracked-files=all",
  ]);
  if (output === null) return [];
  return output.split("\0").filter(Boolean).map(entry => entry.slice(3)).filter(Boolean);
}

function isProductGitPath(value) {
  const relative = path.normalize(value).replaceAll("\\", "/");
  return !GIT_PROCESS_PREFIXES.some(prefix => relative === prefix.slice(0, -1) || relative.startsWith(prefix));
}

function gitSnapshot(root) {
  const baseCommit = gitValue(root, ["rev-parse", "HEAD"]);
  if (!baseCommit) return null;
  const dirtyFiles = gitStatusEntries(root)
    .filter(isProductGitPath)
    .map((file) => ({
      file,
      sha256: sha256File(path.resolve(root, file)),
      blob: gitWorktreeBlob(root, file),
    }));
  return { baseCommit, dirtyFiles };
}

// Preserve only files whose finished state is a real change from HEAD and from
// any pre-claim dirty content. Later gates use this to catch a shared-tree
// rollback without treating a legitimate later integration edit as a loss.
function gitFinishFiles(root, execution, files) {
  const claimDirty = new Map(
    (execution.baseDirtyFiles ?? [])
      .filter((entry) => entry?.file && typeof entry.sha256 === "string")
      .map((entry) => [entry.file, entry]),
  );
  return [...new Set(files)]
    .filter((file) => file && file !== "none")
    .flatMap((file) => {
      const absolute = path.resolve(root, file);
      const exists = (() => {
        try {
          return fs.statSync(absolute).isFile();
        } catch {
          return false;
        }
      })();
      const finishBlob = gitWorktreeBlob(root, file);
      // A present file with no object ID means Git is unavailable or the path
      // is not hashable. Do not manufacture a rollback guard from uncertainty.
      if (exists && !finishBlob) return [];
      const baseBlob = gitCommitBlob(root, execution.baseCommit, file);
      const finishSha256 = exists ? sha256File(absolute) : null;
      if (finishBlob === baseBlob) return [];
      const claim = claimDirty.get(file);
      if (claim?.sha256 === finishSha256) return [];
      return [
        {
          file,
          baseBlob,
          finishBlob,
          ...(typeof claim?.blob === "string" ? { claimBlob: claim.blob } : {}),
        },
      ];
    });
}

// 全树快照：tracked + untracked 的产品文件 sha256，排除 .git、.mf-dev-flow 与技能目录。
// 与 gitSnapshot（仅脏文件，用于 claim 基线）职责不同：本函数给对账提供可比较的时间点。
export function gitTreeSnapshot(root) {
  const baseCommit = gitValue(root, ["rev-parse", "HEAD"]);
  if (!baseCommit) return null;
  const tracked = gitValue(root, [
    "-c", "core.quotePath=false",
    "ls-files", "-z",
  ]);
  const untracked = gitValue(root, [
    "-c", "core.quotePath=false",
    "ls-files", "--others", "--exclude-standard", "-z",
  ]);
  if (tracked === null || untracked === null) return null;
  const files = {};
  for (const file of [...tracked.split("\0"), ...untracked.split("\0")]) {
    if (!file || !isProductGitPath(file)) continue;
    files[file] = sha256File(path.resolve(root, file));
  }
  return { baseCommit, files };
}

export function treeSnapshotsFile(run) {
  return path.join(run.dir, "tree-snapshots.json");
}

// 只存与前一条的差异；首条存全量。读取时按链重建，任何一条损坏都不静默跳过。
function diffSnapshot(previousFiles, files) {
  const added = {};
  const changed = {};
  const removed = [];
  for (const [file, sha] of Object.entries(files)) {
    if (previousFiles[file] === undefined) added[file] = sha;
    else if (previousFiles[file] !== sha) changed[file] = sha;
  }
  for (const file of Object.keys(previousFiles)) {
    if (files[file] === undefined) removed.push(file);
  }
  return { added, changed, removed };
}

// 快照链是读改写：并发写会互相覆盖丢条目。锁路径从快照文件派生，模式与
// fileTouchLockFile 一致（acquireLeaseLock / releaseFileLeaseLock）。
function treeSnapshotLockFile(run) {
  const digest = crypto
    .createHash("sha256")
    .update(canonicalFilePath(treeSnapshotsFile(run)))
    .digest("hex");
  return path.join(STORE, "tree-snapshot-locks", `${digest}.lock`);
}

export function recordTreeSnapshot(run, { taskId, kind }) {
  // 锁被占用时直接放弃本条快照（不阻塞调用方、不写日志）：丢一个时间点只
  // 损失区间归因的粒度，绝不损坏链条本身；调用方（plan/claim/bind/finish）
  // 永远不能被快照写入卡住。
  const lock = acquireLeaseLock(treeSnapshotLockFile(run));
  if (!lock) return;
  try {
    const snapshot = gitTreeSnapshot(process.cwd());
    if (!snapshot) return;
    const file = treeSnapshotsFile(run);
    const store = fs.existsSync(file)
      ? readJson(file)
      : { schemaVersion: 1, runId: run.id, entries: [] };
    store.entries ??= [];
    const previous = store.entries.at(-1);
    const rebuilt = readTreeSnapshots(run);
    const previousFiles = rebuilt.at(-1)?.files ?? {};
    const { added, changed, removed } = previous
      ? diffSnapshot(previousFiles, snapshot.files)
      : { added: snapshot.files, changed: {}, removed: [] };
    store.entries.push({
      at: now(),
      taskId,
      kind,
      baseCommit: snapshot.baseCommit,
      added,
      changed,
      removed,
    });
    writeJson(file, store);
  } finally {
    releaseFileLeaseLock(lock);
  }
}

export function readTreeSnapshots(run) {
  const file = treeSnapshotsFile(run);
  if (!fs.existsSync(file)) return [];
  const store = readJson(file);
  const rebuilt = [];
  let current = {};
  for (const entry of store.entries ?? []) {
    const next = { ...current };
    for (const [f, sha] of Object.entries(entry.added ?? {})) next[f] = sha;
    for (const [f, sha] of Object.entries(entry.changed ?? {})) next[f] = sha;
    for (const f of entry.removed ?? []) delete next[f];
    rebuilt.push({
      at: entry.at,
      taskId: entry.taskId,
      kind: entry.kind,
      baseCommit: entry.baseCommit,
      files: { ...next },
    });
    current = next;
  }
  return rebuilt;
}

// 证据级归因：某文件在相邻快照之间哈希变化，且该区间内只有一个活跃任务 → 归该任务。
// Ruling 11：歧义区间（0 或 2+ 活跃任务）不再立即放弃——文件可能在更晚的区间
// 再次变化且彼时恰只有一个活跃任务，那仍是有效证据；只有"文件未变化"的区间才跳过。
// 全部变化区间都歧义时返回 null，交由上层降级为 unattributed。
export function attributeByInterval(snapshotPairs, filePath) {
  for (const pair of snapshotPairs) {
    const before = pair.from?.[filePath];
    const after = pair.to?.[filePath];
    // 哈希比对：undefined → 有值也算变化（新建文件）。
    if (before === after) continue;
    // 缺 activeTasks 时按 0 个活跃任务处理：该区间证据不足，继续看更晚的区间。
    const activeTasks = pair.activeTasks ?? [];
    if (activeTasks.length === 1) {
      const [{ runId, taskId }] = activeTasks;
      return { basis: "snapshot-interval", runId, taskId };
    }
  }
  return null;
}

function runIntersectsPlan(candidatePlan, targetScopes) {
  return runWriteScopes(candidatePlan).some((scope) =>
    targetScopes.some((target) => scopesOverlap(scope, target)),
  );
}

// 相关运行 = 声明并集与目标运行相交的全部运行（含已终态但仍有未提交改动的运行）。
export function relatedRunsFor(run, plan) {
  const targetScopes = runWriteScopes(plan);
  return listRuns()
    .filter((entry) => entry.type === "delivery")
    .flatMap((entry) => {
      const file = workPlanFile(entry);
      if (!fs.existsSync(file)) return [];
      const candidatePlan = readJson(file);
      if (entry.id === run.id) return [{ run: entry, plan: candidatePlan }];
      return runIntersectsPlan(candidatePlan, targetScopes)
        ? [{ run: entry, plan: candidatePlan }]
        : [];
    });
}

function taskWriteScopesOverlap(left, right) {
  return (left.writes ?? []).some((leftScope) =>
    (right.writes ?? []).some((rightScope) =>
      scopesOverlap(leftScope, rightScope),
    ),
  );
}

function documentedOverlapApproval(plan, taskId, otherRunId, targetScopes) {
  return (plan.overlaps ?? []).some(
    (overlap) =>
      overlap.taskId === taskId &&
      (overlap.otherRunIds ?? []).includes(otherRunId) &&
      (overlap.scopes ?? []).some((scope) =>
        targetScopes.some((targetScope) =>
          scopesOverlap(scope, targetScope),
        ),
      ),
  );
}

function dispatchTaskSummary(run, task) {
  const file = executionFile(run, task.id);
  const execution = fs.existsSync(file) ? readJson(file) : null;
  return {
    taskId: task.id,
    title: task.title ?? task.id,
    status: execution?.status ?? "pending",
    writes: task.writes ?? [],
    changedFiles: execution?.changedFiles ?? [],
    claimedAt: execution?.claimedAt ?? null,
    updatedAt: execution?.updatedAt ?? null,
  };
}

function dispatchTaskMayWrite(run, task) {
  const file = executionFile(run, task.id);
  if (!fs.existsSync(file)) return true;
  return !terminal(readJson(file).status);
}

// 这是主 agent 派发前的边界判断，不依赖子 agent 的 PreToolUse 能力：
// 用当前任务的 writes 对照其他运行的声明、执行状态及工作树脏文件。
function dispatchRelatedRuns(run, task) {
  const plan = ensureWorkPlan(run);
  return listRuns()
    .filter((candidate) => candidate.type === "delivery" && candidate.id !== run.id)
    .flatMap((candidate) => {
      const file = workPlanFile(candidate);
      if (!fs.existsSync(file)) return [];
      const candidatePlan = readJson(file);
      const tasks = (candidatePlan.tasks ?? []).filter((candidateTask) =>
        taskWriteScopesOverlap(task, candidateTask),
      );
      if (!tasks.length) return [];
      return [
        {
          run: candidate,
          tasks,
          overlapApproved:
            documentedOverlapApproval(
              plan,
              task.id,
              candidate.id,
              task.writes ?? [],
            ) ||
            tasks.some((candidateTask) =>
              documentedOverlapApproval(
                candidatePlan,
                candidateTask.id,
                run.id,
                task.writes ?? [],
              ),
            ),
        },
      ];
    })
    .sort((left, right) => left.run.id.localeCompare(right.run.id));
}

export function dispatchBoundaryBrief(run, task) {
  const related = dispatchRelatedRuns(run, task);
  const dirtyFiles = currentTreeChanges()
    .filter((file) => taskCoversFile(task, file))
    .map((file) => ({
      file,
      otherRunIds: related
        .filter((entry) => entry.tasks.some((otherTask) => taskCoversFile(otherTask, file)))
        .map((entry) => entry.run.id),
    }));
  const activeUnapproved = related.filter(
    (entry) =>
      ACTIVE_DELIVERY_STATUSES.has(entry.run.run.status) &&
      !entry.overlapApproved &&
      entry.tasks.some((otherTask) => dispatchTaskMayWrite(entry.run, otherTask)),
  );
  const verdict = activeUnapproved.length
    ? "block"
    : related.length || dirtyFiles.length
      ? "review"
      : "clear";
  return {
    schemaVersion: 1,
    verdict,
    task: {
      taskId: task.id,
      title: task.title ?? task.id,
      writes: task.writes ?? [],
    },
    relatedRuns: related.map((entry) => ({
      runId: entry.run.id,
      runStatus: entry.run.run.status,
      tasks: entry.tasks
        .map((otherTask) => dispatchTaskSummary(entry.run, otherTask))
        .sort((left, right) => left.taskId.localeCompare(right.taskId)),
    })),
    dirtyFiles,
    overlapApprovals: related
      .filter((entry) => entry.overlapApproved)
      .map((entry) => entry.run.id),
  };
}

// 当前工作树里所有产品文件的改动（tracked 相对 HEAD 的变更 + 未跟踪文件）。
// 只取路径：归因是路径级问题，哈希比对由快照链负责。
function currentTreeChanges() {
  const snapshot = gitTreeSnapshot(process.cwd());
  const base = gitValue(process.cwd(), ["rev-parse", "HEAD"]);
  if (!snapshot || !base) return [];
  const tracked = gitValue(process.cwd(), [
    "-c", "core.quotePath=false", "diff", "--name-only", "-z", base, "--",
  ]) ?? "";
  const untracked = gitValue(process.cwd(), [
    "-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard", "-z",
  ]) ?? "";
  const paths = new Set();
  for (const file of [...tracked.split("\0"), ...untracked.split("\0")]) {
    if (file && isProductGitPath(file)) paths.add(file);
  }
  return [...paths].sort();
}

// 对账：把当前树改动分入三桶。归因基准是声明并集；歧义时用快照区间补证据；
// 无声明又无证据的进 unattributed，绝不默认算作本次任务改动。
export function reconcileRun(run) {
  const plan = ensureWorkPlan(run);
  const related = relatedRunsFor(run, plan);
  // 只计算一次当前改动集，三桶与 declaredUnchanged 共用同一视图。
  const changed = currentTreeChanges();
  const shared = [];
  const attributed = [];
  const unattributed = [];
  for (const file of changed) {
    const covering = related.filter((entry) => runCoversFile(entry.plan, file));
    if (covering.length > 1) {
      shared.push({ file, runIds: covering.map((entry) => entry.run.id).sort() });
      continue;
    }
    if (covering.length === 1) {
      const entry = covering[0];
      const owner = (entry.plan.tasks ?? []).find((task) =>
        runCoversFile({ tasks: [task] }, file),
      );
      attributed.push({
        file,
        runId: entry.run.id,
        taskId: owner?.id ?? null,
        basis: "declaration-scope",
      });
      continue;
    }
    unattributed.push({ file });
  }
  // 区间归因作为补充证据：对 unattributed 里能定位到唯一活跃任务的，提升为 inferred。
  const pairs = snapshotPairsFor(related);
  const inferred = [];
  const stillUnattributed = [];
  for (const item of unattributed) {
    const found = attributeByInterval(pairs, item.file);
    if (found) inferred.push({ file: item.file, ...found });
    else stillUnattributed.push(item);
  }
  // 声明但未改动：逐任务看它的声明范围内是否没有任何当前改动（范围过宽信号）。
  const changedSet = new Set(changed);
  const declaredUnchanged = [];
  for (const entry of related) {
    for (const task of entry.plan.tasks ?? []) {
      const touched = [...changedSet].some((file) =>
        (task.writes ?? []).some(
          (scope) => file === scope || file.startsWith(scope.replace(/\/+$/, "") + "/"),
        ),
      );
      if (!touched)
        declaredUnchanged.push({
          runId: entry.run.id,
          taskId: task.id,
          scopes: task.writes ?? [],
        });
    }
  }
  return { attributed, inferred, unattributed: stillUnattributed, declaredUnchanged, shared };
}

const RECONCILIATION_RESOLUTIONS_SCHEMA_VERSION = 1;

function reconciliationResolutionsFile(run) {
  return path.join(run.dir, "reconcile-resolutions.json");
}

function emptyReconciliationResolutions(run) {
  return {
    schemaVersion: RECONCILIATION_RESOLUTIONS_SCHEMA_VERSION,
    runId: run.id,
    updatedAt: null,
    resolutions: [],
  };
}

function readReconciliationResolutions(run) {
  const file = reconciliationResolutionsFile(run);
  if (!fs.existsSync(file)) return emptyReconciliationResolutions(run);
  const store = readJson(file);
  if (
    store?.schemaVersion !== RECONCILIATION_RESOLUTIONS_SCHEMA_VERSION ||
    store?.runId !== run.id ||
    !Array.isArray(store?.resolutions)
  )
    fail(`对账裁决记录格式不兼容：${file}`);
  return store;
}

function sameRunIds(left, right) {
  const leftIds = [...(left ?? [])].sort();
  const rightIds = [...(right ?? [])].sort();
  return (
    leftIds.length === rightIds.length &&
    leftIds.every((id, index) => id === rightIds[index])
  );
}

function resolutionMatchesFinding(resolution, kind, finding) {
  if (resolution?.kind !== kind || resolution?.file !== finding.file) return false;
  return kind !== "shared" || sameRunIds(resolution.runIds, finding.runIds);
}

function reconciliationResolutionState(run, result) {
  const store = readReconciliationResolutions(run);
  const resolved = [];
  const unresolved = [];
  for (const kind of ["shared", "unattributed"]) {
    for (const finding of result[kind] ?? []) {
      const resolution = store.resolutions.find((item) =>
        resolutionMatchesFinding(item, kind, finding),
      );
      const item = { kind, ...finding };
      if (resolution) resolved.push({ ...item, resolution });
      else unresolved.push(item);
    }
  }
  return { resolutions: store.resolutions, resolved, unresolved };
}

function unresolvedReconciliationProblems(run, unresolved) {
  return unresolved.map((item) => {
    const command = `work reconcile --run ${run.id} --resolve ${item.kind} --file ${item.file} --summary <裁决结论>`;
    if (item.kind === "shared")
      return `对账 shared 改动尚未裁决：${item.file}（${item.runIds.join("、")}）；由主 agent 确认归属后运行 ${command}`;
    return `对账 unattributed 改动尚未裁决：${item.file}；由主 agent 确认来源后运行 ${command}`;
  });
}

function repairResultForUnresolved(result, resolutionState) {
  return {
    ...result,
    shared: resolutionState.unresolved.filter((item) => item.kind === "shared"),
    unattributed: resolutionState.unresolved.filter(
      (item) => item.kind === "unattributed",
    ),
  };
}

function reconciliationFileArgument() {
  const root = canonicalFilePath(".");
  const absolute = canonicalFilePath(required("--file"));
  const relative = path.relative(root, absolute);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    fail("--file 必须是工作区内的产品文件路径。");
  return relative.split(path.sep).join("/");
}

function resolveReconciliationFinding(run, kind) {
  if (!new Set(["shared", "unattributed"]).has(kind))
    fail("--resolve 只能是 shared 或 unattributed");
  const file = reconciliationFileArgument();
  const summary = required("--summary");
  const result = reconcileRun(run);
  const finding = (result[kind] ?? []).find((item) => item.file === file);
  if (!finding) fail(`当前对账中没有可裁决的 ${kind} 文件：${file}`);
  const store = readReconciliationResolutions(run);
  const resolvedAt = now();
  const resolution = {
    kind,
    file,
    ...(kind === "shared" ? { runIds: finding.runIds } : {}),
    summary,
    by: valueFor("--by") ?? "root",
    resolvedAt,
  };
  const index = store.resolutions.findIndex(
    (item) => item.kind === kind && item.file === file,
  );
  if (index === -1) store.resolutions.push(resolution);
  else store.resolutions[index] = resolution;
  store.updatedAt = resolvedAt;
  writeJson(reconciliationResolutionsFile(run), store);
  console.log(
    JSON.stringify(
      {
        schemaVersion: RECONCILIATION_RESOLUTIONS_SCHEMA_VERSION,
        run: { id: run.id, type: run.type, status: run.run.status },
        resolution,
      },
      null,
      2,
    ),
  );
}

// 构造区间对：相邻快照之间，活跃任务 = 该区间内 claim/bind 过、且尚未 finish 的任务。
// 跨运行的所有快照按时间合并，保证归属判定能看见并发写入者。
function snapshotPairsFor(related) {
  const points = [];
  for (const entry of related) {
    for (const snapshot of readTreeSnapshots(entry.run)) {
      points.push({ ...snapshot, runId: entry.run.id });
    }
  }
  points.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const pairs = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const activeTasks = related.flatMap((entry) =>
      (entry.plan.tasks ?? []).flatMap((task) => {
        const file = executionFile(entry.run, task.id);
        if (!fs.existsSync(file)) return [];
        const execution = readJson(file);
        // Ruling 11：活跃判定不得只看 in_progress——任务收尾后，其 claim→finish
        // 窗口内的区间证据仍然成立（否则终态任务的改动永远找不到归属）。
        // finishedAt 只对终态执行有意义；in_progress 的 updatedAt 只是心跳，当作 null。
        const claimedAt = execution.claimedAt;
        const finishedAt = terminal(execution.status) ? execution.updatedAt : null;
        const overlaps =
          claimedAt && claimedAt < to.at && (!finishedAt || finishedAt > from.at);
        return overlaps ? [{ runId: entry.run.id, taskId: task.id }] : [];
      }),
    );
    pairs.push({ from: from.files, to: to.files, activeTasks });
  }
  return pairs;
}

function gitChangesSinceBaseline(root, baseline) {
  if (!baseline?.baseCommit) return { available: false, files: [], baselineFiles: [] };
  const trackedOutput = gitValue(root, [
    "-c", "core.quotePath=false",
    "diff", "--name-only", "-z", baseline.baseCommit, "--",
  ]);
  if (trackedOutput === null) return { available: false, files: [], baselineFiles: [] };
  const baselineByKey = new Map(baseline.dirtyFiles.map(item => [item.file, item.sha256]));
  const changed = new Set();
  for (const file of trackedOutput.split("\0").filter(Boolean)) {
    if (!isProductGitPath(file)) continue;
    const digest = sha256File(path.resolve(root, file));
    if (baselineByKey.get(file) !== digest) changed.add(file);
  }
  const untrackedOutput = gitValue(root, [
    "-c", "core.quotePath=false",
    "ls-files", "--others", "--exclude-standard", "-z",
  ]);
  if (untrackedOutput === null) return { available: false, files: [], baselineFiles: [] };
  for (const file of untrackedOutput.split("\0").filter(Boolean)) {
    if (!isProductGitPath(file)) continue;
    const digest = sha256File(path.resolve(root, file));
    if (baselineByKey.get(file) !== digest) changed.add(file);
  }
  return {
    available: true,
    files: [...changed].sort(),
    baselineFiles: [...baselineByKey.keys()].sort(),
  };
}

export function workClaim() {
  ensureProject();
  const run = resolveRun(required("--run"));
  const plan = ensureWorkPlan(run);
  const taskId = slug(required("--task"));
  const task = plan.tasks.find((item) => item.id === taskId);
  if (!task) fail(`未规划任务：${taskId}`);
  assertTaskPrototypeCurrent(run, task);
  const phase = canonicalTaskPhase(task.phase);
  const stages = taskStageDefinitions(task);
  const requestedTargetPhase = valueFor("--target-phase");
  const agent = required("--agent");
  if (
    requestedTargetPhase &&
    !stages.some((stage) => stage.id === requestedTargetPhase)
  )
    fail("--target-phase 必须是任务类型声明的阶段；无阶段任务请省略该参数。");
  const nextStage = nextOpenDeliveryStage(task);
  const nextProfile = nextStage
    ? stageAgentFor(task, nextStage.id)
    : null;
  if (
    nextProfile &&
    requestedTargetPhase &&
    requestedTargetPhase !== nextStage.id
  )
    fail(`当前应先执行 ${nextStage.id} 阶段，不能将目标设为 ${requestedTargetPhase}。`);
  const targetPhase = nextProfile
    ? nextStage.id
    : requestedTargetPhase || stages.at(-1)?.id || null;
  if (nextProfile) assertStageAgent(task, nextStage.id, agent);
  else if (targetPhase) assertStageAgent(task, targetPhase, agent);
  if (!isContinuousDeliveryTask(task) && phase === "technical_implementation") {
    const problems = deliveryImplementationProblems(run);
    if (problems.length) fail(`不能领取实现任务：\n- ${problems.join("\n- ")}`);
  }
  if (!isContinuousDeliveryTask(task) && phase === "api_mock") {
    const problems = deliveryMockProblems(run);
    if (problems.length)
      fail(`不能领取 Mock 任务：\n- ${problems.join("\n- ")}`);
  }
  if (!isContinuousDeliveryTask(task) && phase === "end_to_end_acceptance") {
    const problems = deliveryAcceptanceProblems(run);
    if (problems.length)
      fail(`不能领取全链路测试任务：\n- ${problems.join("\n- ")}`);
  }
  for (const dependency of task.dependsOn) {
    const file = executionFile(run, dependency);
    if (!fs.existsSync(file)) fail(`依赖尚未领取：${dependency}`);
    const dependencyTask = plan.tasks.find((item) => item.id === dependency);
    const dependencyExecution = readJson(file);
    if (!executionIsFinalTerminal(dependencyTask, dependencyExecution))
      fail(`依赖尚未完成：${dependency}（${dependencyExecution.status}）`);
  }
  const file = executionFile(run, taskId);
  const sessionId = valueFor("--session") || null;
  if (sessionId) assertSessionAvailable(run, plan, sessionId, taskId);
  const gitBaseline = gitSnapshot(process.cwd());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const descriptor = fs.openSync(file, "wx");
    fs.writeFileSync(
      descriptor,
      `${JSON.stringify({ schemaVersion: 2, runId: run.id, taskId, agent, sessionId, status: "in_progress", targetPhase, claimedAt: now(), updatedAt: now(), baseCommit: gitBaseline?.baseCommit ?? null, baseDirtyFiles: gitBaseline?.dirtyFiles ?? [], summary: null, changedFiles: [], tests: null, notes: [], stages: {}, checkpoints: [], handoffs: [], attempts: [{ id: "attempt-1", agent, status: "in_progress", sessionId, targetPhase, startedAt: now(), endedAt: null, summary: null }] }, null, 2)}\n`,
    );
    fs.closeSync(descriptor);
  } catch (error) {
    if (error.code === "EEXIST") fail(`任务已被领取：${taskId}`);
    throw error;
  }
  if (run.run.status === "done") {
    run.run.status = "in_progress";
    run.run.notes ??= [];
    run.run.notes.push({ at: now(), note: `主任务重新打开：领取新任务 ${taskId}` });
    writeJson(path.join(run.dir, "run.json"), run.run);
  }
  recordTreeSnapshot(run, { taskId, kind: "claim" });
  rebuildExecutionIndex();
  projectTaskStateToFeatureMap(run, task, { at: now() });
  appendFeatureHistory(run, task, "task_claimed", {
    taskStatus: "in_progress",
    summary: "任务已领取并开始执行。",
  });
  syncDeliveryReports(run);
  kernelSync(run, plan, { reason: "claimed", taskId });
  console.log(`已领取 ${run.id}/${taskId}`);
}

// 运行内并发模型允许同一 Codex 会话绑定多个任务；任务唯一性由 execution 文件 wx 创建保证。
export function assertSessionAvailable() {}

export function workBindSession() {
  ensureProject();
  const run = resolveRun(required("--run"));
  const plan = ensureWorkPlan(run);
  const taskId = slug(required("--task"));
  const file = executionFile(run, taskId);
  const task = plan.tasks.find((item) => item.id === taskId);
  if (!task) fail(`未规划任务：${taskId}`);
  assertTaskPrototypeCurrent(run, task);
  if (!fs.existsSync(file)) fail(`任务未领取：${taskId}`);
  const execution = readJson(file);
  const agent = required("--agent");
  const sessionId = required("--session");
  const requestedTargetPhase = valueFor("--target-phase");
  const stages = taskStageDefinitions(task);
  if (
    requestedTargetPhase &&
    !stages.some((stage) => stage.id === requestedTargetPhase)
  )
    fail("--target-phase 必须是任务类型声明的阶段；无阶段任务请省略该参数。");
  const resumed = executionIsResumableCheckpoint(task, execution);
  if (execution.status !== "in_progress" && !resumed)
    fail(`任务 ${taskId} 已不是可续做的进行中检查点。`);
  if (!resumed && execution.agent !== agent)
    fail(`任务 ${taskId} 正在进行中，不能由 ${agent} 替换 ${execution.agent}。`);
  const nextStage = nextOpenDeliveryStage(task, execution);
  const nextProfile = nextStage
    ? stageAgentFor(task, nextStage.id)
    : null;
  const latestCheckpoint = execution.checkpoints?.at(-1);
  const lateBindCurrentCheckpoint =
    execution.status === "in_progress" &&
    execution.sessionId == null &&
    execution.agent === agent &&
    requestedTargetPhase === execution.targetPhase &&
    latestCheckpoint?.targetPhase === execution.targetPhase &&
    latestCheckpoint?.status === "reached";
  if (
    nextProfile &&
    requestedTargetPhase &&
    requestedTargetPhase !== nextStage.id &&
    !lateBindCurrentCheckpoint
  )
    fail(`当前应先执行 ${nextStage.id} 阶段，不能将目标设为 ${requestedTargetPhase}。`);
  const boundPhase =
    lateBindCurrentCheckpoint
      ? execution.targetPhase
      : nextProfile
      ? nextStage.id
      : requestedTargetPhase || execution.targetPhase || stages.at(-1)?.id;
  if (lateBindCurrentCheckpoint) assertStageAgent(task, boundPhase, agent);
  else if (nextProfile) assertStageAgent(task, nextStage.id, agent);
  else if (boundPhase) assertStageAgent(task, boundPhase, agent);
  assertSessionAvailable(run, plan, sessionId, taskId);
  const previousAgent = execution.agent;
  const previousPhase = execution.targetPhase;
  execution.sessionId = sessionId;
  if (nextProfile || requestedTargetPhase) execution.targetPhase = boundPhase;
  if (resumed) {
    execution.agent = agent;
    beginExecutionAttempt(execution, {
      agent,
      sessionId,
      targetPhase: execution.targetPhase || stages.at(-1)?.id,
    });
    if (previousAgent !== agent) {
      execution.handoffs ??= [];
      execution.handoffs.push({
        id: `handoff-${execution.handoffs.length + 1}`,
        at: now(),
        fromAgent: previousAgent,
        toAgent: agent,
        fromPhase: previousPhase,
        toPhase: execution.targetPhase,
      });
    }
    execution.status = "in_progress";
    execution.summary = null;
    execution.tests = null;
  }
  const gitBaseline = gitSnapshot(process.cwd());
  execution.baseCommit = gitBaseline?.baseCommit ?? null;
  execution.baseDirtyFiles = gitBaseline?.dirtyFiles ?? [];
  execution.updatedAt = now();
  execution.notes.push({
    at: execution.updatedAt,
    note: requestedTargetPhase
      ? `${resumed ? "已从已完成检查点续做，并" : "已绑定 Codex 会话，并"}将本次目标阶段设为 ${requestedTargetPhase}。`
      : resumed
        ? "已从已完成检查点续做同一任务，并创建新的执行尝试。"
        : "已绑定 Codex 会话，用于写前文件租约门禁。",
  });
  writeJson(file, execution);
  recordTreeSnapshot(run, { taskId, kind: "bind" });
  rebuildExecutionIndex();
  projectTaskStateToFeatureMap(run, task, { at: execution.updatedAt });
  syncDeliveryReports(run);
  console.log(`已绑定 ${run.id}/${taskId} 到 Codex 会话。`);
}

export function workDeliveryBrief() {
  ensureProject();
  const run = resolveRun(required("--run"));
  if (run.type !== "delivery") fail("delivery-brief 只能用于开发运行。");
  const taskId = slug(required("--task"));
  const task = ensureWorkPlan(run).tasks.find((item) => item.id === taskId);
  if (!task) fail(`未规划任务：${taskId}`);
  if (process.argv.includes("--dispatch")) {
    console.log(JSON.stringify(dispatchBoundaryBrief(run, task), null, 2));
    return;
  }
  const stageDefinitions = taskStageDefinitions(task);
  if (!stageDefinitions.length) {
    if (valueFor("--target-phase")) fail("此任务类型尚未声明阶段，请省略 --target-phase。");
    return console.log(renderGenericDeliveryBrief(task));
  }
  if (!isContinuousDeliveryTask(task))
    fail(`任务 ${taskId} 不是连续产品交付任务。`);
  const executionFilePath = executionFile(run, taskId);
  const execution = fs.existsSync(executionFilePath)
    ? readJson(executionFilePath)
    : null;
  const targetPhase =
    valueFor("--target-phase") ||
    execution?.targetPhase ||
    stageDefinitions.at(-1)?.id;
  if (!stageDefinitions.some((stage) => stage.id === targetPhase))
    fail("--target-phase 必须是阶段契约中的有效阶段。");
  const completedStageIds = Object.entries(execution?.stages ?? {})
    .filter(([, record]) => DELIVERY_STAGE_CLOSED_STATUSES.has(record.status))
    .map(([id]) => id);
  const currentStage = stageDefinitions
    .slice(0, stageDefinitions.findIndex((stage) => stage.id === targetPhase) + 1)
    .find((stage) => !completedStageIds.includes(stage.id));
  const input = deliveryInput(run);
  console.log(
    renderDeliveryBrief({
      targetPhase,
      completedStageIds,
      stageDefinitions,
      contract: deliveryContractForInput(input),
      agentProfile: currentStage?.agent ?? null,
      carriedRisks: input?.carriedRisks ?? [],
    }),
  );
}

export function activeDeliveryRun() {
  const current = readJson(currentFile());
  if (current.active?.type !== "delivery" || !current.active?.id) return null;
  const run = resolveRun(current.active.id);
  return ACTIVE_DELIVERY_STATUSES.has(run.run.status) ? run : null;
}

// `current.json` identifies the run shown by default in the UI. It is not an
// ownership record: a workspace may have several delivery runs in progress.
export function activeDeliveryWorkPlans() {
  return listRuns()
    .filter(
      (run) =>
        run.type === "delivery" && ACTIVE_DELIVERY_STATUSES.has(run.run.status),
    )
    .flatMap((run) => {
      const file = workPlanFile(run);
      return fs.existsSync(file) ? [{ run, plan: readJson(file) }] : [];
    });
}

export function runningSessionTaskCandidates(sessionId, activePlans) {
  return activePlans.flatMap(({ run, plan }) =>
    (plan.tasks ?? []).flatMap((task) => {
      const file = executionFile(run, task.id);
      if (!fs.existsSync(file)) return [];
      const execution = readJson(file);
      return execution.status === "in_progress" && execution.sessionId === sessionId
        ? [{ run, plan, task, execution }]
        : [];
    }),
  );
}

export function writeOwnershipForSession(sessionId, requestedFile) {
  const activePlans = activeDeliveryWorkPlans();
  const explicitRunId = valueFor("--run");
  const explicitTaskId = valueFor("--task");
  if (Boolean(explicitRunId) !== Boolean(explicitTaskId))
    fail("文件租约的 --run 和 --task 必须同时提供。");

  let candidates = runningSessionTaskCandidates(sessionId, activePlans);
  if (explicitRunId && explicitTaskId) {
    candidates = candidates.filter(
      (candidate) =>
        candidate.run.id === explicitRunId && candidate.task.id === explicitTaskId,
    );
  }
  // 所有权单位是 delivery run：同一运行的任务可共享/互改文件，跨运行必须互斥。
  const coveredPlans = activePlans.filter(({ plan }) =>
    runCoversFile(plan, requestedFile),
  );
  const scoped = candidates.filter(({ run }) =>
    coveredPlans.some((covered) => covered.run.id === run.id),
  );
  return {
    activePlans,
    candidates,
    coveredPlans,
    scoped,
    explicit: Boolean(explicitRunId),
  };
}

export function executionForSession(run, plan, sessionId) {
  const matches = plan.tasks
    .map((task) => {
      const file = executionFile(run, task.id);
      return fs.existsSync(file) ? { task, execution: readJson(file) } : null;
    })
    .filter(
      (item) =>
        item?.execution.status === "in_progress" &&
        item.execution.sessionId === sessionId,
    );
  return matches.length === 1 ? matches[0] : null;
}

export function leaseIsActive(lease, run, plan, timestamp) {
  if (Date.parse(lease.expiresAt) <= timestamp) return false;
  const task = plan.tasks.find((item) => item.id === lease.taskId);
  if (!task) return false;
  const file = executionFile(run, task.id);
  if (!fs.existsSync(file)) return false;
  const execution = readJson(file);
  return (
    execution.status === "in_progress" &&
    execution.sessionId === lease.sessionId
  );
}

export function recordLeaseConflict(leases, conflict) {
  const existing = leases.conflicts.find(
    (item) =>
      item.status === "open" &&
      item.file === conflict.file &&
      item.waitingTaskId === conflict.waitingTaskId &&
      item.ownerTaskId === conflict.ownerTaskId,
  );
  if (existing) {
    existing.lastSeenAt = conflict.lastSeenAt;
    existing.retryAfterSeconds = conflict.retryAfterSeconds;
    return existing;
  }
  const id = `conflict-${crypto.createHash("sha256").update(`${conflict.file}\u0000${conflict.waitingTaskId}\u0000${conflict.ownerTaskId}\u0000${now()}`).digest("hex").slice(0, 12)}`;
  const entry = { id, status: "open", ...conflict };
  leases.conflicts.push(entry);
  return entry;
}

export function leaseResponse(value) {
  console.log(
    JSON.stringify({
      schemaVersion: FILE_LEASE_SCHEMA_VERSION,
      generatedAt: now(),
      ...value,
    }),
  );
}

export function fileLeaseLockFile(requestedFile) {
  const digest = crypto
    .createHash("sha256")
    .update(canonicalFilePath(requestedFile))
    .digest("hex");
  return path.join(STORE, "file-lease-locks", `${digest}.lock`);
}

// 触碰台账是全局的：写入不再被租约拒绝，但每次触碰都要留痕，供冲突确认与审计读取。
export function fileTouchesFile() {
  return path.join(STORE, "file-touches.json");
}

function fileTouchLockFile() {
  const digest = crypto
    .createHash("sha256")
    .update(canonicalFilePath(fileTouchesFile()))
    .digest("hex");
  return path.join(STORE, "file-touch-locks", `${digest}.lock`);
}

function recordFileTouch(touch) {
  // 触碰锁被占用时直接放弃本次记录：这是有意的丢弃，绝不能让台账锁阻塞调用方写入。
  const lock = acquireLeaseLock(fileTouchLockFile());
  if (!lock) return;
  try {
    const file = fileTouchesFile();
    const store = fs.existsSync(file)
      ? readJson(file)
      : { schemaVersion: 1, updatedAt: null, touches: [] };
    store.touches.push({ at: now(), ...touch });
    store.updatedAt = now();
    writeJson(file, store);
  } finally {
    releaseFileLeaseLock(lock);
  }
}

// 触碰台账 append-only，因此条目身份可以用数组下标稳定合成：touch-<index>。
// conflict-status 与 conflict-resolve 都用这个 id 指向同一条触碰，无需额外落盘。
export function touchIdFor(index) {
  return `touch-${index}`;
}

function touchIndexFromId(id) {
  const match = /^touch-(\d+)$/.exec(String(id ?? ""));
  return match ? Number(match[1]) : null;
}

// 全局台账纯读取：缺文件返回空数组而不是报错。台账是全局的，不按运行分文件。
export function readFileTouches() {
  const file = fileTouchesFile();
  if (!fs.existsSync(file))
    return {
      schemaVersion: FILE_LEASE_SCHEMA_VERSION,
      updatedAt: null,
      touches: [],
    };
  const store = readJson(file);
  return {
    schemaVersion: store?.schemaVersion ?? FILE_LEASE_SCHEMA_VERSION,
    updatedAt: store?.updatedAt ?? null,
    touches: Array.isArray(store?.touches) ? store.touches : [],
  };
}

// 写路径专用：台账此刻不可读（缺文件或正在写入中）时按"无历史触碰"处理，绝不阻断写入。
function priorFileTouches() {
  try {
    return readFileTouches().touches;
  } catch {
    return [];
  }
}

export function fileLeaseLockOwnerExited(lockFile) {
  let record;
  try {
    record = readJson(lockFile);
  } catch {
    return false;
  }
  if (!Number.isInteger(record?.pid) || record.pid <= 0) return false;
  try {
    process.kill(record.pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}

export function acquireLeaseLock(lockFile) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockFile, "wx", 0o600);
      fs.writeFileSync(
        descriptor,
        `${JSON.stringify({ acquiredAt: now(), pid: process.pid })}\n`,
      );
      return { descriptor, lockFile };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (fileLeaseLockOwnerExited(lockFile)) {
        try {
          fs.unlinkSync(lockFile);
        } catch (unlinkError) {
          if (unlinkError.code !== "ENOENT") throw unlinkError;
        }
        continue;
      }
      return null;
    }
  }
  return null;
}

export function acquireFileLeaseLock(requestedFile) {
  return acquireLeaseLock(fileLeaseLockFile(requestedFile));
}

export function fileLeaseStoreLockFile(run) {
  const digest = crypto
    .createHash("sha256")
    .update(canonicalFilePath(fileLeasesFile(run)))
    .digest("hex");
  return path.join(STORE, "file-lease-store-locks", `${digest}.lock`);
}

export function acquireFileLeaseStoreLock(run) {
  return acquireLeaseLock(fileLeaseStoreLockFile(run));
}

export function withFileLeaseStoreLock(run, operation) {
  const lock = acquireFileLeaseStoreLock(run);
  if (!lock) return false;
  try {
    operation();
    return true;
  } finally {
    releaseFileLeaseLock(lock);
  }
}

export function releaseFileLeaseLock(lock) {
  try {
    fs.closeSync(lock.descriptor);
  } finally {
    try {
      fs.unlinkSync(lock.lockFile);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export function workLeaseForWrite() {
  ensureProject();
  const sessionId = required("--session");
  const requestedFile = canonicalFilePath(required("--file"));
  const ownership = writeOwnershipForSession(sessionId, requestedFile);
  const observations = [];
  if (!ownership.activePlans.length) observations.push("no-active-run");
  if (ownership.coveredPlans.length > 1) observations.push("cross-run-scope");
  if (ownership.activePlans.length && !ownership.candidates.length)
    observations.push("no-active-run");
  if (ownership.candidates.length && !ownership.scoped.length)
    observations.push("out-of-scope");
  // 绑定优先级：在范围内的会话任务优先，否则退回到会话候选（文件越界时仍记录）。
  const sessionTask = ownership.scoped[0] ?? ownership.candidates[0] ?? null;
  // 原型复评不再拒绝写入，但信号必须保留：命中时记为该观测，交由上层门禁提示。
  if (sessionTask && taskPrototypeProblems(sessionTask.run, sessionTask.task).length)
    observations.push("prototype-reassessment-required");
  const currentRunId = sessionTask?.run.id ?? null;
  const currentTaskId = sessionTask?.task.id ?? null;
  // Ruling 8：并发同文件观测从全局触碰台账派生。租约不再被写入，所以判据是
  // "台账里已有同一文件、但属于不同 runId 或 taskId 的触碰"（无身份触碰 runId/taskId 为 null）。
  const sameFileElsewhere = priorFileTouches().some(
    (touch) =>
      touch.file === requestedFile &&
      (touch.runId !== currentRunId || touch.taskId !== currentTaskId),
  );
  if (sameFileElsewhere) observations.push("concurrent-same-file");
  // 台账是全局的：无活跃运行时也必须记录，否则 no-active-run 触碰会丢失。
  recordFileTouch({
    file: requestedFile,
    runId: currentRunId,
    taskId: currentTaskId,
    sessionId,
    agent: sessionTask?.execution?.agent ?? null,
    observations,
  });
  leaseResponse({
    verdict: "allow",
    taskId: sessionTask?.task.id ?? null,
    observations,
  });
}

// 文件租约已降级为只记不拦的触碰台账：释放不再改写任何租约存储，保留下调用点签名。
export function releaseSessionLeases(sessionId) {
  leaseResponse({ verdict: "allow", released: 0, sessionId });
}

export function releaseTaskLeases(run, taskId) {
  return undefined;
}

export function workLease() {
  if (process.argv.includes("--for-write")) return workLeaseForWrite();
  if (valueFor("--release-session"))
    return releaseSessionLeases(required("--release-session"));
  fail("work lease 需要 --for-write 或 --release-session <Codex会话ID>");
}

export function workConflictStatus() {
  ensureProject();
  const run = resolveRun(required("--run"));
  // 触碰台账是全局的且 append-only：每条触碰按数组下标获得稳定 id，与
  // conflict-resolve 的 --conflict 取值一致（touch-<index>）。
  // id 放在展开之后：即使历史/异常条目自带 id，合成的稳定 id 也不可被覆盖。
  const store = readFileTouches();
  const touches = store.touches.map((touch, index) => ({
    ...touch,
    id: touchIdFor(index),
  }));
  // 只收窄到本次运行自己的触碰；无身份触碰（runId 为 null）无法归属到任何运行，
  // 因此既不出现在这个子集里，也不参与 crossRunTouches 判定。
  const runTouches = touches.filter((touch) => touch.runId === run.id);
  // 未确认的跨运行触碰：本运行触碰的 observations 里带 cross-run-scope，
  // 即该次写入与另一个运行的声明范围相撞，尚未被主 agent 用 conflict-resolve 确认。
  const crossRunTouches = runTouches
    .filter(
      (touch) =>
        Array.isArray(touch.observations) &&
        touch.observations.includes("cross-run-scope") &&
        !touch.confirmedAt,
    )
    .map((touch) => ({
      id: touch.id,
      at: touch.at,
      file: touch.file,
      runId: touch.runId,
      taskId: touch.taskId,
      sessionId: touch.sessionId,
      observations: touch.observations,
    }));
  console.log(
    JSON.stringify(
      {
        schemaVersion: store.schemaVersion,
        run: { id: run.id, type: run.type, status: run.run.status },
        touches: runTouches,
        crossRunTouches,
      },
      null,
      2,
    ),
  );
}

export function workConflictResolve() {
  ensureProject();
  const run = resolveRun(required("--run"));
  const conflictId = required("--conflict");
  const index = touchIndexFromId(conflictId);
  if (index === null) fail(`无法识别的触碰 id：${conflictId}（应为 touch-<序号>）`);
  const summary = required("--summary");
  const by = valueFor("--by") ?? null;
  // 确认写入与 recordFileTouch 共用同一把全局台账锁，读改写不会与并发触碰交错。
  // 校验失败时先释放锁再 fail（fail 直接 process.exit，不会走 finally）。
  const lock = acquireLeaseLock(fileTouchLockFile());
  if (!lock) fail("触碰台账正在更新，请稍后重试确认触碰。");
  let confirmed = null;
  let problem = null;
  try {
    const file = fileTouchesFile();
    if (!fs.existsSync(file)) problem = "没有触碰台账记录，无法确认。";
    else {
      const store = readJson(file);
      const touch = Array.isArray(store?.touches) ? store.touches[index] : null;
      if (!touch) problem = `找不到触碰记录：${conflictId}`;
      else if (touch.confirmedAt)
        // 与旧的"文件冲突已处理，不能重复关闭"一致：确认是单向的。
        problem = "触碰已确认，不能重复确认。";
      else if (touch.runId !== run.id)
        // 无身份触碰（runId 为 null）无法归属，且 status 只暴露本运行触碰；确认必须落在本运行。
        problem = `触碰 ${conflictId} 不属于运行 ${run.id}，不能由本运行确认。`;
      else {
        // 触碰确认是给原条目追加确认记录，不删除、不改写历史触碰内容；
        // updatedAt 与 recordFileTouch 同步刷新，审计可见最后一次台账变更时间。
        touch.confirmedAt = now();
        touch.confirmedBy = by;
        touch.confirmation = summary;
        store.updatedAt = now();
        confirmed = {
          id: touchIdFor(index),
          file: touch.file,
          runId: touch.runId,
          taskId: touch.taskId,
        };
        writeJson(file, store);
      }
    }
  } finally {
    releaseFileLeaseLock(lock);
  }
  if (problem) fail(problem);
  console.log(`已确认触碰 ${confirmed.id}（${confirmed.file}）`);
}

export function workReplan() {
  const project = ensureProject();
  const run = resolveRun(required("--run"));
  const plan = ensureWorkPlan(run);
  const taskId = slug(required("--task"));
  const task = plan.tasks.find((item) => item.id === taskId);
  if (!task) fail(`未规划任务：${taskId}`);
  const execution = fs.existsSync(executionFile(run, taskId))
    ? readJson(executionFile(run, taskId))
    : null;
  if (
    execution &&
    terminal(execution.status) &&
    !executionIsResumableCheckpoint(task, execution)
  )
    fail(`任务 ${taskId} 已终态，不能重写其历史计划。`);
  const writes = csv("--writes");
  if (!writes.length) fail("--writes 至少声明一个新的写入范围");
  const targets = taskDeliveryTargetsFor(task);
  if (targets.length) {
    const roots = targets.map((target) => {
      const root = projectRootForDeliveryTarget(project, target.path);
      if (!root)
        fail(`任务 ${taskId} 绑定的交付项目已不在项目基线中：${target.path}`);
      return root;
    });
    const outOfProject = writes.filter(
      (write) => !roots.some((root) => scopeCovers(rootPath(root), write)),
    );
    if (outOfProject.length)
      fail(
        `重排后的写入范围必须仍属于绑定交付项目：${outOfProject.join("、")}`,
      );
  }
  // 重排可以把范围改成与其他运行相交，必须和 work plan 用同一预检，否则门禁可绕过。
  const overlappingRuns = crossRunOverlap(run, writes);
  const overlapReason = valueFor("--allow-overlap");
  if (overlappingRuns.length && !overlapReason)
    fail(overlapFailure(overlappingRuns));
  if (overlappingRuns.length) {
    plan.overlaps ??= [];
    plan.overlaps.push({
      at: now(),
      taskId,
      otherRunIds: overlappingRuns.map((entry) => entry.runId),
      scopes: [...new Set(overlappingRuns.flatMap((entry) => entry.scopes))],
      reason: overlapReason,
      via: "replan",
    });
  }
  // 运行内并发模型允许重排后仍与其他任务共享写入范围。
  const leases = readFileLeases(run);
  const outsideLeases = leases.leases.filter(
    (lease) =>
      lease.taskId === taskId &&
      !writes.some((scope) => taskCoversFile({ writes: [scope] }, lease.file)),
  );
  if (outsideLeases.length)
    fail(
      `重排会丢弃仍持有的文件租约：${outsideLeases.map((lease) => lease.file).join("、")}`,
    );
  const previousWrites = task.writes;
  task.writes = writes;
  plan.replans ??= [];
  plan.replans.push({
    at: now(),
    taskId,
    previousWrites,
    writes,
    reason: required("--reason"),
  });
  writeJson(workPlanFile(run), plan);
  rebuildExecutionIndex();
  console.log(`已重排 ${run.id}/${taskId} 的写入范围。`);
}

// 主任务状态派生门禁（M5-3）：任务终态写入后，若计划内全部任务都已终态
// （done/blocked/skipped），把派生结果同步进 run.json，消除"子任务全部完成、
// 主任务永远 in_progress"的父子状态漂移。被取代（skipped）的运行不可复活；
// 有任务未领取或未终态时不派生。幂等：与现状一致则不写盘。返回 "旧→新" 或 null。
export function syncRunStatusFromTasks(run, plan) {
  if (run.run?.status === "skipped") return null;
  const statuses = [];
  for (const task of plan.tasks ?? []) {
    const file = executionFile(run, task.id);
    if (!fs.existsSync(file)) return null;
    const execution = readJson(file);
    if (!terminal(execution.status)) return null;
    statuses.push(execution.status);
  }
  if (!statuses.length) return null;
  const next = statuses.some(status => status === "blocked") ? "blocked" : "done";
  if (next === run.run?.status) return null;
  const at = now();
  const previous = run.run?.status ?? "in_progress";
  run.run.notes ??= [];
  run.run.notes.push({ at, note: `主任务状态派生：${previous} → ${next}（全部子任务已终态）` });
  run.run.status = next;
  run.run.updatedAt = at;
  writeJson(path.join(run.dir, "run.json"), run.run);
  return `${previous}→${next}`;
}

// M1 kernel 双写：从旧 run/plan/execution 派生 kernel 记录并落 .mf-dev-flow/tasks/。
// 非法记录抛错（双写失败即缺陷，不静默）；历史运行由 M5 迁移脚本统一转换。
// 构建（不写盘）一个交付运行的内核记录：run 记录 + 各任务记录。
// 实时 kernelSync 与 M5 回填共用同一实现，保证历史运行与实时运行产出的记录同构。
export function buildKernelRecords(run, plan) {
  const meta = { id: run.id, title: run.run?.title ?? run.id, status: run.run?.status ?? "in_progress", createdAt: run.run?.createdAt ?? null, updatedAt: run.run?.updatedAt ?? null };
  const taskRecords = [];
  for (const task of plan.tasks) {
    const file = executionFile(run, task.id);
    if (!fs.existsSync(file)) continue;
    const execution = readJson(file);
    const typeRef = inferTaskTypeRef(task);
    const { taskRecord } = normalizeDeliveryRun({ run: meta, planTask: task, execution, typeRef });
    if (taskRecord) taskRecords.push(taskRecord);
  }
  const typeRef = taskRecords[0]?.typeRef ?? inferTaskTypeRef({ stageDefinitions: [] });
  const { runRecord } = normalizeDeliveryRun({ run: meta, planTask: null, execution: null, typeRef });
  runRecord.taskRefs = taskRecords.map(taskRecord => `task:${taskRecord.id}`);
  // 投影侧兜底：run.json 状态滞后（旧数据未修复）时，内核记录仍按子任务派生，
  // 保证父子两层永远自洽。未全部终态则保留 meta 映射的执行中状态。
  const derived = deriveRunStatus(taskRecords.map(taskRecord => taskRecord.status), { superseded: meta.status === "skipped" });
  if (derived) runRecord.status = derived;
  return { runRecord, taskRecords };
}

function kernelSync(run, plan, publication = null) {
  const { runRecord, taskRecords } = buildKernelRecords(run, plan);
  return publishKernelRecords({
    projectRoot: process.cwd(),
    runRecord,
    taskRecords,
    publication,
  });
}

// M5：把 kernel 落地之前已存在的 delivery 运行回填成内核记录（写 .mf-dev-flow/tasks/）。
// 数据源与实时 kernelSync 完全一致（run.json + work-plan.json + executions/*.json），
// 复用同一 buildKernelRecords，因此回填记录与实时记录同构；writeKernelRecords 内含
// schema 校验，非法记录会抛错而非落盘。--dry-run 只报告不落盘；--run 定向单个运行。
export function kernelBackfill() {
  const dryRun = process.argv.includes("--dry-run");
  const only = valueFor("--run");
  let runs = listRuns().filter(run => run.type === "delivery");
  if (only) {
    runs = runs.filter(run => run.id === only);
    if (!runs.length) fail(`找不到交付运行：${only}`);
  }
  const summaries = [];
  const problems = [];
  let statusRepairs = 0;
  for (const run of runs) {
    try {
      const plan = ensureWorkPlan(run);
      if (!dryRun) {
        const repaired = syncRunStatusFromTasks(run, plan);
        if (repaired) statusRepairs++;
      } else {
        const would = deriveRunStatus(
          (plan.tasks ?? []).map(task => {
            const file = executionFile(run, task.id);
            if (!fs.existsSync(file)) return "pending";
            const s = readJson(file).status;
            return s === "done" ? "completed" : s === "skipped" ? "abandoned" : s;
          }),
          { superseded: run.run?.status === "skipped" },
        );
        if (would && would !== run.run?.status) statusRepairs++;
      }
      const { runRecord, taskRecords } = buildKernelRecords(run, plan);
      if (!dryRun) writeKernelRecords({ projectRoot: process.cwd(), runRecord, taskRecords });
      summaries.push({ runId: run.id, typeRef: runRecord.typeRef, status: runRecord.status, taskRefs: runRecord.taskRefs, written: !dryRun });
    } catch (error) {
      problems.push(`${run.id}：${error?.message ?? error}`);
    }
  }
  console.log(JSON.stringify({ schemaVersion: 1, mode: dryRun ? "dry-run" : "write", count: summaries.length, statusRepairs, problems, runs: summaries }));
  if (problems.length) process.exitCode = 1;
}

export function workFinish() {
  ensureProject();
  const run = resolveRun(required("--run"));
  const plan = ensureWorkPlan(run);
  const taskId = slug(required("--task"));
  const task = plan.tasks.find((item) => item.id === taskId);
  if (!task) fail(`未规划任务：${taskId}`);
  const file = executionFile(run, taskId);
  if (!fs.existsSync(file)) fail(`任务未领取：${taskId}`);
  const execution = readJson(file);
  const agent = required("--agent");
  if (execution.agent !== agent)
    fail(`任务 ${taskId} 由 ${execution.agent} 领取，不能由 ${agent} 更新。`);
  const status = required("--status");
  if (status === "done") assertTaskPrototypeCurrent(run, task);
  if (!terminal(status)) fail("work finish 只能写 done、blocked 或 skipped");
  if (status === "done" && isContinuousDeliveryTask(task)) {
    const incomplete = taskStageDefinitions(task).filter(
      (stage) =>
        !DELIVERY_STAGE_CLOSED_STATUSES.has(
          execution.stages?.[stage.id]?.status,
        ),
    );
    if (incomplete.length)
      fail(
        `连续开发任务尚未完成阶段契约：${incomplete.map((stage) => stage.id).join("、")}`,
      );
  }
  const changedFiles = csv("--files");
  if (!valueFor("--files") || !valueFor("--tests"))
    fail("完成记录必须提供 --files 与 --tests（未运行请写原因）。");
  // 运行内并发共享文件：--files 是任务自报证据，不表示跨任务文件所有权。
  const outOfScope = changedFiles.filter(
    (filePath) => filePath !== "none" && !runCoversFile(plan, filePath),
  );
  // 文件登记默认不阻塞：超出运行范围也允许先完成，交给主 agent 通过审计提醒复核。
  execution.scopeWarnings = outOfScope;
  // 默认过程数据对账（M1 §5）：并发运行内不强制把会话观测归属到单个任务；
  // 未声明项只保留审计记录，最终内容由 work verify / 主 agent 判断。
  const hookObservations = readHookObservations({
    projectRoot: process.cwd(),
    sessionId: execution.sessionId ?? null,
    since: execution.claimedAt ?? null,
  });
  const declaredFiles = changedFiles.filter(item => item !== "none");
  if (hookObservations.health === "observed") {
    const missing = hookObservations.files.filter(
      item => !declaredFiles.includes(item),
    );
    const unobserved = declaredFiles.filter(item => !hookObservations.files.includes(item));
    execution.processData = missing.length
      ? { hookHealth: "observed", provenance: "declared", complete: false, undeclared: missing, explanation: valueFor("--explain-undeclared") }
      : unobserved.length
        ? { hookHealth: "observed", provenance: "declared", complete: false, unobserved }
        : { hookHealth: "observed", provenance: "reconciled", complete: true };
  } else if (hookObservations.health === "degraded") {
    execution.processData = { hookHealth: "degraded", provenance: "declared", complete: false };
  }
  // Git 是不依赖宿主 hook 与 agent 自报的记录源。并发运行内不把工作区全量改动
  // 强制归属到单个任务；未声明项保留审计，最终由 work verify / 主 agent 判断。
  const gitAudit = gitChangesSinceBaseline(process.cwd(), {
    baseCommit: execution.baseCommit,
    dirtyFiles: execution.baseDirtyFiles ?? [],
  });
  if (gitAudit.available) {
    const baselineFiles = new Set(gitAudit.baselineFiles);
    // --acceptance 是过程证据输入，不是任务交付物；外部 fixture 也不应触发 git 对账。
    const acceptanceArgument = valueFor("--acceptance");
    const ignoredGitFiles = new Set(acceptanceArgument ? [path.relative(process.cwd(), canonicalFilePath(acceptanceArgument)).replaceAll("\\", "/")] : []);
    const auditedGitFiles = gitAudit.files.filter(item => !ignoredGitFiles.has(item));
    // 基准是运行声明并集，不是单任务自报：同运行任务共享声明，不互相误报。
    const attributedByGit = auditedGitFiles.filter((item) =>
      runCoversFile(plan, item),
    );
    // Ruling 12（设计 §gitUndeclared 基准修正：跨运行的改动不再算进本运行）：
    // 被其他运行声明并集覆盖的改动属于那些运行——reconcile 在那边按其自身声明
    // 归因——因此不算本任务的 gitUndeclared。这里枚举全部其他 delivery 运行而
    // 不是 relatedRunsFor 的交集子集：声明不相交的并发运行（复现场景 A=src/theme、
    // B=src/review）根本不会出现在相交集合里，按交集过滤会把 A 的改动继续误报给 B。
    // 不过滤运行状态，与 reconcile 的口径一致。
    const otherRunPlans = listRuns()
      .filter((entry) => entry.type === "delivery" && entry.id !== run.id)
      .flatMap((entry) => {
        const otherPlanFile = workPlanFile(entry);
        return fs.existsSync(otherPlanFile) ? [readJson(otherPlanFile)] : [];
      });
    // 快速验证档位不能把同一运行内的其他任务改动误认成“本任务只改了一个页面”。
    // 已由其他运行声明的文件保持跨运行隔离；当前运行内的同行任务或完全未归属
    // 的改动则使当前任务回退 standard，直到具备可证明的任务级区间归因能力。
    const taskGitExtra = auditedGitFiles.filter(
      (item) =>
        !declaredFiles.includes(item) &&
        !otherRunPlans.some((otherPlan) => runCoversFile(otherPlan, item)),
    );
    const undeclaredByGit = auditedGitFiles.filter(
      (item) =>
        !runCoversFile(plan, item) &&
        !otherRunPlans.some((otherPlan) => runCoversFile(otherPlan, item)),
    );
    const unobservedByGit = declaredFiles.filter(
      item => !auditedGitFiles.includes(item) && !baselineFiles.has(item),
    );
    // claim 时已存在的脏文件，若既不再出现在基线对比里、内容又已不等于 claim
    // 时的快照，说明它被回退或丢弃（如共享工作树上的 git stash/checkout）。
    // 这类丢失不会出现在 diff 清单中，必须单独检测，否则静默蒸发。
    const revertedByGit = (execution.baseDirtyFiles ?? [])
      .filter((entry) => entry?.file && typeof entry.sha256 === "string")
      .filter((entry) => !auditedGitFiles.includes(entry.file))
      .filter(
        (entry) =>
          sha256File(path.resolve(process.cwd(), entry.file)) !== entry.sha256,
      )
      .map((entry) => entry.file)
      .sort();
    const finishGitFiles = gitFinishFiles(process.cwd(), execution, declaredFiles);
    const finishedTaskFiles = new Set(finishGitFiles.map(item => item.file));
    const taskGitUnobserved = declaredFiles.filter(item => !finishedTaskFiles.has(item));
    const { gitUndeclared: _staleUndeclared, gitUnobserved: _staleUnobserved, gitReverted: _staleReverted, gitFinishFiles: _staleFinishFiles, taskGitReconciled: _staleTaskGitReconciled, taskGitExtra: _staleTaskGitExtra, taskGitUnobserved: _staleTaskGitUnobserved, ...priorProcessData } =
      execution.processData ?? { hookHealth: "none", provenance: "declared", complete: false };
    execution.processData = {
      ...priorProcessData,
      gitBaseline: execution.baseCommit,
      gitReconciled: !undeclaredByGit.length && !unobservedByGit.length && !revertedByGit.length,
      taskGitReconciled: !taskGitExtra.length && !taskGitUnobserved.length && !revertedByGit.length,
      ...(attributedByGit.length ? { gitAttributed: attributedByGit } : {}),
      ...(undeclaredByGit.length ? { gitUndeclared: undeclaredByGit } : {}),
      ...(unobservedByGit.length ? { gitUnobserved: unobservedByGit } : {}),
      ...(taskGitExtra.length ? { taskGitExtra } : {}),
      ...(taskGitUnobserved.length ? { taskGitUnobserved } : {}),
      ...(revertedByGit.length ? { gitReverted: revertedByGit } : {}),
      ...(finishGitFiles.length ? { gitFinishFiles: finishGitFiles } : {}),
      ...(valueFor("--explain-undeclared") ? { explanation: valueFor("--explain-undeclared") } : {}),
    };
  }
  // 来源↔任务索引强制（M1）：feature-map 来源运行的任务终态必须关联叶子功能点，
  // 使 execution-index 的 features[] 与功能点→任务反查成立；非功能任务须显式说明。
  if (run.run?.deliveryInput?.source === "feature-map" && !taskLeafFeatureIds(run, task).length && !execution.noFeatureJustification) {
    const explicit = csv("--features").filter(item => item && item !== "none");
    const knownLeaves = new Set((currentFeatureMap()?.features ?? []).map(feature => feature.id));
    const resolved = explicit.length ? explicit : knownLeaves.has(task.id) ? [task.id] : [];
    if (resolved.length) {
      assertLeafFeatureIds(resolved);
      task.leafFeatureIds = resolved;
      writeJson(workPlanFile(run), plan);
    } else if (valueFor("--no-feature")) {
      execution.noFeatureJustification = valueFor("--no-feature");
    } else {
      fail(`任务 ${taskId} 尚未关联功能点；feature-map 来源运行的任务终态必须用 --features <ID列表>（或 feature link-task）关联，确属非功能任务用 --no-feature <理由> 说明。`);
    }
  }
  let acceptance = null;
  if (status === "done" && task.taskType?.criteria?.length) {
    const acceptanceFile = valueFor("--acceptance");
    if (!acceptanceFile || fs.statSync(acceptanceFile).size > 1048576) fail("本任务需要 --acceptance <JSON文件>（最多 1 MiB）；读取 delivery-brief 查看验收项。");
    acceptance = readJson(acceptanceFile);
    const problems = taskTypeProblems(task, acceptance, reference => readableRunEvidence(run.dir, reference));
    if (problems.length) fail(problems.join("\n"));
    execution.typeAcceptance = acceptance;
  }
  if (status === "done" && task.taskType) {
    const validationDecision = resolveValidationDecision({
      task,
      changedFiles,
      gitReconciled: execution.processData?.taskGitReconciled === true,
      acceptance,
    });
    const validationProblems = validationDecisionProblems(
      validationDecision,
      acceptance,
      reference => readableRunEvidence(run.dir, reference),
    );
    if (validationProblems.length) fail(validationProblems.join("\n"));
    execution.validationDecision = validationDecision;
  }
  execution.status = status;
  execution.updatedAt = now();
  execution.summary = required("--summary");
  execution.changedFiles = changedFiles;
  execution.tests = valueFor("--tests");
  closeExecutionAttempt(execution, {
    status,
    summary: execution.summary,
    at: execution.updatedAt,
  });
  if (valueFor("--note"))
    execution.notes.push({ at: execution.updatedAt, note: valueFor("--note") });
  writeJson(file, execution);
  recordTreeSnapshot(run, { taskId, kind: "finish" });
  const runDerived = syncRunStatusFromTasks(run, plan);
  appendFeatureHistory(run, task, "task_finished", {
    at: execution.updatedAt,
    taskStatus: status,
    summary: execution.summary,
    blocker: status === "blocked" ? execution.summary : null,
    decision: valueFor("--note"),
  });
  projectTaskStateToFeatureMap(run, task, { at: execution.updatedAt });
  releaseTaskLeases(run, taskId);
  rebuildExecutionIndex();
  syncDeliveryReports(run);
  kernelSync(run, plan, { reason: "finished", taskId });
  console.log(`已完成 ${run.id}/${taskId}：${status}`);
}

export function workCheckpointGate() {
  ensureProject();
  const sessionId = required("--session");
  const agent = required("--agent");
  const matches = [];
  for (const run of listRuns().filter((item) => item.type === "delivery")) {
    const plan = ensureWorkPlan(run);
    for (const task of plan.tasks) {
      if (!isContinuousDeliveryTask(task)) continue;
      const file = executionFile(run, task.id);
      if (!fs.existsSync(file)) continue;
      const execution = readJson(file);
      if (
        execution.status === "in_progress" &&
        execution.sessionId === sessionId &&
        execution.agent === agent
      )
        matches.push({ run, task, file, execution });
    }
  }
  if (!matches.length) {
    const completedMatches = [];
    for (const run of listRuns().filter((item) => item.type === "delivery")) {
      const plan = ensureWorkPlan(run);
      for (const task of plan.tasks) {
        if (!isContinuousDeliveryTask(task)) continue;
        const file = executionFile(run, task.id);
        if (!fs.existsSync(file)) continue;
        const execution = readJson(file);
        if (
          execution.sessionId === sessionId &&
          execution.agent === agent &&
          executionIsResumableCheckpoint(task, execution)
        )
          completedMatches.push({ run, task, execution });
      }
    }
    if (completedMatches.length === 1) {
      assertTaskPrototypeCurrent(completedMatches[0].run, completedMatches[0].task);
      return console.log(
        JSON.stringify({
          verdict: "pass",
          runId: completedMatches[0].run.id,
          taskId: completedMatches[0].task.id,
          targetPhase: completedMatches[0].execution.targetPhase,
          alreadyCompleted: true,
        }),
      );
    }
    return console.log(JSON.stringify({ verdict: "allow" }));
  }
  if (matches.length > 1) {
    const runIds = [...new Set(matches.map((match) => match.run.id))];
    if (runIds.length > 1)
      return console.log(
        JSON.stringify({
          verdict: "need_followup",
          reason:
            "同一 sub-agent 会话绑定了多个运行的任务；请先完成或明确其中一个运行。",
        }),
      );
    // 同运行并发任务共享会话观测，无法可靠区分中间检查点；
    // 放行到任务 finish 阶段校验各任务阶段契约，最终由主 agent 合并判断。
    return console.log(
      JSON.stringify({
        verdict: "pass",
        runId: runIds[0],
        sharedSessionConcurrency: true,
      }),
    );
  }
  const { run, task, file, execution } = matches[0];
  assertTaskPrototypeCurrent(run, task);
  if (!taskStageDefinitions(task).length)
    return console.log(JSON.stringify({ verdict: "need_followup", reason: `任务 ${task.id} 尚需执行 work finish --status done 后才能结束。` }));
  const stages = taskStageDefinitions(task);
  const targetPhase = execution.targetPhase || stages.at(-1)?.id;
  const targetIndex = stages.findIndex(
    (stage) => stage.id === targetPhase,
  );
  const missing = stages.slice(0, targetIndex + 1).filter(
    (stage) =>
      !DELIVERY_STAGE_CLOSED_STATUSES.has(execution.stages?.[stage.id]?.status),
  );
  if (missing.length)
    return console.log(
      JSON.stringify({
        verdict: "need_followup",
        reason: `任务 ${task.id} 尚未达到目标阶段 ${targetPhase}：${missing.map((stage) => stage.id).join("、")}`,
      }),
    );
  if (targetPhase === stages.at(-1)?.id)
    return console.log(
      JSON.stringify({
        verdict: "need_followup",
        reason: `任务 ${task.id} 已完成阶段契约，但仍需执行 work finish --status done 后才能结束。`,
      }),
    );
  execution.checkpoints ??= [];
  const latest = execution.checkpoints.at(-1);
  if (
    !latest ||
    latest.targetPhase !== targetPhase ||
    !["reached", "validated"].includes(latest.status)
  )
    return console.log(
      JSON.stringify({
        verdict: "need_followup",
        reason: `任务 ${task.id} 缺少 ${targetPhase} 的已达成检查点记录。`,
      }),
    );
  if (latest.validatedAt == null) {
    latest.validatedAt = now();
    latest.status = "validated";
    execution.updatedAt = latest.validatedAt;
    execution.notes ??= [];
    execution.notes.push({
      at: latest.validatedAt,
      note: `已在 ${targetPhase} 检查点停止，等待主 agent 验证后续做。`,
    });
    writeJson(file, execution);
  }
  const completedAt = latest.validatedAt;
  execution.schemaVersion = Math.max(Number(execution.schemaVersion) || 1, 2);
  execution.status = "done";
  execution.summary = `已完成至 ${targetPhase} 检查点；连续任务仍可从下一阶段续做。${latest.summary ? ` ${latest.summary}` : ""}`;
  execution.tests = `检查点 ${targetPhase} 已通过阶段门禁；详见阶段结论与归档证据。`;
  closeExecutionAttempt(execution, {
    status: "done",
    summary: execution.summary,
    at: completedAt,
  });
  execution.updatedAt = completedAt;
  execution.notes ??= [];
  execution.notes.push({
    at: completedAt,
    note: `本次执行已在 ${targetPhase} 检查点完成；同一连续任务待验证后可绑定续做。`,
  });
  writeJson(file, execution);
  appendFeatureHistory(run, task, "task_checkpoint_finished", {
    at: completedAt,
    taskStatus: "done",
    summary: execution.summary,
  });
  projectTaskStateToFeatureMap(run, task, { at: completedAt });
  releaseTaskLeases(run, task.id);
  rebuildExecutionIndex();
  syncDeliveryReports(run);
  console.log(
    JSON.stringify({
      verdict: "pass",
      runId: run.id,
      taskId: task.id,
      targetPhase,
    }),
  );
}

export function workSupersede() {
  ensureProject();
  const run = resolveRun(required("--run"));
  const plan = ensureWorkPlan(run);
  const taskId = slug(required("--task"));
  const task = plan.tasks.find((item) => item.id === taskId);
  if (!task) fail(`未规划任务：${taskId}`);
  const file = executionFile(run, taskId);
  if (!fs.existsSync(file)) fail(`任务未领取：${taskId}`);
  const execution = readJson(file);
  if (!terminal(execution.status)) fail(`任务 ${taskId} 尚未终态，不能取代。`);
  const supersededAt = now();
  const reason = required("--reason");
  execution.supersessions ??= [];
  execution.supersessions.push({
    at: supersededAt,
    previousStatus: execution.status,
    previousSummary: execution.summary,
    previousChangedFiles: execution.changedFiles,
    previousTests: execution.tests,
    reason,
  });
  execution.status = "skipped";
  execution.updatedAt = supersededAt;
  execution.summary = `已由逐功能任务方案取代：${reason}`;
  execution.notes ??= [];
  execution.notes.push({
    at: supersededAt,
    note: "原任务结论已保留在 supersessions 审计记录。",
  });
  writeJson(file, execution);
  appendFeatureHistory(run, task, "task_superseded", {
    at: supersededAt,
    taskStatus: "skipped",
    summary: execution.summary,
    decision: reason,
  });
  rebuildExecutionIndex();
  syncDeliveryReports(run);
  console.log(`已取代并跳过 ${run.id}/${taskId}`);
}

export function workMergeCheck() {
  ensureProject();
  const run = resolveRun(required("--run"));
  const problems = mergeProblems(run);
  const reminders = mergeAuditReminders(run);
  rebuildExecutionIndex();
  if (problems.length) fail(`不能合并：\n- ${problems.join("\n- ")}`);
  console.log(
    `通过：${run.id} 的任务边界、依赖和执行记录可进入总 agent 合并验证。`,
  );
  if (reminders.length) {
    console.log("审计提醒（不阻塞合并，请主 agent 复核）：");
    for (const reminder of reminders) console.log(`- ${reminder}`);
  } else {
    console.log("审计提醒：无。");
  }
  const reconcile = reconcileRun(run);
  const reconciliation = reconciliationResolutionState(run, reconcile);
  console.log(
    `对账：认领 ${reconcile.attributed.length} / 推断 ${reconcile.inferred.length} / 未认领 ${reconcile.unattributed.length}`,
  );
  if (reconciliation.unresolved.length) {
    console.log("未裁决的对账异常（请运行 work reconcile 查看修复提示词）：");
    for (const item of reconciliation.unresolved.filter((item) => item.kind === "unattributed"))
      console.log(`- 未认领改动：${item.file}`);
    for (const item of reconciliation.unresolved.filter((item) => item.kind === "shared"))
      console.log(`- 跨运行共享：${item.file}（${item.runIds.join("、")}）`);
  }
}

export function workVerify() {
  ensureProject();
  const run = resolveRun(required("--run"));
  const status = required("--status");
  if (!new Set(["passed", "failed", "blocked"]).has(status))
    fail("--status 只能是 passed、failed 或 blocked");
  const reconcile = reconcileRun(run);
  const reconciliation = reconciliationResolutionState(run, reconcile);
  if (status === "passed") {
    const problems = mergeProblems(run);
    if (run.type === "delivery") {
      problems.push(...deliveryStageClosureProblems(run));
      problems.push(...deliveryReportProblems(run));
      problems.push(...unresolvedReconciliationProblems(run, reconciliation.unresolved));
    }
    if (problems.length) fail(`不能标记验证通过：\n- ${problems.join("\n- ")}`);
  }
  const auditWarnings = mergeAuditReminders(run);
  if (auditWarnings.length) {
    console.log("审计提醒（不阻塞验证，请主 agent 确认已复核）：");
    for (const warning of auditWarnings) console.log(`- ${warning}`);
  }
  console.log(
    `对账：认领 ${reconcile.attributed.length} / 推断 ${reconcile.inferred.length} / 未认领 ${reconcile.unattributed.length}`,
  );
  if (reconciliation.unresolved.length) {
    console.log("未裁决的对账异常（请运行 work reconcile 查看修复提示词）：");
    for (const item of reconciliation.unresolved.filter((item) => item.kind === "unattributed"))
      console.log(`- 未认领改动：${item.file}`);
    for (const item of reconciliation.unresolved.filter((item) => item.kind === "shared"))
      console.log(`- 跨运行共享：${item.file}（${item.runIds.join("、")}）`);
  }
  writeJson(path.join(run.dir, "integration.json"), {
    schemaVersion: 1,
    runId: run.id,
    status,
    commands: required("--commands"),
    summary: required("--summary"),
    verifiedAt: now(),
    auditWarnings,
    reconciliation: {
      unresolved: reconciliation.unresolved,
      resolved: reconciliation.resolved,
    },
  });
  if (run.type === "delivery") {
    const plan = ensureWorkPlan(run);
    const verifiedAt = now();
    for (const task of plan.tasks) {
      const execution = fs.existsSync(executionFile(run, task.id))
        ? readJson(executionFile(run, task.id))
        : null;
      appendFeatureHistory(run, task, "verification_updated", {
        at: verifiedAt,
        taskStatus: execution?.status ?? "pending",
        summary: required("--summary"),
        blocker: status === "blocked" ? required("--summary") : null,
        verification: { status, commands: required("--commands") },
      });
    }
  }
  rebuildExecutionIndex();
  syncDeliveryReports(run);
  console.log(`已记录 ${run.id} 的合并验证：${status}`);
}

export function repairPromptsFor(result, run) {
  const prompts = [];
  for (const item of result.unattributed) {
    prompts.push(
      [
        `文件 ${item.file} 有改动但不在任何运行声明内。`,
        `请执行 fix-forward 重建：先运行 \`run context --id ${run.id}\` 读取各任务 summary 与 attempts 时间窗，`,
        `再读 \`delivery-runs/${run.id}/implementation.md\`，用当前 diff 判断该文件应有的内容并修正。`,
        `不要从 git 还原字节（该版本未被捕获）。`,
      ].join(""),
    );
  }
  for (const item of result.shared) {
    prompts.push(
      `文件 ${item.file} 落在多个运行声明内（${item.runIds.join("、")}）：请确认是否需 --allow-overlap，或人工判断归属后 fix-forward。`,
    );
  }
  for (const item of result.inferred) {
    prompts.push(
      `文件 ${item.file} 无声明但区间证据指向 ${item.runId}/${item.taskId}（basis: snapshot-interval）：请核实该任务是否越界写入并按需 fix-forward。`,
    );
  }
  return prompts;
}

export function workReconcile() {
  ensureProject();
  const run = resolveRun(required("--run"));
  if (process.argv.includes("--resolve"))
    return resolveReconciliationFinding(run, required("--resolve"));
  if (["--file", "--summary", "--by"].some((flag) => process.argv.includes(flag)))
    fail("--file、--summary、--by 只能与 --resolve 一起使用。");
  const result = reconcileRun(run);
  const reconciliation = reconciliationResolutionState(run, result);
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        run: { id: run.id, type: run.type, status: run.run.status },
        ...result,
        resolutions: reconciliation.resolutions,
        unresolved: reconciliation.unresolved,
        repairPrompts: repairPromptsFor(
          repairResultForUnresolved(result, reconciliation),
          run,
        ),
      },
      null,
      2,
    ),
  );
}

export function workIndex() {
  ensureProject();
  const runs = rebuildExecutionIndex();
  console.log(`已更新 ${executionIndexFile()}（${runs.length} 个运行）`);
}
