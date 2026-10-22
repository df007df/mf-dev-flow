import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph, writeGraph, loadGraph, graphFile, stableStringify, featureTriggers, flagFeatureTrigger, clearFeatureTriggers, syncDriftTriggers } from "../graph.mjs";
import { closure } from "../closure.mjs";
import { readPrototypeRevision } from "../../planning/impact.mjs";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/mf-dev-flow.mjs");
const tempDirs = [];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixtureWorkspace() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-graph-")));
  tempDirs.push(root);
  const store = path.join(root, ".mf-dev-flow");
  writeJson(path.join(store, "project.json"), { schemaVersion: 1 });
  writeJson(path.join(store, "planning", "feature-map.json"), {
    schemaVersion: 3,
    groups: [{ id: "dom-a", title: "域A" }],
    features: [
      { id: "f-one", parentId: "dom-a", title: "F1", scopeRefs: ["prototype:g1"], sourceEntries: ["e1"], systemCardRefs: ["system-main"], dependsOn: [], status: "blocked", reassessment: { status: "stale", prototypeFingerprint: "sha256:old", runId: "r0" }, stages: { development: { status: "confirmed" } }, updatedAt: "2026-09-08T00:00:00Z" },
      { id: "f-two", parentId: "dom-a", title: "F2", scopeRefs: ["prototype:g1"], sourceEntries: ["e1"], dependsOn: ["f-one"], status: "done" },
      { id: "f-three", parentId: "dom-a", title: "F3", scopeRefs: ["prototype:g2"], sourceEntries: ["e2"], dependsOn: [] },
      { id: "f-four", parentId: "f-one", title: "F4", scopeRefs: ["prototype:g1"], sourceEntries: ["e1"], dependsOn: [] },
      { id: "f-six", parentId: "dom-a", title: "F6", scopeRefs: ["prototype:g2"], sourceEntries: ["e2"], dependsOn: [], reassessment: { status: "reviewed", prototypeFingerprint: "sha256:old", runId: "r9" } },
    ],
  });
  writeJson(path.join(store, "prd", "manifest.json"), { schemaVersion: 1, sources: [{ id: "prd-alpha", title: "PRD α", kind: "dingtalk", location: "https://example/x" }] });
  fs.mkdirSync(path.join(store, "prd", "sources"), { recursive: true });
  fs.writeFileSync(path.join(store, "prd", "sources", "prd-alpha.md"), "# PRD α\n正文\n");
  writeJson(path.join(store, "prd", "analyses", "b1", "findings.json"), {
    schemaVersion: 1, batchId: "b1", title: "T", summary: {}, sources: ["prd-alpha"], items: [],
    affectsLinks: [{ sourceId: "prd-alpha", to: "prototype:g1" }],
  });
  writeJson(path.join(store, "system", "cards.json"), { schemaVersion: 2, runId: "sys-1", cards: [{ id: "system-main", title: "System Main", status: "confirmed", relationship: "r", authority: "a", sources: [{ id: "s1", kind: "api" }], changeLog: [{ at: "x" }], lastVerifiedAt: "y" }], removeCardIds: [] });
  writeJson(path.join(store, "tasks", "run-1.json"), { schemaVersion: 1, kind: "run", id: "run-1", typeRef: { id: "generic-delivery", version: 1 }, title: "R1", status: "completed", taskRefs: ["task:run-1/t1"], createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T01:00:00Z" });
  writeJson(path.join(store, "tasks", "run-1", "t1.json"), {
    schemaVersion: 1, kind: "task", id: "run-1/t1", runId: "run-1", typeRef: { id: "generic-delivery", version: 1 }, title: "T1",
    status: "completed", agent: "root", sessionId: null, parentTask: null, subtasks: [], sourceRefs: ["feature:f-one"],
    touchedRefs: [{ ref: "code:src/a.ts", provenance: "reconciled" }],
    outputs: { reports: [], artifacts: [] }, processData: { hookHealth: "observed", provenance: "reconciled", complete: true },
    phaseRef: null, extensions: {}, timeline: [{ at: "2026-09-08T00:10:00Z", event: "created", by: "agent:root" }],
    createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T01:00:00Z",
  });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  writeJson(path.join(store, "execution-index.json"), {
    schemaVersion: 1, generatedAt: "2026-09-08T01:00:00Z",
    runs: [{ id: "run-1", type: "delivery", title: "R1", tasks: [{ id: "t1", title: "T1", kind: "ui", features: ["f-one"], writes: ["src"], dependsOn: [], status: "completed", agent: "root", executionFile: "tasks/run-1/t1.json", updatedAt: "2026-09-08T01:00:00Z" }] }],
  });
  return root;
}

test("构建：节点分类、边方向与 reassessment 触发列表投影", () => {
  const { graph, problems, notes } = buildGraph(fixtureWorkspace());
  assert.deepEqual(problems, []);
  const nodeOf = ref => graph.nodes.find(n => n.ref === ref);
  assert.equal(nodeOf("prototype:g1").kind, "prototype-group");
  assert.equal(nodeOf("prototype:e1").kind, "prototype-entry");
  assert.equal(nodeOf("feature:f-one").kind, "feature");
  assert.equal(nodeOf("feature-group:dom-a").kind, "feature-group");
  assert.equal(nodeOf("prototype:g1").objectRef, "mf-dev-flow:prototype-group:g1");
  assert.equal(nodeOf("prototype:e1").objectRef, "mf-dev-flow:prototype-entry:e1");
  assert.equal(nodeOf("feature:f-one").objectRef, "mf-dev-flow:feature:f-one");
  assert.equal(nodeOf("feature-group:dom-a").objectRef, "mf-dev-flow:feature-group:dom-a");
  assert.equal(nodeOf("task:run-1/t1").objectRef, "mf-dev-flow:task:kernel/run-1/t1");
  assert.equal(nodeOf("code:src/a.ts").objectRef, "mf-dev-flow:code-file:src/a.ts");
  assert.equal(nodeOf("prd:prd-alpha").fingerprint.startsWith("sha256:"), true);
  const hasEdge = (from, to, kind) => graph.edges.some(e => e.from === from && e.to === to && e.kind === kind);
  assert.ok(hasEdge("feature:f-one", "feature-group:dom-a", "parent"));
  assert.ok(hasEdge("feature:f-four", "feature:f-one", "parent"));
  assert.ok(hasEdge("feature:f-two", "feature:f-one", "depends-on"));
  assert.ok(hasEdge("feature:f-one", "prototype:g1", "scope-ref"));
  assert.ok(hasEdge("feature:f-one", "system:system-main", "scope-ref"));
  assert.ok(hasEdge("prd:prd-alpha", "prototype:g1", "evidence-for"));
  assert.ok(hasEdge("task:run-1/t1", "feature:f-one", "implements"));
  // kernel 已覆盖同一 task→feature 时，execution-index 兜底不得再产平行边（单一真源）
  assert.deepEqual(
    graph.edges.filter(edge => edge.kind === "implements" && edge.from === "task:run-1/t1" && edge.to === "feature:f-one").map(edge => edge.declaredBy),
    ["kernel:run-1/t1"],
  );
  assert.ok(hasEdge("task:run-1/t1", "code:src/a.ts", "observed-change"));
  assert.deepEqual(nodeOf("feature:f-one").reassessment, [{ triggerRef: "prototype:legacy-baseline", triggerKind: "prototype-group", triggerFingerprint: "sha256:old", dirtyAt: null, status: "open", clearedByTask: "r0" }]);
  // legacy refinement 写入的 status:"reviewed" 表示已被该 run 复评处理，迁移为 cleared
  assert.deepEqual(nodeOf("feature:f-six").reassessment, [{ triggerRef: "prototype:legacy-baseline", triggerKind: "prototype-group", triggerFingerprint: "sha256:old", dirtyAt: null, status: "cleared", clearedByTask: "r9" }]);
  assert.ok(notes.some(n => n.includes("catalog")));});

test("确定性：两次构建字节一致（fixture D）", () => {
  const root = fixtureWorkspace();
  const first = stableStringify(buildGraph(root).graph);
  const second = stableStringify(buildGraph(root).graph);
  assert.equal(first, second);
  writeGraph(root);
  const a = fs.readFileSync(graphFile(root));
  writeGraph(root);
  assert.deepEqual(a, fs.readFileSync(graphFile(root)));
});

test("闭包：PRD→分组→功能点两跳传递 + done 不过滤 + 任务不外溢（fixture B）", () => {
  const { graph } = buildGraph(fixtureWorkspace());
  const { affected } = closure(graph, ["prd:prd-alpha"], { direction: "dependents" });
  const refs = affected.map(item => item.ref);
  assert.ok(refs.includes("prototype:g1"));
  assert.ok(refs.includes("feature:f-one"));
  assert.ok(refs.includes("feature:f-two"), "done 状态功能点同样纳入复核");
  assert.ok(refs.includes("feature:f-four"), "parent 后代沿闭包展开");
  assert.ok(!refs.includes("feature:f-three"), "未关联触发分组的不在集合");
  assert.ok(!refs.includes("task:run-1/t1"), "task 是记录终点，不被传播命中");
  const ftwo = affected.find(item => item.ref === "feature:f-two");
  assert.equal(ftwo.origin, "prd:prd-alpha");
});

test("闭包 sources 向：任务下钻到其来源（看板反查方向）", () => {
  const { graph } = buildGraph(fixtureWorkspace());
  const { affected } = closure(graph, ["task:run-1/t1"], { direction: "sources" });
  const refs = affected.map(item => item.ref);
  assert.ok(refs.includes("feature:f-one"));
  assert.ok(refs.includes("code:src/a.ts"));
});

test("漂移检查：新增功能点被 check 报告，重建后归零", () => {
  const root = fixtureWorkspace();
  writeGraph(root);
  const map = JSON.parse(fs.readFileSync(path.join(root, ".mf-dev-flow", "planning", "feature-map.json"), "utf8"));
  map.features.push({ id: "f-five", parentId: "dom-a", title: "F5", scopeRefs: ["prototype:g1"], sourceEntries: ["e1"], dependsOn: [] });
  writeJson(path.join(root, ".mf-dev-flow", "planning", "feature-map.json"), map);
  const check = writeGraph(root, { check: true });
  assert.equal(check.matches, false);
  assert.deepEqual(check.drift.addedNodes, ["feature:f-five"]);
  const rebuilt = writeGraph(root);
  assert.deepEqual(rebuilt.drift.addedNodes, ["feature:f-five"], "落盘时仍相对旧存档报漂移");
  const second = writeGraph(root);
  assert.equal(second.drift, null);
  assert.ok(loadGraph(root).nodes.some(n => n.ref === "feature:f-five"));
});

test("CLI：build → impact 输出建议分派且 autoCreate=false", () => {
  const root = fixtureWorkspace();
  const built = spawnSync(process.execPath, [cli, "graph", "build", "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  const impacted = spawnSync(process.execPath, [cli, "graph", "impact", "--from", "prd:prd-alpha", "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(impacted.status, 0, impacted.stderr);
  const result = JSON.parse(impacted.stdout);
  const targets = result.dispatchSuggestions[0];
  assert.equal(targets.openTaskType, "feature-impact-review");
  assert.equal(targets.autoCreate, false);
  assert.equal(targets.batching, "per-trigger");
  assert.deepEqual(targets.targets.sort(), ["feature:f-four", "feature:f-one", "feature:f-two"]);
  const badSeed = spawnSync(process.execPath, [cli, "graph", "impact", "--from", "feature:ghost"], { cwd: root, encoding: "utf8" });
  assert.equal(badSeed.status, 1);
  assert.match(badSeed.stderr, /不在图中/);
});

test("非法边组合与缺图命令返回明确错误，不猜", () => {
  const root = fixtureWorkspace();
  const missing = spawnSync(process.execPath, [cli, "graph", "node", "--ref", "feature:f-one"], { cwd: root, encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /graph build/);
});

test("复评触发纯函数：flag 幂等 + clear 只动 open + 保留 legacy 审计", () => {
  const map = { features: [{ id: "fx", reassessment: { status: "reviewed", runId: "r9", prototypeFingerprint: "sha:old" } }] };
  assert.equal(featureTriggers(map.features[0]).every(t => t.status === "cleared"), true);
  const f = flagFeatureTrigger(map, { featureRef: "feature:fx", triggerRef: "prototype:gz", triggerFingerprint: "sha:new", at: "T1" });
  assert.equal(f.changed, true);
  const triggers = map.features[0].reassessment.triggers;
  assert.equal(triggers.find(t => t.triggerRef === "prototype:gz").status, "open");
  // 旧形制迁移后原对象保留在 legacy，复评审计不丢
  assert.equal(map.features[0].reassessment.legacy.prototypeFingerprint, "sha:old");
  // 同 trigger+同 fingerprint 幂等（广播风暴熔断：不重复置脏）
  assert.equal(flagFeatureTrigger(map, { featureRef: "feature:fx", triggerRef: "prototype:gz", triggerFingerprint: "sha:new" }).changed, false);
  // 新 fingerprint 才重新置脏
  assert.equal(flagFeatureTrigger(map, { featureRef: "feature:fx", triggerRef: "prototype:gz", triggerFingerprint: "sha:newer", at: "T2" }).changed, true);
  const c = clearFeatureTriggers(map, { featureRef: "feature:fx", clearedByTask: "run-x/t9", at: "T3" });
  assert.deepEqual(c.cleared, ["prototype:gz"]);
  const after = map.features[0].reassessment.triggers;
  assert.equal(after.find(t => t.triggerRef === "prototype:gz").status, "cleared");
  assert.equal(after.find(t => t.triggerRef === "prototype:gz").clearedByTask, "run-x/t9");
  assert.match(clearFeatureTriggers(map, { featureRef: "feature:nope" }).reason, /不存在/);
  assert.match(flagFeatureTrigger(map, { featureRef: "feature:nope", triggerRef: "prototype:x" }).reason, /不存在/);
});

test("漂移置脏纯函数：来源精确 + 继承兜底 + 幂等 + current 无操作", () => {
  const map = { features: [
    { id: "bySource", sourceEntries: ["e1"], sourceFeatureIds: ["g1"] },
    { id: "inherited", sourceEntries: [], dependsOn: ["bySource"] },
  ] };
  const impact = { status: "review_required", id: "imp1", to: "rev2",
    changedEntryIds: ["e1"], changedGroupIds: ["g1"], changedRequirementIds: [], changedQuestionIds: [],
    affected: [
      { id: "bySource", status: "not_started", reasons: ["prototype_entry_changed", "prototype_group_changed"] },
      { id: "inherited", status: "not_started", reasons: ["dependent:bySource"] },
    ] };
  const r1 = syncDriftTriggers(map, impact, { at: "T" });
  assert.equal(r1.changed, true);
  assert.deepEqual(map.features[0].reassessment.triggers.map(t => t.triggerRef).sort(), ["prototype:e1", "prototype:g1"]);
  const inherited = map.features[1].reassessment.triggers;
  assert.deepEqual(inherited.map(t => t.triggerRef), ["prototype:drift"]);
  assert.equal(inherited[0].triggerFingerprint, "rev2");
  // 同影响重复 sync 幂等
  assert.equal(syncDriftTriggers(map, impact).changed, false);
  // 一致状态不置脏
  assert.equal(syncDriftTriggers(map, { status: "current" }).changed, false);
  // 新指纹重新置脏
  assert.equal(syncDriftTriggers(map, { ...impact, id: "imp2", to: "rev3", affected: [{ id: "inherited", reasons: ["dependent:bySource"] }] }).changed, true);
});

// 独立 fixture：带 legacy 原型真源 + 与当前 revision 对齐的 prototypeBaseline，驱动真实 drift。
function syncFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-sync-")));
  tempDirs.push(root);
  const store = path.join(root, ".mf-dev-flow");
  writeJson(path.join(store, "project.json"), { schemaVersion: 1 });
  const revision = null; // set below after prototype files exist
  writeJson(path.join(store, "prototype", "feature-index.json"), { features: [{ id: "g1", title: "G1", sourceEntries: ["e1"] }] });
  writeJson(path.join(store, "prototype", "coverage.json"), { sourceInventory: { entries: [{ id: "e1", feature: "g1" }], sourceFiles: [] }, coverage: [] });
  writeJson(path.join(store, "prototype", "open-questions.json"), { questions: [] });
  fs.writeFileSync(path.join(store, "prototype", "原型图流程.md"), "# G1\n- 分组 ID：`g1`\n\n内容A\n");
  const baseline = readPrototypeRevision(store);
  writeJson(path.join(store, "planning", "feature-map.json"), {
    schemaVersion: 3, groups: [{ id: "dom-a", title: "域A" }], migrations: [],
    prototypeBaseline: { schemaVersion: 1, fingerprint: baseline.fingerprint, groups: baseline.groups, entries: baseline.entries, global: baseline.global, files: baseline.files, sourceFiles: baseline.sourceFiles },
    features: [{ id: "s-one", parentId: "dom-a", title: "S1", sourceFeatureIds: ["g1"], sourceEntries: ["e1"], status: "not_started", dependsOn: [] }],
  });
  void revision;
  return root;
}

test("M6 漂移自动置脏 CLI：原型变更→sync 落 open→clear 按终态复评任务→回 cleared", () => {
  const root = syncFixture();
  const store = path.join(root, ".mf-dev-flow");
  const run = (...extra) => spawnSync(process.execPath, [cli, "graph", ...extra, "--json"], { cwd: root, encoding: "utf8" });
  const map = () => JSON.parse(fs.readFileSync(path.join(store, "planning/feature-map.json"), "utf8"));
  const graphNode = ref => JSON.parse(fs.readFileSync(graphFile(root), "utf8")).nodes.find(n => n.ref === ref);
  // 基线一致 → 只报告不落盘
  const noop = JSON.parse(run("build").stdout) && JSON.parse(run("sync").stdout);
  assert.equal(noop.changed, false);
  assert.equal(noop.status, "current");
  // 改原型分组标题 → 分组指纹漂移
  writeJson(path.join(store, "prototype/feature-index.json"), { features: [{ id: "g1", title: "G1 改名", sourceEntries: ["e1"] }] });
  const dry = JSON.parse(run("sync", "--dry-run").stdout);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.changed, true);
  assert.deepEqual(dry.plannedFlags.map(f => [f.feature, f.triggerRef]), [["s-one", "prototype:g1"]]);
  assert.equal(map().features[0].reassessment, undefined, "dry-run 不得写 feature-map");
  const applied = JSON.parse(run("sync").stdout);
  assert.equal(applied.changed, true);
  assert.equal(applied.status, "review_required");
  assert.deepEqual(applied.features, ["s-one"]);
  assert.equal(graphNode("feature:s-one").reassessment.find(t => t.triggerRef === "prototype:g1").status, "open");
  // 重复 sync 幂等
  assert.equal(JSON.parse(run("sync").stdout).changed, false);
  // 终态复评任务清脏
  writeJson(path.join(store, "tasks/rev-1.json"), { schemaVersion: 1, kind: "run", id: "rev-1", typeRef: { id: "feature-impact-review", version: 1 }, title: "复评", status: "completed", taskRefs: ["task:rev-1/r1"], createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T01:00:00Z" });
  writeJson(path.join(store, "tasks/rev-1/r1.json"), { schemaVersion: 1, kind: "task", id: "rev-1/r1", runId: "rev-1", typeRef: { id: "feature-impact-review", version: 1 }, title: "复评 S1", status: "completed", agent: "root", sessionId: null, parentTask: null, subtasks: [], sourceRefs: ["feature:s-one"], touchedRefs: [], outputs: { reports: [], artifacts: [] }, processData: { hookHealth: "none", provenance: "declared", complete: false }, phaseRef: null, extensions: {}, timeline: [], createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T01:00:00Z" });
  const cleared = JSON.parse(run("clear", "--by-task", "rev-1/r1").stdout);
  assert.equal(cleared.changed, true);
  const after = graphNode("feature:s-one").reassessment.find(t => t.triggerRef === "prototype:g1");
  assert.equal(after.status, "cleared");
  assert.equal(after.clearedByTask, "rev-1/r1");
});


test("M6 flag/clear CLI：flag 置脏→投影→按终态任务清脏→幂等→授权拒绝", () => {
  const root = fixtureWorkspace();
  const graphJson = () => JSON.parse(fs.readFileSync(graphFile(root), "utf8"));
  const openOf = (graph, ref) => (graph.nodes.find(n => n.ref === ref)?.reassessment ?? []).filter(t => t.status === "open").map(t => t.triggerRef).sort();
  const run = (...extra) => spawnSync(process.execPath, [cli, "graph", ...extra, "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(run("build").status, 0);
  assert.deepEqual(openOf(graphJson(), "feature:f-one"), ["prototype:legacy-baseline"]);
  const flagged = JSON.parse(run("flag", "--feature", "feature:f-one", "--trigger", "prototype:g2", "--kind", "prototype-group", "--fingerprint", "sha256:new", "--source", "r0").stdout);
  assert.equal(flagged.changed, true);
  assert.deepEqual(openOf(graphJson(), "feature:f-one"), ["prototype:g2", "prototype:legacy-baseline"]);
  // 清脏授权来自终态内核任务 run-1/t1（sourceRefs feature:f-one）
  const cleared = JSON.parse(run("clear", "--by-task", "run-1/t1").stdout);
  assert.equal(cleared.changed, true);
  assert.deepEqual(cleared.cleared[0].triggers.sort(), ["prototype:g2", "prototype:legacy-baseline"]);
  const node = graphJson().nodes.find(n => n.ref === "feature:f-one");
  assert.equal(node.reassessment.length, 2);
  assert.ok(node.reassessment.every(t => t.status === "cleared" && t.clearedByTask === "run-1/t1"));
  // 无 open 可清 → 幂等 false
  assert.equal(JSON.parse(run("clear", "--by-task", "run-1/t1").stdout).changed, false);
  // 授权拒绝：任务记录不存在
  assert.notEqual(run("clear", "--by-task", "run-9/nope").status, 0);
});
