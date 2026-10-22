import fs from "node:fs";
import path from "node:path";
import { json, text, filesUnder, runDirectory } from "./archive.js";
import {
  DELIVERY_STAGE_CLOSED_STATUSES,
  DELIVERY_STAGES,
  VISUAL_VALIDATION_EVIDENCE,
} from "../delivery-contract.js";
import { objectRefOrNull } from "../../../modules/kernel/object-ref.mjs";
const FEATURE_STAGES = DELIVERY_STAGES;
const CLOSED_STAGE_STATUSES = DELIVERY_STAGE_CLOSED_STATUSES;
const FEATURE_STAGE_TITLES = new Map(
  FEATURE_STAGES.map((stage) => [stage.id, stage.title]),
);

export function featureIsImplemented(feature) {
  return ["completed", "done", "完成"].includes(
    String(feature.implementationStatus || "").toLowerCase(),
  );
}

function stageEvent(events, stageId) {
  return events.find(
    (event) =>
      event.stage?.id === stageId &&
      ["confirmed", "done"].includes(event.stage?.status),
  );
}

export function featureStages(feature, history = []) {
  const terminal =
    feature.status === "done"
      ? "confirmed"
      : feature.status === "park"
        ? "not_applicable"
        : "pending";
  return Object.fromEntries(
    (feature.stageDefinitions ?? FEATURE_STAGES).map((stage) => {
      const current = {
        status: terminal,
        summary: null,
        updatedAt: null,
        ...(feature.stages?.[stage.id] ?? {}),
      };
      // “不适用”只表示最新一次运行没有改动这个阶段，不应抹掉该功能
      // 已完成的同阶段证据。功能卡片展示的是跨运行汇总，运行详情仍保留
      // 每次运行自身的原始阶段结论。
      const confirmed =
        current.status === "not_applicable" ? stageEvent(history, stage.id) : null;
      return [
        stage.id,
        confirmed
          ? {
              ...current,
              status: confirmed.stage.status,
              summary: confirmed.stage.summary ?? current.summary,
              updatedAt: confirmed.at ?? current.updatedAt,
              evidenceSource: {
                runId: confirmed.runId,
                taskId: confirmed.taskId,
                note: "后续运行未改动此阶段；保留此前已确认的证据。",
              },
              latestRunNote: current.summary ?? null,
            }
          : current,
      ];
    }),
  );
}

export function featureStageEvidence(store, stageId, stage) {
  if (stageId !== "api_mock" || !stage.evidenceSource?.runId || !stage.evidenceSource?.taskId)
    return [];
  const runId = stage.evidenceSource.runId;
  const taskId = stage.evidenceSource.taskId;
  const directory = path.join(store, "delivery-runs", runId);
  const evidence = json(path.join(directory, "api-mock-screenshots.json"), {
    evidence: [],
  });
  return (evidence.evidence ?? []).flatMap((item) => {
    if (item.taskId !== taskId || typeof item.screenshot !== "string") return [];
    const screenshot = path.resolve(directory, item.screenshot);
    const screenshotsRoot = path.resolve(directory, "screenshots", "api-mock");
    if (
      !screenshot.startsWith(`${screenshotsRoot}${path.sep}`) ||
      !fs.existsSync(screenshot)
    )
      return [];
    return [{
      path: path.relative(store, screenshot),
      label: `${item.method ?? "HTTP"} ${item.endpoint ?? "Mock 响应"} · ${item.httpStatus ?? "—"}`,
      action: item.action ?? "已归档的实际 Mock 响应",
    }];
  });
}

export function featureStageMockContracts(store, stageId, stage) {
  if (stageId !== "api_mock" || !stage.evidenceSource?.runId || !stage.evidenceSource?.taskId)
    return [];
  const directory = path.join(store, "delivery-runs", stage.evidenceSource.runId);
  const evidence = json(path.join(directory, "api-mock-screenshots.json"), {
    evidence: [],
  });
  return (evidence.evidence ?? []).flatMap((item) => {
    if (item.taskId !== stage.evidenceSource.taskId) return [];
    return [{
      method: item.method ?? "HTTP",
      url: item.url ?? null,
      endpoint: item.endpoint ?? null,
      httpStatus: item.httpStatus ?? null,
      responseFile: item.responseFile ?? null,
      fieldDefinitions: Array.isArray(item.fieldDefinitions)
        ? item.fieldDefinitions
        : [],
      response: Object.hasOwn(item, "response") ? item.response : null,
    }];
  });
}

function safeStageScreenshot(store, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const resolved = path.resolve(store, value);
  const relative = path.relative(store, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    return null;
  return fs.existsSync(resolved) ? relative : null;
}

export function featureStageVisualPairs(store, stageId, stage) {
  if (stageId !== "prototype_alignment" || !stage.evidenceSource?.runId || !stage.evidenceSource?.taskId)
    return [];
  const directory = path.join(store, "delivery-runs", stage.evidenceSource.runId);
  const pairs = json(path.join(directory, "validation-screenshot-pairs.json"), {
    pairs: [],
  });
  return (pairs.pairs ?? []).flatMap((pair) => {
    if (pair.taskId !== stage.evidenceSource.taskId) return [];
    const reference = (pair.screenshots ?? []).find((shot) => shot.role === "reference");
    const result = (pair.screenshots ?? []).find((shot) => shot.role === "result");
    const referencePath = safeStageScreenshot(store, reference?.path);
    const resultPath = safeStageScreenshot(store, result?.path);
    if (!referencePath || !resultPath) return [];
    return [{
      id: pair.id ?? `${pair.taskId}-${pair.state ?? "state"}`,
      state: pair.state ?? "未标注状态",
      action: pair.action ?? "复现动作待补充",
      screenshots: [
        { path: referencePath, label: "原型图", action: pair.action },
        { path: resultPath, label: "UI 图", action: pair.action },
      ],
    }];
  });
}

export function featureStageVisualReviews(store, stageId, stage) {
  if (stageId !== "prototype_alignment" || !stage.evidenceSource?.runId || !stage.evidenceSource?.taskId)
    return [];
  const directory = path.join(store, "delivery-runs", stage.evidenceSource.runId);
  const reviews = json(path.join(directory, "visual-region-reviews.json"), {
    reviews: [],
  });
  return (reviews.reviews ?? []).flatMap((review) => {
    if (review.taskId !== stage.evidenceSource.taskId || !review.pairId) return [];
    const differences = (review.regions ?? []).flatMap((region) =>
      (region.checks ?? [])
        .filter((check) => ["failed", "uncertain"].includes(check.status))
        .map((check) => ({
          regionId: region.id,
          kind: check.kind,
          status: check.status,
          detail: check.detail,
        })),
    );
    return [{
      pairId: review.pairId,
      status: review.status ?? "uncertain",
      differences,
      reviewedAt: review.reviewedAt ?? null,
    }];
  });
}

export function taskSummary(tasks) {
  const counts = {
    pending: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
    skipped: 0,
  };
  for (const task of tasks)
    counts[task.status] = (counts[task.status] ?? 0) + 1;
  return counts;
}

export function deliveryStageGate(input, tasks, runStatus) {
  if (!input || !(input.stages ?? []).length) return null;
  const stages = input.stages ?? [];
  const allTasksTerminal =
    tasks.length > 0 &&
    tasks.every((task) =>
      ["done", "blocked", "skipped"].includes(
        task.execution?.status ?? "pending",
      ),
    );
  const blockedStage = stages.find(
    (stage) => stage.status === "blocked" && String(stage.summary ?? "").trim(),
  );
  const terminal = ["done", "skipped", "blocked"].includes(runStatus);
  const problems =
    runStatus === "blocked"
      ? blockedStage
        ? []
        : ["运行已阻塞，但没有标记 blocked 阶段及阻塞说明。"]
      : stages.flatMap((stage) => {
          const title =
            stage.title ?? FEATURE_STAGE_TITLES.get(stage.id) ?? stage.id;
          if (!CLOSED_STAGE_STATUSES.has(stage.status))
            return [`${title} 仍为 ${stage.status ?? "pending"}。`];
          if (
            stage.status === "not_applicable" &&
            !String(stage.summary ?? "").trim()
          )
            return [`${title} 标记不适用但缺少原因。`];
          return [];
        });
  return {
    status: problems.length
      ? "open"
      : runStatus === "blocked"
        ? "blocked"
        : "passed",
    requiresAction: problems.length > 0 && (allTasksTerminal || terminal),
    allTasksTerminal,
    problems,
  };
}

export function developmentRecords(store) {
  const records = [];
  const root = path.join(store, "delivery-runs");
  if (!fs.existsSync(root)) return records;
  const taskLinks = json(path.join(store, "planning", "task-leaf-links.json"), {
    links: [],
  });
  const leafIds = (runId, task) => {
    if (Array.isArray(task.leafFeatureIds))
      return task.scope === "governance" ? [] : task.leafFeatureIds;
    const link = (taskLinks.links ?? []).find(
      (item) => item.runId === runId && item.taskId === task.id,
    );
    return link?.scope === "product" ? (link.leafFeatureIds ?? []) : [];
  };
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    const run = json(path.join(directory, "run.json"));
    const plan = json(path.join(directory, "work-plan.json"), { tasks: [] });
    if (!run) continue;
    const input = json(path.join(directory, "delivery-input.json"));
    const stages = Object.fromEntries(
      (input?.stages ?? []).map((stage) => [stage.id, stage.status]),
    );
    for (const task of plan.tasks ?? []) {
      const execution = json(
        path.join(directory, "executions", `${task.id}.json`),
      );
      for (const featureId of leafIds(run.id, task)) {
        records.push({
          featureId,
          runId: run.id,
          runTitle: run.title,
          runStatus: run.status,
          taskId: task.id,
          taskTitle: task.title,
          phase: task.phase ?? "implementation",
          taskStatus: execution?.status ?? "pending",
          agent: execution?.agent ?? null,
          summary: execution?.summary ?? null,
          updatedAt: execution?.updatedAt ?? task.createdAt ?? run.updatedAt,
          stages,
        });
      }
    }
  }
  return records.sort((left, right) =>
    String(right.updatedAt).localeCompare(String(left.updatedAt)),
  );
}

export function featureHistory(store) {
  const history = json(path.join(store, "planning", "feature-history.json"), {
    events: [],
  });
  return [...(history.events ?? [])].sort((left, right) =>
    String(right.at).localeCompare(String(left.at)),
  );
}

export function runSummary(store, type, id) {
  const directory = runDirectory(store, type, id);
  const run = directory && json(path.join(directory, "run.json"));
  if (!run) return null;
  const plan = json(path.join(directory, "work-plan.json"), { tasks: [] });
  const tasks = plan.tasks.map((task) => {
    const execution = json(
      path.join(directory, "executions", `${task.id}.json`),
    );
    return {
      id: task.id,
      ref: objectRefOrNull("task", `${type}/${id}/${task.id}`),
      title: task.title,
      kind: task.kind,
      scope: task.scope ?? null,
      leafFeatureIds: task.leafFeatureIds ?? [],
      dependsOn: task.dependsOn,
      status: execution?.status ?? "pending",
      agent: execution?.agent ?? null,
      updatedAt: execution?.updatedAt ?? task.createdAt,
    };
  });
  return {
    type,
    id,
    ref: objectRefOrNull("run", `${type}/${id}`),
    title: run.title,
    status: run.status,
    prototypeRun: run.prototypeRun,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    taskCounts: taskSummary(tasks),
    taskTotal: tasks.length,
    verification:
      json(path.join(directory, "integration.json"))?.status ?? null,
  };
}

export function runDetail(store, type, id) {
  const directory = runDirectory(store, type, id);
  const run = directory && json(path.join(directory, "run.json"));
  if (!run) return null;
  const plan = json(path.join(directory, "work-plan.json"), { tasks: [] });
  const documents =
    type === "prototype"
      ? [
          {
            id: "overview",
            title: "概览",
            path: "overview.md",
            content: text(path.join(directory, "overview.md")),
          },
          ...["audit-review.md", "audit-report.md", "report.md"].filter((file) => fs.existsSync(path.join(directory, file))).map((file) => ({
            id: file,
            title: file === "report.md" ? "分析报告" : "审计记录",
            path: file,
            content: text(path.join(directory, file)),
          })),
          ...filesUnder(path.join(directory, "features"))
            .filter(
              (file) =>
                file.endsWith(".md") && path.basename(file) !== "README.md",
            )
            .sort()
            .map((file) => ({
              id: `feature:${path.basename(file, ".md")}`,
              title: `功能块 · ${path.basename(file, ".md")}`,
              path: path.relative(store, file),
              content: text(file),
            })),
        ]
      : type === "system"
        ? [
            {
              id: "overview",
              title: "系统事实",
              path: "overview.md",
              content: text(path.join(directory, "overview.md")),
            },
            {
              id: "impact",
              title: "影响分析",
              path: "impact-analysis.md",
              content: text(path.join(directory, "impact-analysis.md")),
            },
            {
              id: "tasks",
              title: "派生任务",
              path: "tasks.md",
              content: text(path.join(directory, "tasks.md")),
            },
            {
              id: "cards",
              title: fs.existsSync(path.join(directory, "cards.json"))
                ? "系统卡片快照"
                : "来源清单（旧版）",
              path: fs.existsSync(path.join(directory, "cards.json"))
                ? "cards.json"
                : "sources.json",
              content:
                "```json\n" +
                text(
                  fs.existsSync(path.join(directory, "cards.json"))
                    ? path.join(directory, "cards.json")
                    : path.join(directory, "sources.json"),
                ) +
                "\n```",
            },
          ]
        : type === "refinement"
          ? [
              ...(fs.existsSync(path.join(directory, "brief.md"))
                ? [
                    {
                      id: "brief",
                      title: "上下文摘要（默认）",
                      path: "brief.md",
                      content: text(path.join(directory, "brief.md")),
                    },
                  ]
                : []),
              {
                id: "analysis",
                title: "拆解分析",
                path: "analysis.md",
                content: text(path.join(directory, "analysis.md")),
              },
              {
                id: "context",
                title: "原始事实快照（按需）",
                path: "context.json",
                content:
                  "```json\n" +
                  text(path.join(directory, "context.json")) +
                  "\n```",
              },
              {
                id: "proposal",
                title: "功能提案",
                path: "proposal.json",
                content:
                  "```json\n" +
                  text(path.join(directory, "proposal.json")) +
                  "\n```",
              },
              {
                id: "validation",
                title: "应用门禁",
                path: "validation.json",
                content:
                  "```json\n" +
                  text(path.join(directory, "validation.json")) +
                  "\n```",
              },
            ]
          : [
              {
                id: "plan",
                title: "开发计划",
                path: "plan.md",
                content: text(path.join(directory, "plan.md")),
              },
              {
                id: "implementation",
                title: "实时记录",
                path: "implementation.md",
                content: text(path.join(directory, "implementation.md")),
              },
              {
                id: "verification",
                title: "测试与回归",
                path: "verification.md",
                content: text(path.join(directory, "verification.md")),
              },
            ];
  const tasks = plan.tasks.map((task) => ({
    ...task,
    ref: objectRefOrNull("task", `${type}/${id}/${task.id}`),
    execution: json(path.join(directory, "executions", `${task.id}.json`)),
  }));
  const deliveryInput =
    type === "delivery"
      ? json(path.join(directory, "delivery-input.json"))
      : null;
  // manual/prototype 运行把 featureIds 当参考范围，不代表承诺交付；只有
  // feature-map 运行才是按功能点承诺。看板据此标注，避免把参考范围读成承诺。
  const declaredFeatureIds = run.deliveryInput?.featureIds ?? [];
  const referenceScope =
    type === "delivery" && declaredFeatureIds.length
      ? {
          source: run.deliveryInput?.source ?? null,
          featureIds: declaredFeatureIds,
          referenceOnly: ["manual", "prototype"].includes(
            run.deliveryInput?.source,
          ),
          notice:
            ["manual", "prototype"].includes(run.deliveryInput?.source)
              ? "参考范围，未承诺交付：本次运行按任务描述推进，功能 ID 仅作规划参考。"
              : "承诺范围：本次运行按这些功能点做独立交付与验收。",
        }
      : null;
  const screenshots = filesUnder(path.join(directory, "screenshots"))
    .filter((file) =>
      [".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"].includes(
        path.extname(file).toLowerCase(),
      ),
    )
    .sort()
    .map((file) => path.relative(store, file));
  const visualPairs =
    type === "delivery"
      ? (
          json(path.join(directory, "validation-screenshot-pairs.json"), {
            pairs: [],
          }).pairs ?? []
        ).map((pair) => ({
          ...pair,
          screenshots: VISUAL_VALIDATION_EVIDENCE.screenshots.map(
            (definition) => {
              const stored = (pair.screenshots ?? []).find(
                (shot) => shot.role === definition.role,
              );
              const sourceSystem =
                stored?.sourceSystem ??
                (definition.role === "reference"
                  ? {
                      kind: "prototype-run",
                      id: run.prototypeRun,
                      label: `原型运行 · ${run.prototypeRun || "—"}`,
                    }
                  : {
                      kind: "ui-client-project",
                      id: pair.uiProject,
                      label: `ui-client · ${pair.uiProject || "—"}`,
                    });
              return { ...definition, ...stored, sourceSystem };
            },
          ),
        }))
      : [];
  const additionalScreenshots =
    type === "delivery"
      ? (json(path.join(directory, "additional-screenshots.json"), {
          screenshots: [],
        }).screenshots ?? [])
      : screenshots;
  return {
    run: { ...run, ref: objectRefOrNull("run", `${type}/${id}`) },
    documents,
    tasks,
    integration: json(path.join(directory, "integration.json")),
    screenshots,
    visualPairs,
    additionalScreenshots,
    assetBase: type === "prototype" ? path.relative(store, directory) : null,
    deliveryInput,
    referenceScope,
    stageGate:
      type === "delivery"
        ? deliveryStageGate(deliveryInput, tasks, run.status)
        : null,
  };
}
