// graph render：SVG 确定性投影 + CLI 路径与错误处理（M4）
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "../graph.mjs";
import { renderFocusSvg } from "../render.mjs";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/mf-dev-flow.mjs");
const tempDirs = [];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function storeFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-render-")));
  tempDirs.push(root);
  const store = path.join(root, ".mf-dev-flow");
  writeJson(path.join(store, "planning", "feature-map.json"), {
    schemaVersion: 3,
    groups: [{ id: "dom-a", title: "域<A>" }],
    features: [
      { id: "f-one", parentId: "dom-a", title: "F1", scopeRefs: ["prototype:g1"], sourceEntries: ["e1"], dependsOn: [] },
      { id: "f-two", parentId: "dom-a", title: "F2", scopeRefs: ["prototype:g1"], sourceEntries: ["e1"], dependsOn: ["f-one"] },
      { id: "f-out", parentId: "dom-a", title: "F3", scopeRefs: ["prototype:g9"], sourceEntries: ["e9"], dependsOn: [] },
    ],
  });
  writeJson(path.join(store, "prd", "manifest.json"), { schemaVersion: 1, sources: [{ id: "prd-alpha", title: "α" }] });
  writeJson(path.join(store, "prd", "analyses", "b1", "findings.json"), {
    schemaVersion: 1, batchId: "b1", title: "T", summary: {}, sources: ["prd-alpha"], items: [],
    affectsLinks: [{ sourceId: "prd-alpha", to: "prototype:g1" }],
  });
  return root;
}

test("SVG 确定性：同输入字节一致，XML 转义正确，范围限闭包成员", () => {
  const { graph } = buildGraph(storeFixture());
  const first = renderFocusSvg(graph, "prd:prd-alpha", { depth: 3 });
  const second = renderFocusSvg(graph, "prd:prd-alpha", { depth: 3 });
  assert.equal(first, second);
  assert.match(first, /focus prd:prd-alpha/);
  assert.ok(first.includes(">F1<") && first.includes(">F2<"));
  assert.ok(!first.includes(">F3<"), "未受影响节点不入图");
  assert.ok(!first.includes("feature-group:dom-a"), "闭包外的业务域组不入图（parent 只向后代传播）");
  assert.equal((first.match(/<line /g) ?? []).length, (graph.edges.filter(e => ["prd:prd-alpha", "prototype:g1", "feature:f-one", "feature:f-two"].includes(e.from) && ["prd:prd-alpha", "prototype:g1", "feature:f-one", "feature:f-two"].includes(e.to)).length));
});

test("CLI graph render：--out 落盘与 stdout 两条路径；坏焦点/缺图报错", () => {
  const root = storeFixture();
  assert.equal(spawnSync(process.execPath, [cli, "graph", "build"], { cwd: root, encoding: "utf8" }).status, 0);
  const outFile = path.join(root, "impact.svg");
  const rendered = spawnSync(process.execPath, [cli, "graph", "render", "--focus", "prd:prd-alpha", "--out", outFile], { cwd: root, encoding: "utf8" });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.ok(fs.readFileSync(outFile, "utf8").startsWith("<svg"));
  const toStdout = spawnSync(process.execPath, [cli, "graph", "render", "--focus", "prototype:g1"], { cwd: root, encoding: "utf8" });
  assert.equal(toStdout.status, 0);
  assert.match(JSON.parse(toStdout.stdout).svg, /<svg xmlns/);
  const ghost = spawnSync(process.execPath, [cli, "graph", "render", "--focus", "feature:ghost"], { cwd: root, encoding: "utf8" });
  assert.equal(ghost.status, 1);
  assert.match(ghost.stderr, /不在图中/);
});
