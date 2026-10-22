// Flow module extracted from the existing runtime; shared gates retain one implementation.

import path from "node:path";
import { isGenericDelivery } from "../delivery/contract.mjs";

import fs from "node:fs";

import { hasPrototypeCatalog, planningPrototype, prototypeArchiveDirectory, prototypeArchiveExists } from "../prototype/client.mjs";

import { prototypeGroupDocument, PROTOTYPE_SUPPLEMENT_SECTION } from "../../dashboard/server/prototype-groups.js";

import { RUN_TYPES, STORE, compactionAudit, compactionIndexFile, continuousTaskHasOpenStages, coverageCounts, createDeliveryRun, csv, currentFile, deliveryInput, deliveryReportProblems, deliveryStageClosureProblems, ensureProject, ensureWorkPlan, evidenceDir, executionFile, fail, featureMapFile, fullPrototypeProblems, mergeProblems, now, prototypeDeliveryCandidates, prototypeDir, readJson, rebuildExecutionIndex, refinementBriefFile, required, resolveRun, runDir, slug, systemCardContextSummary, systemCardProblems, systemCardsFile, systemDir, taskPrototypeProblems, timestamp, tokenEstimate, valueFor, workPlanFile, writeIfMissing, writeJson } from './shared.mjs';

export const STATES = new Set([
  "pending",
  "in_progress",
  "blocked",
  "done",
  "skipped",
]);

export const CONTEXT_DETAIL_SECTIONS = new Set([
  "prototype",
  "planning",
  "development",
  "systems",
  "code-roots",
  "documents",
]);

export const CONTEXT_PAGE_DEFAULT = 5;

export const CONTEXT_PAGE_MAX = 20;

export const CONTEXT_PAGE_BYTES_DEFAULT = 12_000;

export const CONTEXT_PAGE_BYTES_MAX = 32_000;

export function readEvidenceBundle(ref, expectedKind) {
  const target = path.resolve(STORE, ref ?? "");
  const base = `${path.resolve(evidenceDir())}${path.sep}`;
  if (!target.startsWith(base) || !fs.existsSync(target))
    fail(`找不到受控证据索引：${ref ?? "—"}`);
  const bundle = readJson(target);
  if (bundle?.schemaVersion !== 1 || bundle.kind !== expectedKind)
    fail(`证据索引格式或类别不匹配：${ref}`);
  return bundle.value;
}

export function requireType(value) {
  if (!RUN_TYPES.has(value))
    fail("--type 只能是 prototype、delivery、system 或 refinement");
  return value;
}

export function compactAudit() {
  const audit = compactionAudit();
  console.log(
    `功能演进快照：${audit.runs.length} 份；原始文本 ${audit.totalBytes} bytes（约 ${tokenEstimate(audit.totalBytes)} tokens）`,
  );
  console.log(`当前功能地图来源：${audit.sourceRun ?? "未建立"}`);
  console.log(
    `可默认折叠的已完成历史：${audit.superseded.length} 份；原始证据仍保留，不删除。`,
  );
  for (const item of audit.runs) {
    console.log(
      `- ${item.run.id} · ${item.bytes} bytes（约 ${item.tokens} tokens）${item.run.id === audit.sourceRun ? " · 当前来源" : ""}`,
    );
  }
}

export function compactStatus() {
  ensureProject();
  if (!fs.existsSync(compactionIndexFile())) {
    console.log(
      "尚未生成上下文整理索引；先运行 `mf-dev-flow compact build`。可先用 `compact audit` 查看风险。",
    );
    return;
  }
  const index = readJson(compactionIndexFile());
  const current =
    index.runs?.find((run) => run.runId === index.currentRunId) ?? null;
  console.log(
    `上下文整理：${index.runs?.length ?? 0} 份 refinement 快照；生成于 ${index.generatedAt}`,
  );
  console.log(`默认读取：${index.policy?.defaultRead ?? "—"}`);
  console.log(
    `当前来源：${current?.runId ?? "—"}；原始快照 ${current?.rawContextBytes ?? 0} bytes（约 ${current?.estimatedTokens ?? 0} tokens）`,
  );
  console.log(
    `已折叠历史：${(index.runs ?? []).filter((run) => run.supersededBy).length} 份；原始证据未删除。`,
  );
}

export function help() {
  console.log(`用法:
  mf-dev-flow.mjs init --name <项目名> --background <背景> --prototype-kind <类型> --prototype-location <位置> --code-root <目录>
  mf-dev-flow.mjs project add --path <目录> --role <角色> --write-boundary <边界> --check [--start-command <命令>] [--test-command <命令>] [--e2e-command <命令>]
  mf-dev-flow.mjs project check [--root <已登记代码根>] [--start-command <命令>] [--test-command <命令>] [--e2e-command <命令>]
  mf-dev-flow.mjs project status
  mf-dev-flow.mjs current
  mf-dev-flow.mjs prototype init [--from-run <原型运行ID>] [--refresh]
  mf-dev-flow.mjs prototype status
  mf-dev-flow.mjs prototype map --run <原型运行ID>  # 先生成独立源码分母，不操作浏览器
  mf-dev-flow.mjs prototype audit --run <原型运行ID>  # 只读对账，不启动/补扫/回写真源
  mf-dev-flow.mjs prototype sync-tasks
  mf-dev-flow.mjs system update --from-run <系统信息运行ID>
  mf-dev-flow.mjs system dedupe
  mf-dev-flow.mjs system status
  mf-dev-flow.mjs system profile-address --card <系统ID> --environment test|online --address <公开HTTP(S) origin> --evidence <脱敏证据>
  mf-dev-flow.mjs system api-use --card <系统ID> --api <API ID> --consumer <使用方> --purpose <用途> --decision-ref <方案或任务依据> [--usage <使用ID>]
  mf-dev-flow.mjs system api-remove --card <系统ID> --usage <使用ID> --reason <不再使用原因>
  mf-dev-flow.mjs system issue-add --card <系统ID> --id <问题ID> --title <标题> --severity low|medium|high|critical --summary <影响说明> --evidence <逗号列表> [--apis <API ID 列表>]
  mf-dev-flow.mjs system issue-set --card <系统ID> --id <问题ID> --status open|monitoring|resolved --note <状态说明>
  mf-dev-flow.mjs system agreement-add --id <约定ID> --title <标题> --summary <约定内容> --scope <适用范围> --decision-ref <决策依据> --evidence <逗号列表>
  mf-dev-flow.mjs system agreement-set --id <约定ID> --status confirmed|superseded --note <说明> [--decision-ref <新依据>] [--evidence <逗号列表>]
  mf-dev-flow.mjs feature refine [--scope auto] [--title <范围>]
  mf-dev-flow.mjs feature proposal-patch --run <功能拆解运行ID> --from <按组补丁JSON>
  mf-dev-flow.mjs feature status
  mf-dev-flow.mjs feature impact  # 只读列出原型变更与全部受影响子功能，不自动重规划
  mf-dev-flow.mjs feature apply --from-run <功能拆解运行ID>
  mf-dev-flow.mjs feature start --id <叶子功能ID> [--title <范围>] [--process <流程ID>@<版本>]
  mf-dev-flow.mjs feature risk-add --id <叶子功能ID> --text <风险/下一步条目> [--stage <阶段契约 ID>] [--run <运行ID> --task <任务ID>]
  mf-dev-flow.mjs feature risk-resolve --id <叶子功能ID> --risk <风险条目ID> [--note <关闭结论>]
  mf-dev-flow.mjs feature risks --id <叶子功能ID>
  mf-dev-flow.mjs feature link-task --run <开发运行ID> --task <任务ID> --scope product|governance [--leaf-features <子叶功能 ID 列表>] --reason <关联依据>
  mf-dev-flow.mjs compact audit|build|status
  mf-dev-flow.mjs run new --type prototype|delivery|system --title <范围> [--scope partial|full] [--prototype-run <id>]
  mf-dev-flow.mjs delivery start --source prototype --intensity focused|standard|high [--features <功能块 ID 列表>] [--title <范围>]
  mf-dev-flow.mjs delivery start --source feature-map --intensity focused|standard|high [--features <叶子功能 ID 列表>] [--entries <原型入口 ID 列表>] [--title <范围>]
  mf-dev-flow.mjs delivery start --source manual --intensity focused|standard|high --title <范围> --task <任务说明> [--features <功能块 ID 列表>] [--prototype-run <id>]
  mf-dev-flow.mjs delivery stage --run <运行ID> --task <关联任务ID> --stage <阶段契约 ID> --status pending|in_progress|confirmed|blocked|not_applicable|done --summary <结论> [--decision <重大更新决定>] [--risk "<风险/下一步条目>" [--risk ...]]
  mf-dev-flow.mjs delivery stage-artifact --run <运行ID> --task <任务ID> --stage <阶段契约 ID> --kind dataflow_svg|e2e_screenshot|note --file <文件路径> --caption <系统+数据+接口/流程说明>
  mf-dev-flow.mjs delivery supersede --run <运行ID> --reason <为何由新运行取代>
  mf-dev-flow.mjs run context --id <运行ID> [--detail prototype|planning|development|systems|code-roots|documents] [--limit 1-20] [--max-bytes 2048-32000] [--cursor <偏移量>]
    prototype: [--group <原型分组ID>] [--collection features|entries|coverage]
    planning: [--group <业务域ID>] [--feature <叶子功能ID>] [--collection features|groups|migrations|impact]
    development: [--run <开发运行ID>]
    systems: [--card <系统卡片ID>]
    code-roots: [--root <代码根路径> --changes]
  mf-dev-flow.mjs run set --type prototype|delivery|system|refinement --id <id> --status <状态> --note <结论>
  mf-dev-flow.mjs feature new --run <原型运行ID> --id <功能ID> --title <名称> --priority P0|P1|P2|P3
  mf-dev-flow.mjs work plan --run <运行ID> --task <任务ID> --title <名称> --kind <类型> --scope product|governance --writes <逗号列表> [--projects <UI代码根,API代码根>] [--leaf-features <逗号列表>]
  mf-dev-flow.mjs work claim --run <运行ID> --task <任务ID> --agent <agent-id> [--session <Codex会话ID>] [--target-phase <阶段契约 ID>]
  mf-dev-flow.mjs work bind-session --run <运行ID> --task <任务ID> --agent <agent-id> --session <Codex会话ID> [--target-phase <阶段契约 ID>]
  mf-dev-flow.mjs work delivery-brief --run <运行ID> --task <任务ID> [--target-phase <阶段契约 ID>]
  mf-dev-flow.mjs work checkpoint-gate --session <Codex会话ID> --agent <agent类型>
  mf-dev-flow.mjs work lease --for-write --session <Codex会话ID> --file <绝对文件路径> [--ttl-seconds 300]
  mf-dev-flow.mjs work lease --release-session <Codex会话ID>
  mf-dev-flow.mjs work conflict-status --run <运行ID>
  mf-dev-flow.mjs work conflict-resolve --run <运行ID> --conflict <冲突ID> --summary <裁决>
  mf-dev-flow.mjs work replan --run <运行ID> --task <任务ID> --writes <逗号分隔的写入范围> --reason <重排理由>
  mf-dev-flow.mjs work finish --run <运行ID> --task <任务ID> --agent <agent-id> --status done|blocked|skipped --summary <结论> --files <逗号列表> --tests <结果>
  mf-dev-flow.mjs work supersede --run <运行ID> --task <任务ID> --reason <为何由新任务取代>
  mf-dev-flow.mjs work merge-check --run <运行ID>
  mf-dev-flow.mjs work verify --run <运行ID> --status passed|failed|blocked --commands <命令> --summary <结论>
  mf-dev-flow.mjs visual archive --run <运行ID> --task <任务ID> --state <原型状态/入口> --reference <关联原型 screenshots/图> --result <本运行 screenshots/图> --ui-project <ui-client 代码根> --action <复现动作>
  mf-dev-flow.mjs visual archive-additional --run <运行ID> --task <任务ID> --state <额外状态> --screenshot <本运行 screenshots/图> --reason <为何不能由固定截图对说明> --action <复现动作>
  mf-dev-flow.mjs visual compare --run <运行ID> --task <任务ID> --state <原型状态/入口> --prototype <关联原型 screenshots/图> --ui <本运行 screenshots/图> --ui-project <ui-client 代码根> --action <复现动作> --region-report <图像分析逐区报告 JSON>
  mf-dev-flow.mjs api-mock evidence --run <运行ID> --task <任务ID> --screenshot <本运行 screenshots/api-mock/图> --method <HTTP 方法> --url <完整 HTTP(S) Mock URL> --http-status <状态码> --response-file <本运行 screenshots/api-mock/完整响应.json> --action <复现动作>
  mf-dev-flow.mjs miniapp evidence --run <运行ID> --task <任务ID> --screenshot <本运行 screenshots/wechatide/图> --page <页面路径> --selector <断言选择器> --action <复现动作> --console <console结论> --network <network结论>
  mf-dev-flow.mjs work index
  mf-dev-flow.mjs object locate --ref <mf-dev-flow:kind:key> --json
  mf-dev-flow.mjs dashboard
  mf-dev-flow.mjs gate --for-stop [--since <ISO时间>] [--session-files <JSON清单>]
    JSON 清单：{"schemaVersion":1,"files":[{"path":"src/...","observedAt":"<ISO时间>"}]}
  mf-dev-flow.mjs check --type prototype|delivery|system|refinement --id <id>`);
}

export function newRun() {
  ensureProject();
  const type = requireType(required("--type"));
  const title = required("--title");
  if (type === "refinement")
    fail(
      "refinement 运行必须使用 `feature refine --scope auto` 创建，以冻结完整证据快照。",
    );
  const scope = type === "prototype" ? valueFor("--scope") || "partial" : null;
  if (scope && !new Set(["partial", "full"]).has(scope))
    fail("--scope 只能是 partial 或 full");
  const prototypeRun = valueFor("--prototype-run") || null;
  if (type === "delivery" && !prototypeRun)
    fail("开发运行必须用 --prototype-run 关联原型拆解运行。");
  if (
    prototypeRun &&
    !prototypeArchiveExists(STORE, prototypeRun)
  ) {
    fail(`找不到关联的原型运行 prototype/${prototypeRun}`);
  }
  if (type === "delivery") {
    const featureIds = csv("--features");
    const candidates = featureIds.length
      ? prototypeDeliveryCandidates()
      : { features: [] };
    const features = featureIds.length
      ? featureIds.map(
          (id) =>
            candidates.features.find((feature) => feature.id === id) ?? {
              id,
              title: id,
            },
        )
      : [];
    const id = createDeliveryRun({
      title,
      prototypeRun,
      input: {
        source: "manual",
        intensity: valueFor("--intensity") || "standard",
        taskDescription: valueFor("--task") || title,
        features,
        extraction: null,
      },
    });
    return console.log(id);
  }
  const id = `${timestamp()}-${slug(title)}`;
  const dir = runDir(type, id);
  writeJson(path.join(dir, "run.json"), {
    schemaVersion: 1,
    id,
    type,
    title,
    scope,
    status: "in_progress",
    prototypeRun,
    createdAt: now(),
    updatedAt: now(),
    notes: [],
  });
  if (type === "prototype") {
    writeIfMissing(
      path.join(dir, "overview.md"),
      `# ${title}\n\n## 原型来源与版本\n\n- 待填写\n\n## 本次更新范围\n\n- 待填写\n\n## 覆盖入口与功能块\n\n- 待填写\n\n## 观察方法与未观察边界\n\n- 待填写\n\n## 发现的问题与代码差异\n\n- 待填写\n\n## 更新记录\n\n- ${now()} · 创建本次原型拆解运行。\n`,
    );
    writeIfMissing(
      path.join(dir, "features", "README.md"),
      "# 功能块\n\n每个功能块必须使用 `feature new` 创建。\n",
    );
    writeIfMissing(
      path.join(dir, "coverage.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          runId: id,
          scope,
          sourceInventory: {
            method: "待填写：列出原型中已知的页面、弹层、深链入口与状态入口",
            completeness: "unverified",
            capturedAt: null,
            sourceFiles: [],
            entries: [],
          },
          sourceInteractionInventory: {
            method:
              "待填写：从源码枚举事件、状态变量、存储键与模拟/调试控件，再以运行态逐项复核",
            completeness: "unverified",
            status: "not_started",
            sourceFiles: [],
            controls: [],
            stateVectors: [],
            remainingControlIds: [],
            capturedAt: null,
          },
          coverage: [],
          traversal: {
            status: "not_started",
            queueMethod: "待填写：记录已访问集合、待访问队列和无法访问边界",
            remainingEntryIds: [],
            convergedAt: null,
          },
          updatedAt: now(),
        },
        null,
        2,
      )}\n`,
    );
    fs.mkdirSync(path.join(dir, "screenshots"), { recursive: true });
  } else {
    writeIfMissing(
      path.join(dir, "overview.md"),
      `# ${title}\n\n## 信息来源与权限\n\n- 待填写：来源、位置、负责人、版本与访问方式。\n\n## 已确认系统事实\n\n- 待填写；只写有证据的事实。\n\n## 数据访问与安全边界\n\n- 待填写；密钥值不得进入记录。\n\n## 更新记录\n\n- ${now()} · 创建系统信息更新运行。\n`,
    );
    writeJson(path.join(dir, "cards.json"), {
      schemaVersion: 2,
      runId: id,
      cards: [],
      removeCardIds: [],
      updatedAt: now(),
    });
    writeIfMissing(
      path.join(dir, "impact-analysis.md"),
      `# ${title} · 影响分析\n\n## 原型图影响\n\n- 待分析；默认最小改动。\n\n## 系统设计影响\n\n- 待分析。\n\n## 技术方案与代码影响\n\n- 待分析。\n\n## 数据模型与迁移影响\n\n- 待分析。\n\n## 风险、冲突与待确认问题\n\n- 待填写。\n`,
    );
    writeIfMissing(
      path.join(dir, "tasks.md"),
      `# ${title} · 派生任务\n\n| ID | 优先级 | 任务 | 影响区域 | 状态 | 验收证据 |\n| --- | --- | --- | --- | --- | --- |\n| SYS-1 | P1 | 待依据影响分析补充 | 待填写 | pending | 待填写 |\n`,
    );
    fs.mkdirSync(path.join(dir, "evidence"), { recursive: true });
  }
  const run = { type, id, dir, run: readJson(path.join(dir, "run.json")) };
  ensureWorkPlan(run);
  writeJson(currentFile(), {
    schemaVersion: 1,
    active: { type, id },
    updatedAt: now(),
  });
  rebuildExecutionIndex();
  console.log(id);
}

export function deliveryCompletionProblems(run) {
  if (run.type !== "delivery") return [];
  const input = deliveryInput(run);
  if (!input) return [];
  const problems = deliveryStageClosureProblems(run);
  for (const task of ensureWorkPlan(run).tasks) {
    const execution = fs.existsSync(executionFile(run, task.id)) ? readJson(executionFile(run, task.id)) : null;
    if (execution?.status !== "skipped") problems.push(...taskPrototypeProblems(run, task));
  }
  const integrationFile = path.join(run.dir, "integration.json");
  const integration = fs.existsSync(integrationFile)
    ? readJson(integrationFile)
    : null;
  if (integration?.status !== "passed")
    problems.push("开发闭环缺少 work verify --status passed");
  problems.push(...deliveryReportProblems(run));
  return problems;
}

export function deliveryBlockedProblems(run) {
  if (run.type !== "delivery") return [];
  const input = deliveryInput(run);
  // Generic runs record the blocking reason through the required run set --note.
  if (!input || isGenericDelivery(input)) return [];
  const blocked = (input.stages ?? []).find(
    (stage) => stage.status === "blocked" && String(stage.summary ?? "").trim(),
  );
  return blocked
    ? []
    : ["开发运行标记 blocked 前，必须有一个阶段为 blocked 并说明阻塞原因"];
}

export function newFeature() {
  ensureProject();
  const runId = required("--run");
  const id = slug(required("--id"));
  const title = required("--title");
  const priority = required("--priority");
  if (!new Set(["P0", "P1", "P2", "P3"]).has(priority))
    fail("--priority 只能是 P0、P1、P2 或 P3");
  if (!fs.existsSync(path.join(runDir("prototype", runId), "run.json")))
    fail(`找不到原型运行 prototype/${runId}`);
  const file = path.join(runDir("prototype", runId), "features", `${id}.md`);
  if (fs.existsSync(file)) fail(`功能块已存在：${file}`);
  const fence = String.fromCharCode(96).repeat(3);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      `# ${title}`,
      "",
      `- 分组 ID：\`${id}\``,
      "",
      "## 访问流程与重要度",
      "",
      `- 优先级：${priority}`,
      "- 入口与前置条件：待填写",
      "- 主路径：待填写",
      "- 异常/返回路径：待填写",
      "- 优先级理由：待填写",
      "",
      "## 流程图",
      "",
      `${fence}mermaid`,
      "flowchart TD",
      "  A[入口] --> B[待拆解]",
      fence,
      "",
      "## 截图与证据（0 张，待采集）",
      "",
      "| 截图/证据 | 复现动作 | 界面状态 | 等级 |",
      "| --- | --- | --- | --- |",
      "| 待填写 | 待填写 | 待填写 | observed / inferred / unavailable |",
      "",
      "## 功能说明",
      "",
      "- 用户目标：待填写",
      "- 输入与操作：待填写",
      "- 可见结果与状态变化：待填写",
      "- 数据/接口线索：待填写",
      "- 验收条件：待填写",
      `- 更新时间：${now()}`,
      "",
      "## 待确认问题",
      "",
      `- 待核验；问题索引的 featureId 使用分组 ID \`${id}\`，每项记录 open / resolved 状态和截图证据。核对后无问题才写“无”。`,
      "",
      PROTOTYPE_SUPPLEMENT_SECTION,
      "",
      "## 更新记录",
      "",
      `- ${now()} · 创建功能块，待完成访问流程与原型证据梳理。`,
      "",
    ].join("\n"),
  );
  console.log(file);
}

export function setRun() {
  ensureProject();
  const type = requireType(required("--type"));
  const id = required("--id");
  const status = required("--status");
  if (!STATES.has(status)) fail(`未知状态 ${status}`);
  const file = path.join(runDir(type, id), "run.json");
  if (!fs.existsSync(file)) fail(`找不到运行 ${type}/${id}`);
  const run = readJson(file);
  if (status === "done") {
    const resolvedRun = { type, id, dir: path.dirname(file), run };
    const problems = fullPrototypeProblems(resolvedRun);
    if (problems.length)
      fail(`不能将全量原型运行标记为 done：\n- ${problems.join("\n- ")}`);
    const systemProblems = systemCardProblems(resolvedRun);
    if (systemProblems.length)
      fail(`不能将系统信息运行标记为 done：\n- ${systemProblems.join("\n- ")}`);
    if (type === "system") {
      const workProblems = mergeProblems(resolvedRun);
      if (workProblems.length)
        fail(`不能将系统信息运行标记为 done：\n- ${workProblems.join("\n- ")}`);
      const integrationFile = path.join(resolvedRun.dir, "integration.json");
      const integration = fs.existsSync(integrationFile)
        ? readJson(integrationFile)
        : null;
      if (integration?.status !== "passed")
        fail(
          "不能将系统信息运行标记为 done：必须先完成 work verify --status passed。",
        );
    }
    if (type === "delivery") {
      const workProblems = mergeProblems(resolvedRun);
      if (workProblems.length)
        fail(`不能将开发运行标记为 done：\n- ${workProblems.join("\n- ")}`);
      const deliveryProblems = deliveryCompletionProblems(resolvedRun);
      if (deliveryProblems.length)
        fail(`不能将开发运行标记为 done：\n- ${deliveryProblems.join("\n- ")}`);
    }
    if (type === "refinement") {
      const validationFile = path.join(resolvedRun.dir, "validation.json");
      const applicationFile = path.join(resolvedRun.dir, "application.json");
      const validation = fs.existsSync(validationFile)
        ? readJson(validationFile)
        : null;
      const application = fs.existsSync(applicationFile)
        ? readJson(applicationFile)
        : null;
      if (validation?.status !== "passed" || application?.status !== "applied")
        fail(
          "不能将功能拆解运行标记为 done：必须先执行 feature apply 并通过迁移、入口与依赖门禁。",
        );
    }
  }
  if (type === "delivery" && status === "skipped") {
    const problems = deliveryStageClosureProblems({
      type,
      id,
      dir: path.dirname(file),
      run,
    });
    if (problems.length)
      fail(`不能将开发运行标记为 skipped：\n- ${problems.join("\n- ")}`);
  }
  if (type === "delivery" && status === "blocked") {
    const problems = deliveryBlockedProblems({
      type,
      id,
      dir: path.dirname(file),
      run,
    });
    if (problems.length)
      fail(`不能将开发运行标记为 blocked：\n- ${problems.join("\n- ")}`);
  }
  run.status = status;
  run.updatedAt = now();
  run.notes ??= [];
  run.notes.push({ at: run.updatedAt, note: required("--note") });
  writeJson(file, run);
  const current = readJson(currentFile());
  if (
    ["done", "skipped"].includes(status) &&
    current.active?.type === type &&
    current.active?.id === id
  )
    current.active = null;
  writeJson(currentFile(), { ...current, updatedAt: now() });
  console.log(`${type}/${id}: ${status}`);
}

export function contextPageOptions() {
  const rawLimit = valueFor("--limit");
  const limit =
    rawLimit == null ? CONTEXT_PAGE_DEFAULT : Number.parseInt(rawLimit, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > CONTEXT_PAGE_MAX)
    fail(`--limit 必须是 1-${CONTEXT_PAGE_MAX} 的整数`);
  const rawCursor = valueFor("--cursor");
  const cursor = rawCursor == null ? 0 : Number.parseInt(rawCursor, 10);
  if (!Number.isInteger(cursor) || cursor < 0)
    fail("--cursor 必须是非负整数偏移量");
  const rawMaxBytes = valueFor("--max-bytes");
  const maxBytes = rawMaxBytes == null
    ? CONTEXT_PAGE_BYTES_DEFAULT
    : Number.parseInt(rawMaxBytes, 10);
  if (
    !Number.isInteger(maxBytes) ||
    maxBytes < 2_048 ||
    maxBytes > CONTEXT_PAGE_BYTES_MAX
  )
    fail(`--max-bytes 必须是 2048-${CONTEXT_PAGE_BYTES_MAX} 的整数`);
  return { limit, cursor, maxBytes };
}

export function pageContextItems(items, { limit, cursor, maxBytes }) {
  const source = Array.isArray(items) ? items : [];
  const candidates = source.slice(cursor, cursor + limit);
  const page = [];
  let consumed = 0;
  for (const item of candidates) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item));
    const selected = itemBytes > maxBytes
      ? {
          id: item?.id ?? item?.path ?? String(cursor + consumed),
          type: item?.type ?? null,
          oversized: true,
          bytes: itemBytes,
          detail: "单条记录超过本次上下文预算；请缩小到具体分组、功能、系统卡片、开发运行或代码根，必要时在上限内提高 --max-bytes 后重试。",
        }
      : item;
    const nextBytes = Buffer.byteLength(JSON.stringify([...page, selected]));
    if (page.length && nextBytes > maxBytes) break;
    page.push(selected);
    consumed += 1;
  }
  const next = cursor + consumed;
  return {
    total: source.length,
    limit,
    cursor,
    maxBytes,
    bytes: Buffer.byteLength(JSON.stringify(page)),
    nextCursor: next < source.length ? String(next) : null,
    items: page,
  };
}

export function contextEvidence(raw, detail) {
  const paging = contextPageOptions();
  const cardId = valueFor("--card");
  const taskRunId = valueFor("--run");
  const rootPath = valueFor("--root");
  const groupId = valueFor("--group");
  const collection = valueFor("--collection");
  const includeChanges = process.argv.includes("--changes");
  if (detail === "prototype") {
    const features = raw.prototype?.features ?? [];
    const entries = raw.prototype?.sourceEntries ?? [];
    const coverage = raw.prototype?.coverage ?? [];
    if (groupId && !features.some((feature) => feature.id === groupId))
      fail(`此快照中找不到原型分组：${groupId}`);
    const groupedEntryIds = new Set(
      entries.filter((entry) => entry.feature === groupId).map((entry) => entry.id),
    );
    const collections = {
      features: groupId ? features.filter((feature) => feature.id === groupId) : features,
      entries: groupId ? entries.filter((entry) => groupedEntryIds.has(entry.id)) : entries,
      coverage: groupId ? coverage.filter((entry) => groupedEntryIds.has(entry.id)) : coverage,
    };
    const name = collection ?? "features";
    if (!Object.hasOwn(collections, name))
      fail("--collection 只能是 features、entries 或 coverage");
    return {
      section: detail,
      collection: name,
      filter: { groupId: groupId ?? null },
      task: raw.prototype?.task ?? null,
      ...pageContextItems(collections[name], paging),
    };
  }
  if (detail === "development") {
    const stored = raw.development?.evidenceRef
      ? readEvidenceBundle(raw.development.evidenceRef, "development").tasks
      : [
          ...(raw.development?.activeTasks ?? []),
          ...(raw.development?.recentCompletedTasks ?? []),
        ];
    const summaries = [
      ...(raw.development?.activeTasks ?? []),
      ...(raw.development?.recentCompletedTasks ?? []),
    ];
    const tasks = taskRunId
      ? stored.filter((task) => task.runId === taskRunId)
      : summaries;
    return {
      section: detail,
      filter: { runId: taskRunId ?? null, expanded: Boolean(taskRunId) },
      ...pageContextItems(tasks, paging),
    };
  }
  if (detail === "systems") {
    const stored = raw.systems?.evidenceRef
      ? readEvidenceBundle(raw.systems.evidenceRef, "systems").cards
      : (raw.systems?.cards ?? []);
    const summaries = (raw.systems?.cards ?? []).map(systemCardContextSummary);
    const cards = cardId
      ? stored.filter((card) => card.id === cardId)
      : summaries;
    if (cardId && !cards.length) fail(`此快照中找不到系统卡片：${cardId}`);
    return {
      section: detail,
      filter: { cardId: cardId ?? null },
      ...pageContextItems(cards, paging),
    };
  }
  if (detail === "code-roots") {
    const roots = raw.codeRoots ?? [];
    if (!includeChanges)
      return {
        section: detail,
        filter: { root: rootPath ?? null, changes: false },
        ...pageContextItems(
          rootPath ? roots.filter((root) => root.path === rootPath) : roots,
          paging,
        ),
      };
    if (!rootPath) fail("读取改动清单时必须提供 --root <代码根路径>");
    const root = roots.find((item) => item.path === rootPath);
    if (!root) fail(`此快照中找不到代码根：${rootPath}`);
    const changes = root.evidenceRef
      ? readEvidenceBundle(root.evidenceRef, "code-roots").changedPaths
      : (root.changedPaths ?? []);
    return {
      section: detail,
      root: root.path,
      filter: { root: rootPath, changes: true },
      ...pageContextItems(changes, paging),
    };
  }
  if (detail === "documents")
    return {
      section: detail,
      ...pageContextItems(raw.documents ?? [], paging),
    };
  fail(`未知上下文分区：${detail}`);
}

export function planningContextEvidence(run) {
  const paging = contextPageOptions();
  const collection = valueFor("--collection") ?? "features";
  const groupId = valueFor("--group");
  const featureId = valueFor("--feature");
  const previousFile = path.join(run.dir, "previous-map.json");
  const proposalFile = path.join(run.dir, "proposal.json");
  const impactFile = path.join(run.dir, "prototype-impact.json");
  const previous = fs.existsSync(previousFile) ? readJson(previousFile) : null;
  const proposal = fs.existsSync(proposalFile) ? readJson(proposalFile) : null;
  const impact = fs.existsSync(impactFile) ? readJson(impactFile) : null;
  const previousFeatures = new Map((previous?.features ?? []).map((item) => [item.id, item]));
  const proposedFeatures = new Map((proposal?.features ?? []).map((item) => [item.id, item]));
  const featureIds = [...new Set([...previousFeatures.keys(), ...proposedFeatures.keys()])];
  const idsInGroup = new Set(featureIds.filter((id) =>
    previousFeatures.get(id)?.parentId === groupId || proposedFeatures.get(id)?.parentId === groupId));
  const selectedIds = featureIds.filter((id) =>
    (!groupId || idsInGroup.has(id)) && (!featureId || id === featureId));
  if (groupId && ![
    ...(previous?.groups ?? []),
    ...(proposal?.groups ?? []),
  ].some((group) => group.id === groupId)) fail(`此规划快照中找不到业务域：${groupId}`);
  if (featureId && !featureIds.includes(featureId)) fail(`此规划快照中找不到叶子功能：${featureId}`);
  const reviews = proposal?.impactReviews ?? [];
  const collections = {
    features: selectedIds.map((id) => ({
      type: "planning-feature",
      id,
      previous: previousFeatures.get(id) ?? null,
      proposed: proposedFeatures.get(id) ?? null,
      impact: (impact?.affected ?? []).find((item) => item.id === id) ?? null,
      review: reviews.find((item) => item.featureId === id) ?? null,
    })),
    groups: [...new Set([
      ...(previous?.groups ?? []).map((group) => group.id),
      ...(proposal?.groups ?? []).map((group) => group.id),
    ])]
      .filter((id) => !groupId || id === groupId)
      .map((id) => ({
        type: "planning-group",
        id,
        previous: (previous?.groups ?? []).find((group) => group.id === id) ?? null,
        proposed: (proposal?.groups ?? []).find((group) => group.id === id) ?? null,
      })),
    migrations: (proposal?.migrations ?? [])
      .map((migration, index) => ({ type: "planning-migration", id: String(index), ...migration }))
      .filter((migration) => {
        if (!groupId && !featureId) return true;
        const selected = featureId ? new Set([featureId]) : idsInGroup;
        return [...(migration.from ?? []), ...(migration.to ?? [])].some((id) => selected.has(id));
      }),
    impact: (impact?.affected ?? [])
      .filter((item) => (!groupId || idsInGroup.has(item.id)) && (!featureId || item.id === featureId))
      .map((item) => ({
        type: "planning-impact",
        ...item,
        review: reviews.find((review) => review.featureId === item.id) ?? null,
      })),
  };
  if (!Object.hasOwn(collections, collection))
    fail("planning 的 --collection 只能是 features、groups、migrations 或 impact");
  return {
    section: "planning",
    collection,
    filter: { groupId: groupId ?? null, featureId: featureId ?? null },
    files: {
      previous: path.relative(STORE, previousFile),
      proposal: path.relative(STORE, proposalFile),
      impact: path.relative(STORE, impactFile),
    },
    proposalUpdatedAt: proposal?.updatedAt ?? null,
    ...pageContextItems(collections[collection], paging),
  };
}

export function runContext() {
  ensureProject();
  const run = resolveRun(required("--id"));
  const planFile = workPlanFile(run);
  const plan = fs.existsSync(planFile) ? readJson(planFile) : { tasks: [] };
  const tasks = (plan.tasks ?? []).map((task) => {
    const file = executionFile(run, task.id);
    const execution = fs.existsSync(file) ? readJson(file) : null;
    return {
      id: task.id,
      title: task.title,
      status: execution?.status ?? "pending",
      continuationOpen: continuousTaskHasOpenStages(task, execution),
      agent: execution?.agent ?? null,
      dependsOn: task.dependsOn ?? [],
      features: task.leafFeatureIds ?? task.features ?? [],
      summary: execution?.summary ?? null,
      attempts: execution?.attempts ?? [],
    };
  });
  const active = readJson(currentFile()).active;
  const detail = valueFor("--detail");
  if (detail && !CONTEXT_DETAIL_SECTIONS.has(detail))
    fail(
      "--detail 只能是 prototype、planning、development、systems、code-roots 或 documents；禁止 all，必须分页读取。",
    );
  const contextFile = path.join(run.dir, "context.json");
  const compaction = fs.existsSync(compactionIndexFile())
    ? readJson(compactionIndexFile())
    : null;
  const compactRecord =
    compaction?.runs?.find((item) => item.runId === run.id) ?? null;
  let evidence = null;
  if (run.type === "refinement" && detail) {
    if (!fs.existsSync(contextFile)) fail(`运行缺少事实快照：${contextFile}`);
    evidence = detail === "planning"
      ? planningContextEvidence(run)
      : contextEvidence(readJson(contextFile), detail);
  }
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        run: {
          id: run.id,
          type: run.type,
          title: run.run.title,
          scope: run.run.scope,
          status: run.run.status,
          prototypeRun: run.run.prototypeRun,
          deliveryInput: run.run.deliveryInput ?? null,
          isCurrent: active?.type === run.type && active?.id === run.id,
        },
        input: run.type === "delivery" ? deliveryInput(run) : null,
        tasks,
        context:
          run.type === "refinement"
            ? {
                defaultRead:
                  compactRecord?.brief ??
                  path.relative(STORE, refinementBriefFile(run)),
                rawContext: path.relative(STORE, contextFile),
                availableSections: [
                  "prototype",
                  "planning",
                  "development",
                  "systems",
                  "code-roots",
                  "documents",
                ],
                detail: detail ?? null,
                estimatedTokens:
                  compactRecord?.estimatedTokens ??
                  (fs.existsSync(contextFile)
                    ? tokenEstimate(fs.statSync(contextFile).size)
                    : null),
              }
            : null,
        evidence,
        continuationRule:
          "收到运行 ID 但没有明确目标时，只展示此上下文并询问要继续的功能块、任务或阻塞问题；refinement 运行先读 defaultRead 摘要，再按受影响分组使用 --detail prototype|planning --group <ID> 分页读取，其他事实也只按分区读取（默认 5、最大 20 条、默认 12000 bytes）；禁止整读 context.json、prototype-impact.json、previous-map.json、proposal.json 或原型报告；不得自行挑选范围或新建运行。",
      },
      null,
      2,
    ),
  );
}

export function current() {
  const project = ensureProject();
  const current = readJson(currentFile());
  console.log(`项目：${project.project.name}`);
  const canonicalTaskFile = path.join(prototypeDir(), "task.json");
  const canonicalCoverageFile = path.join(prototypeDir(), "coverage.json");
  if (
    fs.existsSync(canonicalTaskFile) &&
    fs.existsSync(canonicalCoverageFile)
  ) {
    const canonicalTask = readJson(canonicalTaskFile);
    const counts = coverageCounts(readJson(canonicalCoverageFile));
    console.log(
      `原型真源：${canonicalTask.status} · 覆盖 ${counts.covered}/${counts.total}`,
    );
  }
  const systemTaskFile = path.join(systemDir(), "task.json");
  const cardsFile = systemCardsFile();
  if (fs.existsSync(systemTaskFile) && fs.existsSync(cardsFile)) {
    const task = readJson(systemTaskFile);
    const cards = readJson(cardsFile);
    console.log(
      `系统卡片：${task.status} · 系统 ${cards.cards?.length ?? 0} · API 使用 ${task.apiUsageCount ?? 0} · 未解决问题 ${task.openIssueCount ?? 0}`,
    );
  }
  if (fs.existsSync(featureMapFile())) {
    const map = readJson(featureMapFile());
    console.log(
      `功能地图：业务域 ${map.groups?.length ?? 0} · 叶子功能 ${map.features?.length ?? 0} · 更新 ${map.updatedAt ?? "—"}；用 feature status 复核新鲜度`,
    );
  } else
    console.log(
      "功能地图：未建立 · 需要规划开发时运行 `feature refine --scope auto`",
    );
  if (!project.confirmedAt)
    console.log(
      "下一步：补全 project.json 的 access、version、testCommands，并确认项目基线。",
    );
  if (!current.active)
    return console.log(
      "当前没有进行中的运行；功能演进拆解用 `feature refine --scope auto`，原型拆解用 `run new --type prototype`，系统事实更新用 `run new --type system`，优先从当前功能地图开始开发用 `delivery start --source feature-map --intensity <focused|standard|high>`。",
    );
  const run = readJson(
    path.join(runDir(current.active.type, current.active.id), "run.json"),
  );
  console.log(`当前：${run.type}/${run.id}（${run.status}）`);
  console.log(
    run.type === "prototype"
      ? "下一步：按 prototype-inventory.md 穷尽流程、截图并整理功能块。"
      : run.type === "system"
        ? "下一步：核验来源、记录系统事实、分析原型/设计/代码影响并生成派生任务。"
        : run.type === "refinement"
          ? "下一步：先读 refinement 的 brief.md，再按需分区核验 context.json，填写叶子功能、迁移、优先级与依赖，然后执行 feature apply。"
          : "下一步：按原型对齐 → 接口 Mock → 技术实现 → 全链路测试完成小闭环；不适用阶段必须写明原因。",
  );
}

export function check() {
  ensureProject();
  const type = requireType(required("--type"));
  const id = required("--id");
  const dir = runDir(type, id);
  const runFile = path.join(dir, "run.json");
  if (!fs.existsSync(runFile)) fail(`找不到运行 ${type}/${id}`);
  const requiredFiles =
    type === "prototype"
      ? ["overview.md", "work-plan.json", path.join("features", "README.md")]
      : type === "system"
        ? [
            "overview.md",
            "cards.json",
            "impact-analysis.md",
            "tasks.md",
            "work-plan.json",
          ]
        : type === "refinement"
          ? ["analysis.md", "context.json", "proposal.json", "work-plan.json"]
          : [
              "plan.md",
              "work-plan.json",
              "implementation.md",
              "verification.md",
            ];
  const missing = requiredFiles.filter(
    (file) => !fs.existsSync(path.join(dir, file)),
  );
  if (type === "prototype") {
    const featureDir = path.join(dir, "features");
    const count = fs.existsSync(featureDir)
      ? fs
          .readdirSync(featureDir)
          .filter((file) => file.endsWith(".md") && file !== "README.md").length
      : 0;
    if (!count) missing.push("至少一个 features/<功能块>.md");
  }
  const run = readJson(runFile);
  if (type === "delivery") {
    const reportProblems = deliveryReportProblems({ type, id, dir, run });
    if (reportProblems.length)
      fail(
        `${type}/${id} 的交付报告未通过：\n- ${reportProblems.join("\n- ")}`,
      );
  }
  if (type === "delivery" && run.status === "done") {
    const deliveryProblems = deliveryCompletionProblems({ type, id, dir, run });
    if (deliveryProblems.length)
      fail(
        `${type}/${id} 的完成门禁未通过：\n- ${deliveryProblems.join("\n- ")}`,
      );
  }
  if (type === "delivery" && run.deliveryInput?.file) {
    const inputFile = path.join(dir, run.deliveryInput.file);
    if (!fs.existsSync(inputFile)) missing.push(run.deliveryInput.file);
  }
  if (missing.length) fail(`${type}/${id} 缺少：${missing.join("、")}`);
  const fullProblems = fullPrototypeProblems({ type, id, dir, run });
  if (fullProblems.length)
    fail(`${type}/${id} 未满足全量原型门禁：\n- ${fullProblems.join("\n- ")}`);
  const cardProblems = systemCardProblems({ type, id, dir, run });
  if (cardProblems.length)
    fail(`${type}/${id} 未满足系统卡片门禁：\n- ${cardProblems.join("\n- ")}`);
  console.log(
    type === "delivery" && run.status === "done"
      ? `通过：${type}/${id} 的记录、交付报告与完成门禁均已校验。`
      : `通过：${type}/${id} 的记录与报告格式均已校验（当前状态：${run.status}）。`,
  );
}
