import test from "node:test";
import assert from "node:assert/strict";
import { loadCapabilityRegistry, capabilityProblems, capabilitySummary, resolveCapability, gateOwnership, requireCapabilityGates } from "../registry.mjs";
import { loadRegistry as loadTypes } from "../../types/registry.mjs";

const registry = loadCapabilityRegistry();

test("能力注册表：6 能力登记且校验通过", () => {
  assert.equal(registry.entries.length, 6);
  assert.deepEqual(capabilityProblems(registry), []);
  assert.deepEqual(capabilitySummary(registry.entries).map(item => item.id), [
    "api-mock-evidence", "content-diff", "git-diff", "miniapp-evidence", "runtime-observe", "visual-compare",
  ]);
});

test("每个能力必须带判定提示词与命令面", () => {
  const broken = structuredClone(registry.entries.find(e => e.id === "visual-compare"));
  broken.agentFile = "missing.md";
  broken.agentPath = "/nonexistent";
  broken.commands = [];
  const problems = capabilityProblems({ ...registry, entries: [broken] });
  assert.ok(problems.some(p => p.includes("agentFile 不存在")));
  assert.ok(problems.some(p => p.includes("commands 至少一条")));
});

test("门禁单主归属：gate 不得由两个能力同时声明", () => {
  const dupe = structuredClone(registry.entries.find(e => e.id === "content-diff"));
  dupe.gates = ["visual_region_review"];
  const problems = capabilityProblems({ ...registry, entries: [...registry.entries, dupe] });
  assert.ok(problems.some(p => p.includes("gate 多主")));
});

test("交叉校验：全部任务类型的 evidenceGates 都有归属主（能力或 kernel）", () => {
  const owners = gateOwnership(registry);
  const types = loadTypes();
  const unowned = [];
  for (const entry of types.entries)
    for (const stage of entry.process.stages ?? [])
      for (const gate of stage.evidenceGates ?? [])
        if (!owners.has(gate)) unowned.push(`${entry.id}@${entry.version}/${stage.id}:${gate}`);
  assert.deepEqual(unowned, []);
  assert.ok(owners.get("visual_region_review").includes("visual-compare"));
  assert.deepEqual(owners.get("risk_ledger"), ["kernel"]);
});

test("git-diff 能力已注册且解析正确", () => {
  const gitDiff = resolveCapability(registry.entries, "git-diff");
  assert.equal(gitDiff.provider, "modules/runtime/capabilities.mjs#capabilityGitDiff");
  assert.deepEqual(gitDiff.commands, ["capability git-diff"]);
});

test("requireCapabilityGates：视觉门禁要求 visual-compare 已注册并声明归属", () => {
  const entry = requireCapabilityGates(registry, "visual-compare", [
    "visual_validation_pair",
    "visual_region_review",
  ]);
  assert.equal(entry.id, "visual-compare");
  assert.ok(entry.agentPath && entry.agentPath.endsWith("judgment.md"));
  assert.throws(
    () => requireCapabilityGates(registry, "no-such-capability", ["visual_region_review"]),
    /未在能力索引注册/,
  );
  assert.throws(
    () => requireCapabilityGates(registry, "visual-compare", ["visual_validation_pair", "not-a-real-gate"]),
    /未声明门禁归属：not-a-real-gate/,
  );
});
