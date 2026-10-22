// Flow module extracted from the existing runtime; shared gates retain one implementation.

import path from "node:path";
import { PRIVATE_STORE_DIRECTORY, SKILL_ID, STORE_DIRECTORY } from "../skill-identity.mjs";
import { taskTypeProblems, readableRunEvidence } from "../delivery/types.mjs";
import {
  loadDeliveryProcess,
  parseDeliveryProcessSpecifier,
} from "../delivery/processes.mjs";

import fs from "node:fs";

import {
  ADDITIONAL_SCREENSHOT_EVIDENCE,
  DELIVERY_CONTRACT,
  GENERIC_DELIVERY_CONTRACT,
  MINIAPP_DELIVERY_CONTRACT,
  isGenericDelivery,
  taskStageDefinitions,
  DELIVERY_FINAL_STAGE,
  DELIVERY_STAGE_CLOSED_STATUSES,
  DELIVERY_STAGE_STATUSES,
  DELIVERY_STAGES,
  DELIVERY_TASK_PHASE,
  VISUAL_VALIDATION_EVIDENCE,
  additionalScreenshotInstruction,
  deliveryStageById,
  renderDeliveryBrief,
  stageSummaryProblems,
  stagedDeliveryStages,
  visualValidationInstruction,
} from "../../dashboard/server/delivery-contract.js";
import { freezeFeatureAcceptanceCases } from "./acceptance-cases.mjs";

import crypto from "node:crypto";

import { spawn, spawnSync } from "node:child_process";

import { hasPrototypeCatalog, planningPrototype, prototypeArchiveDirectory, prototypeArchiveExists } from "../prototype/client.mjs";

import { readPrototypeRevision, prototypeImpact, impactHash, impactReviewProblems, prototypeDevelopmentProblems } from "../../dashboard/server/prototype-impact.js";

import {
  prototypeEvidenceDocument,
  prototypeEvidenceFeature,
} from "../../dashboard/server/prototype-evidence.js";

import { createPrototypeMap, prototypeMapProblems } from "../../dashboard/server/prototype-map-audit.js";

export const RUN_TYPES = new Set(["prototype", "delivery", "system", "refinement"]);

export const FEATURE_HISTORY_SCHEMA_VERSION = 1;

export const TASK_LEAF_LINKS_SCHEMA_VERSION = 1;

// Task leaf-link scopes. governance tasks may carry relatedFeatureIds only;
// technical tasks use the same delivery-target path as product but skip
// --projects required checks because technical收口 rarely binds ui-client.
export const TASK_LEAF_SCOPES = new Set(["product", "technical", "governance"]);

// Delivery-input sources whose unresolved feature references are reminders
// rather than merge-blocking problems. feature-map sources retain the
// strict check because they represent explicit delivery commitments.
export const FEATURE_BINDING_SOFT_SOURCES = new Set(["manual", "prototype"]);

export const DELIVERY_TARGET_ROLES = new Set(["ui-client", "api-provider"]);

export const UI_DELIVERY_ROLE = "ui-client";

export const LEGACY_STAGE_FALLBACKS = {
  prototype_alignment: ["prototype_alignment", "prototype_mock_reproduction"],
  api_mock: ["api_field_alignment", "prototype_mock_reproduction"],
  technical_implementation: ["implementation", "technical_solution"],
  end_to_end_acceptance: ["prototype_regression"],
};

export const TASK_PHASE_ALIASES = {
  analysis: "prototype_alignment",
  mock: "api_mock",
  implementation: "technical_implementation",
  regression: "end_to_end_acceptance",
};

export const COMPACTION_SCHEMA_VERSION = 1;

export const ACTIVE_DELIVERY_STATUSES = new Set(["pending", "in_progress"]);

export const FILE_LEASE_SCHEMA_VERSION = 1;

export const STORE = path.join(process.cwd(), STORE_DIRECTORY);

export const now = () => new Date().toISOString();

export const projectFile = () => path.join(STORE, "project.json");

export const currentFile = () => path.join(STORE, "current.json");

export const executionIndexFile = () => path.join(STORE, "execution-index.json");

export const runDir = (type, id) => path.join(STORE, `${type}-runs`, id);

export const prototypeDir = () => path.join(STORE, "prototype");

export const systemDir = () => path.join(STORE, "system");

export const systemCardsFile = () => path.join(systemDir(), "cards.json");

export const projectCardsDir = () => path.join(STORE, "projects");

export const projectCardFile = (id) => path.join(projectCardsDir(), `${id}.json`);

export const planningDir = () => path.join(STORE, "planning");

export const featureMapFile = () => path.join(planningDir(), "feature-map.json");

export const featureHistoryFile = () =>
  path.join(planningDir(), "feature-history.json");

export const taskLeafLinksFile = () =>
  path.join(planningDir(), "task-leaf-links.json");

export const compactionDir = () => path.join(STORE, "compaction");

export const compactionIndexFile = () => path.join(compactionDir(), "index.json");

export const planningContextBriefFile = () =>
  path.join(planningDir(), "context-brief.md");

export const evidenceDir = () => path.join(STORE, "evidence");

export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export function fail(message) {
  console.error(`${SKILL_ID}: ${message}`);
  process.exit(1);
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeIfMissing(file, text) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function writeEvidenceBundle(kind, value) {
  const fingerprint = sha256(JSON.stringify(value));
  const file = path.join(evidenceDir(), kind, `${fingerprint}.json`);
  if (!fs.existsSync(file))
    writeJson(file, {
      schemaVersion: 1,
      kind,
      fingerprint,
      value,
    });
  return {
    ref: path.relative(STORE, file),
    fingerprint,
    bytes: bytes(value),
  };
}

export function valueFor(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

// Repeatable flags (e.g. several --risk entries in one delivery stage call).
export function flagValues(name) {
  const argv = process.argv;
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) continue;
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) values.push(value);
  }
  return values;
}

export function required(name) {
  const value = valueFor(name);
  if (!value || value.startsWith("--")) fail(`缺少 ${name}`);
  return value;
}

export function slug(value) {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "run"
  );
}

export function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-");
}

export function ensureProject() {
  if (!fs.existsSync(projectFile())) {
    fail(`尚未初始化；先运行 init，在 ${STORE_DIRECTORY}/ 保存项目与原型基线。`);
  }
  return readJson(projectFile());
}

export function csv(name) {
  const value = valueFor(name);
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function deliveryRoles(root) {
  return [
    ...new Set(
      (root?.deliveryRoles ?? []).filter((role) =>
        DELIVERY_TARGET_ROLES.has(role),
      ),
    ),
  ];
}

export function taskDeliveryTargetsFor(task) {
  return task.deliveryTargets?.length
    ? task.deliveryTargets
    : task.deliveryTarget
      ? [task.deliveryTarget]
      : [];
}

export function taskHasDeliveryRole(task, role) {
  return taskDeliveryTargetsFor(task).some((target) =>
    target.deliveryRoles?.includes(role),
  );
}

export function isContinuousDeliveryTask(task) {
  return task.scope === "product" && task.phase === DELIVERY_TASK_PHASE;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function fileEvidence(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return {
    path: path.relative(process.cwd(), file),
    sha256: sha256(fs.readFileSync(file)),
    updatedAt: fs.statSync(file).mtime.toISOString(),
  };
}

export function discoverProjectDocumentEvidence(root = process.cwd()) {
  const markdownPattern = /\.mdx?$/i;
  const documentDirectoryPattern = /^(?:docs?|documentation)$/i;
  const ignoredDirectories = new Set([
    ".git",
    STORE_DIRECTORY,
    ".next",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "images",
    "assets",
    "archive",
    "archives",
    "history",
    "legacy",
    "update",
    "updates",
  ]);
  const candidates = new Set();
  const addMarkdownFiles = (directory, depth = 0) => {
    if (!fs.existsSync(directory) || depth > 8) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name.toLowerCase()))
          addMarkdownFiles(target, depth + 1);
      } else if (entry.isFile() && markdownPattern.test(entry.name)) {
        candidates.add(target);
      }
    }
  };

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && markdownPattern.test(entry.name)) {
      candidates.add(path.join(root, entry.name));
    } else if (
      entry.isDirectory() &&
      documentDirectoryPattern.test(entry.name)
    ) {
      addMarkdownFiles(path.join(root, entry.name));
    }
  }

  return [...candidates]
    .sort((left, right) => left.localeCompare(right))
    .map((file) => fileEvidence(file))
    .filter(Boolean);
}

export function projectCardId(root) {
  return slug(path.basename(path.resolve(process.cwd(), root.path)));
}

export function gitValue(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  // Preserve the leading status column from `git status --short`. Trimming the
  // left side shifts porcelain paths by one character and can make `.mf-dev-flow/`
  // look like `mf-dev-flow/`, defeating the evidence ignore rule below.
  return result.status === 0 ? result.stdout.trimEnd() : null;
}

// Git object IDs compare exact bytes without reading a committed blob into JS.
// `null` means the file does not exist at that point (or Git is unavailable).
export function gitWorktreeBlob(root, file) {
  const absolute = path.resolve(root, file);
  try {
    if (!fs.statSync(absolute).isFile()) return null;
  } catch {
    return null;
  }
  return gitValue(root, ["hash-object", "--", file]);
}

export function gitCommitBlob(root, commit, file) {
  if (!commit || !file) return null;
  return gitValue(root, ["rev-parse", "--verify", `${commit}:${file}`]);
}

export function codeRootEvidence(root) {
  const location = path.resolve(process.cwd(), root.path);
  if (!fs.existsSync(location)) {
    return {
      path: root.path,
      role: root.role,
      status: "unavailable",
      reason: "目录不存在",
    };
  }
  const head = gitValue(location, ["rev-parse", "HEAD"]);
  const branch = gitValue(location, ["branch", "--show-current"]);
  const status = gitValue(location, [
    "-c",
    "core.quotePath=false",
    "status",
    "--short",
    "--untracked-files=all",
  ]);
  // mf-dev-flow records and its local workflow implementation are process metadata,
  // not product evidence. Changing the tool must not invalidate an otherwise
  // evidence-complete feature-map proposal.
  const ignoredPrefixes = [
    `${STORE_DIRECTORY}/`,
    `${PRIVATE_STORE_DIRECTORY}/`,
    `.codex/skills/${SKILL_ID}/`,
    `.agents/skills/${SKILL_ID}/`,
  ];
  const changedPaths = status
    ? status
        .split("\n")
        .filter(Boolean)
        .map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }))
        .filter(
          (entry) =>
            !ignoredPrefixes.some((prefix) => entry.path.startsWith(prefix)),
        )
        .map((entry) => {
          const currentPath = entry.path.includes(" -> ")
            ? entry.path.split(" -> ").at(-1)
            : entry.path;
          const file = path.join(location, currentPath);
          if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return entry;
          const size = fs.statSync(file).size;
          return {
            ...entry,
            size,
            contentSha256:
              size <= 10 * 1024 * 1024 ? sha256(fs.readFileSync(file)) : null,
          };
        })
    : [];
  const fingerprint = sha256(JSON.stringify({ head, branch, changedPaths }));
  const changes = writeEvidenceBundle("code-roots", {
    path: root.path,
    role: root.role,
    writeBoundary: root.writeBoundary,
    head,
    branch: branch || null,
    changedPaths,
  });
  return {
    path: root.path,
    role: root.role,
    writeBoundary: root.writeBoundary,
    status: head ? "observed" : "not_git",
    head,
    branch: branch || null,
    changedPathCount: changedPaths.length,
    changedPathSample: changedPaths.slice(0, 12).map((entry) => ({
      status: entry.status,
      path: entry.path,
    })),
    evidenceRef: changes.ref,
    changesFingerprint: changes.fingerprint,
    fingerprint,
  };
}

export function systemCardContextSummary(card) {
  if (
    Object.hasOwn(card, "openIssueCount") &&
    !Object.hasOwn(card, "technicalIssues")
  )
    return card;
  const openIssues = (card.technicalIssues ?? []).filter(
    (issue) =>
      !["resolved", "closed", "done"].includes(
        String(issue.status).toLowerCase(),
      ),
  );
  return {
    id: card.id,
    title: card.title,
    status: card.status,
    lastVerifiedAt: card.lastVerifiedAt,
    apiUsageCount: (card.apiUsages ?? []).length,
    openIssueCount: openIssues.length,
    openIssues: openIssues.slice(0, 3).map((issue) => ({
      id: issue.id,
      title: compactText(issue.title, 120),
      severity: issue.severity ?? null,
      status: issue.status ?? null,
      summary: compactText(issue.summary, 160) || null,
    })),
    openQuestionCount: (card.openQuestions ?? []).length,
  };
}

export function featureEvidenceContext() {
  const project = ensureProject();
  const nativePrototype = hasPrototypeCatalog(process.cwd()) ? planningPrototype(process.cwd()) : null;
  const prototypeTask = nativePrototype?.task ?? readJson(path.join(prototypeDir(), "task.json"));
  const prototypeIndex = nativePrototype ? { features: nativePrototype.features } : readJson(path.join(prototypeDir(), "feature-index.json"));
  const prototypeCoverage = nativePrototype ? { sourceInventory: { entries: nativePrototype.sourceEntries }, coverage: nativePrototype.coverage } : readJson(path.join(prototypeDir(), "coverage.json"));
  const systemCards = fs.existsSync(systemCardsFile())
    ? readJson(systemCardsFile())
    : { cards: [], updatedAt: null };
  const runs = fs.existsSync(executionIndexFile())
    ? (readJson(executionIndexFile()).runs ?? [])
    : [];
  const deliveryTasks = runs
    .filter((run) => run.type === "delivery")
    .flatMap((run) =>
      (run.tasks ?? []).map((task) => ({
        runId: run.id,
        runTitle: run.title,
        ...task,
      })),
    );
  const activeTasks = deliveryTasks.filter(
    (task) => !terminal(task.status) || task.continuationOpen,
  );
  const completedTasks = deliveryTasks
    .filter((task) => terminal(task.status) && !task.continuationOpen)
    .sort((left, right) =>
      String(right.updatedAt).localeCompare(String(left.updatedAt)),
    );
  const taskSummary = (task) => ({
    runId: task.runId,
    runTitle: task.runTitle,
    id: task.id,
    title: task.title,
    status: task.status,
    continuationOpen: Boolean(task.continuationOpen),
    updatedAt: task.updatedAt ?? null,
    summary: compactText(task.summary, 160) || null,
    // Newer work plans store the single leaf relationship as leafFeatureIds.
    // Keep the legacy features fallback so historical runs remain readable.
    features: task.leafFeatureIds ?? task.features ?? [],
  });
  const developmentEvidence = writeEvidenceBundle("development", {
    tasks: deliveryTasks,
  });
  const systemEvidence = writeEvidenceBundle("systems", {
    updatedAt: systemCards.updatedAt ?? null,
    cards: systemCards.cards ?? [],
  });
  const codeRoots = (project.codeRoots ?? []).map(codeRootEvidence);
  const documents = discoverProjectDocumentEvidence();
  const sourceEntries = prototypeCoverage.sourceInventory?.entries ?? [];
  const context = {
    schemaVersion: 1,
    capturedAt: now(),
    prototype: {
      revision: nativePrototype?.revision ?? readPrototypeRevision(STORE),
      requirements: nativePrototype?.requirements ?? [],
      questions: nativePrototype?.questions ?? [],
      task: {
        id: prototypeTask.id,
        status: prototypeTask.status,
        source: prototypeTask.source,
        updatedAt: prototypeTask.updatedAt,
      },
      features: (prototypeIndex.features ?? []).map(prototypeEvidenceFeature),
      sourceEntries,
      coverage: prototypeCoverage.coverage ?? [],
    },
    development: {
      evidenceRef: developmentEvidence.ref,
      evidenceFingerprint: developmentEvidence.fingerprint,
      activeTasks: activeTasks.slice(0, 20).map(taskSummary),
      recentCompletedTasks: completedTasks.slice(0, 12).map(taskSummary),
      totalTaskCount: deliveryTasks.length,
      activeTaskCount: activeTasks.length,
      completedTaskCount: completedTasks.length,
    },
    systems: {
      updatedAt: systemCards.updatedAt ?? null,
      evidenceRef: systemEvidence.ref,
      evidenceFingerprint: systemEvidence.fingerprint,
      cards: (systemCards.cards ?? []).map(systemCardContextSummary),
    },
    codeRoots,
    documents,
  };
  const fingerprintInput = {
    prototype: nativePrototype ? { fingerprint: context.prototype.revision.fingerprint } : context.prototype,
    development: context.development.evidenceFingerprint,
    systems: context.systems.evidenceFingerprint,
    codeRoots,
    documents,
  };
  return {
    ...context,
    evidenceCursor: sha256(JSON.stringify(fingerprintInput)),
  };
}

export function bytes(value) {
  return Buffer.byteLength(
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

export function tokenEstimate(byteCount) {
  // This is deliberately an estimate, not a tokenizer claim. JSON keys, Chinese
  // text and source paths tokenize differently, so use it for trend decisions.
  return Math.ceil(byteCount / 3.2);
}

export function refinementBriefFile(run) {
  return path.join(run.dir, "brief.md");
}

export function refinementDeltaFile(run) {
  return path.join(run.dir, "delta.json");
}

export function compactText(value, max = 160) {
  const text = String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function refinementRuns() {
  return listRuns()
    .filter(
      (run) =>
        run.type === "refinement" &&
        fs.existsSync(path.join(run.dir, "context.json")),
    )
    .sort((left, right) =>
      String(left.run.createdAt ?? left.id).localeCompare(
        String(right.run.createdAt ?? right.id),
      ),
    );
}

export function contextSectionManifest(context) {
  return Object.fromEntries(
    ["prototype", "development", "systems", "codeRoots", "documents"].map(
      (name) => {
        const value = context[name];
        return [
          name,
          { bytes: bytes(value), sha256: sha256(JSON.stringify(value)) },
        ];
      },
    ),
  );
}

export function refinementBriefMarkdown(run, context, options = {}) {
  const activeTasks = context.development?.activeTasks ?? [];
  const recentCompleted = context.development?.recentCompletedTasks ?? [];
  const features = context.prototype?.features ?? [];
  const cards = context.systems?.cards ?? [];
  const openIssues = cards.flatMap((card) =>
    (card.openIssues ?? []).map(
      (issue) =>
        `- \`${card.id}\` · ${compactText(issue.title || issue.id)}：${compactText(issue.summary, 120)}`,
    ),
  );
  const openIssueCount = cards.reduce(
    (count, card) => count + (card.openIssueCount ?? 0),
    0,
  );
  const roots = context.codeRoots ?? [];
  const changedPathCount = roots.reduce(
    (count, root) =>
      count + (root.changedPathCount ?? root.changedPaths?.length ?? 0),
    0,
  );
  const topChangedPaths = roots
    .flatMap((root) =>
      (root.changedPathSample ?? root.changedPaths ?? []).map(
        (entry) => `${root.path}/${entry.path}`,
      ),
    )
    .slice(0, 12);
  const manifest = contextSectionManifest(context);
  return [
    `# ${run.run.title} · 上下文摘要`,
    "",
    "> 默认只读本摘要。需要核验具体证据时使用 `run context` 按分区、分组和页读取；不要直接打开 `context.json`、`prototype-impact.json`、`previous-map.json`、`proposal.json` 或完整原型报告。",
    "",
    "## 运行与证据",
    "",
    `- 运行：\`${run.id}\` · 状态：${run.run.status} · 冻结时间：${context.capturedAt ?? "—"}`,
    `- 证据游标：\`${context.evidenceCursor}\``,
    `- 原始快照：${bytes(context)} bytes（约 ${tokenEstimate(bytes(context))} tokens）`,
    "- 原型变更复评：用 `run context --detail planning --collection impact` 读取影响清单，再按 `--group <业务域ID>` 分页对照旧/新功能；每个受影响叶子功能必须在 `proposal.impactReviews` 留下结论。",
    options.previousRunId
      ? `- 相对上次快照：仅 ${options.changedSections.join("、") || "无"} 分区发生变化；上次运行：\`${options.previousRunId}\``
      : "- 相对上次快照：这是首份可比较快照。",
    "",
    "## 原型与当前功能",
    "",
    `- 原型：${context.prototype?.task?.status ?? "—"}；功能块 ${features.length} 个；入口 ${(context.prototype?.sourceEntries ?? []).length} 个。`,
    ...features
      .slice(0, 16)
      .map(
        (feature) =>
          `- \`${feature.id}\` · ${compactText(feature.title)} · 原型：${feature.prototypeStatus ?? "—"} · 覆盖：${feature.coverage?.covered ?? 0}/${feature.coverage?.total ?? feature.sourceEntries?.length ?? 0}`,
      ),
    features.length > 16
      ? `- 其余 ${features.length - 16} 个功能块通过 \`run context --detail prototype\` 分页读取。`
      : "",
    "- 原型证据按组读取：`run context --id <本运行ID> --detail prototype --group <原型分组ID> --collection features|entries|coverage`。",
    "- 旧/新规划先列业务域：`run context --id <本运行ID> --detail planning --collection groups`，再用 `--group <业务域ID>` 逐组读取。",
    "- 每组结论用 `feature proposal-patch --run <本运行ID> --from <本组patch.json>` 增量合并；不要整读或整写 `proposal.json`。",
    "",
    "## 开发与阻塞",
    "",
    `- 开发任务：共 ${context.development?.totalTaskCount ?? 0} 个；未结束 ${context.development?.activeTaskCount ?? activeTasks.length} 个；摘要中显示 ${activeTasks.length} 个进行中、${recentCompleted.length} 个最近终态记录。`,
    ...(activeTasks.length
      ? activeTasks
          .slice(0, 12)
          .map(
            (task) =>
              `- \`${task.runId}/${task.id}\` · ${compactText(task.title)} · ${task.status} · ${compactText(task.summary, 120) || "无摘要"}`,
          )
      : ["- 当前无未结束开发任务。"]),
    "",
    "## 系统与代码变更",
    "",
    `- 系统卡片 ${cards.length} 张；未解决技术问题 ${openIssueCount} 个（摘要最多列 ${openIssues.length} 个）。`,
    ...(openIssues.slice(0, 6).length
      ? openIssues.slice(0, 6)
      : ["- 当前未记录未解决技术问题。"]),
    openIssues.length > 6
      ? `- 其余 ${openIssues.length - 6} 项用 \`run context --detail systems --card <ID>\` 按需读取。`
      : "",
    `- 代码根 ${roots.length} 个；变更路径 ${changedPathCount} 条（摘要只列前 ${topChangedPaths.length} 条）。`,
    ...topChangedPaths.map((file) => `- \`${file}\``),
    changedPathCount > topChangedPaths.length
      ? `- 其余 ${changedPathCount - topChangedPaths.length} 条用 \`run context --detail code-roots --root <路径> --changes\` 分页读取。`
      : "",
    "",
    "## 按需读取清单",
    "",
    "- 默认每页 5 条、最多 12000 bytes；只有单条记录确有需要时才提高 `--max-bytes`。",
    ...Object.entries(manifest).map(
      ([name, value]) =>
        `- \`${name}\`：${value.bytes} bytes · sha256 \`${value.sha256}\``,
    ),
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function writeRefinementCompactionArtifacts(run, context, previousRun = null) {
  const currentSections = contextSectionManifest(context);
  const previousContext = previousRun
    ? readJson(path.join(previousRun.dir, "context.json"))
    : null;
  const previousSections = previousContext
    ? contextSectionManifest(previousContext)
    : {};
  const changedSections = Object.entries(currentSections)
    .filter(([name, value]) => previousSections[name]?.sha256 !== value.sha256)
    .map(([name]) => name);
  writeJson(refinementDeltaFile(run), {
    schemaVersion: COMPACTION_SCHEMA_VERSION,
    runId: run.id,
    previousRunId: previousRun?.id ?? null,
    generatedAt: now(),
    changedSections,
    sections: currentSections,
  });
  fs.writeFileSync(
    refinementBriefFile(run),
    refinementBriefMarkdown(run, context, {
      previousRunId: previousRun?.id,
      changedSections,
    }),
  );
  return { currentSections, changedSections };
}

export function compactionAudit() {
  ensureProject();
  const runs = refinementRuns();
  const snapshots = runs.map((run) => {
    const file = path.join(run.dir, "context.json");
    const size = fs.statSync(file).size;
    return { run, bytes: size, tokens: tokenEstimate(size) };
  });
  const totalBytes = snapshots.reduce((sum, item) => sum + item.bytes, 0);
  const currentMap = fs.existsSync(featureMapFile())
    ? readJson(featureMapFile())
    : null;
  const sourceRun = currentMap?.sourceRun ?? null;
  const superseded = snapshots.filter(
    (item) => item.run.id !== sourceRun && item.run.run.status === "done",
  );
  return { runs: snapshots, totalBytes, sourceRun, superseded };
}

export function compactBuild() {
  const audit = compactionAudit();
  const snapshots = audit.runs;
  const currentRunId = snapshots.some((item) => item.run.id === audit.sourceRun)
    ? audit.sourceRun
    : (snapshots.at(-1)?.run.id ?? null);
  const records = snapshots.map((item, index) => {
    const context = readJson(path.join(item.run.dir, "context.json"));
    const artifacts = writeRefinementCompactionArtifacts(
      item.run,
      context,
      snapshots[index - 1]?.run ?? null,
    );
    return {
      runId: item.run.id,
      title: item.run.run.title,
      status: item.run.run.status,
      createdAt: item.run.run.createdAt ?? null,
      rawContextBytes: item.bytes,
      estimatedTokens: item.tokens,
      brief: path.relative(STORE, refinementBriefFile(item.run)),
      delta: path.relative(STORE, refinementDeltaFile(item.run)),
      previousRunId: snapshots[index - 1]?.run.id ?? null,
      changedSections: artifacts.changedSections,
      currentMapSource: item.run.id === currentRunId,
      supersededBy:
        item.run.id !== currentRunId && terminal(item.run.run.status)
          ? currentRunId
          : null,
    };
  });
  const current = records.find((record) => record.currentMapSource) ?? null;
  if (current) {
    const sourceRun = snapshots.find(
      (item) => item.run.id === current.runId,
    )?.run;
    fs.mkdirSync(path.dirname(planningContextBriefFile()), { recursive: true });
    fs.copyFileSync(refinementBriefFile(sourceRun), planningContextBriefFile());
  }
  writeJson(compactionIndexFile(), {
    schemaVersion: COMPACTION_SCHEMA_VERSION,
    generatedAt: now(),
    policy: {
      rawRecords: "preserved",
      defaultRead: current
        ? path.relative(STORE, planningContextBriefFile())
        : null,
      rawContext: "on_demand_by_section",
    },
    currentRunId: current?.runId ?? null,
    runs: records,
  });
  console.log(`已生成上下文摘要与差量：${records.length} 份运行。`);
  if (current) console.log(`默认摘要：${planningContextBriefFile()}`);
  console.log(`索引：${compactionIndexFile()}`);
}

export function resolveRun(id) {
  for (const type of RUN_TYPES) {
    const dir = runDir(type, id);
    const file = path.join(dir, "run.json");
    if (fs.existsSync(file)) return { type, id, dir, run: readJson(file) };
  }
  fail(`找不到运行 ${id}`);
}

export function workPlanFile(run) {
  return path.join(run.dir, "work-plan.json");
}

export function executionDir(run) {
  return path.join(run.dir, "executions");
}

export function executionFile(run, taskId) {
  return path.join(executionDir(run), `${taskId}.json`);
}

export function fileLeasesFile(run) {
  return path.join(run.dir, "file-leases.json");
}

export function readFileLeases(run) {
  const file = fileLeasesFile(run);
  if (!fs.existsSync(file)) {
    return {
      schemaVersion: FILE_LEASE_SCHEMA_VERSION,
      runId: run.id,
      updatedAt: null,
      leases: [],
      conflicts: [],
    };
  }
  const value = readJson(file);
  if (value?.schemaVersion !== FILE_LEASE_SCHEMA_VERSION)
    fail(`文件租约记录 schema 不兼容：${file}`);
  if (!Array.isArray(value.leases) || !Array.isArray(value.conflicts))
    fail(`文件租约记录格式无效：${file}`);
  return value;
}

export function ensureWorkPlan(run) {
  const file = workPlanFile(run);
  if (!fs.existsSync(file)) {
    writeJson(file, {
      schemaVersion: 1,
      runId: run.id,
      runType: run.type,
      createdAt: now(),
      tasks: [],
    });
  }
  fs.mkdirSync(executionDir(run), { recursive: true });
  return readJson(file);
}

export function normalizeScope(value) {
  return value.replace(/^\.\//, "").replace(/\/+$/, "");
}

export function scopeCovers(scope, file) {
  const allowed = normalizeScope(scope);
  const actual = normalizeScope(file);
  // A code root registered as `.` becomes an empty relative prefix. It means
  // the workspace root, not an unusable scope: accept only workspace-relative
  // descendants and continue rejecting absolute or parent-directory paths.
  if (!allowed || allowed === ".")
    return (
      actual === "" ||
      (!actual.startsWith("/") && !actual.startsWith(".."))
    );
  return actual === allowed || actual.startsWith(`${allowed}/`);
}

export function canonicalFilePath(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  const suffix = [];
  let existing = absolute;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return absolute;
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  try {
    return path.join(fs.realpathSync(existing), ...suffix);
  } catch {
    return absolute;
  }
}

export function taskCoversFile(task, filePath) {
  const absolute = canonicalFilePath(filePath);
  const relative = path.relative(canonicalFilePath("."), absolute);
  return (task.writes ?? []).some((scope) => {
    if (path.isAbsolute(scope))
      return scopeCovers(canonicalFilePath(scope), absolute);
    return (
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative) &&
      scopeCovers(scope, relative)
    );
  });
}

/** 运行级写入范围是所有任务 writes 的并集；同运行内任务可共享文件。 */
export function runCoversFile(plan, filePath) {
  return (plan.tasks ?? []).some((task) => taskCoversFile(task, filePath));
}

export function terminal(status) {
  return ["done", "blocked", "skipped"].includes(status);
}

export function continuousTaskHasOpenStages(task, execution) {
  return (
    isContinuousDeliveryTask(task) &&
    taskStageDefinitions(task).some(
      (stage) =>
        !DELIVERY_STAGE_CLOSED_STATUSES.has(
          execution?.stages?.[stage.id]?.status,
        ),
    )
  );
}

export function executionIsFinalTerminal(task, execution) {
  return (
    terminal(execution?.status) && !continuousTaskHasOpenStages(task, execution)
  );
}

export function listRuns() {
  const result = [];
  for (const type of RUN_TYPES) {
    const base = path.join(STORE, `${type}-runs`);
    if (!fs.existsSync(base)) continue;
    for (const id of fs.readdirSync(base)) {
      const dir = runDir(type, id);
      const file = path.join(dir, "run.json");
      if (fs.existsSync(file))
        result.push({ type, id, dir, run: readJson(file) });
    }
  }
  return result;
}

export function taskLinkKey(runId, taskId) {
  return `${runId}:${taskId}`;
}

export function readTaskLeafLinks() {
  if (!fs.existsSync(taskLeafLinksFile()))
    return {
      schemaVersion: TASK_LEAF_LINKS_SCHEMA_VERSION,
      links: [],
      updatedAt: null,
    };
  const links = readJson(taskLeafLinksFile());
  if (
    links.schemaVersion !== TASK_LEAF_LINKS_SCHEMA_VERSION ||
    !Array.isArray(links.links)
  )
    fail(`任务叶子功能关联格式不兼容：${taskLeafLinksFile()}`);
  return links;
}

export function taskLeafLink(run, task) {
  const explicit = task.leafFeatureIds;
  if (Array.isArray(explicit)) {
    const scope = task.scope ?? "product";
    if (!TASK_LEAF_SCOPES.has(scope))
      fail(`任务 ${task.id} 的 scope 必须是 product/technical/governance：${scope}`);
    return {
      scope,
      leafFeatureIds: scope === "governance" ? [] : [...new Set(explicit)],
    };
  }
  const links = readTaskLeafLinks();
  const stored = links.links.find(
    (link) => link.runId === run.id && link.taskId === task.id,
  );
  if (stored) return stored;
  return { scope: "governance", leafFeatureIds: [] };
}

export function taskLeafFeatureIds(run, task) {
  const link = taskLeafLink(run, task);
  return link.scope === "governance" ? [] : link.leafFeatureIds;
}

export function taskRelatedFeatureIds(_run, task) {
  const ids = task?.relatedFeatureIds;
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id) => typeof id === "string" && id.trim()))];
}

export function assertRelatedFeatureIds(ids) {
  if (!ids.length) return;
  if (!fs.existsSync(featureMapFile()))
    fail("尚未建立功能演进地图，不能登记相关功能。");
  const known = new Set(
    (readJson(featureMapFile()).features ?? []).map((feature) => feature.id),
  );
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) fail(`不是当前叶子功能：${unknown.join("、")}`);
}

export function assertLeafFeatureIds(ids) {
  if (!fs.existsSync(featureMapFile()))
    fail("尚未建立功能演进地图，不能关联产品任务。");
  const known = new Set(
    (readJson(featureMapFile()).features ?? []).map((feature) => feature.id),
  );
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) fail(`不是当前叶子功能：${unknown.join("、")}`);
}

export function currentFeatureMap() {
  return fs.existsSync(featureMapFile()) ? readJson(featureMapFile()) : null;
}

export function taskPrototypeProblems(run, task) {
  if (run.type !== "delivery" || taskLeafLink(run, task).scope === "governance") return [];
  const map = currentFeatureMap();
  if (!map) return ["产品/技术任务缺少当前功能地图；先 feature refine / apply"];
  const ids = taskLeafFeatureIds(run, task);
  const problems = prototypeDevelopmentProblems(STORE, map, ids);
  for (const id of ids) {
    const feature = map.features.find((item) => item.id === id);
    if (feature && (task.featureRevision ?? null) !== (feature.planningRevision ?? null))
      problems.push(`功能 ${id} 已重新规划，任务 ${run.id}/${task.id} 属于旧规划版本；不可复用旧任务和阶段验收`);
  }
  return problems;
}

export function deliveryDevelopmentRecords() {
  const records = [];
  for (const run of listRuns().filter((item) => item.type === "delivery")) {
    const planFile = path.join(run.dir, "work-plan.json");
    if (!fs.existsSync(planFile)) continue;
    const plan = readJson(planFile);
    const inputFile = path.join(run.dir, "delivery-input.json");
    const input = fs.existsSync(inputFile) ? readJson(inputFile) : null;
    const stages = Object.fromEntries(
      (input?.stages ?? []).map((stage) => [
        stage.id,
        { status: stage.status, summary: stage.summary },
      ]),
    );
    const integrationFile = path.join(run.dir, "integration.json");
    const integration = fs.existsSync(integrationFile)
      ? readJson(integrationFile)
      : null;
    for (const task of plan.tasks ?? []) {
      const executionFilePath = path.join(
        run.dir,
        "executions",
        `${task.id}.json`,
      );
      const execution = fs.existsSync(executionFilePath)
        ? readJson(executionFilePath)
        : null;
      // A superseded delivery run has explicitly closed every unclaimed plan
      // item. Keep an existing execution's own terminal evidence intact, but
      // never surface a missing execution from that run as active work.
      const taskStatus =
        execution?.status ?? (run.run.status === "skipped" ? "skipped" : "pending");
      for (const featureId of taskLeafFeatureIds(run, task)) {
        records.push({
          featureId,
          runId: run.id,
          runTitle: run.run.title,
          runStatus: run.run.status,
          taskId: task.id,
          taskTitle: task.title,
          phase: task.phase ?? "implementation",
          kind: task.kind ?? "development",
          taskScope: task.scope ?? "governance",
          taskStatus,
          continuationOpen: Boolean(execution && continuousTaskHasOpenStages(task, execution)),
          featureRevision: task.featureRevision ?? null,
          agent: execution?.agent ?? null,
          summary: execution?.summary ?? null,
          changedFiles: execution?.changedFiles ?? [],
          tests: execution?.tests ?? null,
          updatedAt:
            execution?.updatedAt ?? task.createdAt ?? run.run.updatedAt,
          stages,
          integrationStatus: integration?.status ?? null,
        });
      }
    }
  }
  return records.sort((left, right) =>
    String(right.updatedAt).localeCompare(String(left.updatedAt)),
  );
}

/**
 * Scan the latest delivery records and project a technical→product impact
 * closure: any product leaf that dependsOn a technical leaf whose latest
 * delivery record is `done` is reported as affected unless the impact
 * closure is already covered by a `reassessment.reviews` decision for that
 * product leaf in the current map. Implementation lives in planning/impact.mjs
 * under deliveryImpactClosure (kept here as a thin re-export to avoid
 * runtime→planning→runtime cycles via the shared module barrel).
 */
export { deliveryImpactClosure as deliveryImpact } from "../planning/impact.mjs";

export function readFeatureHistory() {
  if (!fs.existsSync(featureHistoryFile()))
    return {
      schemaVersion: FEATURE_HISTORY_SCHEMA_VERSION,
      events: [],
      updatedAt: null,
    };
  const history = readJson(featureHistoryFile());
  if (
    history.schemaVersion !== FEATURE_HISTORY_SCHEMA_VERSION ||
    !Array.isArray(history.events)
  )
    fail(`功能历史记录格式不兼容：${featureHistoryFile()}`);
  return history;
}

export function appendFeatureHistory(run, task, type, details = {}) {
  if (run.type !== "delivery") return [];
  const featureIds = task ? taskLeafFeatureIds(run, task) : [];
  const relatedIds = task ? taskRelatedFeatureIds(run, task) : [];
  if (!featureIds.length && !relatedIds.length) return [];
  const history = readFeatureHistory();
  const at = details.at ?? now();
  const events = [];
  const allIds = [...new Set([...featureIds, ...relatedIds])];
  for (const featureId of allIds) {
    events.push({
      id: `feature-history-${sha256(
        JSON.stringify([
          at,
          featureId,
          run.id,
          task.id,
          type,
          details.stage?.id ?? null,
          featureIds.includes(featureId) ? "bound" : "related",
        ]),
      ).slice(0, 16)}`,
      featureId,
      type,
      at,
      runId: run.id,
      runTitle: run.run.title,
      taskId: task.id,
      taskTitle: task.title,
      phase: canonicalTaskPhase(task.phase),
      taskStatus: details.taskStatus ?? "pending",
      summary: details.summary ?? null,
      blocker: details.blocker ?? null,
      decision: details.decision ?? null,
      stage: details.stage ?? null,
      verification: details.verification ?? null,
    });
  }
  history.events.push(...events);
  history.updatedAt = at;
  writeJson(featureHistoryFile(), history);
  return events;
}

export function writeFeatureMap(map) {
  writeJson(featureMapFile(), map);
  fs.writeFileSync(
    path.join(planningDir(), "功能演进地图.md"),
    featureMapMarkdown(map),
  );
}

// “风险/下一步”以独立台账条目挂在叶子功能上：与阶段文案分离，
// 供看板单独展示，并作为下一次交付运行的输入注入。
export function featureRiskId(prefix, text) {
  return `${prefix}-${Date.now().toString(36)}-${crypto
    .createHash("sha256")
    .update(String(text))
    .digest("hex")
    .slice(0, 8)}`;
}

export function registerFeatureRisks(featureIds, texts, source = null) {
  const created = [];
  if (!fs.existsSync(featureMapFile())) return created;
  const map = readJson(featureMapFile());
  const at = now();
  for (const feature of map.features ?? []) {
    if (!featureIds.includes(feature.id)) continue;
    feature.risks ??= [];
    for (const text of texts) {
      const trimmed = String(text ?? "").trim();
      if (!trimmed) continue;
      const entry = {
        id: featureRiskId("risk", `${feature.id}:${trimmed}`),
        text: trimmed,
        status: "open",
        source: source ?? null,
        createdAt: at,
        updatedAt: at,
      };
      feature.risks.push(entry);
      created.push({ featureId: feature.id, ...entry });
    }
    feature.updatedAt = at;
  }
  if (created.length) {
    map.updatedAt = at;
    writeFeatureMap(map);
  }
  return created;
}

export function openFeatureRisks(featureIds) {
  if (!fs.existsSync(featureMapFile())) return [];
  const map = readJson(featureMapFile());
  return (map.features ?? [])
    .filter((feature) => featureIds.includes(feature.id))
    .flatMap((feature) =>
      (feature.risks ?? [])
        .filter((risk) => (risk.status ?? "open") === "open")
        .map((risk) => ({
          featureId: feature.id,
          featureTitle: feature.title,
          ...risk,
        })),
    );
}

export function resolveFeatureRisk(featureId, riskId, note = null) {
  if (!fs.existsSync(featureMapFile())) return null;
  const map = readJson(featureMapFile());
  const feature = (map.features ?? []).find((item) => item.id === featureId);
  const risk = (feature?.risks ?? []).find((item) => item.id === riskId);
  if (!feature || !risk) return null;
  const at = now();
  risk.status = "resolved";
  risk.resolution = note;
  risk.updatedAt = at;
  feature.updatedAt = at;
  map.updatedAt = at;
  writeFeatureMap(map);
  return { featureId, ...risk };
}

// Extracts the “风险/下一步” segment (last report field) from a stage summary.
// Returns "" for an empty or trivial value so gates can skip ledger checks.
export function riskSegmentFromSummary(summary) {
  const match = /风险\/下一步\s*[:：]([\s\S]*)$/.exec(String(summary ?? ""));
  const text = (match?.[1] ?? "").trim();
  if (!text) return "";
  if (/^(无|暂无|没有|none|n\/a|—|-)([。．.；;，,]\s*)?$/.test(text)) return "";
  return text;
}

export function projectTaskStateToFeatureMap(
  run,
  task,
  { stage = null, acceptanceResults = null, at = now() } = {},
) {
  if (run.type !== "delivery") return [];
  if (!fs.existsSync(featureMapFile())) return [];
  const map = readJson(featureMapFile());
  const records = deliveryDevelopmentRecords();
  const changed = [];
  for (const feature of map.features ?? []) {
    if (!taskLeafFeatureIds(run, task).includes(feature.id)) continue;
    // Old task events remain in history but cannot complete a revised feature.
    if ((task.featureRevision ?? null) !== (feature.planningRevision ?? null)) continue;
    if (Array.isArray(task.stageDefinitions)) feature.stageDefinitions = task.stageDefinitions;
    else delete feature.stageDefinitions;
    if (stage) {
      const stages = normalizeFeatureStages(feature);
      stages[stage.id] = {
        status: stage.status,
        summary: stage.summary,
        updatedAt: at,
      };
      feature.stages = stages;
    }
    if (acceptanceResults) {
      const stages = normalizeFeatureStages(feature);
      const finalStage = stages.end_to_end_acceptance;
      if (finalStage) {
        stages.end_to_end_acceptance = {
          ...finalStage,
          acceptanceResults: JSON.parse(JSON.stringify(acceptanceResults)),
          updatedAt: at,
        };
        feature.stages = stages;
      }
    }
    const related = records.filter((record) => record.featureId === feature.id && record.featureRevision === (feature.planningRevision ?? null));
    const statuses = related.map((record) => record.taskStatus);
    const allStagesClosed = taskStageDefinitions(task).every((definition) =>
      DELIVERY_STAGE_CLOSED_STATUSES.has(
        normalizeFeatureStages(feature)[definition.id]?.status,
      ),
    );
    if (feature.status !== "park" && feature.status !== "skipped") {
      if (stage?.status === "blocked" || statuses.includes("blocked"))
        feature.status = "blocked";
      else if (
        related.length &&
        statuses.every((status) => status === "skipped")
      ) {
        feature.status = "not_started";
        feature.stages = defaultFeatureStages();
      } else if (
        related.length &&
        statuses.every((status) => ["done", "skipped"].includes(status)) &&
        statuses.includes("done") &&
        allStagesClosed && !related.some((record) => record.continuationOpen)
      )
        feature.status = "done";
      else if (
        related.length &&
        statuses.some((status) => status !== "pending")
      )
        feature.status = "in_progress";
    }
    feature.updatedAt = at;
    changed.push(feature.id);
  }
  if (changed.length) {
    map.updatedAt = at;
    // Delivery progress is projected into the map itself. Refresh the cursor
    // after that projection so a claim/stage update cannot invalidate the
    // planning snapshot that authorized the same task.
    // Legacy maps used by generic task fixtures may not have a planning
    // cursor (or even a project baseline), so retain their metadata-only
    // projection behavior.
    if (typeof map.evidenceCursor === "string" && fs.existsSync(projectFile())) {
      rebuildExecutionIndex();
      map.evidenceCursor = featureEvidenceContext().evidenceCursor;
    }
    writeFeatureMap(map);
  }
  return changed;
}

export function markdownCell(value) {
  return String(value ?? "—")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
}

export function canonicalTaskPhase(phase) {
  return TASK_PHASE_ALIASES[phase] ?? phase ?? "technical_implementation";
}

export function stageRecord(input, stageId) {
  const direct = input?.stages?.find((stage) => stage.id === stageId);
  if (direct) return direct;
  for (const legacyId of LEGACY_STAGE_FALLBACKS[stageId] ?? []) {
    const legacy = input?.stages?.find((stage) => stage.id === legacyId);
    if (legacy) return legacy;
  }
  return null;
}

export function defaultFeatureStages(status = "not_started") {
  const terminal =
    status === "done"
      ? "confirmed"
      : status === "park"
        ? "not_applicable"
        : "pending";
  return Object.fromEntries(
    DELIVERY_STAGES.map((stage) => [
      stage.id,
      { status: terminal, summary: null, updatedAt: null },
    ]),
  );
}

export function normalizeFeatureStages(feature) {
  const fallback = defaultFeatureStages(feature.status);
  const source = feature.stages ?? {};
  return Object.fromEntries(
    (feature.stageDefinitions ?? DELIVERY_STAGES).map((stage) => [
      stage.id,
      { ...fallback[stage.id], ...(source[stage.id] ?? {}) },
    ]),
  );
}

export function coverageCounts(coverage) {
  return (coverage?.coverage ?? []).reduce(
    (counts, entry) => {
      counts[entry.status] = (counts[entry.status] ?? 0) + 1;
      counts.total += 1;
      return counts;
    },
    { total: 0, covered: 0, unavailable: 0, inferred: 0, out_of_scope: 0 },
  );
}

export function orderedFeatureGroups(groups = []) {
  return [...groups].sort(
    (left, right) =>
      Number(left?.rank ?? Number.MAX_SAFE_INTEGER) -
        Number(right?.rank ?? Number.MAX_SAFE_INTEGER) ||
      String(left?.id ?? "").localeCompare(String(right?.id ?? "")),
  );
}

export function orderedFeaturesInMap(features = [], groups = []) {
  const groupRanks = new Map(
    orderedFeatureGroups(groups).map((group, index) => [
      group.id,
      group.rank ?? index + 1,
    ]),
  );
  return [...features].sort(
    (left, right) =>
      Number(groupRanks.get(left.parentId) ?? Number.MAX_SAFE_INTEGER) -
        Number(groupRanks.get(right.parentId) ?? Number.MAX_SAFE_INTEGER) ||
      Number(left?.rank ?? Number.MAX_SAFE_INTEGER) -
        Number(right?.rank ?? Number.MAX_SAFE_INTEGER) ||
      String(left?.id ?? "").localeCompare(String(right?.id ?? "")),
  );
}

export function featureMapMarkdown(map) {
  const groups = orderedFeatureGroups(map.groups ?? []);
  const features = map.features ?? [];
  const sections = groups.map((group) => {
    const children = orderedFeaturesInMap(
      features.filter((feature) => feature.parentId === group.id),
      [group],
    );
    const rows = children.length
      ? children.map(
          (feature) => {
            const kind = feature.kind ?? "product";
            const kindTag = kind === "technical" ? "技术" : "产品";
            const outcome = kind === "technical"
              ? (feature.description ?? "—")
              : (feature.outcome ?? "—");
            const coverage = kind === "technical"
              ? (feature.systemCardRefs ?? []).join("、") || "—"
              : (feature.sourceEntries ?? []).join("、") || "—";
            return `| ${String(group.rank).padStart(2, "0")}.${String(feature.rank).padStart(2, "0")} | \`${feature.id}\` | ${feature.title} | ${kindTag} | ${outcome} | ${feature.priority} | ${feature.wave ?? "—"} | ${feature.status} | ${(feature.stageDefinitions ?? DELIVERY_STAGES).map((stage) => `${stage.title.split("（")[0]}：${normalizeFeatureStages(feature)[stage.id].status}`).join("；") || "未预设阶段"} | ${coverage} | ${(feature.dependsOn ?? []).join("、") || "—"} | ${(feature.blockers ?? []).join("；") || "—"} | ${markdownCell((feature.risks ?? []).filter((risk) => (risk.status ?? "open") === "open").map((risk) => `${risk.id}：${risk.text}`).join("；"))} |`;
          },
        )
      : ["| — | — | 尚无叶子功能 | — | — | — | — | — | — | — | — | — | — |"];
    return [
      `## ${String(group.rank).padStart(2, "0")} · ${group.title}`,
      "",
      `业务域 ID：\`${group.id}\`；功能块顺序：${String(group.rank).padStart(2, "0")}；来源旧功能：${(group.sourceFeatureIds ?? []).map((id) => `\`${id}\``).join("、") || "—"}。`,
      "",
      "| 顺序 | ID | 叶子功能 | 类型 | 独立用户结果 | 优先级 | 波次 | 真实实现状态 | 小闭环阶段 | 原型入口 / 系统卡片 | 依赖 | 阻塞 | 开放风险（独立台账，二次运行输入） |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...rows,
    ].join("\n");
  });
  const graphNodes = features.map(
    (feature) =>
      `  ${slug(feature.id).replace(/-/g, "_")}[\"${feature.title.replace(/\"/g, "'")}\"]`,
  );
  const graphEdges = features.flatMap((feature) =>
    (feature.dependsOn ?? []).map(
      (dependency) =>
        `  ${slug(dependency).replace(/-/g, "_")} --> ${slug(feature.id).replace(/-/g, "_")}`,
    ),
  );
  return [
    "# 功能演进地图",
    "",
    `- 来源拆解运行：\`${map.sourceRun}\``,
    `- 原型运行：\`${map.prototypeRun ?? "—"}\``,
    `- 证据游标：\`${map.evidenceCursor}\``,
    `- 更新时间：${map.updatedAt}`,
    "",
    "> 本文是原型、代码、开发历史、系统卡片和范围文档的当前执行视图；事实仍以各自真源为准。",
    "",
    "## 功能块与执行顺序",
    "",
    "> 功能块及其叶子功能按 `rank` 从上到下展示；该顺序就是当前的评估与执行顺序，最上方优先处理。依赖必须指向更靠上的功能。`P1-1` 与 `W2` 是范围/波次标签，不再决定看板排序。信息或方案变动后，应重新运行 `feature refine`，允许重组功能块并调整顺序。",
    "",
    "## 任务要求与历史阶段",
    "",
    "新任务不预设阶段，按任务创建时冻结的类型、输入和验收要求执行；用 work delivery-brief 读取当前任务要求。地图不自行定义任务阶段。",
    "",
    "以下仅解释历史阶段契约；旧任务恢复时继续遵守，新任务不自动继承：",
    ...DELIVERY_STAGES.map((stage, index) => `${index + 1}. **${stage.title}**：${stage.objective}`),
    "",
    "> 历史任务的 not_applicable 仍需明确依据；中间检查点完成不代表产品任务完成。",
    "",
    "## 依赖图",
    "",
    "```mermaid",
    "flowchart LR",
    ...graphNodes,
    ...graphEdges,
    "```",
    "",
    ...sections,
    "",
    "## 历史迁移",
    "",
    "| 类型 | 旧功能 | 当前叶子功能 | 原因 |",
    "| --- | --- | --- | --- |",
    ...(map.migrations ?? []).map(
      (migration) =>
        `| ${migration.type} | ${(migration.from ?? []).join("、")} | ${(migration.to ?? []).join("、")} | ${migration.reason} |`,
    ),
    "",
  ].join("\n");
}

export const SYSTEM_SOURCE_KINDS = new Set([
  "codebase",
  "database",
  "configuration",
  "document",
  "api",
  "other",
]);

export const SYSTEM_SOURCE_STATES = new Set(["confirmed", "partial", "unavailable"]);

export const SYSTEM_CARD_STATES = new Set(["confirmed", "partial", "unavailable"]);

export const SYSTEM_API_STATES = new Set(["observed", "partial", "unavailable"]);

export const SYSTEM_ISSUE_SEVERITIES = new Set(["low", "medium", "high", "critical"]);

export const SYSTEM_ISSUE_STATES = new Set(["open", "monitoring", "resolved"]);

export const FORBIDDEN_SECRET_KEYS = new Set([
  "credential",
  "credentials",
  "password",
  "secret",
  "token",
  "databaseUrl",
  "connectionString",
]);

export function containsSecretKey(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSecretKey);
  return Object.entries(value).some(
    ([key, child]) =>
      FORBIDDEN_SECRET_KEYS.has(key) || containsSecretKey(child),
  );
}

export function systemCardProblems(run) {
  if (run.type !== "system") return [];
  const cardFile = path.join(run.dir, "cards.json");
  const legacyFile = path.join(run.dir, "sources.json");
  const file = fs.existsSync(cardFile) ? cardFile : legacyFile;
  if (!file || !fs.existsSync(file)) return ["系统信息运行缺少 cards.json"];
  let document;
  try {
    document = readJson(file);
  } catch {
    return [`${path.basename(file)} 不是有效 JSON`];
  }
  if (!fs.existsSync(cardFile)) {
    const sources = document.sources;
    if (!Array.isArray(sources) || !sources.length)
      return ["sources.json 至少登记一个系统来源"];
    return sourceProblems(sources);
  }
  const cards = document.cards;
  if (!Array.isArray(cards)) return ["cards.json.cards 必须是数组"];
  if (!cards.length && !(document.removeCardIds ?? []).length)
    return ["cards.json 至少登记一张系统卡片或一个待移除卡片 ID"];
  const problems = [];
  const projectRoots = (ensureProject().codeRoots ?? []).map((root) =>
    path.resolve(process.cwd(), root.path),
  );
  const ids = new Set();
  for (const card of cards) {
    if (!card?.id || ids.has(card.id)) problems.push("系统卡片存在重复或空 ID");
    ids.add(card?.id);
    for (const field of [
      "title",
      "relationship",
      "authority",
      "status",
      "lastVerifiedAt",
    ]) {
      if (!card?.[field])
        problems.push(`系统卡片 ${card?.id || "<unknown>"} 缺少 ${field}`);
    }
    if (card?.status && !SYSTEM_CARD_STATES.has(card.status))
      problems.push(`系统卡片 ${card.id} 的 status 无效：${card.status}`);
    if (!Array.isArray(card?.sources) || !card.sources.length)
      problems.push(`系统卡片 ${card?.id || "<unknown>"} 至少登记一个来源`);
    else
      problems.push(...sourceProblems(card.sources, `系统卡片 ${card.id} / `));
    for (const source of card?.sources ?? []) {
      if (source?.kind !== "codebase") continue;
      const locations = String(source.location ?? "").split(/、|；|\s+与\s+/);
      if (
        locations.some((location) =>
          projectRoots.includes(path.resolve(process.cwd(), location.trim())),
        )
      )
        problems.push(
          `系统卡片 ${card.id} 引用了本地可开发项目代码；本地项目只能登记为项目卡片，外部参考才可建立系统卡片`,
        );
    }
    const apiIds = new Set();
    for (const api of card?.knownApis ?? []) {
      if (!api?.id || apiIds.has(api.id))
        problems.push(`系统卡片 ${card.id} 的 API 存在重复或空 ID`);
      apiIds.add(api?.id);
      for (const field of ["method", "path", "purpose", "status", "evidence"])
        if (!api?.[field] || (field === "evidence" && !api.evidence.length))
          problems.push(
            `系统卡片 ${card.id} 的 API ${api?.id || "<unknown>"} 缺少 ${field}`,
          );
      if (api?.status && !SYSTEM_API_STATES.has(api.status))
        problems.push(
          `系统卡片 ${card.id} 的 API ${api.id} status 无效：${api.status}`,
        );
    }
    const usageIds = new Set();
    for (const usage of card?.apiUsages ?? []) {
      if (!usage?.id || usageIds.has(usage.id))
        problems.push(`系统卡片 ${card.id} 的 API 使用登记存在重复或空 ID`);
      usageIds.add(usage?.id);
      for (const field of [
        "apiId",
        "consumer",
        "purpose",
        "decisionRef",
        "registeredAt",
        "lastConfirmedAt",
      ])
        if (!usage?.[field])
          problems.push(
            `系统卡片 ${card.id} 的 API 使用登记 ${usage?.id || "<unknown>"} 缺少 ${field}`,
          );
      if (usage?.apiId && !apiIds.has(usage.apiId))
        problems.push(
          `系统卡片 ${card.id} 的 API 使用登记 ${usage.id} 指向未知 API：${usage.apiId}`,
        );
    }
    const issueIds = new Set();
    for (const issue of card?.technicalIssues ?? []) {
      if (!issue?.id || issueIds.has(issue.id))
        problems.push(`系统卡片 ${card.id} 的技术问题存在重复或空 ID`);
      issueIds.add(issue?.id);
      for (const field of [
        "title",
        "severity",
        "status",
        "summary",
        "observedAt",
        "lastConfirmedAt",
        "evidence",
      ])
        if (!issue?.[field] || (field === "evidence" && !issue.evidence.length))
          problems.push(
            `系统卡片 ${card.id} 的技术问题 ${issue?.id || "<unknown>"} 缺少 ${field}`,
          );
      if (issue?.severity && !SYSTEM_ISSUE_SEVERITIES.has(issue.severity))
        problems.push(
          `系统卡片 ${card.id} 的技术问题 ${issue.id} severity 无效：${issue.severity}`,
        );
      if (issue?.status && !SYSTEM_ISSUE_STATES.has(issue.status))
        problems.push(
          `系统卡片 ${card.id} 的技术问题 ${issue.id} status 无效：${issue.status}`,
        );
    }
    if (containsSecretKey(card))
      problems.push(
        `系统卡片 ${card?.id || "<unknown>"} 含敏感字段；只记录配置路径、变量名与脱敏规则`,
      );
  }
  for (const id of document.removeCardIds ?? []) {
    if (ids.has(id)) problems.push(`系统卡片 ${id} 不能同时更新和删除`);
  }
  return [...new Set(problems)];
}

export function sourceProblems(sources, prefix = "") {
  const problems = [];
  const ids = new Set();
  for (const source of sources) {
    if (!source?.id || ids.has(source.id))
      problems.push(`${prefix}系统来源存在重复或空 ID`);
    ids.add(source?.id);
    for (const field of [
      "title",
      "kind",
      "location",
      "authority",
      "accessPolicy",
      "secretHandling",
      "status",
    ]) {
      if (!source?.[field])
        problems.push(
          `${prefix}系统来源 ${source?.id || "<unknown>"} 缺少 ${field}`,
        );
    }
    if (source?.kind && !SYSTEM_SOURCE_KINDS.has(source.kind))
      problems.push(
        `${prefix}系统来源 ${source.id} 的 kind 无效：${source.kind}`,
      );
    if (source?.status && !SYSTEM_SOURCE_STATES.has(source.status))
      problems.push(
        `${prefix}系统来源 ${source.id} 的 status 无效：${source.status}`,
      );
    if (
      ["codebase", "configuration"].includes(source?.kind) &&
      !/只读|不修改|禁止修改/.test(source?.accessPolicy ?? "")
    )
      problems.push(
        `${prefix}系统来源 ${source.id} 必须明确为只读参考，禁止修改外部项目`,
      );
    if (containsSecretKey(source))
      problems.push(
        `${prefix}系统来源 ${source?.id || "<unknown>"} 含敏感字段；只记录配置路径、变量名与脱敏规则`,
      );
  }
  return [...new Set(problems)];
}

export function rebuildExecutionIndex() {
  const runs = listRuns().map((run) => {
    const plan = ensureWorkPlan(run);
    const tasks = plan.tasks.map((task) => {
      const file = executionFile(run, task.id);
      const execution = fs.existsSync(file) ? readJson(file) : null;
      return {
        id: task.id,
        title: task.title,
        kind: task.kind,
        features: task.leafFeatureIds ?? task.features ?? [],
        writes: task.writes,
        dependsOn: task.dependsOn,
        status: execution?.status ?? "pending",
        continuationOpen: continuousTaskHasOpenStages(task, execution),
        agent: execution?.agent ?? null,
        executionFile: path.relative(STORE, file),
        updatedAt: execution?.updatedAt ?? task.createdAt,
      };
    });
    return { id: run.id, type: run.type, title: run.run.title, tasks };
  });
  writeJson(executionIndexFile(), {
    schemaVersion: 1,
    generatedAt: now(),
    runs,
  });
  return runs;
}

export function featureIsImplemented(feature) {
  return ["completed", "done", "完成"].includes(
    String(feature.implementationStatus || "").toLowerCase(),
  );
}

export function prototypeDeliveryCandidates() {
  if (hasPrototypeCatalog(process.cwd())) {
    const view = planningPrototype(process.cwd());
    if (view.revision.sourceProblems.length) fail(view.revision.sourceProblems.join("\n"));
    const questions = view.questions.filter(q => q.status !== 'resolved');
    if (questions.length) fail(`原型疑问尚未回答：${questions.map(q => q.id).join('、')}`);
    return { prototypeRun: view.task.source.prototypeRun, task: view.task, features: view.features.map(feature => ({ ...feature, prototypeStatus: 'covered' })) };
  }
  const taskFile = path.join(prototypeDir(), "task.json");
  const indexFile = path.join(prototypeDir(), "feature-index.json");
  if (!fs.existsSync(taskFile) || !fs.existsSync(indexFile))
    fail("尚未建立完整原型真源；先完成 prototype init 与功能块回写。");
  const task = readJson(taskFile);
  const index = readJson(indexFile);
  const prototypeRun = task.source?.prototypeRun || index.sourceRun;
  if (
    !prototypeRun ||
    !prototypeArchiveExists(STORE, prototypeRun)
  )
    fail("长期原型真源缺少可用的来源原型运行，不能自动提取开发输入。");
  const features = (index.features ?? [])
    .filter((feature) => !featureIsImplemented(feature))
    .map((feature) => ({
      id: feature.id,
      title: feature.title,
      sourceEntries: feature.sourceEntries ?? [],
      sourceReport: feature.sourceReport ?? null,
      prototypeStatus: feature.prototypeStatus ?? "unknown",
      implementationStatus: feature.implementationStatus ?? "not_started",
      testStatus: feature.testStatus ?? "not_run",
      systemInformation: feature.systemInformation ?? null,
    }));
  return { prototypeRun, task, features };
}

export function compareFeatureRank(left, right, groups) {
  const groupRanks = new Map(
    orderedFeatureGroups(groups).map((group, index) => [
      group.id,
      group.rank ?? index + 1,
    ]),
  );
  return (
    Number(groupRanks.get(left.parentId) ?? Number.MAX_SAFE_INTEGER) -
      Number(groupRanks.get(right.parentId) ?? Number.MAX_SAFE_INTEGER) ||
    Number(left.rank ?? Number.MAX_SAFE_INTEGER) -
      Number(right.rank ?? Number.MAX_SAFE_INTEGER) ||
    left.id.localeCompare(right.id)
  );
}

export function orderFeatureCandidates(features, groups = []) {
  const remaining = new Map(features.map((feature) => [feature.id, feature]));
  const ordered = [];
  while (remaining.size) {
    const ready = [...remaining.values()]
      .filter((feature) =>
        (feature.dependsOn ?? []).every(
          (dependency) => !remaining.has(dependency),
        ),
      )
      .sort((left, right) => compareFeatureRank(left, right, groups));
    if (!ready.length)
      fail("功能演进地图的依赖无法排序；先运行 feature refine 修复依赖环。");
    for (const feature of ready) {
      ordered.push(feature);
      remaining.delete(feature.id);
    }
  }
  return ordered;
}

export function featureMapDeliveryCandidates() {
  if (!fs.existsSync(featureMapFile()))
    fail(
      "尚未建立功能演进地图；先运行 feature refine，完成 proposal.json 后执行 feature apply。",
    );
  rebuildExecutionIndex();
  const map = readJson(featureMapFile());
  const prototypeProblems = prototypeDevelopmentProblems(STORE, map);
  if (prototypeProblems.length) fail(prototypeProblems.join("\n"));
  const context = featureEvidenceContext();
  if (map.evidenceCursor !== context.evidenceCursor)
    fail(
      "功能演进地图已过期；代码、原型、任务历史、系统卡片或范围文档发生变化，请先运行 feature refine。",
    );
  const features = (map.features ?? [])
    .filter((feature) => !["done", "skipped", "park"].includes(feature.status))
    .map((feature) => ({
      ...feature,
      prototypeStatus: feature.prototypeStatus ?? "covered",
      implementationStatus: feature.status,
      testStatus: feature.testStatus ?? "not_run",
    }));
  return {
    prototypeRun: map.prototypeRun,
    map,
    features: orderFeatureCandidates(features, map.groups),
  };
}

export function deliveryInputFile(run) {
  return path.join(run.dir, "delivery-input.json");
}

export function deliveryInput(run) {
  const file = deliveryInputFile(run);
  return fs.existsSync(file) ? readJson(file) : null;
}

export function visualRegionReviewFile(run) {
  return path.join(run.dir, "visual-region-reviews.json");
}

export function validationScreenshotPairsFile(run) {
  return path.join(run.dir, "validation-screenshot-pairs.json");
}

export function additionalScreenshotsFile(run) {
  return path.join(run.dir, "additional-screenshots.json");
}

export function validationScreenshotPairs(run) {
  const file = validationScreenshotPairsFile(run);
  if (!fs.existsSync(file))
    return { schemaVersion: 1, runId: run.id, pairs: [] };
  const value = readJson(file);
  if (value?.schemaVersion !== 1 || !Array.isArray(value.pairs))
    fail(`验证截图对格式无效：${path.relative(process.cwd(), file)}`);
  return value;
}

export function additionalScreenshots(run) {
  const file = additionalScreenshotsFile(run);
  if (!fs.existsSync(file))
    return { schemaVersion: 1, runId: run.id, screenshots: [] };
  const value = readJson(file);
  if (value?.schemaVersion !== 1 || !Array.isArray(value.screenshots))
    fail(`补充截图格式无效：${path.relative(process.cwd(), file)}`);
  return value;
}

export function apiMockEvidenceFile(run) {
  return path.join(run.dir, "api-mock-screenshots.json");
}

export function miniappEvidenceFile(run) {
  return path.join(run.dir, "miniapp-screenshots.json");
}

export function miniappEvidence(run) {
  const file = miniappEvidenceFile(run);
  if (!fs.existsSync(file))
    return { schemaVersion: 1, runId: run.id, evidence: [] };
  const value = readJson(file);
  if (value?.schemaVersion !== 1 || !Array.isArray(value.evidence))
    fail(`小程序截图证据格式无效：${path.relative(process.cwd(), file)}`);
  return value;
}

export function apiMockEvidence(run) {
  const file = apiMockEvidenceFile(run);
  if (!fs.existsSync(file))
    return { schemaVersion: 1, runId: run.id, evidence: [] };
  const value = readJson(file);
  if (value?.schemaVersion !== 1 || !Array.isArray(value.evidence))
    fail(`接口 Mock 截图证据格式无效：${path.relative(process.cwd(), file)}`);
  return value;
}

export function visualRegionReviews(run) {
  const file = visualRegionReviewFile(run);
  if (!fs.existsSync(file))
    return { schemaVersion: 1, runId: run.id, reviews: [] };
  const value = readJson(file);
  if (value?.schemaVersion !== 1 || !Array.isArray(value.reviews))
    fail(`逐区视觉审查记录格式无效：${path.relative(process.cwd(), file)}`);
  return value;
}

export function fileWithin(file, directory) {
  const target = path.resolve(file);
  const base = path.resolve(directory);
  return target.startsWith(`${base}${path.sep}`);
}

export function validationScreenshotPairProblems(run, task, expectedResult = null) {
  const pairs = validationScreenshotPairs(run).pairs.filter(
    (pair) => pair.taskId === task.id,
  );
  if (!pairs.length)
    return [
      `UI 任务 ${task.id} 缺少固定验证截图对；使用 visual archive 归档原型参考图与 ui-client 结果图。`,
    ];
  const prototypeBase = path.join(prototypeArchiveDirectory(STORE, run.run.prototypeRun), "screenshots");
  const resultBase = path.resolve(run.dir, "screenshots");
  const roles = VISUAL_VALIDATION_EVIDENCE.screenshots;
  const problems = [];
  const candidates = expectedResult
    ? pairs.filter((pair) =>
        pair.screenshots?.some(
          (shot) =>
            shot.role === "result" &&
            shot.path === path.relative(STORE, expectedResult),
        ),
      )
    : pairs;
  if (!candidates.length)
    return [`UI 任务 ${task.id} 的结果截图未与原型参考图组成固定验证截图对。`];
  for (const pair of candidates) {
    if (
      !Array.isArray(pair.screenshots) ||
      pair.screenshots.length !==
        VISUAL_VALIDATION_EVIDENCE.primaryScreenshotCount
    ) {
      problems.push(
        `验证截图对 ${pair.id} 必须恰好包含 ${VISUAL_VALIDATION_EVIDENCE.primaryScreenshotCount} 份主截图。`,
      );
      continue;
    }
    for (const role of roles) {
      const shots = pair.screenshots.filter((shot) => shot.role === role.role);
      if (shots.length !== 1 || shots[0]?.source !== role.source) {
        problems.push(
          `验证截图对 ${pair.id} 缺少唯一的 ${role.title}（${role.role}/${role.source}）。`,
        );
        continue;
      }
      const file = path.resolve(STORE, shots[0].path ?? "");
      const directory = role.role === "reference" ? prototypeBase : resultBase;
      if (!fileWithin(file, directory) || !fs.existsSync(file))
        problems.push(
          `验证截图对 ${pair.id} 的${role.title}不存在或来源不正确：${shots[0].path ?? "—"}`,
        );
      if (
        shots[0]?.sourceSystem?.kind !== role.sourceSystemKind ||
        !String(shots[0]?.sourceSystem?.id ?? "").trim() ||
        !String(shots[0]?.sourceSystem?.label ?? "").trim()
      )
        problems.push(
          `验证截图对 ${pair.id} 的${role.title}缺少有效来源系统标记。`,
        );
    }
    if (
      !taskDeliveryTargetsFor(task).some(
        (target) => target.path === pair.uiProject,
      )
    )
      problems.push(
        `验证截图对 ${pair.id} 的结果图项目与任务绑定不一致：${pair.uiProject ?? "—"}`,
      );
    if (!String(pair.action ?? "").trim())
      problems.push(`验证截图对 ${pair.id} 缺少复现动作。`);
  }
  return problems;
}

export function visualRegionReviewProblems(run) {
  if (run.type !== "delivery") return [];
  const project = ensureProject();
  if (
    !(project.codeRoots ?? []).some((root) =>
      deliveryRoles(root).includes(UI_DELIVERY_ROLE),
    )
  )
    return [];
  const input = deliveryInput(run);
  const acceptance = stageRecord(input, "end_to_end_acceptance");
  if (!acceptance || !["confirmed", "done"].includes(acceptance.status))
    return [];
  const plan = ensureWorkPlan(run);
  const uiTasks = plan.tasks.filter(
    (task) =>
      task.scope === "product" &&
      (isContinuousDeliveryTask(task) ||
        canonicalTaskPhase(task.phase) === "end_to_end_acceptance") &&
      taskHasDeliveryRole(task, UI_DELIVERY_ROLE),
  );
  if (!uiTasks.length)
    return [
      "全链路验收没有绑定 ui-client 项目；不得以 API/Web 截图代替客户端验收。",
    ];
  const reviews = visualRegionReviews(run).reviews;
  const problems = [];
  for (const task of uiTasks) {
    const passed = reviews.find(
      (item) =>
        item.status === "passed" &&
        item.taskId === task.id &&
        item.uiProject === task.deliveryTarget.path,
    );
    if (!passed)
      problems.push(
        `全链路验收缺少 ${task.deliveryTarget.path} 的通过逐区原型/UI 审查。`,
      );
    else problems.push(...validationScreenshotPairProblems(run, task));
  }
  return problems;
}

export const DELIVERY_REPORT_MARKERS = {
  stages: [
    "<!-- mf-dev-flow:stage-todo:start -->",
    "<!-- mf-dev-flow:stage-todo:end -->",
  ],
  tasks: [
    "<!-- mf-dev-flow:task-todo:start -->",
    "<!-- mf-dev-flow:task-todo:end -->",
  ],
  outcomes: [
    "<!-- mf-dev-flow:task-outcomes:start -->",
    "<!-- mf-dev-flow:task-outcomes:end -->",
  ],
  apiMock: [
    "<!-- mf-dev-flow:api-mock-evidence:start -->",
    "<!-- mf-dev-flow:api-mock-evidence:end -->",
  ],
  miniapp: [
    "<!-- mf-dev-flow:miniapp-evidence:start -->",
    "<!-- mf-dev-flow:miniapp-evidence:end -->",
  ],
  visualPairs: [
    "<!-- mf-dev-flow:visual-pairs:start -->",
    "<!-- mf-dev-flow:visual-pairs:end -->",
  ],
  additionalScreenshots: [
    "<!-- mf-dev-flow:additional-screenshots:start -->",
    "<!-- mf-dev-flow:additional-screenshots:end -->",
  ],
  integration: [
    "<!-- mf-dev-flow:integration:start -->",
    "<!-- mf-dev-flow:integration:end -->",
  ],
  visual: [
    "<!-- mf-dev-flow:visual-region-review:start -->",
    "<!-- mf-dev-flow:visual-region-review:end -->",
  ],
  stageArtifacts: [
    "<!-- mf-dev-flow:stage-artifacts:start -->",
    "<!-- mf-dev-flow:stage-artifacts:end -->",
  ],
  featureRisks: [
    "<!-- mf-dev-flow:feature-risks:start -->",
    "<!-- mf-dev-flow:feature-risks:end -->",
  ],
};

export function reportSection(markdown, heading) {
  const lines = String(markdown).split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return null;
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("## "),
  );
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}

export function meaningfulReportText(value) {
  const text = String(value ?? "")
    .replace(/<!--[^]*?-->/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/[|#*_\-\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 24) return false;
  return !/待填写|创建开发运行|每次测试后追加|等待方案确认/.test(text);
}

export function replaceMarkedBlock(markdown, markers, content) {
  const [start, end] = markers;
  const block = `${start}\n${content.trim()}\n${end}`;
  const startAt = markdown.indexOf(start);
  const endAt = markdown.indexOf(end);
  if (startAt !== -1 && endAt >= startAt) {
    return `${markdown.slice(0, startAt)}${block}${markdown.slice(endAt + end.length)}`;
  }
  return `${markdown.trimEnd()}\n\n${block}\n`;
}

export function taskStatus(run, task) {
  const file = executionFile(run, task.id);
  return fs.existsSync(file) ? readJson(file).status : "pending";
}

export function todoMark(status) {
  return ["done", "confirmed", "not_applicable"].includes(status) ? "x" : " ";
}

export function syncDeliveryReports(run) {
  if (run.type !== "delivery") return;
  const input = deliveryInput(run);
  const syncBlock = (markdown, markers, content) =>
    isGenericDelivery(input) && !markers.every((marker) => markdown.includes(marker))
      ? markdown
      : replaceMarkedBlock(markdown, markers, content);
  const plan = ensureWorkPlan(run);
  const planFile = path.join(run.dir, "plan.md");
  if (fs.existsSync(planFile) && input) {
    let markdown = fs.readFileSync(planFile, "utf8");
    const stages = (input.stages ?? []).map(
      (stage) =>
        `- [${todoMark(stage.status)}] \`${stage.id}\` · ${stage.title}（${stage.status}）${stage.summary ? `：${stage.summary}` : ""}`,
    );
    const tasks = plan.tasks.map((task) => {
      const status = taskStatus(run, task);
      return `- [${todoMark(status)}] \`${task.id}\` · ${task.title}（${task.phase} / ${status}）`;
    });
    markdown = syncBlock(
      markdown,
      DELIVERY_REPORT_MARKERS.stages,
      stages.join("\n") || "- [ ] 尚未登记阶段。",
    );
    markdown = syncBlock(
      markdown,
      DELIVERY_REPORT_MARKERS.tasks,
      tasks.join("\n") || "- [ ] 尚未登记实施任务。",
    );
    fs.writeFileSync(planFile, markdown);
  }

  const implementationFile = path.join(run.dir, "implementation.md");
  if (fs.existsSync(implementationFile)) {
    let markdown = fs.readFileSync(implementationFile, "utf8");
    const outcomes = plan.tasks.map((task) => {
      const file = executionFile(run, task.id);
      if (!fs.existsSync(file)) return `- \`${task.id}\`：待领取。`;
      const execution = readJson(file);
      return `- \`${task.id}\` · ${execution.status}：${execution.summary ?? "尚未填写结果摘要"}；改动：${(execution.changedFiles ?? []).join("、") || "none"}。`;
    });
    markdown = syncBlock(
      markdown,
      DELIVERY_REPORT_MARKERS.outcomes,
      outcomes.join("\n") || "- 尚未登记任务执行结果。",
    );
    fs.writeFileSync(implementationFile, markdown);
  }

  const verificationFile = path.join(run.dir, "verification.md");
  const integrationFile = path.join(run.dir, "integration.json");
  if (fs.existsSync(verificationFile)) {
    let markdown = fs.readFileSync(verificationFile, "utf8");
    const mockEvidence = apiMockEvidence(run).evidence;
    markdown = syncBlock(
      markdown,
      DELIVERY_REPORT_MARKERS.apiMock,
      mockEvidence.length
        ? mockEvidence
            .map(
              (item) =>
                `- 任务 ${item.taskId} · ${item.method} ${item.endpoint} · HTTP ${item.httpStatus} · 截图 \`${item.screenshot}\` · 复现：${item.action}`,
            )
            .join("\n")
        : "- 尚未登记接口 Mock 实际响应截图。",
    );
    const miniappShots = miniappEvidence(run).evidence;
    markdown = syncBlock(
      markdown,
      DELIVERY_REPORT_MARKERS.miniapp,
      miniappShots.length
        ? miniappShots
            .map(
              (item) =>
                `- 任务 ${item.taskId} · 微信开发者工具 ${item.screenshotTool} · 页面 ${item.page} · 选择器 ${item.selector} · 截图 \`${item.screenshot}\` · 复现：${item.action} · console：${item.consoleResult} · network：${item.networkResult}`,
            )
            .join("\n")
        : "- 尚未登记微信开发者工具模拟器截图。",
    );
    const pairs = validationScreenshotPairs(run).pairs;
    markdown = syncBlock(
      markdown,
      DELIVERY_REPORT_MARKERS.visualPairs,
      pairs.length
        ? pairs
            .map((pair) => {
              const reference = pair.screenshots?.find(
                (shot) => shot.role === "reference",
              );
              const result = pair.screenshots?.find(
                (shot) => shot.role === "result",
              );
              return `- 状态 ${pair.state} · 参考图（${reference?.sourceSystem?.label ?? "来源待补"}） \`${reference?.path ?? "—"}\` · 结果图（${result?.sourceSystem?.label ?? "来源待补"}） \`${result?.path ?? "—"}\` · 复现：${pair.action}`;
            })
            .join("\n")
        : "- 尚未归档固定的原型参考图 / ui-client 结果图截图对。",
    );
    const additional = additionalScreenshots(run).screenshots;
    markdown = syncBlock(
      markdown,
      DELIVERY_REPORT_MARKERS.additionalScreenshots,
      additional.length
        ? additional
            .map(
              (item) =>
                `- 状态 ${item.state} · 截图 \`${item.screenshot}\` · 原因：${item.reason} · 复现：${item.action}`,
            )
            .join("\n")
        : "- 无；固定验证截图对及各专项取证已独立归档。",
    );
    const reviews = visualRegionReviews(run).reviews;
    markdown = syncBlock(
      markdown,
      DELIVERY_REPORT_MARKERS.visual,
      reviews.length
        ? reviews
            .map((item) => {
              const regions = item.regions ?? [];
              const summary = regions
                .map((region) => `${region.id}:${region.status}`)
                .join("，");
              const excluded = (item.excludedRegions ?? [])
                .map((region) => region.id)
                .join("、");
              return `- ${item.status} · 状态 ${item.state} · 截图对 ${item.pairId} · UI 项目 ${item.uiProject} · 图像分析 ${item.analyzer.provider}/${item.analyzer.model} · 业务区块 ${summary || "—"}${excluded ? ` · 排除区 ${excluded}` : ""} · 复现：${item.action}`;
            })
            .join("\n")
        : "- 尚未执行原型/UI 逐区识别审查。",
    );
    const stageArtifacts = (input?.stages ?? []).flatMap((stage) =>
      (stage.artifacts ?? []).map(
        (artifact) =>
          `- ${stage.title}（\`${stage.id}\`）· ${artifact.kind} · \`${artifact.file}\` · ${artifact.caption}`,
      ),
    );
    markdown = syncBlock(
      markdown,
      DELIVERY_REPORT_MARKERS.stageArtifacts,
      stageArtifacts.join("\n") ||
        "- 尚无阶段产物登记；技术方案数据流转 SVG 与端到端截图须在对应阶段用 delivery stage-artifact 登记。",
    );
    const runFeatureRisks = fs.existsSync(featureMapFile())
      ? (readJson(featureMapFile()).features ?? []).flatMap((feature) =>
          (feature.risks ?? [])
            .filter((risk) => risk.source?.runId === run.id)
            .map(
              (risk) =>
                `- ${feature.id} · [${risk.status ?? "open"}] \`${risk.id}\`：${risk.text}（来源 ${risk.source?.stageId ?? "—"}／任务 ${risk.source?.taskId ?? "—"}${risk.status === "resolved" ? ` · 已关闭${risk.resolution ? `：${risk.resolution}` : ""}` : ""}）`,
            ),
        )
      : [];
    markdown = syncBlock(
      markdown,
      DELIVERY_REPORT_MARKERS.featureRisks,
      runFeatureRisks.join("\n") ||
        "- 本运行没有登记到功能点的风险/下一步条目。",
    );
    if (fs.existsSync(integrationFile)) {
      const integration = readJson(integrationFile);
      markdown = syncBlock(
        markdown,
        DELIVERY_REPORT_MARKERS.integration,
        [
          `- 状态：${integration.status}`,
          `- 命令：${integration.commands}`,
          `- 结论：${integration.summary}`,
          `- 时间：${integration.verifiedAt}`,
        ].join("\n"),
      );
    }
    fs.writeFileSync(verificationFile, markdown);
  }
}

export function deliveryReportProblems(run) {
  if (run.type !== "delivery") return [];
  const problems = [];
  const generic = isGenericDelivery(deliveryInput(run));
  for (const requirement of (generic ? GENERIC_DELIVERY_CONTRACT : DELIVERY_CONTRACT).reportFiles) {
    const file = path.join(run.dir, requirement.file);
    if (!fs.existsSync(file)) {
      problems.push(`${requirement.label}缺少 ${requirement.file}`);
      continue;
    }
    const markdown = fs.readFileSync(file, "utf8");
    if (generic && requirement.sections.length === 0) {
      const body = markdown.replace(/<!--[^]*?-->/g, "").replace(/^#+.*$/gm, "").trim();
      if (!body) problems.push(`${requirement.label}尚未记录内容`);
    }
    for (const section of requirement.sections) {
      const content = reportSection(markdown, section);
      if (!content) problems.push(`${requirement.label}缺少“${section}”章节`);
      else if (!generic && !meaningfulReportText(content))
        problems.push(`${requirement.label}的“${section}”仍是模板或内容不足`);
    }
  }
  const plan = ensureWorkPlan(run);
  const planMarkdownFile = path.join(run.dir, "plan.md");
  if (fs.existsSync(planMarkdownFile)) {
    const markdown = fs.readFileSync(planMarkdownFile, "utf8");
    for (const task of plan.tasks) {
      if (!markdown.includes(`\`${task.id}\``))
        problems.push(`开发计划 Todo 未同步任务 ${task.id}`);
    }
  }
  const input = deliveryInput(run);
  const acceptance = stageRecord(input, "end_to_end_acceptance");
  if (["confirmed", "done"].includes(acceptance?.status)) {
    const screenshotDirectory = path.join(run.dir, "screenshots");
    const screenshots = fs.existsSync(screenshotDirectory)
      ? fs
          .readdirSync(screenshotDirectory, { recursive: true })
          .filter((file) => /\.(png|jpe?g|webp)$/i.test(file))
      : [];
    const verification = fs.existsSync(path.join(run.dir, "verification.md"))
      ? fs.readFileSync(path.join(run.dir, "verification.md"), "utf8")
      : "";
    if (!screenshots.length) problems.push("全链路验收缺少归档的 E2E 截图");
    else if (
      !screenshots.some((file) => verification.includes(`screenshots/${file}`))
    )
      problems.push("测试与原型回归未引用归档的 E2E 截图");
    problems.push(...visualRegionReviewProblems(run));
  }
  return problems;
}

export function deliveryStages() {
  return DELIVERY_STAGES.map((stage) => ({
    ...stage,
    status: "pending",
    summary: null,
    updatedAt: null,
  }));
}

export function createDeliveryRun({ title, prototypeRun, input }) {
  const id = `${timestamp()}-${slug(title)}`;
  const dir = runDir("delivery", id);
  const createdAt = now();
  if (input.deliveryProcess && input.source !== "feature-map")
    fail("--process 目前只支持 --source feature-map 的功能点交付。");
  const requestedProcess = input.deliveryProcess
    ? parseDeliveryProcessSpecifier(input.deliveryProcess)
    : input.source === "feature-map"
      ? { id: "miniapp-product", version: 3 }
      : null;
  const deliveryProcess = requestedProcess
    ? loadDeliveryProcess(requestedProcess)
    : null;
  const deliveryContract = deliveryProcess
    ? MINIAPP_DELIVERY_CONTRACT
    : GENERIC_DELIVERY_CONTRACT;
  const run = {
    schemaVersion: 1,
    id,
    type: "delivery",
    title,
    scope: null,
    status: "in_progress",
    prototypeRun,
    deliveryInput: {
      file: "delivery-input.json",
      source: input.source,
      intensity: input.intensity,
      featureIds: input.features.map((feature) => feature.id),
      createdAt,
    },
    createdAt,
    updatedAt: createdAt,
    notes: [],
  };
  writeJson(path.join(dir, "run.json"), run);
  const carriedRisks =
    input.source === "feature-map"
      ? openFeatureRisks(input.features.map((feature) => feature.id))
      : [];
  const featureAcceptanceCases =
    input.source === "feature-map"
      ? freezeFeatureAcceptanceCases(
          process.cwd(),
          input.features.map((feature) => feature.id),
        )
      : {};
  writeJson(path.join(dir, "delivery-input.json"), {
    schemaVersion: 1,
    deliveryContract: {
      id: deliveryContract.id,
      version: deliveryContract.version,
    },
    deliveryProcess: deliveryProcess
      ? {
          id: deliveryProcess.id,
          version: deliveryProcess.version,
          sha256: deliveryProcess.sha256,
        }
      : null,
    runId: id,
    source: input.source,
    intensity: input.intensity,
    prototypeRun,
    taskDescription: input.taskDescription,
    featureInputs: input.features,
    featureAcceptanceCases,
    carriedRisks,
    extraction: input.extraction ?? null,
    stages: stagedDeliveryStages(deliveryProcess ?? deliveryContract),
    createdAt,
    updatedAt: createdAt,
  });
  writeIfMissing(
    path.join(dir, "plan.md"),
    `# ${title} · 开发计划\n\n## 开发任务输入\n\n- 来源：${input.source === "prototype" ? "从长期原型真源自动提取" : input.source === "feature-map" ? "从功能演进地图提取" : "手工输入"}\n- 开发强度：${input.intensity}\n- 功能块：${input.features.map((feature) => feature.id).join("、") || "待分析"}\n- 任务要求：${input.taskDescription || title}\n- 详细输入见 \`delivery-input.json\`。\n\n## 并发任务\n\n<!-- mf-dev-flow:task-todo:start -->\n- [ ] 尚未登记实施任务。\n<!-- mf-dev-flow:task-todo:end -->\n`,
  );
  writeIfMissing(
    path.join(dir, "implementation.md"),
    `# ${title} · 实时记录\n\n<!-- 内容与格式由任务类型声明。执行时持续记录实际进展。 -->\n`,
  );
  writeIfMissing(
    path.join(dir, "verification.md"),
    `# ${title} · 测试与回归\n\n<!-- 内容与格式由任务类型声明。记录实际验证结果，未执行时说明原因。 -->\n`,
  );
  const resolved = { type: "delivery", id, dir, run };
  ensureWorkPlan(resolved);
  writeJson(currentFile(), {
    schemaVersion: 1,
    active: { type: "delivery", id },
    updatedAt: now(),
  });
  rebuildExecutionIndex();
  syncDeliveryReports(resolved);
  return id;
}

export function deliveryStageClosureProblems(run) {
  if (run.type !== "delivery") return [];
  const input = deliveryInput(run);
  if (!input) return [];
  const problems = [];
  for (const stage of input.stages ?? []) {
    const complete = DELIVERY_STAGE_CLOSED_STATUSES.has(stage.status);
    if (!complete)
      problems.push(`开发阶段未闭环：${stage.id}（${stage.status}）`);
    if (
      stage.status === "not_applicable" &&
      !String(stage.summary ?? "").trim()
    )
      problems.push(`开发阶段标记不适用时必须说明原因：${stage.id}`);
  }
  return problems;
}

export function fullPrototypeProblems(run) {
  if (run.type !== "prototype" || run.run.scope !== "full") return [];
  const file = path.join(run.dir, "coverage.json");
  if (!fs.existsSync(file)) return ["全量原型运行缺少 coverage.json"];
  let coverage;
  try {
    coverage = readJson(file);
  } catch {
    return ["coverage.json 不是有效 JSON"];
  }
  const mapProblems = prototypeMapProblems({ workspaceRoot: process.cwd(), runDirectory: run.dir, run: run.run, coverage });
  if (mapProblems.length) return mapProblems;
  const sourceEntries = coverage.sourceInventory?.entries;
  const records = coverage.coverage;
  const sourceFiles = coverage.sourceInventory?.sourceFiles;
  const traversal = coverage.traversal;
  const interactionInventory = coverage.sourceInteractionInventory;
  if (!Array.isArray(sourceEntries) || !sourceEntries.length)
    return ["全量原型运行尚未登记 sourceInventory.entries"];
  if (!Array.isArray(records) || !records.length)
    return ["全量原型运行尚未登记 coverage"];
  if (coverage.sourceInventory?.completeness !== "verified")
    return [
      "全量原型运行未确认入口枚举完整性（sourceInventory.completeness 必须为 verified）",
    ];
  if (!Array.isArray(sourceFiles) || !sourceFiles.length)
    return ["全量原型运行缺少原型源文件指纹（sourceInventory.sourceFiles）"];
  if (traversal?.status !== "converged")
    return [
      "全量原型运行未记录状态图遍历收敛（traversal.status 必须为 converged）",
    ];
  if (
    Array.isArray(traversal?.remainingEntryIds) &&
    traversal.remainingEntryIds.length
  )
    return [
      `全量原型运行仍有待遍历入口：${traversal.remainingEntryIds.join("、")}`,
    ];
  if (!interactionInventory || typeof interactionInventory !== "object")
    return [
      "全量原型运行缺少 sourceInteractionInventory（必须先枚举源码状态与交互）",
    ];
  if (interactionInventory.completeness !== "verified")
    return [
      "全量原型运行未确认源码交互清单完整性（sourceInteractionInventory.completeness 必须为 verified）",
    ];
  if (interactionInventory.status !== "converged")
    return [
      "全量原型运行未记录源码状态/交互遍历收敛（sourceInteractionInventory.status 必须为 converged）",
    ];
  if (
    !Array.isArray(interactionInventory.controls) ||
    !interactionInventory.controls.length
  )
    return ["全量原型运行尚未登记 sourceInteractionInventory.controls"];
  if (
    !Array.isArray(interactionInventory.stateVectors) ||
    !interactionInventory.stateVectors.length
  )
    return ["全量原型运行尚未登记 sourceInteractionInventory.stateVectors"];
  if (
    Array.isArray(interactionInventory.remainingControlIds) &&
    interactionInventory.remainingControlIds.length
  )
    return [
      `全量原型运行仍有待遍历源码交互：${interactionInventory.remainingControlIds.join("、")}`,
    ];
  const sourceProblems = [];
  for (const sourceFile of sourceFiles) {
    if (!sourceFile?.path || !sourceFile?.sha256) {
      sourceProblems.push("原型源文件指纹缺少 path 或 sha256");
      continue;
    }
    const file = path.resolve(process.cwd(), sourceFile.path);
    if (!fs.existsSync(file)) {
      sourceProblems.push(`原型源文件不存在：${sourceFile.path}`);
      continue;
    }
    const actual = crypto
      .createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex");
    if (actual !== sourceFile.sha256)
      sourceProblems.push(`原型源文件已变化：${sourceFile.path}；必须重新分析`);
  }
  if (sourceProblems.length) return sourceProblems;
  const interactionProblems = [];
  const interactionIds = new Set();
  for (const control of interactionInventory.controls) {
    if (!control?.id || interactionIds.has(control.id)) {
      interactionProblems.push(
        "sourceInteractionInventory.controls 存在重复或空 ID",
      );
      continue;
    }
    interactionIds.add(control.id);
    if (!control.source)
      interactionProblems.push(`源码交互缺少来源定位：${control.id}`);
    if (!Array.isArray(control.states) || !control.states.length)
      interactionProblems.push(`源码交互缺少状态/分支：${control.id}`);
    if (control.status !== "covered")
      interactionProblems.push(`源码交互未真实覆盖：${control.id}`);
    if (!control.evidence?.some((evidence) => evidence?.level === "observed"))
      interactionProblems.push(`源码交互缺少 observed 证据：${control.id}`);
    for (const evidence of control.evidence ?? []) {
      if (evidence?.level !== "observed") continue;
      const evidenceFile =
        evidence.path && path.resolve(run.dir, evidence.path);
      if (
        !evidenceFile ||
        !evidenceFile.startsWith(`${run.dir}${path.sep}`) ||
        !fs.existsSync(evidenceFile)
      )
        interactionProblems.push(
          `源码交互 observed 证据文件不存在：${control.id} / ${evidence.path || "未填路径"}`,
        );
    }
  }
  const vectorIds = new Set();
  for (const vector of interactionInventory.stateVectors) {
    if (!vector?.id || vectorIds.has(vector.id)) {
      interactionProblems.push(
        "sourceInteractionInventory.stateVectors 存在重复或空 ID",
      );
      continue;
    }
    vectorIds.add(vector.id);
    if (!vector.values || typeof vector.values !== "object")
      interactionProblems.push(`状态向量缺少 values：${vector.id}`);
    if (!vector.evidence?.some((evidence) => evidence?.level === "observed"))
      interactionProblems.push(`状态向量缺少 observed 证据：${vector.id}`);
    for (const evidence of vector.evidence ?? []) {
      if (evidence?.level !== "observed") continue;
      const evidenceFile =
        evidence.path && path.resolve(run.dir, evidence.path);
      if (
        !evidenceFile ||
        !evidenceFile.startsWith(`${run.dir}${path.sep}`) ||
        !fs.existsSync(evidenceFile)
      )
        interactionProblems.push(
          `状态向量 observed 证据文件不存在：${vector.id} / ${evidence.path || "未填路径"}`,
        );
    }
  }
  if (interactionProblems.length) return interactionProblems;
  const sourceIds = new Set(
    sourceEntries.map((entry) => entry?.id).filter(Boolean),
  );
  const recordIds = new Set(records.map((entry) => entry?.id).filter(Boolean));
  const problems = [];
  if (sourceIds.size !== sourceEntries.length)
    problems.push("sourceInventory.entries 存在重复或空 ID");
  if (recordIds.size !== records.length)
    problems.push("coverage 存在重复或空 ID");
  for (const id of sourceIds) {
    const record = records.find((entry) => entry.id === id);
    if (!record) {
      problems.push(`入口未覆盖：${id}`);
      continue;
    }
    if (record.status !== "covered")
      problems.push(`入口未真实覆盖：${id}（${record.status || "未填状态"}）`);
    if (!Array.isArray(record.evidence) || !record.evidence.length)
      problems.push(`入口缺少证据：${id}`);
    if (!record.evidence?.some((evidence) => evidence?.level === "observed"))
      problems.push(`入口缺少 observed 证据：${id}`);
    for (const evidence of record.evidence ?? []) {
      if (evidence?.level !== "observed") continue;
      if (!evidence.path) {
        problems.push(`observed 证据缺少截图路径：${id}`);
        continue;
      }
      const file = path.resolve(run.dir, evidence.path);
      if (!file.startsWith(`${run.dir}${path.sep}`) || !fs.existsSync(file))
        problems.push(`observed 证据文件不存在：${id} / ${evidence.path}`);
    }
  }
  for (const id of recordIds) {
    if (!sourceIds.has(id)) problems.push(`coverage 出现未登记入口：${id}`);
  }
  return problems;
}

/** 聚合非阻塞审计提醒；ZCode/旁路写入可能未登记，最终由主 agent 复核。 */
export function mergeAuditReminders(run) {
  const reminders = [];
  const paths = (value) =>
    Array.isArray(value)
      ? value.filter((item) => typeof item === "string" && item).sort()
      : [];
  for (const task of ensureWorkPlan(run).tasks) {
    const file = executionFile(run, task.id);
    if (!fs.existsSync(file)) continue;
    const execution = readJson(file);
    if (execution.status === "skipped") continue;
    const data = execution.processData ?? {};
    if (data.hookHealth === "degraded")
      reminders.push(`${task.id}：hook 观测降级，写入登记可能不完整`);
    const hookUndeclared = paths(data.undeclared);
    if (hookUndeclared.length)
      reminders.push(
        `${task.id}：hook 观测到未声明改动：${hookUndeclared.join("、")}`,
      );
    const hookUnobserved = paths(data.unobserved);
    if (hookUnobserved.length)
      reminders.push(
        `${task.id}：声明文件未被 hook 观测：${hookUnobserved.join("、")}`,
      );
    const gitUndeclared = paths(data.gitUndeclared);
    if (gitUndeclared.length)
      reminders.push(
        `${task.id}：git 审计发现未声明改动：${gitUndeclared.join("、")}`,
      );
    const gitUnobserved = paths(data.gitUnobserved);
    if (gitUnobserved.length)
      reminders.push(
        `${task.id}：声明文件未被 git 审计观测：${gitUnobserved.join("、")}`,
      );
    const gitReverted = paths(data.gitReverted);
    if (gitReverted.length)
      reminders.push(
        `${task.id}：git 审计发现 claim 基线文件被回退或丢失：${gitReverted.join("、")}`,
      );
const scopeWarnings = paths(execution.scopeWarnings);
    if (scopeWarnings.length)
      reminders.push(
        `${task.id}：声明改动超出运行写入范围：${execution.scopeWarnings.join("、")}`,
      );
  }
  // 未确认的跨运行触碰：全局触碰台账里本运行产生、与另一运行声明范围重叠且尚未
  // 被 work conflict-resolve 确认的条目。只做审计提醒，绝不进 mergeProblems。
  // 台账读取必须防御式：缺文件或坏 JSON 一律视为无提醒，绝不能因此抛错。
  const seenCrossRunFiles = new Set();
  let touchLedger = null;
  try {
    const touchLedgerFile = path.join(STORE, "file-touches.json");
    if (fs.existsSync(touchLedgerFile)) touchLedger = readJson(touchLedgerFile);
  } catch {
    touchLedger = null;
  }
  for (const touch of touchLedger?.touches ?? []) {
    if (touch?.runId !== run.id) continue;
    if (!Array.isArray(touch.observations)) continue;
    if (!touch.observations.includes("cross-run-scope")) continue;
    if (touch.confirmedAt) continue;
    // 同一文件可能被多次触碰；消息不含触碰 id，按文件去重避免重复刷屏。
    if (seenCrossRunFiles.has(touch.file)) continue;
    seenCrossRunFiles.add(touch.file);
    reminders.push(
      `未确认的跨运行触碰：${touch.file}（运行 ${touch.runId} 与另一运行声明范围重叠，需 work conflict-resolve 确认）`,
    );
  }
  // Source-soft binding reminders (manual / prototype runs) collected during
  // the most recent mergeProblems call.
  const bindingReminders = mergeProblems.bindingReminders ?? [];
  mergeProblems.bindingReminders = [];
  for (const reminder of bindingReminders) reminders.push(reminder);
  return reminders;
}

// A completed task may be correct at `work finish` and then be erased by a
// shared-worktree stash/reset before final verification. Only a return to the
// pre-claim commit content (or a vanished finished file) is a regression;
// later integration content is intentionally allowed to differ.
function gitBlobValue(value) {
  return value === null || typeof value === "string";
}

export function postFinishGitRegressionProblems(run) {
  const root = process.cwd();
  if (!gitValue(root, ["rev-parse", "HEAD"])) return [];
  const problems = [];
  for (const task of ensureWorkPlan(run).tasks) {
    const file = executionFile(run, task.id);
    if (!fs.existsSync(file)) continue;
    const execution = readJson(file);
    if (execution.status !== "done") continue;
    const snapshots = execution.processData?.gitFinishFiles;
    if (!Array.isArray(snapshots)) continue;
    for (const snapshot of snapshots) {
      if (
        !snapshot?.file ||
        !gitBlobValue(snapshot.baseBlob) ||
        !gitBlobValue(snapshot.finishBlob) ||
        (snapshot.claimBlob !== undefined && typeof snapshot.claimBlob !== "string")
      )
        continue;
      const absolute = path.resolve(root, snapshot.file);
      const exists = fs.existsSync(absolute);
      const currentBlob = exists ? gitWorktreeBlob(root, snapshot.file) : null;
      // Do not call a Git/hash failure a code regression. The snapshot only
      // reaches here from a successful finish audit, so this is exceptional.
      if (exists && currentBlob === null) continue;
      const disappeared = snapshot.finishBlob !== null && !exists;
      const reverted =
        exists &&
        currentBlob !== snapshot.finishBlob &&
        (currentBlob === snapshot.baseBlob || currentBlob === snapshot.claimBlob);
      if (!disappeared && !reverted) continue;
      problems.push(
        `${task.id}：gitPostFinishReverted：已完成任务文件在 finish 后被回退或丢失：${snapshot.file}`,
      );
    }
  }
  return problems;
}

export function mergeProblems(run) {
  const plan = ensureWorkPlan(run);
  const problems = [];
  if (!plan.tasks.length) problems.push("尚未登记并行任务");
  for (const task of plan.tasks) {
    // Superseded tasks retain their old evidence without blocking replacement work.
    const prior = fs.existsSync(executionFile(run, task.id)) ? readJson(executionFile(run, task.id)) : null;
    if (prior?.status !== "skipped") problems.push(...taskPrototypeProblems(run, task));
    const file = executionFile(run, task.id);
    if (!fs.existsSync(file)) {
      problems.push(`任务未领取：${task.id}`);
      continue;
    }
    const execution = readJson(file);
    if (!executionIsFinalTerminal(task, execution))
      problems.push(
        continuousTaskHasOpenStages(task, execution)
          ? `连续任务尚有未完成阶段：${task.id}`
          : `任务未结束：${task.id}（${execution.status}）`,
      );
    if (execution.status === "done") problems.push(...taskTypeProblems(task, execution.typeAcceptance, reference => readableRunEvidence(run.dir, reference)).map(problem => `${task.id}：${problem}`));
    if (execution.status === "blocked") problems.push(`任务受阻：${task.id}`);
  }
  problems.push(...postFinishGitRegressionProblems(run));
  if (run.type === "delivery") {
    const input = deliveryInput(run);
    const selectedFeatureIds = (input?.featureInputs ?? []).map(
      (feature) => feature.id,
    );
    const source = input?.source ?? null;
    const useSoftBinding = FEATURE_BINDING_SOFT_SOURCES.has(source);
    for (const featureId of selectedFeatureIds) {
      if (
        !plan.tasks.some(
          (task) =>
            task.scope === "product" &&
            taskLeafFeatureIds(run, task).includes(featureId),
        )
      ) {
        const message = `叶子功能缺少独立产品任务：${featureId}`;
        if (useSoftBinding) {
          if (!mergeProblems.bindingReminders) mergeProblems.bindingReminders = [];
          mergeProblems.bindingReminders.push(message);
        } else {
          problems.push(message);
        }
      }
    }
    const conflicts = readFileLeases(run).conflicts.filter(
      (conflict) => conflict.status === "open",
    );
    for (const conflict of conflicts) {
      problems.push(
        `未决文件冲突：${conflict.id}（${conflict.waitingTaskId} 等待 ${conflict.ownerTaskId} / ${conflict.file}）`,
      );
    }
  }
  return problems;
}

// Reset between invocations so the module-level accumulator never leaks
// across CLI calls within the same process.
mergeProblems.bindingReminders = [];
