import test from "node:test";
import assert from "node:assert/strict";
import { loadRegistry, listSummary, resolveType, registryProblems, typeProblems } from "../registry.mjs";

const registry = loadRegistry();

test("注册表收编 7 类任务 9 个版本且全表校验通过", () => {
  assert.equal(registry.entries.length, 9);
  assert.deepEqual(registryProblems(registry), []);
  const ids = [...new Set(registry.entries.map(e => e.id))].sort();
  assert.deepEqual(ids, [
    "feature-development", "feature-impact-review", "feature-planning",
    "generic-delivery", "prd-analysis", "prototype-analysis", "system-verification",
  ]);
});

test("新旧两种既有契约无需改写即可通过最小公共集校验", () => {
  const devV2 = resolveType(registry.entries, "feature-development");
  assert.equal(devV2.version, 3);
  assert.equal(typeProblems(devV2).length, 0);
  const proto = resolveType(registry.entries, "prototype-analysis");
  assert.equal(typeProblems(proto).length, 0);
  assert.equal(proto.process.stages.length, 4);
});

test("最新解析跳过 superseded，显式版本仍可取回", () => {
  assert.equal(resolveType(registry.entries, "feature-development").version, 3);
  assert.equal(resolveType(registry.entries, "feature-development", 1).status, "superseded");
  assert.equal(resolveType(registry.entries, "feature-development", 2).status, "superseded");
  assert.equal(resolveType(registry.entries, "does-not-exist"), null);
});

test("列表摘要输出阶段与 dispatch 标记", () => {
  const summary = listSummary(registry.entries);
  const byId = new Map(summary.map(item => [item.id, item]));
  assert.equal(byId.get("feature-development").supersededVersions, 2);
  assert.equal(byId.get("feature-impact-review").hasDispatch, true);
  assert.equal(byId.get("feature-planning").hasDispatch, false);
  assert.ok(byId.get("feature-impact-review").stageIds.includes("apply_fresh"));
});

test("M2 熔断约束：dispatch 必须 autoCreate=false 且 per-trigger、目标类型已注册", () => {
  const review = resolveType(registry.entries, "feature-impact-review");
  const rule = review.process.dispatch[0];
  assert.equal(rule.autoCreate, false);
  assert.equal(rule.batching, "per-trigger");
  assert.ok(rule.whenDirty.includes("prototype-group"));
  assert.ok(rule.whenDirty.includes("prd-source"));
  const broken = structuredClone(review);
  broken.process.dispatch = [{ ...rule, autoCreate: true, batching: "per-object", openTaskType: "ghost-type", whenDirty: ["made-up-kind"] }];
  const problems = typeProblems(broken);
  assert.ok(problems.some(p => p.includes("autoCreate 必须为 false")));
  assert.ok(problems.some(p => p.includes("batching 必须为 per-trigger")));
  assert.ok(problems.some(p => p.includes("whenDirty 未知 kind")));
  const ghostRegistry = { entries: [...registry.entries.filter(e => e.id !== "feature-impact-review"), broken] };
  assert.ok(registryProblems(ghostRegistry).some(p => p.includes("openTaskType 未注册")));
});

test("阶段 agentFile 缺失与版本错位被拒", () => {
  const entry = structuredClone(resolveType(registry.entries, "prd-analysis"));
  entry.version = 9;
  entry.process.stages[0].agentFile = "agents/missing.md";
  const problems = typeProblems(entry);
  assert.ok(problems.some(p => p.includes("version")));
  assert.ok(problems.some(p => p.includes("agentFile 不存在")));
});
