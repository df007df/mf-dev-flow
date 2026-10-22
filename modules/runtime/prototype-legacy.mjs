// Flow module extracted from the existing runtime; shared gates retain one implementation.

import fs from "node:fs";

import path from "node:path";

import { prototypeGroupDocument, PROTOTYPE_SUPPLEMENT_SECTION } from "../../dashboard/server/prototype-groups.js";

import {
  prototypeEvidenceDocument,
  prototypeEvidenceFeature,
} from "../../dashboard/server/prototype-evidence.js";

import { prototypeSummary } from "../../dashboard/server/readers/sources.js";

import { createPrototypeMap, prototypeMapProblems } from "../../dashboard/server/prototype-map-audit.js";

import { STORE, coverageCounts, ensureProject, fail, fullPrototypeProblems, listRuns, now, prototypeDir, readJson, required, resolveRun, valueFor, writeIfMissing, writeJson } from './shared.mjs';

export function titleFromMarkdown(file, fallback) {
  const match = textOrEmpty(file).match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

export function textOrEmpty(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function latestPrototypeRun() {
  return listRuns()
    .filter((run) => run.type === "prototype")
    .sort((left, right) =>
      String(right.run.updatedAt).localeCompare(String(left.run.updatedAt)),
    )[0];
}

export function prototypeInit() {
  ensureProject();
  const requestedRun = valueFor("--from-run");
  const run = requestedRun ? resolveRun(requestedRun) : latestPrototypeRun();
  if (!run || run.type !== "prototype")
    fail(
      "找不到可作为原型真源基线的原型运行；使用 --from-run <原型运行ID> 指定。",
    );

  const target = prototypeDir();
  if (fs.existsSync(path.join(target, "task.json")) && !valueFor("--refresh"))
    fail(
      "原型真源已存在；使用 prototype init --refresh --from-run <运行ID> 仅刷新基线索引。",
    );

  const mapProblems = fullPrototypeProblems(run);
  if (mapProblems.length)
    fail(`不能发布长期原型真源，完整性核验未通过：\n- ${mapProblems.join("\n- ")}`);
  const coverage = readJson(path.join(run.dir, "coverage.json"));
  const featureDirectory = path.join(run.dir, "features");
  const featureFiles = fs.existsSync(featureDirectory)
    ? fs
        .readdirSync(featureDirectory)
        .filter((file) => file.endsWith(".md") && file !== "README.md")
        .sort()
    : [];
  const entriesByFeature = new Map();
  for (const entry of coverage.sourceInventory?.entries ?? []) {
    const id = entry.feature || "unclassified";
    if (!entriesByFeature.has(id)) entriesByFeature.set(id, []);
    entriesByFeature.get(id).push(entry);
  }
  const featureIndex = [...entriesByFeature.entries()].map(([id, entries]) => {
    const report = path.join(featureDirectory, `${id}.md`);
    const records = (coverage.coverage ?? []).filter((record) =>
      entries.some((entry) => entry.id === record.id),
    );
    const counts = coverageCounts({ coverage: records });
    return {
      id,
      title: titleFromMarkdown(report, id),
      sourceEntries: entries.map((entry) => entry.id),
      coverage: counts,
      prototypeStatus:
        counts.total && counts.covered === counts.total ? "covered" : "blocked",

      sourceReport: fs.existsSync(report) ? path.relative(STORE, report) : null,
      updatedAt: now(),
    };
  });
  const counts = coverageCounts(coverage);
  const generatedAt = now();
  // Validate report IDs before replacing any canonical files.
  const featureSections = featureFiles
    .map((file) => `\n---\n\n${prototypeGroupDocument(
      textOrEmpty(path.join(featureDirectory, file)).trim(),
      path.basename(file, ".md"),
    )}\n`)
    .join("\n");
  fs.mkdirSync(path.join(target, "executions"), { recursive: true });
  writeJson(path.join(target, "task.json"), {
    schemaVersion: 1,
    id: "prototype-main",
    type: "prototype-analysis",
    title: "完整原型图流程",
    status:
      counts.total && counts.covered === counts.total ? "fresh" : "blocked",
    canonicalRevision: 1,
    source: {
      prototypeRun: run.id,
      prototypeVersion: ensureProject().prototype?.version ?? null,
      scope: run.run.scope,
    },
    updatedAt: generatedAt,
  });
  writeJson(path.join(target, "coverage.json"), {
    ...coverage,
    canonicalTask: "prototype-main",
    sourceRun: run.id,
    updatedAt: generatedAt,
  });
  writeJson(path.join(target, "feature-index.json"), {
    schemaVersion: 1,
    taskId: "prototype-main",
    sourceRun: run.id,
    features: featureIndex,
    updatedAt: generatedAt,
  });
  writeIfMissing(
    path.join(target, "open-questions.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceRun: run.id,
        updatedAt: generatedAt,
        questions: [],
      },
      null,
      2,
    )}\n`,
  );
  writeJson(path.join(target, "executions", `${run.id}.json`), {
    schemaVersion: 1,
    id: run.id,
    kind: "prototype-analysis",
    sourceRun: `prototype-runs/${run.id}`,
    scope: run.run.scope,
    status: run.run.status,
    trigger: "migration-baseline",
    createdAt: run.run.createdAt,
    importedAt: generatedAt,
  });
  const flow = [
    "# 原型图流程",
    "",
    "> 本文只维护原型页面、交互流程、截图证据、覆盖情况与已确认说明。功能点引用这些证据；开发依赖、阶段和验收结果由功能地图与开发运行维护。",
    "",
    "## 当前原型基线",
    "",
    `- 来源运行：\`prototype-runs/${run.id}\``,
    `- 原型版本：${ensureProject().prototype?.version ?? "待确认"}`,
    `- 任务状态：${counts.total && counts.covered === counts.total ? "fresh" : "blocked"}`,
    `- 全量覆盖：${counts.covered}/${counts.total} 已真实覆盖；${counts.total - counts.covered} 项待补证。`,
    `- 更新时间：${generatedAt}`,
    "",

    "## 功能块",
    featureSections || "\n- 当前来源运行尚未建立功能块文档。\n",
    "## 执行历史",
    "",
    `- ${generatedAt} · 从 \`prototype-runs/${run.id}\` 建立长期真源；历史运行未移动或删除。`,
    "",
  ].join("\n");
  fs.writeFileSync(
    path.join(target, "原型图流程.md"),
    prototypeEvidenceDocument(flow),
  );
  console.log(path.join(target, "原型图流程.md"));
}

export function prototypeStatus() {
  ensureProject();
  const target = prototypeDir();
  const task = readJson(path.join(target, "task.json"));
  const coverage = readJson(path.join(target, "coverage.json"));
  const index = readJson(path.join(target, "feature-index.json"));
  const summary = prototypeSummary(STORE);
  const questionProblems = summary.groupProblems;
  if (questionProblems.length)
    fail(
      `待确认问题未通过截图与证据校验：\n- ${questionProblems.join("\n- ")}`,
    );
  const counts = coverageCounts(coverage);
  console.log(`原型真源：${task.title}（${task.status}）`);
  console.log(
    `覆盖：${counts.covered}/${counts.total}；功能块：${index.features?.length ?? 0}`,
  );
  for (const group of summary.groups)
    console.log(
      `分组：${group.id} · ${group.title}；截图 ${group.screenshotCount} 张；待确认 ${group.questions.open} · 已解决 ${group.questions.resolved}${group.unavailableScreenshotCount ? `；${group.unavailableScreenshotCount} 条截图待补齐` : ""}`,
    );
  console.log(`文档：${path.join(target, "原型图流程.md")}`);
}

export function prototypeMapCommand() {
  ensureProject();
  const run = resolveRun(required("--run"));
  if (!run || run.type !== "prototype") fail("必须指定原型运行");
  try {
    const result = createPrototypeMap({ workspaceRoot: process.cwd(), runDirectory: run.dir });
    console.log(`已生成操作前源码地图：${result.candidates} 个候选；尚未操作或验证原型。`);
    for (const file of result.files) console.log(path.join(run.dir, file));
    for (const problem of result.problems) console.log(`待核验：${problem}`);
  } catch (error) { fail(error.message); }
}

export function prototypeAuditCommand() {
  ensureProject();
  const run = resolveRun(required("--run"));
  if (!run || run.type !== "prototype" || run.run.scope !== "full") fail("完整性对账必须指定 full 原型运行；不会自动扩大局部范围");
  const problems = fullPrototypeProblems(run);
  if (problems.length) fail(`原型完整性对账未通过（${problems.length} 项）：\n- ${problems.join("\n- ")}`);
  console.log("原型源码候选、页面、交互分支、状态组合与运行态记录对账通过；未修改运行或长期真源。语义与排除依据仍需 Agent 复核。");
}

export function prototypeSyncTasks() {
  ensureProject();
  console.log(
    "prototype sync-tasks 已停用：开发状态只维护在功能地图与开发运行；原型真源不再同步任务、依赖或阶段。",
  );
}
