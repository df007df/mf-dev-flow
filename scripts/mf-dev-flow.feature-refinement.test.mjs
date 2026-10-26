import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { DELIVERY_CONTRACT, DELIVERY_STAGES } from "./delivery-contract.mjs";
import { dashboardState, runDetail } from "../dashboard/server/state.js";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "mf-dev-flow.mjs");
const temporaryDirectories = [];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function run(cwd, ...args) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
}

// Explicit historical fixture: new runs intentionally no longer inherit this contract.
function useLegacyDelivery(item, id) {
  const file = path.join(item.store, "delivery-runs", id, "delivery-input.json");
  const input = JSON.parse(fs.readFileSync(file, "utf8"));
  input.deliveryContract = { id: DELIVERY_CONTRACT.id, version: DELIVERY_CONTRACT.version };
  input.stages = DELIVERY_STAGES.map((stage) => ({ ...stage, status: "pending" }));
  writeJson(file, input);
}

function git(cwd, ...args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-refinement-"));
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
  git(
    cwd,
    "-c",
    "user.name=mf-dev-flow-test",
    "-c",
    "user.email=mf-dev-flow@example.com",
    "commit",
    "-qm",
    "fixture",
  );

  const store = path.join(cwd, ".mf-dev-flow");
  writeJson(path.join(store, "project.json"), {
    schemaVersion: 1,
    project: { name: "fixture", background: "feature refinement fixture" },
    codeRoots: [{ path: ".", role: "primary", writeBoundary: "fixture" }],
    confirmedAt: "2026-09-03T00:00:00.000Z",
  });
  writeJson(path.join(store, "current.json"), { schemaVersion: 1, active: null });
  writeJson(path.join(store, "prototype", "task.json"), {
    schemaVersion: 1,
    id: "prototype-main",
    title: "完整原型图流程",
    status: "fresh",
    source: { prototypeRun: "proto-1", prototypeVersion: "fixture" },
    updatedAt: "2026-09-03T00:00:00.000Z",
  });
  writeJson(path.join(store, "prototype", "feature-index.json"), {
    schemaVersion: 1,
    sourceRun: "proto-1",
    features: [
      { id: "old-a", title: "旧功能 A", sourceEntries: ["e1", "e2"] },
      { id: "old-b", title: "旧功能 B", sourceEntries: ["e3"] },
    ],
  });
  writeJson(path.join(store, "prototype", "coverage.json"), {
    schemaVersion: 1,
    sourceInventory: {
      entries: [
        { id: "e1", feature: "old-a" },
        { id: "e2", feature: "old-a" },
        { id: "e3", feature: "old-b" },
      ],
    },
    coverage: [
      { id: "e1", status: "covered", evidence: [{ level: "observed", path: "screenshots/e1.png" }] },
      { id: "e2", status: "covered", evidence: [{ level: "observed", path: "screenshots/e2.png" }] },
      { id: "e3", status: "covered", evidence: [{ level: "observed", path: "screenshots/e3.png" }] },
    ],
  });
  writeJson(path.join(store, "prototype", "open-questions.json"), {
    schemaVersion: 1,
    sourceRun: "proto-1",
    questions: [],
  });
  fs.writeFileSync(path.join(store, "prototype", "原型图流程.md"), "# 原型图流程\n");
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
  return { cwd, store };
}

function startRefinement(item) {
  const result = run(item.cwd, "feature", "refine", "--scope", "auto", "--title", "fixture refine");
  assert.equal(result.status, 0, result.stderr);
  const id = result.stdout.trim().split("\n")[0];
  assert.ok(id);
  return { id, dir: path.join(item.store, "refinement-runs", id) };
}

test("refine 在规划事实未变化时复用未完成快照", () => {
  const item = fixture();
  const first = startRefinement(item);
  const repeated = run(
    item.cwd,
    "feature",
    "refine",
    "--scope",
    "auto",
    "--title",
    "同一事实的再次规划",
  );
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(
    repeated.stdout.trim().split("\n")[0],
    first.id,
    "事实和功能地图都未变化时，应续用已有 refinement，而非新建快照",
  );
  assert.match(repeated.stdout, /复用/);
  const snapshots = fs
    .readdirSync(path.join(item.store, "refinement-runs"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.deepEqual(snapshots, [first.id]);
});

test("refine 在已应用地图与规划事实均未变化时不新建快照", () => {
  const item = fixture();
  const first = startRefinement(item);
  validProposal(first.dir, first.id);
  assert.equal(run(item.cwd, "feature", "apply", "--from-run", first.id).status, 0);

  const repeated = run(
    item.cwd,
    "feature",
    "refine",
    "--scope",
    "auto",
    "--title",
    "不应重复的已应用规划",
  );
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(repeated.stdout.trim().split("\n")[0], first.id);
  assert.match(repeated.stdout, /无需新建快照/);
  const snapshots = fs
    .readdirSync(path.join(item.store, "refinement-runs"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.deepEqual(snapshots, [first.id]);
});

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
  while (temporaryDirectories.length)
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

test("refine 冻结四类事实并创建可编辑提案", () => {
  const item = fixture();
  const refinement = startRefinement(item);
  const context = JSON.parse(fs.readFileSync(path.join(refinement.dir, "context.json"), "utf8"));
  const proposal = JSON.parse(fs.readFileSync(path.join(refinement.dir, "proposal.json"), "utf8"));
  assert.equal(context.prototype.sourceEntries.length, 3);
  assert.equal(context.systems.cards.length, 1);
  assert.equal(context.codeRoots[0].status, "observed");
  assert.equal(context.codeRoots[0].changedPaths, undefined);
  assert.ok(context.codeRoots[0].evidenceRef);
  assert.ok(context.development.evidenceRef);
  assert.ok(context.systems.evidenceRef);
  assert.ok(fs.existsSync(path.join(item.store, context.codeRoots[0].evidenceRef)));
  assert.ok(fs.existsSync(path.join(item.store, context.development.evidenceRef)));
  assert.ok(fs.existsSync(path.join(item.store, context.systems.evidenceRef)));
  assert.equal(typeof context.evidenceCursor, "string");
  const documentPaths = context.documents.map((document) => document.path);
  assert.ok(documentPaths.includes("docs/接口规范.md"));
  assert.ok(documentPaths.includes("docs/architecture/接口设计.md"));
  assert.ok(!documentPaths.includes("docs/update/旧记录.md"));
  assert.deepEqual(
    proposal.groups.map((group) => group.id),
    ["old-a", "old-b"],
  );
  assert.deepEqual(
    proposal.groups.map((group) => group.rank),
    [10, 20],
  );
  assert.deepEqual(proposal.features, []);
  assert.ok(fs.existsSync(path.join(refinement.dir, "brief.md")));
  assert.ok(fs.existsSync(path.join(refinement.dir, "delta.json")));
});

test("refine 不要求或创建固定项目文档", () => {
  const item = fixture();
  fs.rmSync(path.join(item.cwd, "docs"), { recursive: true, force: true });
  const refinement = startRefinement(item);
  const context = JSON.parse(fs.readFileSync(path.join(refinement.dir, "context.json"), "utf8"));
  assert.deepEqual(context.documents, []);
  assert.equal(fs.existsSync(path.join(item.cwd, "docs")), false);
});

test("系统约定可独立登记、替代并提供给看板", () => {
  const item = fixture();
  const added = run(
    item.cwd,
    "system",
    "agreement-add",
    "--id",
    "prototype-first",
    "--title",
    "原型优先",
    "--summary",
    "原型决定用户可见交互，代码差异需要回归。",
    "--scope",
    "所有功能开发",
    "--decision-ref",
    "用户确认",
    "--evidence",
    "docs/功能范围.md",
  );
  assert.equal(added.status, 0, added.stderr);
  const agreementFile = path.join(item.store, "system", "agreements.json");
  assert.ok(fs.existsSync(agreementFile));
  assert.equal(
    JSON.parse(fs.readFileSync(agreementFile, "utf8")).agreements[0].status,
    "confirmed",
  );
  assert.match(fs.readFileSync(path.join(item.store, "system", "系统约定.md"), "utf8"), /原型优先/);

  const dashboard = dashboardState(item.store);
  assert.equal(dashboard.system.agreements[0].id, "prototype-first");

  const replaced = run(
    item.cwd,
    "system",
    "agreement-set",
    "--id",
    "prototype-first",
    "--status",
    "superseded",
    "--note",
    "由更细的交互约定替代",
  );
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(
    JSON.parse(fs.readFileSync(agreementFile, "utf8")).agreements[0].status,
    "superseded",
  );
});

test("compact 生成默认摘要且 run context 仅按需输出原始分区", () => {
  const item = fixture();
  const refinement = startRefinement(item);
  const audit = run(item.cwd, "compact", "audit");
  assert.equal(audit.status, 0, audit.stderr);
  assert.match(audit.stdout, /功能演进快照：1 份/);
  const built = run(item.cwd, "compact", "build");
  assert.equal(built.status, 0, built.stderr);
  const index = JSON.parse(
    fs.readFileSync(path.join(item.store, "compaction", "index.json"), "utf8"),
  );
  assert.equal(index.currentRunId, refinement.id);
  assert.equal(index.runs[0].supersededBy, null);
  assert.ok(fs.existsSync(path.join(item.store, "planning", "context-brief.md")));
  assert.match(fs.readFileSync(path.join(refinement.dir, "brief.md"), "utf8"), /默认只读本摘要/);

  const context = run(item.cwd, "run", "context", "--id", refinement.id);
  assert.equal(context.status, 0, context.stderr);
  const compactContext = JSON.parse(context.stdout);
  assert.equal(compactContext.evidence, null);
  assert.equal(compactContext.context.defaultRead, `refinement-runs/${refinement.id}/brief.md`);
  assert.ok(compactContext.context.estimatedTokens > 0);

  const detailed = run(item.cwd, "run", "context", "--id", refinement.id, "--detail", "systems");
  assert.equal(detailed.status, 0, detailed.stderr);
  const detailedContext = JSON.parse(detailed.stdout);
  assert.equal(detailedContext.evidence.section, "systems");
  assert.ok(Array.isArray(detailedContext.evidence.items));
  assert.equal(detailedContext.evidence.items[0].id, "sys-1");
});

test("run context 分页读取证据并拒绝全量详情", () => {
  const item = fixture();
  for (let index = 0; index < 26; index += 1)
    fs.writeFileSync(
      path.join(item.cwd, `changed-${String(index).padStart(2, "0")}.txt`),
      "changed\n",
    );
  const refinement = startRefinement(item);

  const roots = run(
    item.cwd,
    "run",
    "context",
    "--id",
    refinement.id,
    "--detail",
    "code-roots",
    "--root",
    ".",
    "--changes",
    "--limit",
    "5",
  );
  assert.equal(roots.status, 0, roots.stderr);
  const firstPage = JSON.parse(roots.stdout).evidence;
  assert.equal(firstPage.items.length, 5);
  assert.equal(firstPage.total, 26);
  assert.equal(firstPage.nextCursor, "5");

  const secondPage = run(
    item.cwd,
    "run",
    "context",
    "--id",
    refinement.id,
    "--detail",
    "code-roots",
    "--root",
    ".",
    "--changes",
    "--limit",
    "5",
    "--cursor",
    firstPage.nextCursor,
  );
  assert.equal(secondPage.status, 0, secondPage.stderr);
  assert.equal(JSON.parse(secondPage.stdout).evidence.items.length, 5);

  const card = run(
    item.cwd,
    "run",
    "context",
    "--id",
    refinement.id,
    "--detail",
    "systems",
    "--card",
    "sys-1",
  );
  assert.equal(card.status, 0, card.stderr);
  assert.equal(JSON.parse(card.stdout).evidence.items.length, 1);

  const groupedEntries = run(
    item.cwd,
    "run",
    "context",
    "--id",
    refinement.id,
    "--detail",
    "prototype",
    "--group",
    "old-a",
    "--collection",
    "entries",
  );
  assert.equal(groupedEntries.status, 0, groupedEntries.stderr);
  assert.deepEqual(
    JSON.parse(groupedEntries.stdout).evidence.items.map((entry) => entry.id),
    ["e1", "e2"],
  );

  const all = run(item.cwd, "run", "context", "--id", refinement.id, "--detail", "all");
  assert.notEqual(all.status, 0);
  assert.match(all.stderr, /禁止 all/);
});

test("run context 用分组与字节预算阻止大证据页撑爆上下文", () => {
  const item = fixture();
  const coverageFile = path.join(item.store, "prototype", "coverage.json");
  const coverage = JSON.parse(fs.readFileSync(coverageFile, "utf8"));
  for (const record of coverage.coverage)
    record.evidence[0].note = "长证据".repeat(600);
  writeJson(coverageFile, coverage);
  const refinement = startRefinement(item);

  const page = run(
    item.cwd,
    "run",
    "context",
    "--id",
    refinement.id,
    "--detail",
    "prototype",
    "--collection",
    "coverage",
  );
  assert.equal(page.status, 0, page.stderr);
  const result = JSON.parse(page.stdout).evidence;
  assert.equal(result.limit, 5);
  assert.equal(result.maxBytes, 12000);
  assert.ok(result.bytes <= result.maxBytes);
  assert.ok(result.items.length < result.total);
  assert.equal(result.nextCursor, String(result.items.length));
  assert.ok(Buffer.byteLength(page.stdout) < 16000);

  const tooLarge = run(
    item.cwd,
    "run",
    "context",
    "--id",
    refinement.id,
    "--detail",
    "prototype",
    "--max-bytes",
    "99999",
  );
  assert.notEqual(tooLarge.status, 0);
  assert.match(tooLarge.stderr, /--max-bytes/);
});

test("run context 按业务域分页读取旧地图与当前提案", () => {
  const item = fixture();
  const first = startRefinement(item);
  validProposal(first.dir, first.id);
  assert.equal(run(item.cwd, "feature", "apply", "--from-run", first.id).status, 0);
  fs.appendFileSync(
    path.join(item.cwd, "docs", "开放计划.md"),
    "\n- 新增一项需要重新拆解的范围证据。\n",
  );
  const second = startRefinement(item);
  const carriedFeatures = JSON.parse(
    fs.readFileSync(path.join(second.dir, "proposal.json"), "utf8"),
  ).features;
  for (const feature of carriedFeatures) {
    assert.equal(Object.hasOwn(feature, "stages"), false);
    assert.equal(Object.hasOwn(feature, "labelHistory"), false);
    assert.equal(Object.hasOwn(feature, "planningRevision"), false);
    assert.equal(Object.hasOwn(feature, "reassessment"), false);
  }

  const groups = run(
    item.cwd,
    "run",
    "context",
    "--id",
    second.id,
    "--detail",
    "planning",
    "--collection",
    "groups",
  );
  assert.equal(groups.status, 0, groups.stderr);
  assert.deepEqual(
    JSON.parse(groups.stdout).evidence.items.map((group) => group.id),
    ["old-a", "old-b"],
  );

  const features = run(
    item.cwd,
    "run",
    "context",
    "--id",
    second.id,
    "--detail",
    "planning",
    "--group",
    "old-a",
    "--collection",
    "features",
  );
  assert.equal(features.status, 0, features.stderr);
  const records = JSON.parse(features.stdout).evidence.items;
  assert.deepEqual(records.map((record) => record.id), ["leaf-a1", "leaf-a2"]);
  assert.ok(records.every((record) => record.previous && record.proposed));
});

test("proposal-patch 按业务域增量维护提案且不回显整张地图", () => {
  const item = fixture();
  const refinement = startRefinement(item);
  const patchFile = path.join(item.cwd, "old-a.patch.json");
  writeJson(patchFile, {
    schemaVersion: 1,
    groups: [
      {
        id: "old-a",
        title: "业务域 A",
        rank: 5,
        sourceFeatureIds: ["old-a"],
      },
    ],
    features: [
      {
        id: "draft-a",
        title: "增量功能 A",
        parentId: "old-a",
        rank: 10,
      },
    ],
    migrations: [
      {
        type: "rename",
        from: ["old-a"],
        to: ["draft-a"],
        reason: "按业务域增量重排",
      },
    ],
  });
  const applied = run(
    item.cwd,
    "feature",
    "proposal-patch",
    "--run",
    refinement.id,
    "--from",
    patchFile,
  );
  assert.equal(applied.status, 0, applied.stderr);
  assert.ok(Buffer.byteLength(applied.stdout) < 3000);
  const result = JSON.parse(applied.stdout);
  assert.deepEqual(result.changed.features, ["draft-a"]);
  assert.equal(result.totals.features, 1);
  assert.ok(fs.existsSync(path.join(item.store, result.audit)));
  const proposalFile = path.join(refinement.dir, "proposal.json");
  const proposal = JSON.parse(fs.readFileSync(proposalFile, "utf8"));
  assert.equal(proposal.groups.find((group) => group.id === "old-a").rank, 5);
  assert.equal(proposal.features[0].id, "draft-a");
  assert.deepEqual(proposal.migrations.find((entry) => entry.from.includes("old-a")).to, ["draft-a"]);

  const planningPage = run(
    item.cwd,
    "run",
    "context",
    "--id",
    refinement.id,
    "--detail",
    "planning",
    "--group",
    "old-a",
  );
  assert.equal(planningPage.status, 0, planningPage.stderr);
  assert.equal(JSON.parse(planningPage.stdout).evidence.items[0].id, "draft-a");

  const removalFile = path.join(item.cwd, "old-a.remove.json");
  writeJson(removalFile, {
    schemaVersion: 1,
    remove: { features: ["draft-a"], migrationsFrom: ["old-a"] },
  });
  const removed = run(
    item.cwd,
    "feature",
    "proposal-patch",
    "--run",
    refinement.id,
    "--from",
    removalFile,
  );
  assert.equal(removed.status, 0, removed.stderr);
  const afterRemoval = JSON.parse(fs.readFileSync(proposalFile, "utf8"));
  assert.equal(afterRemoval.features.length, 0);
  assert.equal(afterRemoval.migrations.some((entry) => entry.from.includes("old-a")), false);

  const largeFile = path.join(item.cwd, "too-large.patch.json");
  fs.writeFileSync(largeFile, JSON.stringify({ schemaVersion: 1, padding: "x".repeat(65_000) }));
  const tooLarge = run(
    item.cwd,
    "feature",
    "proposal-patch",
    "--run",
    refinement.id,
    "--from",
    largeFile,
  );
  assert.notEqual(tooLarge.status, 0);
  assert.match(tooLarge.stderr, /64000 bytes/);
});

test("apply 校验迁移与 DAG，生成当前地图并支持依赖闭包提取", () => {
  const item = fixture();
  const refinement = startRefinement(item);
  validProposal(refinement.dir, refinement.id);
  const applied = run(item.cwd, "feature", "apply", "--from-run", refinement.id);
  assert.equal(applied.status, 0, applied.stderr);
  const map = JSON.parse(
    fs.readFileSync(path.join(item.store, "planning", "feature-map.json"), "utf8"),
  );
  assert.equal(map.features.length, 3);
  assert.equal(map.schemaVersion, 4);
  assert.equal(map.features[0].kind ?? "product", "product");
  assert.deepEqual(
    map.features.map((feature) => feature.id),
    ["leaf-a1", "leaf-a2", "leaf-b"],
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(refinement.dir, "run.json"), "utf8")).status,
    "done",
  );
  const status = run(item.cwd, "feature", "status");
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /fresh/);
  const dashboard = dashboardState(item.store);
  assert.equal(dashboard.planning.features.length, 3);
  assert.ok(dashboard.runs.some((run) => run.type === "refinement"));
  assert.deepEqual(
    runDetail(item.store, "refinement", refinement.id).documents.map((document) => document.id),
    ["brief", "analysis", "context", "proposal", "validation"],
  );

  const unknownProcess = run(
    item.cwd,
    "delivery",
    "start",
    "--source",
    "feature-map",
    "--intensity",
    "focused",
    "--features",
    "leaf-b",
    "--process",
    "miniapp-product@99",
  );
  assert.notEqual(unknownProcess.status, 0);
  assert.match(unknownProcess.stderr, /process.json 不存在/);

  const delivery = run(
    item.cwd,
    "delivery",
    "start",
    "--source",
    "feature-map",
    "--intensity",
    "focused",
    "--features",
    "leaf-b",
    "--process",
    "miniapp-product@1",
  );
  assert.equal(delivery.status, 0, delivery.stderr);
  const deliveryId = delivery.stdout.trim().split("\n").at(-1);
  const input = JSON.parse(
    fs.readFileSync(
      path.join(item.store, "delivery-runs", deliveryId, "delivery-input.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    input.featureInputs.map((feature) => feature.id),
    ["leaf-a1", "leaf-a2", "leaf-b"],
  );
  assert.equal(input.deliveryContract.id, "miniapp-product-delivery");
  assert.ok(
    input.deliveryProcess,
    "feature-map 交付必须冻结所选的版本化流程，而不是只保存通用契约 ID",
  );
  assert.equal(input.deliveryProcess.id, "miniapp-product");
  assert.equal(input.deliveryProcess.version, 1);
  assert.match(input.deliveryProcess.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    input.stages.map((stage) => stage.id),
    ["prototype_alignment", "technical_solution", "development", "end_to_end_acceptance"],
  );
  assert.deepEqual(
    input.stages.map((stage) => stage.agent?.id),
    ["prototype_alignment", "technical_solution", "development", "end_to_end_acceptance"],
  );
  assert.match(input.stages[1].agent.instructions, /最多三个/);
});

test("指定功能点开工门禁要求未开始、疑问已解决且前置已完成", () => {
  const item = fixture();
  const screenshot = path.join(item.store, "prototype-runs", "proto-1", "screenshots", "e1.png");
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  fs.writeFileSync(screenshot, "fixture");
  const refinement = startRefinement(item);
  validProposal(refinement.dir, refinement.id);
  assert.equal(run(item.cwd, "feature", "apply", "--from-run", refinement.id).status, 0);

  const dependencyBlocked = run(item.cwd, "feature", "start", "--id", "leaf-a2");
  assert.notEqual(dependencyBlocked.status, 0);
  assert.match(dependencyBlocked.stderr, /前置功能尚未完成：leaf-a1/);

  writeJson(path.join(item.store, "prototype", "open-questions.json"), {
    schemaVersion: 1,
    sourceRun: "proto-1",
    questions: [
      {
        id: "old-a.question",
        status: "open",
        featureId: "old-a",
        question: "需要确认 A1。",
        location: { heading: "旧功能 A" },
        evidence: [
          {
            entryId: "e1",
            path: "prototype-runs/proto-1/screenshots/e1.png",
          },
        ],
      },
    ],
  });
  const questionBlocked = run(item.cwd, "feature", "start", "--id", "leaf-a1");
  assert.notEqual(questionBlocked.status, 0);
  assert.match(questionBlocked.stderr, /原型变更复评门禁/);

  writeJson(path.join(item.store, "prototype", "open-questions.json"), {
    schemaVersion: 1,
    sourceRun: "proto-1",
    questions: [],
  });
  const started = run(item.cwd, "feature", "start", "--id", "leaf-a1");
  assert.equal(started.status, 0, started.stderr);
  const deliveryId = started.stdout.trim().split("\n").at(-1);
  const input = JSON.parse(
    fs.readFileSync(
      path.join(item.store, "delivery-runs", deliveryId, "delivery-input.json"),
      "utf8",
    ),
  );
  assert.equal(input.intensity, "focused");
  assert.deepEqual(input.featureInputs.map((feature) => feature.id), ["leaf-a1"]);
  assert.equal(input.extraction.selection, "single_leaf_feature_gate");
});

test("关联任务驱动功能阶段并将状态、阻塞与决定追加到功能历史", () => {
  const item = fixture();
  const refinement = startRefinement(item);
  validProposal(refinement.dir, refinement.id);
  assert.equal(run(item.cwd, "feature", "apply", "--from-run", refinement.id).status, 0);

  const delivery = run(
    item.cwd,
    "delivery",
    "start",
    "--source",
    "feature-map",
    "--intensity",
    "focused",
    "--features",
    "leaf-b",
  );
  assert.equal(delivery.status, 0, delivery.stderr);
  const deliveryId = delivery.stdout.trim().split("\n").at(-1);
  useLegacyDelivery(item, deliveryId);
  const planned = run(
    item.cwd,
    "work",
    "plan",
    "--run",
    deliveryId,
    "--task",
    "leaf-b-alignment",
    "--title",
    "叶子 B 原型对齐",
    "--kind",
    "implementation",
    "--phase",
    "prototype_alignment",
    "--features",
    "leaf-b",
    "--writes",
    "app.js",
  );
  assert.equal(planned.status, 0, planned.stderr);
  const claimed = run(
    item.cwd,
    "work",
    "claim",
    "--run",
    deliveryId,
    "--task",
    "leaf-b-alignment",
    "--agent",
    "test-agent",
  );
  assert.equal(claimed.status, 0, claimed.stderr);
  const stage = run(
    item.cwd,
    "delivery",
    "stage",
    "--run",
    deliveryId,
    "--task",
    "leaf-b-alignment",
    "--stage",
    "prototype_alignment",
    "--status",
    "confirmed",
    "--summary",
    "已核对主路径和空态。",
    "--decision",
    "本轮复用既有交互结构。",
  );
  assert.equal(stage.status, 0, stage.stderr);
  const finished = run(
    item.cwd,
    "work",
    "finish",
    "--run",
    deliveryId,
    "--task",
    "leaf-b-alignment",
    "--agent",
    "test-agent",
    "--status",
    "done",
    "--summary",
    "原型对齐完成。",
    "--files",
    "none",
    "--tests",
    "未改代码；已核对记录。",
    "--note",
    "后续 Mock 沿用本次确认的字段口径。",
  );
  assert.equal(finished.status, 0, finished.stderr);

  const history = JSON.parse(
    fs.readFileSync(path.join(item.store, "planning", "feature-history.json"), "utf8"),
  );
  const events = history.events.filter((event) => event.featureId === "leaf-b");
  assert.deepEqual(
    events.map((event) => event.type),
    ["task_planned", "task_claimed", "stage_updated", "task_finished"],
  );
  assert.equal(events[2].decision, "本轮复用既有交互结构。");
  assert.equal(events[3].decision, "后续 Mock 沿用本次确认的字段口径。");

  const map = JSON.parse(
    fs.readFileSync(path.join(item.store, "planning", "feature-map.json"), "utf8"),
  );
  assert.equal(
    map.features.find((feature) => feature.id === "leaf-b").stages.prototype_alignment.status,
    "confirmed",
  );
  const dashboard = dashboardState(item.store);
  const feature = dashboard.planning.features.find((item) => item.id === "leaf-b");
  assert.equal(feature.historySummary.eventCount, 4);
  assert.equal(feature.historySummary.taskCount, 1);
});

test("产品任务按项目交付职责路由，UI 阶段不能写入接口项目", () => {
  const item = fixture();
  const projectFile = path.join(item.store, "project.json");
  const project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  project.codeRoots = [
    { path: "api", role: "api", deliveryRoles: ["api-provider"], writeBoundary: "接口" },
    { path: "mini", role: "mini", deliveryRoles: ["ui-client"], writeBoundary: "客户端" },
  ];
  writeJson(projectFile, project);
  const refinement = startRefinement(item);
  validProposal(refinement.dir, refinement.id);
  assert.equal(run(item.cwd, "feature", "apply", "--from-run", refinement.id).status, 0);
  const delivery = run(
    item.cwd,
    "delivery",
    "start",
    "--source",
    "feature-map",
    "--intensity",
    "focused",
    "--features",
    "leaf-b",
  );
  assert.equal(delivery.status, 0, delivery.stderr);
  const deliveryId = delivery.stdout.trim().split("\n").at(-1);
  useLegacyDelivery(item, deliveryId);
  const wrongProject = run(
    item.cwd,
    "work",
    "plan",
    "--run",
    deliveryId,
    "--task",
    "wrong-ui",
    "--title",
    "错误 UI 项目",
    "--kind",
    "implementation",
    "--phase",
    "prototype_alignment",
    "--scope",
    "product",
    "--leaf-features",
    "leaf-b",
    "--project",
    "api",
    "--writes",
    "api/src/page.tsx",
  );
  assert.notEqual(wrongProject.status, 0);
  assert.match(wrongProject.stderr, /ui-client/);
  const wrongPath = run(
    item.cwd,
    "work",
    "plan",
    "--run",
    deliveryId,
    "--task",
    "wrong-ui-path",
    "--title",
    "错误 UI 路径",
    "--kind",
    "implementation",
    "--phase",
    "prototype_alignment",
    "--scope",
    "product",
    "--leaf-features",
    "leaf-b",
    "--project",
    "mini",
    "--writes",
    "api/src/page.tsx",
  );
  assert.notEqual(wrongPath.status, 0);
  assert.match(wrongPath.stderr, /写入范围必须以交付项目 mini/);
  const planned = run(
    item.cwd,
    "work",
    "plan",
    "--run",
    deliveryId,
    "--task",
    "right-ui",
    "--title",
    "正确 UI 项目",
    "--kind",
    "implementation",
    "--phase",
    "prototype_alignment",
    "--scope",
    "product",
    "--leaf-features",
    "leaf-b",
    "--project",
    "mini",
    "--writes",
    "mini/src/pages/library/index.tsx",
  );
  assert.equal(planned.status, 0, planned.stderr);
  const plan = JSON.parse(
    fs.readFileSync(path.join(item.store, "delivery-runs", deliveryId, "work-plan.json"), "utf8"),
  );
  assert.deepEqual(plan.tasks[0].deliveryTarget, {
    path: "mini",
    role: "mini",
    deliveryRoles: ["ui-client"],
  });
});

test("开发任务更新功能地图但不改写原型文档或索引", () => {
  const item = fixture();
  fs.writeFileSync(
    path.join(item.store, "prototype", "原型图流程.md"),
    "# 原型图流程\n\n## 开发与测试回写规则\n\n## 功能块\n",
  );
  const refinement = startRefinement(item);
  validProposal(refinement.dir, refinement.id);
  assert.equal(run(item.cwd, "feature", "apply", "--from-run", refinement.id).status, 0);
  const flowBefore = fs.readFileSync(path.join(item.store, "prototype", "原型图流程.md"), "utf8");
  const indexBefore = fs.readFileSync(path.join(item.store, "prototype", "feature-index.json"), "utf8");

  const delivery = run(
    item.cwd,
    "delivery",
    "start",
    "--source",
    "feature-map",
    "--intensity",
    "focused",
    "--features",
    "leaf-b",
  );
  assert.equal(delivery.status, 0, delivery.stderr);
  const deliveryId = delivery.stdout.trim().split("\n").at(-1);
  const planned = run(
    item.cwd,
    "work",
    "plan",
    "--run",
    deliveryId,
    "--task",
    "leaf-b-alignment",
    "--title",
    "叶子 B 原型对齐",
    "--kind",
    "implementation",
    "--scope",
    "product",
    "--leaf-features",
    "leaf-b",
    "--writes",
    "app.js",
  );
  assert.equal(planned.status, 0, planned.stderr);
  const governance = run(
    item.cwd,
    "work",
    "plan",
    "--run",
    deliveryId,
    "--task",
    "dashboard-maintenance",
    "--title",
    "看板维护",
    "--kind",
    "governance",
    "--scope",
    "governance",
    "--writes",
    "docs",
  );
  assert.equal(governance.status, 0, governance.stderr);

  const flow = fs.readFileSync(path.join(item.store, "prototype", "原型图流程.md"), "utf8");
  assert.equal(flow, flowBefore);
  assert.equal(fs.readFileSync(path.join(item.store, "prototype", "feature-index.json"), "utf8"), indexBefore);
  assert.equal(run(item.cwd, "prototype", "sync-tasks").status, 0);
  assert.equal(fs.readFileSync(path.join(item.store, "prototype", "原型图流程.md"), "utf8"), flowBefore);
  const history = JSON.parse(fs.readFileSync(path.join(item.store, "planning", "feature-history.json"), "utf8"));
  assert.ok(history.events.some((event) => event.featureId === "leaf-b" && event.taskId === "leaf-b-alignment"));
});

test("apply 拒绝依赖环与未覆盖入口", () => {
  const item = fixture();
  const refinement = startRefinement(item);
  const proposal = validProposal(refinement.dir, refinement.id);
  proposal.features[0].dependsOn = ["leaf-b"];
  proposal.features[2].sourceEntries = [];
  writeJson(path.join(refinement.dir, "proposal.json"), proposal);
  const applied = run(item.cwd, "feature", "apply", "--from-run", refinement.id);
  assert.notEqual(applied.status, 0);
  assert.match(applied.stderr, /依赖存在环/);
  assert.match(applied.stderr, /e3/);
});

test("apply 拒绝把依赖排在被依赖功能之后", () => {
  const item = fixture();
  const refinement = startRefinement(item);
  const proposal = validProposal(refinement.dir, refinement.id);
  proposal.groups[0].rank = 20;
  proposal.groups[1].rank = 10;
  writeJson(path.join(refinement.dir, "proposal.json"), proposal);
  const applied = run(item.cwd, "feature", "apply", "--from-run", refinement.id);
  assert.notEqual(applied.status, 0);
  assert.match(applied.stderr, /必须排在它之前/);
});

test("apply 拒绝证据快照之后发生的代码变化", () => {
  const item = fixture();
  const refinement = startRefinement(item);
  validProposal(refinement.dir, refinement.id);
  fs.writeFileSync(path.join(item.cwd, "app.js"), "export const value = 2;\n");
  const applied = run(item.cwd, "feature", "apply", "--from-run", refinement.id);
  assert.notEqual(applied.status, 0);
  assert.match(applied.stderr, /已变化/);
});

test("apply 忽略证据快照后的 mf-dev-flow 运行记录", () => {
  const item = fixture();
  const refinement = startRefinement(item);
  validProposal(refinement.dir, refinement.id);
  writeJson(path.join(item.store, "delivery-runs", "writer", "run.json"), {
    schemaVersion: 1,
    id: "writer",
    type: "delivery",
    status: "in_progress",
  });

  const applied = run(item.cwd, "feature", "apply", "--from-run", refinement.id);
  assert.equal(applied.status, 0, applied.stderr);
});

test("apply 忽略证据快照后的 mf-dev-flow hook 自测变化", () => {
  const item = fixture();
  const hookTest = path.join(item.cwd, ".codex", "skills", "mf-dev-flow", "integrations", "codex", "hooks", "mf-dev-flow.test.mjs");
  fs.mkdirSync(path.dirname(hookTest), { recursive: true });
  fs.writeFileSync(hookTest, "export const revision = 1;\n");

  const refinement = startRefinement(item);
  validProposal(refinement.dir, refinement.id);
  fs.writeFileSync(hookTest, "export const revision = 2;\n");

  const applied = run(item.cwd, "feature", "apply", "--from-run", refinement.id);
  assert.equal(applied.status, 0, applied.stderr);
});

test("从功能地图启动交付不会让地图自我过期", () => {
  const item = fixture();
  const refinement = startRefinement(item);
  validProposal(refinement.dir, refinement.id);
  assert.equal(run(item.cwd, "feature", "apply", "--from-run", refinement.id).status, 0);

  const started = run(item.cwd, "delivery", "start", "--source", "feature-map", "--intensity", "focused", "--features", "leaf-a1");
  assert.equal(started.status, 0, started.stderr);
  const id = started.stdout.trim().split("\n").at(-1);
  const planned = run(item.cwd, "work", "plan", "--run", id, "--task", "pipeline", "--title", "阶段接力", "--kind", "ui", "--scope", "product", "--leaf-features", "leaf-a1", "--writes", "app.js", "--verify", "fixture verification");
  assert.equal(planned.status, 0, planned.stderr);
  const claimed = run(item.cwd, "work", "claim", "--run", id, "--task", "pipeline", "--agent", "prototype_alignment", "--session", "alignment-session", "--target-phase", "prototype_alignment");
  assert.equal(claimed.status, 0, claimed.stderr);
  const rebound = run(item.cwd, "work", "bind-session", "--run", id, "--task", "pipeline", "--agent", "prototype_alignment", "--session", "rebound-session", "--target-phase", "prototype_alignment");
  assert.equal(rebound.status, 0, rebound.stderr);
  const staged = run(item.cwd, "delivery", "stage", "--run", id, "--task", "pipeline", "--stage", "prototype_alignment", "--status", "in_progress", "--summary", "继续收集 fixture 原型对齐证据");
  assert.equal(staged.status, 0, staged.stderr);

  const status = run(item.cwd, "feature", "status");
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /功能演进地图：fresh/);
});

test("连续任务在首阶段确认后允许同 agent 晚绑定缺失的 session", () => {
  const item = fixture();
  const refinement = startRefinement(item);
  validProposal(refinement.dir, refinement.id);
  assert.equal(run(item.cwd, "feature", "apply", "--from-run", refinement.id).status, 0);
  const started = run(item.cwd, "delivery", "start", "--source", "feature-map", "--intensity", "focused", "--features", "leaf-a1");
  assert.equal(started.status, 0, started.stderr);
  const id = started.stdout.trim().split("\n").at(-1);
  const call = (...args) => {
    const result = run(item.cwd, ...args);
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  call("work", "plan", "--run", id, "--task", "pipeline", "--title", "阶段接力", "--kind", "ui", "--scope", "product", "--leaf-features", "leaf-a1", "--writes", "app.js", "--verify", "fixture verification");
  call("work", "claim", "--run", id, "--task", "pipeline", "--agent", "prototype_alignment", "--target-phase", "prototype_alignment");
  call("delivery", "stage", "--run", id, "--task", "pipeline", "--stage", "prototype_alignment", "--status", "not_applicable", "--summary", "结论：fixture 阶段已确认；证据：fixture；变更：无；验证：检查点；风险/下一步：无");

  const bound = call("work", "bind-session", "--run", id, "--task", "pipeline", "--agent", "prototype_alignment", "--session", "late-session", "--target-phase", "prototype_alignment");
  assert.match(bound.stdout, /已绑定/);
  const checkpoint = call("work", "checkpoint-gate", "--session", "late-session", "--agent", "prototype_alignment");
  assert.match(checkpoint.stdout, /"verdict":"pass"/);
});

test("功能地图启动的小程序产品任务写入四阶段 Todo", () => {
  const item = fixture();
  const refinement = startRefinement(item);
  validProposal(refinement.dir, refinement.id);
  assert.equal(run(item.cwd, "feature", "apply", "--from-run", refinement.id).status, 0);
  const started = run(item.cwd, "delivery", "start", "--source", "feature-map", "--intensity", "focused", "--features", "leaf-a1");
  assert.equal(started.status, 0, started.stderr);
  const id = started.stdout.trim().split("\n").at(-1);
  const dir = path.join(item.store, "delivery-runs", id);
  const read = (file) => fs.readFileSync(path.join(dir, file), "utf8");
  const plan = read("plan.md");
  assert.match(plan, /## 开发任务输入/);
  assert.match(plan, /## 并发任务/);
  assert.match(plan, /stage-todo/);
  assert.match(plan, /prototype_alignment/);
  assert.match(plan, /technical_solution/);
  assert.match(plan, /development/);
  assert.match(plan, /end_to_end_acceptance/);
  assert.doesNotMatch(plan, /api_mock/);
  assert.match(read("implementation.md"), /实时记录/);
  assert.match(read("verification.md"), /测试与回归/);
});

test("版本化流程只允许阶段 agent 领取，并在验证检查点后记录交接", () => {
  const item = fixture();
  const refinement = startRefinement(item);
  validProposal(refinement.dir, refinement.id);
  assert.equal(run(item.cwd, "feature", "apply", "--from-run", refinement.id).status, 0);
  const started = run(item.cwd, "delivery", "start", "--source", "feature-map", "--intensity", "focused", "--features", "leaf-a1");
  assert.equal(started.status, 0, started.stderr);
  const id = started.stdout.trim().split("\n").at(-1);
  const call = (...args) => {
    const result = run(item.cwd, ...args);
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  call("work", "plan", "--run", id, "--task", "pipeline", "--title", "阶段接力", "--kind", "ui", "--scope", "product", "--leaf-features", "leaf-a1", "--writes", "app.js", "--verify", "fixture verification");

  const skippedClaim = run(item.cwd, "work", "claim", "--run", id, "--task", "pipeline", "--agent", "end_to_end_acceptance", "--session", "skipped-session", "--target-phase", "end_to_end_acceptance");
  assert.notEqual(skippedClaim.status, 0);
  assert.match(skippedClaim.stderr, /prototype_alignment/);

  const executionFile = path.join(item.store, "delivery-runs", id, "executions", "pipeline.json");
  writeJson(executionFile, {
    schemaVersion: 2,
    runId: id,
    taskId: "pipeline",
    agent: "end_to_end_acceptance",
    sessionId: "forged-session",
    status: "in_progress",
    targetPhase: "end_to_end_acceptance",
    stages: {},
    checkpoints: [],
    attempts: [],
  });
  const wrongStage = run(item.cwd, "delivery", "stage", "--run", id, "--task", "pipeline", "--stage", "prototype_alignment", "--status", "not_applicable", "--summary", "结论：不适用；证据：fixture；变更：无；验证：fixture；风险/下一步：无");
  assert.notEqual(wrongStage.status, 0);
  assert.match(wrongStage.stderr, /prototype_alignment/);
  fs.rmSync(executionFile);

  const wrongClaim = run(item.cwd, "work", "claim", "--run", id, "--task", "pipeline", "--agent", "development", "--session", "wrong-session", "--target-phase", "prototype_alignment");
  assert.notEqual(wrongClaim.status, 0);
  assert.match(wrongClaim.stderr, /prototype_alignment/);

  call("work", "claim", "--run", id, "--task", "pipeline", "--agent", "prototype_alignment", "--session", "alignment-session", "--target-phase", "prototype_alignment");
  const earlySwitch = run(item.cwd, "work", "bind-session", "--run", id, "--task", "pipeline", "--agent", "technical_solution", "--session", "solution-session", "--target-phase", "technical_solution");
  assert.notEqual(earlySwitch.status, 0);
  assert.match(earlySwitch.stderr, /进行中/);

  call("delivery", "stage", "--run", id, "--task", "pipeline", "--stage", "prototype_alignment", "--status", "not_applicable", "--summary", "结论：本 fixture 不执行真实 UI 验证；证据：fixture；变更：无；验证：检查点；风险/下一步：交给方案阶段");
  const checkpoint = call("work", "checkpoint-gate", "--session", "alignment-session", "--agent", "prototype_alignment");
  assert.match(checkpoint.stdout, /"verdict":"pass"/);
  call("work", "bind-session", "--run", id, "--task", "pipeline", "--agent", "technical_solution", "--session", "solution-session", "--target-phase", "technical_solution");

  const execution = JSON.parse(fs.readFileSync(path.join(item.store, "delivery-runs", id, "executions", "pipeline.json"), "utf8"));
  assert.equal(execution.agent, "technical_solution");
  assert.equal(execution.attempts.at(-1).agent, "technical_solution");
  assert.deepEqual(execution.handoffs.at(-1).fromAgent, "prototype_alignment");
  assert.deepEqual(execution.handoffs.at(-1).toAgent, "technical_solution");
  assert.equal(execution.handoffs.at(-1).fromPhase, "prototype_alignment");
  assert.equal(execution.handoffs.at(-1).toPhase, "technical_solution");
  const brief = call("work", "delivery-brief", "--run", id, "--task", "pipeline").stdout;
  assert.match(brief, /当前阶段 Agent[\s\S]*technical_solution/);
  assert.match(brief, /只基于已确认的原型对齐结论/);
  assert.doesNotMatch(brief, /只实施已确认技术方案中的范围/);
});


test("注册任务类型在创建时冻结，完成和合并都检查真实归档文件", () => {
  const item = fixture(), refinement = startRefinement(item);
  validProposal(refinement.dir, refinement.id);
  const call = (...args) => { const result = run(item.cwd, ...args); assert.equal(result.status, 0, result.stderr); return result; };
  call('feature', 'apply', '--from-run', refinement.id);
  const id = call('delivery', 'start', '--source', 'manual', '--intensity', 'focused', '--task', '通用接口验收', '--title', '通用接口验收', '--prototype-run', 'proto-1').stdout.trim().split('\n').at(-1);
  const dir = path.join(item.store, 'delivery-runs', id);
  const projectFile = path.join(item.store, 'project.json'), project = JSON.parse(fs.readFileSync(projectFile));
  project.codeRoots = [{ path: 'api', role: 'api', deliveryRoles: ['api-provider'] }]; writeJson(projectFile, project);
  call('work', 'plan', '--run', id, '--task', 'typed', '--title', '接口验收', '--kind', 'api', '--scope', 'governance', '--projects', 'api', '--writes', 'api/app.js', '--verify', 'fixture verification');
  const task = JSON.parse(fs.readFileSync(path.join(dir, 'work-plan.json'))).tasks[0];
  assert.equal(task.taskType.id, 'api'); assert.equal(task.taskType.version, 1); assert.deepEqual(task.stageDefinitions, []);
  call('work', 'claim', '--run', id, '--task', 'typed', '--agent', 'fixture', '--session', 'typed-session');
  assert.match(call('work', 'delivery-brief', '--run', id, '--task', 'typed').stdout, /failure-path/);
  const args = ['work', 'finish', '--run', id, '--task', 'typed', '--agent', 'fixture', '--status', 'done', '--summary', 'fixture', '--files', 'api/app.js', '--tests', 'fixture'];
  assert.notEqual(run(item.cwd, ...args).status, 0);
  const acceptance = { type: 'api', version: 1, checks: task.taskType.criteria.map(item => ({ id: item.id, status: 'passed', evidence: ['evidence.log'] })) };
  const file = path.join(item.cwd, 'acceptance.json'); writeJson(file, acceptance);
  assert.notEqual(run(item.cwd, ...args, '--acceptance', file).status, 0);
  fs.writeFileSync(path.join(dir, 'evidence.log'), 'SYNTHETIC test artifact; not product evidence');
  acceptance.checks[0].status = 'failed'; writeJson(file, acceptance);
  assert.notEqual(run(item.cwd, ...args, '--acceptance', file).status, 0);
  acceptance.checks[0].status = 'passed'; writeJson(file, acceptance);
  call(...args, '--acceptance', file); call('work', 'merge-check', '--run', id);
  fs.unlinkSync(path.join(dir, 'evidence.log'));
  assert.notEqual(run(item.cwd, 'work', 'merge-check', '--run', id).status, 0);
});
