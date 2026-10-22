// 看板 graph reader（M4）：只读复用 modules/graph，验证快照/闭包/SVG 与问题透传。
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { graphImpact, graphSnapshot, graphSvg } from "../server/readers/graph.js";

const tempDirs = [];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function storeFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-dash-graph-")));
  tempDirs.push(root);
  const store = path.join(root, ".mf-dev-flow");
  writeJson(path.join(store, "planning", "feature-map.json"), {
    schemaVersion: 3,
    groups: [{ id: "dom-a", title: "域A" }],
    features: [
      { id: "f-one", parentId: "dom-a", title: "F1", scopeRefs: ["prototype:g1"], sourceEntries: ["e1"], dependsOn: [] },
      { id: "f-two", parentId: "dom-a", title: "F2", scopeRefs: ["prototype:g1"], sourceEntries: ["e1"], dependsOn: ["f-one"] },
    ],
  });
  writeJson(path.join(store, "prd", "manifest.json"), { schemaVersion: 1, sources: [{ id: "prd-alpha", title: "α" }] });
  fs.mkdirSync(path.join(store, "prd", "sources"), { recursive: true });
  fs.writeFileSync(path.join(store, "prd", "sources", "prd-alpha.md"), "# α\n");
  writeJson(path.join(store, "prd", "analyses", "b1", "findings.json"), {
    schemaVersion: 1, batchId: "b1", title: "T", summary: {}, sources: ["prd-alpha"], items: [],
    affectsLinks: [{ sourceId: "prd-alpha", to: "prototype:g1" }],
  });
  return store;
}

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

test("快照：节点/边计数与构建问题透传（只读计算，不写 graph.json）", () => {
  const store = storeFixture();
  const snapshot = graphSnapshot(store);
  assert.equal(snapshot.schemaVersion, 1);
  assert.ok(snapshot.counts.nodes >= 6);
  assert.ok(snapshot.nodes.some((node) => node.ref === "feature:f-one"));
  assert.ok(snapshot.edges.some((edge) => edge.kind === "evidence-for" && edge.to === "prototype:g1"));
  assert.equal(fs.existsSync(path.join(store, "graph", "graph.json")), false, "HTTP 侧读取不得落盘索引");
});

test("闭包：两跳传递 + dispatch 建议含 per-trigger 与 autoCreate=false", () => {
  const store = storeFixture();
  const result = graphImpact(store, { seeds: ["prd:prd-alpha"] });
  assert.ok(!result.problems);
  const refs = result.affected.map((item) => item.ref);
  assert.ok(refs.includes("prototype:g1") && refs.includes("feature:f-one") && refs.includes("feature:f-two"));
  const suggestion = result.dispatchSuggestions.find((item) => item.openTaskType === "feature-impact-review");
  assert.ok(suggestion, "prd-source 脏应建议功能点复评");
  assert.equal(suggestion.autoCreate, false);
  assert.equal(suggestion.batching, "per-trigger");
});

test("坏种子返回 problems；SVG 与 CLI 渲染同源确定性", () => {
  const store = storeFixture();
  const bad = graphImpact(store, { seeds: ["feature:ghost"] });
  assert.ok(bad.problems?.some((line) => line.includes("不在图中")));
  const svg = graphSvg(store, { focus: "prototype:g1", depth: "2" });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("feature:f-two"));
  assert.equal(svg, graphSvg(store, { focus: "prototype:g1", depth: "2" }));
});
