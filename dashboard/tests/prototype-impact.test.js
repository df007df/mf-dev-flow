import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { readPrototypeRevision, prototypeImpact, impactReviewProblems, prototypeDevelopmentProblems } from "../server/prototype-impact.js";
import { planningSummary } from "../server/readers/planning.js";

const script = path.resolve(import.meta.dirname, "../../scripts/mf-dev-flow.mjs");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); };
const evidence = ["prototype", "code", "system"].map((kind) => ({ kind, ref: `${kind}/fixture`, note: "隔离测试证据，支持本轮结论" }));
const analysis = { prototype: "来源原型与交互", code: "已有代码边界", systems: "未提供外部系统，不能推定已接通", scope: "独立用户结果", gaps: ["本轮无范围差异"], sources: evidence };
const leaf = (id, parentId, rank, entry, dependsOn = []) => ({ id, parentId, rank, title: id, outcome: `完成 ${id}`, description: `用户能够完成 ${id}`,
  developmentRequirements: ["按真实原型验收"], sourceEntries: [entry], dependsOn, status: "not_started", priority: "P1", wave: "W1", priorityReason: "用户优先", waveReason: "依赖顺序", analysis, blockers: [] });
function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-impact-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const store = path.join(cwd, ".mf-dev-flow");
  write(path.join(store, "project.json"), { schemaVersion: 1, project: { name: "impact fixture" }, codeRoots: [], confirmedAt: "2026-09-05", prototype: { location: "prototype.html", version: "v1" } });
  fs.writeFileSync(path.join(cwd, "prototype.html"), "<button>fixture</button>");
  write(path.join(store, "current.json"), { schemaVersion: 1, active: null });
  write(path.join(store, "prototype/task.json"), { id: "prototype-main", status: "fresh", source: { prototypeRun: "p1" } });
  const entries = [{ id: "e1", feature: "p-a" }, { id: "e2", feature: "p-a" }, { id: "e3", feature: "p-b" }, { id: "e4", feature: "p-c" }];
  write(path.join(store, "prototype/feature-index.json"), { features: ["p-a", "p-b", "p-c"].map((id) => ({ id, title: id, sourceEntries: entries.filter((entry) => entry.feature === id).map((entry) => entry.id) })) });
  write(path.join(store, "prototype/coverage.json"), { sourceInventory: { entries }, coverage: entries.map((entry) => ({ id: entry.id, status: "covered", evidence: [{ path: `screenshots/${entry.id}.png`, level: "observed" }] })) });
  write(path.join(store, "prototype/open-questions.json"), { questions: [] });
  fs.writeFileSync(path.join(store, "prototype/原型图流程.md"), ["# 原型", ...["p-a", "p-b", "p-c"].map((id) => `# ${id}\n\n- 分组 ID：\`${id}\`\n\n## 待确认问题\n\n无\n\n### 信息补充\n\n${id} 信息`)].join("\n\n"));
  write(path.join(store, "prototype-runs/p1/run.json"), { id: "p1", type: "prototype", status: "done", title: "fixture" });
  write(path.join(store, "prototype-runs/p1/work-plan.json"), { tasks: [] });
  const map = { sourceRun: "old", groups: ["a", "b", "c"].map((id, index) => ({ id, title: id, rank: (index + 1) * 10, sourceFeatureIds: [`p-${id}`] })),
    features: [leaf("a1", "a", 10, "e1"), leaf("a2", "a", 20, "e2"), leaf("b1", "b", 10, "e3", ["a2"]), leaf("c1", "c", 10, "e4")],
    migrations: ["a", "b", "c"].map((id) => ({ type: "split", from: [`p-${id}`], to: id === "a" ? ["a1", "a2"] : [`${id}1`], reason: "用户结果" })), prototypeBaseline: readPrototypeRevision(store) };
  return { cwd, store, map };
}
function supplement(item, group = "p-a", content = "新增交互信息") {
  const file = path.join(item.store, "prototype/原型图流程.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(`${group} 信息`, `${group} 信息：${content}`));
}
function reviewsFor(map, revision) {
  return prototypeImpact(map, revision).affected.map(({ id }) => ({ featureId: id, decision: "keep", deliveryImpact: "preserve", targets: [id], reason: "核对新增说明，既有范围已包含，保持规划",
    checks: Object.fromEntries(["scope", "status", "dependencies", "priority", "wave", "acceptance"].map((key) => [key, "对照事实维持，理由已核验"])), evidence, taskDecisions: [] }));
}
function proposalFor(map, revision) {
  return { ...structuredClone(map), prototypeImpactId: prototypeImpact(map, revision).id, impactReviews: reviewsFor(map, revision),
    migrations: [...map.migrations, ...map.features.map((feature) => ({ type: "unchanged", from: [feature.id], to: [feature.id], reason: "保持" }))] };
}
const cli = (item, ...args) => spawnSync(process.execPath, [script, ...args], { cwd: item.cwd, encoding: "utf8" });
function refine(item, title) {
  const result = cli(item, "feature", "refine", "--title", title);
  assert.equal(result.status, 0, result.stderr);
  const id = result.stdout.split("\n")[0];
  return { id, dir: path.join(item.store, "refinement-runs", id) };
}
function initialApply(item) {
  const run = refine(item, "initial");
  const proposal = { ...json(path.join(run.dir, "proposal.json")), groups: item.map.groups, features: item.map.features, migrations: item.map.migrations };
  write(path.join(run.dir, "proposal.json"), proposal);
  const result = cli(item, "feature", "apply", "--from-run", run.id);
  assert.equal(result.status, 0, result.stderr);
  item.map = json(path.join(item.store, "planning/feature-map.json"));
  return run;
}

test("无版本/时间变化的正文补充仍定位分组、全部子功能和依赖下游，保留无关功能", (t) => {
  const item = fixture(t);
  item.map.features[0].status = "done";
  item.map.features[1].status = "park";
  supplement(item);
  const revision = readPrototypeRevision(item.store);
  const impact = prototypeImpact(item.map, revision);
  assert.equal(impact.global, false);
  assert.deepEqual(impact.changedGroupIds, ["p-a"]);
  assert.deepEqual(impact.affected.map((feature) => feature.id), ["a1", "a2", "b1"]);
  assert.deepEqual(prototypeDevelopmentProblems(item.store, item.map, ["c1"]), []);
  assert.match(prototypeDevelopmentProblems(item.store, item.map, ["a1"]).join(), /复评门禁/);
  item.map.features.push({ id: "grandchild", parentId: "a1", status: "done" });
  assert.ok(prototypeImpact(item.map, revision).affected.some((feature) => feature.id === "grandchild"));
  delete item.map.prototypeBaseline;
  assert.equal(prototypeImpact(item.map, revision).affected.length, 5);
});

test("应用门禁拒绝未关联当前原型入口的叶子功能", (t) => {
  const item = fixture(t);
  item.map.features[0].sourceEntries = [];
  const run = refine(item, "missing source entry");
  const proposal = json(path.join(run.dir, "proposal.json"));
  proposal.groups = item.map.groups;
  proposal.features = item.map.features;
  proposal.migrations = item.map.migrations;
  write(path.join(run.dir, "proposal.json"), proposal);
  const result = cli(item, "feature", "apply", "--from-run", run.id);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /至少关联一个当前原型入口 sourceEntries/);
});

test("一个当前原型入口可支撑多个独立叶子功能", (t) => {
  const item = fixture(t);
  item.map.features[1].sourceEntries = ["e1", "e2"];
  initialApply(item);
  assert.equal(
    json(path.join(item.store, "planning", "feature-map.json"))
      .features.find((feature) => feature.id === "a2").sourceEntries[0],
    "e1",
  );
});

test("问题回答、入口删除/新增/改属、未归属正文、源码改动和损坏 JSON 均不能被旧指纹掩盖", (t) => {
  const item = fixture(t);
  write(path.join(item.store, "prototype/open-questions.json"), { questions: [{ id: "q", featureId: "p-b", status: "resolved", answer: "补充结果" }] });
  assert.deepEqual(prototypeImpact(item.map, readPrototypeRevision(item.store)).affected.map((feature) => feature.id), ["b1"]);
  const file = path.join(item.store, "prototype/coverage.json");
  const coverage = json(file);
  coverage.sourceInventory.entries = coverage.sourceInventory.entries.filter((entry) => entry.id !== "e1");
  coverage.sourceInventory.entries.push({ id: "e5", feature: "p-a" });
  coverage.sourceInventory.entries.find((entry) => entry.id === "e2").feature = "p-c";
  write(file, coverage);
  const impact = prototypeImpact(item.map, readPrototypeRevision(item.store));
  assert.deepEqual(impact.changedEntryIds, ["e1", "e2", "e5"]);
  assert.equal(impact.affected.length, 4);
  supplement(item, "p-c");
  fs.appendFileSync(path.join(item.store, "prototype/原型图流程.md"), "\n# 新的全局约束\n尚未归属");
  assert.equal(prototypeImpact(item.map, readPrototypeRevision(item.store)).global, true);
  fs.writeFileSync(path.join(item.cwd, "prototype.html"), "<button>new state</button>");
  assert.equal(prototypeImpact(item.map, readPrototypeRevision(item.store)).global, true);
  fs.writeFileSync(file, "{");
  assert.match(prototypeDevelopmentProblems(item.store, item.map).join(), /无法核验/);
});

test("复评不能漏子功能、删旧叶子迁移、空分析或伪称 keep，地图竞争与活动任务也拦截", (t) => {
  const item = fixture(t);
  supplement(item);
  const revision = readPrototypeRevision(item.store);
  const proposal = proposalFor(item.map, revision);
  const validate = (change, records = [], currentMap = item.map) => {
    const copy = structuredClone(proposal); change(copy);
    return impactReviewProblems({ previousMap: item.map, revision, proposal: copy, currentMap, records }).join("\n");
  };
  assert.equal(validate(() => {}), "");
  assert.match(validate((copy) => copy.impactReviews.pop()), /b1.*impactReviews/);
  assert.match(validate((copy) => copy.migrations = item.map.migrations), /旧叶子功能/);
  assert.match(validate((copy) => delete copy.features[0].analysis), /analysis/);
  assert.match(validate((copy) => delete copy.impactReviews[0].checks.status), /checks.status/);
  assert.match(validate((copy) => delete copy.impactReviews[0].deliveryImpact), /deliveryImpact/);
  assert.match(validate((copy) => copy.features[0].status = "done"), /keep/);
  assert.match(validate((copy) => copy.features.pop()), /未受影响功能 c1/);
  assert.match(validate(() => {}, [], { ...item.map, updatedAt: "competing apply" }), /功能地图已变化/);
  const records = [{ featureId: "a1", runId: "r", taskId: "t", taskStatus: "in_progress" }];
  assert.match(validate(() => {}, records), /必须评估历史任务/);
  assert.equal(validate((copy) => copy.impactReviews[0].taskDecisions = [{ runId: "r", taskId: "t", action: "continue", reason: "契约未变" }], records), "");
  assert.equal(validate((copy) => {
    copy.features[0].priority = "P0";
    copy.impactReviews[0].decision = "revise";
  }), "");
  assert.match(validate((copy) => {
    copy.features[0].description = "更改范围";
    copy.impactReviews[0].decision = "revise";
  }), /不能 preserve/);
  assert.match(validate((copy) => {
    copy.impactReviews[0].decision = "revise";
    copy.impactReviews[0].deliveryImpact = "revalidate";
    copy.impactReviews[0].taskDecisions = [{ runId: "r", taskId: "t", action: "continue", reason: "继续旧任务" }];
  }, records), /先按授权 work supersede/);
});

test("CLI：沿用提案不能洗 fresh；完成所有复评后发布，第二次原型变化再次拦截", (t) => {
  const item = fixture(t);
  const first = initialApply(item);
  const firstContext = fs.readFileSync(path.join(first.dir, "context.json"), "utf8");
  supplement(item);
  const readonlyBefore = fs.readFileSync(path.join(item.store, "planning/feature-map.json"), "utf8");
  const report = cli(item, "feature", "impact");
  assert.equal(report.status, 0, report.stderr);
  assert.equal(JSON.parse(report.stdout).affected.length, 3);
  assert.equal(fs.readFileSync(path.join(item.store, "planning/feature-map.json"), "utf8"), readonlyBefore);
  const view = planningSummary(item.store);
  assert.equal(view.features[0].status, "not_started");
  assert.equal(view.features[0].planningStatus, "review_required");
  assert.deepEqual(view.actionable.map((feature) => feature.id), ["c1"]);
  const second = refine(item, "reassess");
  const failed = cli(item, "feature", "apply", "--from-run", second.id);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /impactReviews/);
  const proposal = json(path.join(second.dir, "proposal.json"));
  proposal.impactReviews = reviewsFor(item.map, readPrototypeRevision(item.store));
  write(path.join(second.dir, "proposal.json"), proposal);
  const passed = cli(item, "feature", "apply", "--from-run", second.id);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(cli(item, "feature", "status").stdout, /fresh/);
  assert.equal(fs.readFileSync(path.join(first.dir, "context.json"), "utf8"), firstContext);
  assert.equal(json(path.join(item.store, "planning/feature-history.json")).events.length, 3);
  assert.notEqual(cli(item, "feature", "apply", "--from-run", second.id).status, 0);
  supplement(item, "p-b");
  assert.match(cli(item, "feature", "start", "--id", "b1").stderr, /复评门禁/);
  const third = refine(item, "stale-proposal");
  supplement(item, "p-c");
  assert.match(cli(item, "feature", "apply", "--from-run", third.id).stderr, /发生变化|已变化/);
});

test("整份开发运行已取代时，未领取的产品任务作为 skipped 保留，不阻塞新版地图", (t) => {
  const item = fixture(t);
  initialApply(item);
  const deliveryDir = path.join(item.store, "delivery-runs", "old-plan");
  write(path.join(deliveryDir, "run.json"), {
    id: "old-plan", type: "delivery", status: "in_progress", title: "旧版计划", notes: [],
  });
  write(path.join(deliveryDir, "work-plan.json"), {
    schemaVersion: 1,
    runId: "old-plan",
    runType: "delivery",
    tasks: [{ id: "unclaimed", scope: "product", leafFeatureIds: ["a1"], writes: ["app.js"] }],
  });
  write(path.join(deliveryDir, "delivery-input.json"), { stages: [] });
  write(path.join(item.store, "current.json"), { schemaVersion: 1, active: { type: "delivery", id: "old-plan" } });
  const superseded = cli(item, "delivery", "supersede", "--run", "old-plan", "--reason", "新版原型地图取代旧计划");
  assert.equal(superseded.status, 0, superseded.stderr);
  assert.equal(fs.existsSync(path.join(deliveryDir, "executions", "unclaimed.json")), false);

  supplement(item, "p-a", "新版范围需要重新核对");
  const refinement = refine(item, "reassess superseded unclaimed work");
  const proposalFile = path.join(refinement.dir, "proposal.json");
  const proposal = json(proposalFile);
  proposal.impactReviews = reviewsFor(item.map, readPrototypeRevision(item.store));
  proposal.impactReviews.find((review) => review.featureId === "a1").taskDecisions = [{
    runId: "old-plan", taskId: "unclaimed", action: "superseded", reason: "所在旧开发运行已整体取代，未领取任务不再执行。",
  }];
  write(proposalFile, proposal);

  const applied = cli(item, "feature", "apply", "--from-run", refinement.id);
  assert.equal(applied.status, 0, applied.stderr);
  const map = json(path.join(item.store, "planning", "feature-map.json"));
  assert.equal(map.features.find((feature) => feature.id === "a1").status, "not_started");
});

test("已领取任务也受续做、写租约、阶段、完成和验证门禁约束；blocked 留证仍可用", (t) => {
  const item = fixture(t);
  initialApply(item);
  const dir = path.join(item.store, "delivery-runs/d1");
  write(path.join(dir, "run.json"), { id: "d1", type: "delivery", status: "in_progress", title: "old plan", notes: [] });
  write(path.join(dir, "work-plan.json"), { tasks: [{ id: "t1", scope: "product", leafFeatureIds: ["a1"], phase: "prototype_alignment", writes: ["app.js"], dependsOn: [] }] });
  write(path.join(dir, "executions/t1.json"), { taskId: "t1", agent: "agent", sessionId: "session", status: "in_progress", notes: [], changedFiles: [] });
  write(path.join(dir, "delivery-input.json"), { stages: [{ id: "prototype_alignment", status: "in_progress" }] });
  write(path.join(item.store, "current.json"), { active: { type: "delivery", id: "d1" } });
  supplement(item);
  for (const args of [
    ["work", "claim", "--run", "d1", "--task", "t1", "--agent", "agent"],
    ["work", "bind-session", "--run", "d1", "--task", "t1", "--agent", "agent", "--session", "session"],
    ["delivery", "stage", "--run", "d1", "--task", "t1", "--stage", "prototype_alignment", "--status", "confirmed", "--summary", "old evidence"],
    ["work", "finish", "--run", "d1", "--task", "t1", "--agent", "agent", "--status", "done", "--summary", "done", "--files", "none", "--tests", "none"],
    ["work", "verify", "--run", "d1", "--status", "passed", "--commands", "none", "--summary", "done"],
  ]) {
    const result = cli(item, ...args);
    assert.notEqual(result.status, 0, args.join(" "));
    assert.match(result.stderr, /复评门禁/);
  }
  const lease = cli(item, "work", "lease", "--for-write", "--session", "session", "--file", path.join(item.cwd, "app.js"));
  const leaseJson = JSON.parse(lease.stdout);
  assert.equal(leaseJson.verdict, "allow");
  assert.ok(leaseJson.observations.includes("prototype-reassessment-required"));
  const blocked = cli(item, "work", "finish", "--run", "d1", "--task", "t1", "--agent", "agent", "--status", "blocked", "--summary", "原型待复评", "--files", "none", "--tests", "not run");
  assert.equal(blocked.status, 0, blocked.stderr);
});

test("真正修改范围创建新规划版本，旧完成任务不能复活阶段；原始源码未补证也不能直接重规划", (t) => {
  const item = fixture(t);
  initialApply(item);
  fs.writeFileSync(path.join(item.cwd, "prototype.html"), "<button>changed</button>");
  const raw = refine(item, "raw-change");
  let result = cli(item, "feature", "apply", "--from-run", raw.id);
  assert.match(result.stderr, /长期原型真源尚未更新/);
  fs.writeFileSync(path.join(item.cwd, "prototype.html"), "<button>fixture</button>");
  supplement(item);
  const revised = refine(item, "revised");
  const proposal = json(path.join(revised.dir, "proposal.json"));
  proposal.impactReviews = reviewsFor(item.map, readPrototypeRevision(item.store));
  proposal.impactReviews[0].decision = "revise";
  proposal.impactReviews[0].deliveryImpact = "revalidate";
  proposal.features[0].description = "调整后的用户目标与范围";
  write(path.join(revised.dir, "proposal.json"), proposal);
  result = cli(item, "feature", "apply", "--from-run", revised.id);
  assert.equal(result.status, 0, result.stderr);
  const map = json(path.join(item.store, "planning/feature-map.json"));
  assert.equal(map.features[0].planningRevision, revised.id);
  assert.equal(map.features[1].planningRevision, null);
  assert.ok(Object.values(map.features[0].stages).every((stage) => stage.status === "pending"));
  const dir = path.join(item.store, "delivery-runs/old");
  write(path.join(dir, "run.json"), { id: "old", type: "delivery", status: "in_progress", notes: [] });
  write(path.join(dir, "work-plan.json"), { tasks: [{ id: "old-task", scope: "product", leafFeatureIds: ["a1"], phase: "prototype_alignment", writes: ["app.js"], dependsOn: [] }] });
  result = cli(item, "work", "claim", "--run", "old", "--task", "old-task", "--agent", "agent");
  assert.match(result.stderr, /属于旧规划版本/);
  result = cli(item, "work", "plan", "--run", "old", "--task", "new-task", "--kind", "ui", "--scope", "product", "--leaf-features", "a1", "--writes", "new.js");
  assert.match(result.stderr, /交付运行输入属于旧规划版本/);
});
