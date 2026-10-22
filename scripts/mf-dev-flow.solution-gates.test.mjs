import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "mf-dev-flow.mjs");
const sharedModule = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "modules",
  "runtime",
  "shared.mjs",
);
const temporaryDirectories = [];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function run(cwd, ...args) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
}
function git(cwd, ...args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

// —— 基于 mf-dev-flow.feature-refinement.test.mjs:37-210 的 fixture()/startRefinement()/validProposal()
// 助手移植（brief 要求逐字复制）。适配（brief 的弯路修正，实测为准）：
//   1. 需求 add/update 走原型目录（catalog），因此 fixture 额外初始化已验收的 prototype catalog
//      （groups=old-a/old-b、entries=e1/e2/e3 带 observed 截图证据、sys-1 系统卡片），
//      并在 accept 后把语义修订号保存在 item.semanticRevision 供 T1-a 修订链起点。
//   2. validProposal 的 leaf-a1 追加 sourceRequirementIds:["req-tech"]；并为每个叶子补 analysis /
//      priorityReason / waveReason——apply 的 impactReviewProblems 对复评目标强制要求详细 analysis。
function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-solution-"));
  temporaryDirectories.push(cwd);
  git(cwd, "init", "-q");
  fs.writeFileSync(path.join(cwd, "app.js"), "export const value = 1;\n");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  for (const file of ["功能流程图.md", "功能范围.md", "开放计划.md", "目录结构.md", "接口规范.md"])
    fs.writeFileSync(path.join(cwd, "docs", file), `# ${file}\n`);
  fs.mkdirSync(path.join(cwd, "docs", "architecture"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "architecture", "接口设计.md"), "# 接口设计\n");
  fs.mkdirSync(path.join(cwd, "docs", "update"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "update", "旧记录.md"), "# 旧记录\n");
  git(cwd, "add", ".");
  git(cwd, "-c", "user.name=mf-dev-flow-test", "-c", "user.email=mf-dev-flow@example.com", "commit", "-qm", "fixture");

  const store = path.join(cwd, ".mf-dev-flow");
  writeJson(path.join(store, "project.json"), {
    schemaVersion: 1,
    project: { name: "fixture", background: "solution gates fixture" },
    codeRoots: [{ path: ".", role: "primary", writeBoundary: "fixture" }],
    confirmedAt: "2026-09-03T00:00:00.000Z",
  });
  writeJson(path.join(store, "current.json"), { schemaVersion: 1, active: null });
  writeJson(path.join(store, "system", "cards.json"), {
    schemaVersion: 2,
    updatedAt: "2026-09-03T00:00:00.000Z",
    cards: [
      {
        id: "sys-1",
        title: "系统一",
        status: "confirmed",
        lastVerifiedAt: "2026-09-03T00:00:00.000Z",
        apiUsages: [],
        technicalIssues: [],
        openQuestions: [],
      },
    ],
  });
  writeJson(path.join(store, "prototype-runs", "proto-1", "run.json"), {
    schemaVersion: 1,
    id: "proto-1",
    type: "prototype",
    title: "prototype fixture",
    status: "done",
    updatedAt: "2026-09-03T00:00:00.000Z",
  });
  writeJson(path.join(store, "prototype-runs", "proto-1", "work-plan.json"), {
    schemaVersion: 1,
    runId: "proto-1",
    runType: "prototype",
    tasks: [],
  });

  // —— 初始化并验收一个确定的 prototype catalog（观察型截图证据 e1/e2/e3 + old-a/old-b 分组）——
  fs.mkdirSync(path.join(cwd, "source"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, "source", "index.html"),
    '<main class="page"><button id="go">Go</button></main>\n',
  );
  fs.mkdirSync(path.join(store, "prototype"), { recursive: true });
  fs.writeFileSync(
    path.join(store, "prototype", "analysis-requirements.md"),
    "# SYNTHETIC\n书签只存本地，不走接口。\n",
  );
  writeJson(path.join(cwd, "init.json"), {
    schemaVersion: 1,
    source: { type: "html", location: "source/index.html" },
    scope: { mode: "full", observableBoundary: "SYNTHETIC FIXTURE ONLY" },
  });
  let out = run(cwd, "prototype", "init", "--input", path.join(cwd, "init.json"), "--batch", "test", "--request-id", "init");
  assert.equal(out.status, 0, out.stderr);
  const snapshotId = JSON.parse(out.stdout).items[0].snapshotId;
  const sourceMap = JSON.parse(
    fs.readFileSync(path.join(store, "prototype", "analyses", "test", "source-map.json"), "utf8"),
  );
  const createdAt = sourceMap.createdAt;
  const pageId = sourceMap.candidates.find((candidate) => candidate.kind === "page").id;
  const controlId = sourceMap.candidates.find((candidate) => candidate.kind === "control").id;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  fs.writeFileSync(path.join(cwd, "fixture.png"), png);
  fs.writeFileSync(path.join(cwd, "trace.jsonl"), '{"fixture":true}\n');
  const evidenceIds = {};
  for (const id of ["e1", "e2", "e3"]) {
    const payload = {
      snapshotId,
      capturedAt: new Date(Date.parse(createdAt) + 1000).toISOString(),
      action: `reset ${id}, click Go`,
      assertion: { expected: id.toUpperCase(), actual: id.toUpperCase(), passed: true },
      path: path.resolve(cwd, "fixture.png"),
      trace: path.resolve(cwd, "trace.jsonl"),
    };
    writeJson(path.join(cwd, `ev-${id}.json`), payload);
    out = run(cwd, "prototype", "evidence", "--input", path.join(cwd, `ev-${id}.json`));
    assert.equal(out.status, 0, out.stderr);
    evidenceIds[id] = JSON.parse(out.stdout).items[0].id;
  }
  const records = [];
  const push = (type, record, expectedRevision) =>
    records.push({ type, record, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
  push("group", { id: "old-a", title: "旧功能 A", purpose: "完成 A", order: 0, entryNodeIds: ["e1", "e2"] });
  push("group", { id: "old-b", title: "旧功能 B", purpose: "完成 B", order: 1, entryNodeIds: ["e3"] });
  push("control", { id: "go", locator: "#go", event: "click", sourceIds: [pageId, controlId] });
  for (const id of ["e1", "e2", "e3"]) {
    const groupId = id === "e3" ? "old-b" : "old-a";
    push("entry", { id, feature: groupId, status: "covered", evidenceIds: [evidenceIds[id]] });
    push("node", { id, label: `节点 ${id}`, purpose: `模式 ${id}`, groupId, values: { mode: id }, resetAction: `Reset ${id}`, entryIds: [id], status: "covered", evidenceIds: [evidenceIds[id]] });
    push("edge", { id: `go-${id}`, from: id, to: id, controlId: "go", inputClass: "none", outcomeKey: id, sourceIds: [controlId], action: { type: "click", target: "#go", force: false, script: false }, outcome: `Title ${id.toUpperCase()}`, status: "covered", evidenceIds: [evidenceIds[id]] });
    push("occurrence", { id: `button-${id}`, nodeId: id, controlId: "go", edgeIds: [`go-${id}`] });
    push("sweep", { id, nodeId: id, complete: true, discoveryIds: [`button-${id}`], status: "covered", evidenceIds: [evidenceIds[id]] });
    push("vector", { id: `mode-${id}`, spaceId: "flow", values: { mode: id }, resetAction: `Reset ${id}`, status: "covered", evidenceIds: [evidenceIds[id]] });
  }
  push("space", { id: "flow", sourceIds: [pageId], dimensions: { mode: ["e1", "e2", "e3"] }, reductions: [] });
  for (const candidate of sourceMap.candidates)
    push("candidate", { ...candidate, status: "mapped", ...(candidate.kind === "page" ? { nodeIds: ["e1", "e2", "e3"] } : { edgeIds: ["go-e1", "go-e2", "go-e3"] }) }, 0);
  writeJson(path.join(cwd, "batch.json"), records);
  out = run(cwd, "prototype", "put", "--input", path.join(cwd, "batch.json"), "--request-id", "put-all");
  assert.equal(out.status, 0, out.stderr);
  const status = JSON.parse(run(cwd, "prototype", "status", "--json").stdout).items[0];
  out = run(cwd, "prototype", "accept", "--request-id", "accept", "--expected-revision", String(status.semanticRevision));
  assert.equal(out.status, 0, out.stderr);
  const item = { cwd, store, semanticRevision: JSON.parse(out.stdout).items[0].semanticRevision };
  assert.ok(item.semanticRevision > 0);
  return item;
}

function startRefinement(item) {
  const result = run(item.cwd, "feature", "refine", "--scope", "auto", "--title", "fixture refine");
  assert.equal(result.status, 0, result.stderr);
  const id = result.stdout.trim().split("\n")[0];
  assert.ok(id);
  return { id, dir: path.join(item.store, "refinement-runs", id) };
}

function validProposal(dir, id) {
  const proposalFile = path.join(dir, "proposal.json");
  const proposal = JSON.parse(fs.readFileSync(proposalFile, "utf8"));
  Object.assign(proposal, {
    runId: id,
    features: [
      {
        id: "leaf-a1",
        title: "叶子 A1",
        parentId: "old-a",
        rank: 10,
        outcome: "完成 A1",
        description: "完成 A1 的概括说明。",
        developmentRequirements: ["按来源截图核对 A1。"],
        sourceEntries: ["e1"],
        sourceRequirementIds: ["req-tech"],
        scopeRefs: ["F1"],
        moduleRefs: ["catalog"],
        codeRefs: ["app.js"],
        systemCardRefs: ["sys-1"],
        priority: "P0-1",
        wave: "W0",
        status: "not_started",
        dependsOn: [],
        blockers: [],
        taskRefs: [],
        analysis: {
          prototype: "按 e1 来源截图核对。",
          code: "核对 app.js 结构与本地存储边界。",
          systems: "核对 sys-1 系统卡片。",
          scope: "按 F1 功能范围核对。",
          gaps: ["无待核验项"],
          sources: [
            { kind: "prototype", ref: "e1", note: "来源截图" },
            { kind: "code", ref: "app.js", note: "代码来源" },
            { kind: "system", ref: "sys-1", note: "系统卡片" },
          ],
        },
        priorityReason: "优先级维持。",
        waveReason: "波次维持。",
      },
      {
        id: "leaf-a2",
        title: "叶子 A2",
        parentId: "old-a",
        rank: 20,
        outcome: "完成 A2",
        description: "完成 A2 的概括说明。",
        developmentRequirements: ["按来源截图核对 A2。"],
        sourceEntries: ["e2"],
        priority: "P1",
        wave: "W1",
        status: "not_started",
        dependsOn: ["leaf-a1"],
        systemCardRefs: [],
        analysis: {
          prototype: "按 e2 来源截图核对。",
          code: "核对 app.js 结构。",
          systems: "不涉及系统卡片。",
          scope: "按功能范围核对。",
          gaps: ["无待核验项"],
          sources: [
            { kind: "prototype", ref: "e2", note: "来源截图" },
            { kind: "code", ref: "app.js", note: "代码来源" },
            { kind: "system", ref: "sys-1", note: "系统卡片参考" },
          ],
        },
        priorityReason: "优先级维持。",
        waveReason: "波次维持。",
      },
      {
        id: "leaf-b",
        title: "叶子 B",
        parentId: "old-b",
        rank: 10,
        outcome: "完成 B",
        description: "完成 B 的概括说明。",
        developmentRequirements: ["按来源截图核对 B。"],
        sourceEntries: ["e3"],
        priority: "P2",
        wave: "W2",
        status: "not_started",
        dependsOn: ["leaf-a2"],
        systemCardRefs: [],
        analysis: {
          prototype: "按 e3 来源截图核对。",
          code: "核对 app.js 结构。",
          systems: "不涉及系统卡片。",
          scope: "按功能范围核对。",
          gaps: ["无待核验项"],
          sources: [
            { kind: "prototype", ref: "e3", note: "来源截图" },
            { kind: "code", ref: "app.js", note: "代码来源" },
            { kind: "system", ref: "sys-1", note: "系统卡片参考" },
          ],
        },
        priorityReason: "优先级维持。",
        waveReason: "波次维持。",
      },
    ],
    migrations: [
      { type: "split", from: ["old-a"], to: ["leaf-a1", "leaf-a2"], reason: "拆成独立结果" },
      { type: "rename", from: ["old-b"], to: ["leaf-b"], reason: "改为叶子命名" },
    ],
  });
  writeJson(proposalFile, proposal);
  return proposal;
}

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// T4-a（评审裁定）：add 返回的语义修订号被存到 item 上复用；confirm 的 update 用该值做
// --expected-revision，且输入必须含 actor（mutate 强校验）与 status:"confirmed"。
function bindTechnicalRequirement(item) {
  const file = path.join(item.cwd, "req-tech.json");
  writeJson(file, { id: "req-tech", actor: "用户", origin: "user", text: "书签只存本地，不走接口。", kind: "technical", entryIds: ["e1"] });
  const out = run(item.cwd, "prototype", "requirement", "add", "--input", file, "--request-id", "add-tech", "--expected-revision", String(item.semanticRevision));
  assert.equal(out.status, 0, out.stderr);
  item.reqTechRevision = JSON.parse(out.stdout).items[0].semanticRevision;
  assert.ok(item.reqTechRevision > item.semanticRevision);
  return item.reqTechRevision;
}

// 复用同一 fixture 的 refine/apply + feature start + work plan + claim，并把任务推进到
// technical_solution 活动阶段：claim 原型对齐 agent → 以 not_applicable 关闭前置阶段 →
// checkpoint-gate 校验并交棒 → bind 技术方案 agent。dataflow_svg 提前登记，使第一次
// 阶段确认恰好落在“技术要求未确认”门禁上（门禁顺序：dataflow → technical_requirement → dev_plan）。
function startSolution(item) {
  const refinement = startRefinement(item);
  validProposal(refinement.dir, refinement.id);
  assert.equal(run(item.cwd, "feature", "apply", "--from-run", refinement.id).status, 0, "apply stderr");
  const started = run(item.cwd, "feature", "start", "--id", "leaf-a1");
  assert.equal(started.status, 0, started.stderr);
  const deliveryId = started.stdout.trim().split("\n").at(-1);
  const input = JSON.parse(fs.readFileSync(path.join(item.store, "delivery-runs", deliveryId, "delivery-input.json"), "utf8"));
  assert.equal(input.deliveryProcess.version, 3); // Task 2 默认切换生效
  const planned = run(item.cwd, "work", "plan", "--run", deliveryId, "--task", "leaf-a1-solution",
    "--title", "技术要求方案", "--kind", "implementation",
    "--features", "leaf-a1", "--writes", "app.js");
  assert.equal(planned.status, 0, planned.stderr);
  const claimed = run(item.cwd, "work", "claim", "--run", deliveryId, "--task", "leaf-a1-solution",
    "--agent", "prototype_alignment", "--session", "alignment-session", "--target-phase", "prototype_alignment");
  assert.equal(claimed.status, 0, claimed.stderr); // Task 3 放行：proposed technical 可领取
  const alignment = run(item.cwd, "delivery", "stage", "--run", deliveryId, "--task", "leaf-a1-solution",
    "--stage", "prototype_alignment", "--status", "not_applicable",
    "--summary", "结论：本 fixture 不执行真实 UI 验证；证据：fixture；变更：无；验证：检查点；风险/下一步：无");
  assert.equal(alignment.status, 0, alignment.stderr);
  const gate = run(item.cwd, "work", "checkpoint-gate", "--session", "alignment-session", "--agent", "prototype_alignment");
  assert.match(gate.stdout, /"verdict":"pass"/);
  const bound = run(item.cwd, "work", "bind-session", "--run", deliveryId, "--task", "leaf-a1-solution",
    "--agent", "technical_solution", "--session", "solution-session", "--target-phase", "technical_solution");
  assert.equal(bound.status, 0, bound.stderr);
  const runDir = path.join(item.store, "delivery-runs", deliveryId);
  const svg = path.join(runDir, "flow.svg");
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20"><rect width="100" height="20"/></svg>');
  const art = run(item.cwd, "delivery", "stage-artifact", "--run", deliveryId, "--task", "leaf-a1-solution",
    "--stage", "technical_solution", "--kind", "dataflow_svg", "--file", svg, "--caption", "小程序页面→本地存储（无接口）");
  assert.equal(art.status, 0, art.stderr);
  return { deliveryId };
}

function technicalSolutionConfirm(item, deliveryId, summary) {
  return run(item.cwd, "delivery", "stage", "--run", deliveryId, "--task", "leaf-a1-solution",
    "--stage", "technical_solution", "--status", "confirmed", "--summary", summary);
}

// taskPrototypeProblems 依赖 STORE（模块加载时按 process.cwd() 冻结）；测试进程的 cwd 是
// 仓库而非 fixture，因此把真实函数放进 cwd=fixture 的子进程执行，保持对产品代码原样调用。
function taskPrototypeProblemsInFixture(item, deliveryId, taskId) {
  const runDir = path.join(item.store, "delivery-runs", deliveryId);
  const check = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import fs from "node:fs";
import { taskPrototypeProblems } from ${JSON.stringify(sharedModule)};
const [runDir, deliveryId, taskId] = process.argv.slice(1);
const runRecord = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
const plan = JSON.parse(fs.readFileSync(path.join(runDir, "work-plan.json"), "utf8"));
const task = plan.tasks.find((t) => t.id === taskId);
process.stdout.write(JSON.stringify(taskPrototypeProblems({ type: "delivery", id: deliveryId, dir: runDir, ...runRecord }, task)));`,
      runDir,
      deliveryId,
      taskId,
    ],
    { cwd: item.cwd, encoding: "utf8" },
  );
  assert.equal(check.status, 0, check.stderr);
  return JSON.parse(check.stdout);
}

test("technical_solution 阶段被双门禁锁住，登记后放行", (t) => {
  const item = fixture();
  bindTechnicalRequirement(item);
  const { deliveryId } = startSolution(item);

  let stage = technicalSolutionConfirm(item, deliveryId, "结论：方案已确认；证据：待登记；变更：无；验证：检查点；风险/下一步：无");
  assert.notEqual(stage.status, 0);
  assert.match(stage.stderr, /尚未与用户确认/);

  // 确认技术要求（T1-a：update 携带 actor + status:confirmed + --expected-revision 链）→ 复评收敛 → 阶段确认仍被 dev_plan 门禁锁住
  const upd = path.join(item.cwd, "req-tech-confirm.json");
  writeJson(upd, { id: "req-tech", actor: "用户", status: "confirmed" });
  const updOut = run(item.cwd, "prototype", "requirement", "update", "--input", upd, "--request-id", "upd-tech",
    "--expected-revision", String(item.reqTechRevision));
  assert.equal(updOut.status, 0, updOut.stderr);
  assert.ok(JSON.parse(updOut.stdout).items[0].semanticRevision);
  const sync = run(item.cwd, "graph", "sync", "--json");
  assert.equal(sync.status, 0, sync.stderr);
  const refine = startRefinement(item);
  const proposalFile = path.join(refine.dir, "proposal.json");
  const proposal = JSON.parse(fs.readFileSync(proposalFile, "utf8"));
  proposal.impactReviews = ["leaf-a1", "leaf-a2", "leaf-b"].map((featureId) => ({
    featureId,
    decision: "keep",
    deliveryImpact: "preserve",
    targets: [featureId],
    reason: "技术要求已确认、内容未变；仅刷新基线",
    checks: { scope: "unchanged", status: "preserve", dependencies: "unchanged", priority: "unchanged", wave: "unchanged", acceptance: "preserve" },
    evidence: [
      { kind: "prototype", ref: "e1", note: "截图证据保持" },
      { kind: "code", ref: "app.js", note: "代码无变化" },
      { kind: "system", ref: "sys-1", note: "系统卡片无变化" },
    ],
    taskDecisions:
      featureId === "leaf-a1"
        ? [{ runId: deliveryId, taskId: "leaf-a1-solution", action: "continue", reason: "技术要求已确认，任务继续执行" }]
        : [],
  }));
  writeJson(proposalFile, proposal);
  assert.equal(run(item.cwd, "feature", "apply", "--from-run", refine.id).status, 0, "apply stderr");
  const map = JSON.parse(fs.readFileSync(path.join(item.store, "planning", "feature-map.json"), "utf8"));
  const before = map.features.find((f) => f.id === "leaf-a1").planningRevision;

  stage = technicalSolutionConfirm(item, deliveryId, "结论：技术方案已确认；证据：待登记；变更：无；验证：检查点；风险/下一步：无");
  assert.notEqual(stage.status, 0);
  assert.match(stage.stderr, /dev_plan|writing-plans/);

  // 登记 dev_plan + dataflow SVG → 阶段确认通过；任务存活（planningRevision 未变）
  const planMd = path.join(item.store, "delivery-runs", deliveryId, "plan.md");
  fs.writeFileSync(planMd, "# 开发计划\n切片 1：本地书签存储。\n");
  const art = run(item.cwd, "delivery", "stage-artifact", "--run", deliveryId, "--task", "leaf-a1-solution",
    "--stage", "technical_solution", "--kind", "dev_plan", "--file", planMd, "--caption", "writing-plans 计划");
  assert.equal(art.status, 0, art.stderr);
  stage = technicalSolutionConfirm(item, deliveryId, "结论：技术方案已确认；证据：计划与流转图已登记；变更：无；验证：检查点；风险/下一步：无");
  assert.equal(stage.status, 0, stage.stderr);

  const after = JSON.parse(fs.readFileSync(path.join(item.store, "planning", "feature-map.json"), "utf8"))
    .features.find((f) => f.id === "leaf-a1").planningRevision;
  assert.equal(after, before);
});

test("revalidate 复评显式作废旧任务", (t) => {
  const item = fixture();
  bindTechnicalRequirement(item);
  const { deliveryId } = startSolution(item);
  const blocked = run(item.cwd, "work", "finish", "--run", deliveryId, "--task", "leaf-a1-solution",
    "--agent", "technical_solution", "--status", "blocked", "--summary", "等待用户确认新版技术边界",
    "--files", "none", "--tests", "未运行：等待技术边界确认");
  assert.equal(blocked.status, 0, blocked.stderr);
  const changedRequirement = path.join(item.cwd, "req-tech-revised.json");
  writeJson(changedRequirement, {
    id: "req-tech", actor: "用户",
    text: "书签改为本地优先存储，并在恢复网络后执行受控同步。",
  });
  const changed = run(item.cwd, "prototype", "requirement", "update", "--input", changedRequirement,
    "--request-id", "revise-tech", "--expected-revision", String(item.reqTechRevision));
  assert.equal(changed.status, 0, changed.stderr);
  const superseded = run(item.cwd, "work", "supersede", "--run", deliveryId, "--task", "leaf-a1-solution",
    "--reason", "用户确认新版技术边界，旧任务范围失效");
  assert.equal(superseded.status, 0, superseded.stderr);
  const refine = startRefinement(item);
  const proposalFile = path.join(refine.dir, "proposal.json");
  const proposal = JSON.parse(fs.readFileSync(proposalFile, "utf8"));
  proposal.features.find((feature) => feature.id === "leaf-a1").status = "not_started";
  proposal.impactReviews = ["leaf-a1", "leaf-a2", "leaf-b"].map((featureId) => ({
    featureId,
    decision: featureId === "leaf-a1" ? "revise" : "keep",
    deliveryImpact: featureId === "leaf-a1" ? "revalidate" : "preserve",
    targets: [featureId],
    reason: featureId === "leaf-a1" ? "方案实质改变验收边界" : "前置功能变更后确认本功能范围保持不变",
    checks: { scope: featureId === "leaf-a1" ? "revised" : "preserve", status: featureId === "leaf-a1" ? "revalidate" : "preserve", dependencies: "已核对前置变化", priority: "unchanged", wave: "unchanged", acceptance: featureId === "leaf-a1" ? "revalidate" : "preserve" },
    evidence: [
      { kind: "prototype", ref: featureId === "leaf-a1" ? "e1" : featureId === "leaf-a2" ? "e2" : "e3", note: "来源截图已核对" },
      { kind: "code", ref: "app.js", note: "代码边界已核对" },
      { kind: "system", ref: "sys-1", note: "系统卡片已核对" },
    ],
    taskDecisions: featureId === "leaf-a1"
      ? [{ runId: deliveryId, taskId: "leaf-a1-solution", action: "superseded", reason: "验收边界已改变，旧任务必须取代" }]
      : [],
  }));
  writeJson(proposalFile, proposal);
  const applied = run(item.cwd, "feature", "apply", "--from-run", refine.id);
  assert.equal(applied.status, 0, applied.stderr);

  const problems = taskPrototypeProblemsInFixture(item, deliveryId, "leaf-a1-solution");
  assert.ok(problems.some((p) => p.includes("已重新规划")));
});

test("proposed technical 不阻断 feature start 与 claim；product 要求仍阻断 claim", (t) => {
  const item = fixture();
  bindTechnicalRequirement(item);
  const { deliveryId } = startSolution(item);
  const plan = JSON.parse(fs.readFileSync(path.join(item.store, "delivery-runs", deliveryId, "work-plan.json"), "utf8"));
  assert.equal(plan.tasks[0].id, "leaf-a1-solution");
  assert.ok(plan.tasks[0].leafFeatureIds.includes("leaf-a1"));
});
