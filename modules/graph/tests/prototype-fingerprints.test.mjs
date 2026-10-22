// M3b：分组/入口内容指纹（纯函数 + graph 集成注入）
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computePrototypeFingerprints } from "../prototype-fingerprints.mjs";
import { buildGraph, writeGraph } from "../graph.mjs";

const tempDirs = [];
function storeFixture(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-graphfp-")));
  tempDirs.push(root);
  for (const [rel, value] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  }
  return root;
}

const baseView = () => ({
  features: [
    { id: "g1", title: "分组1", sourceFeatureIds: [] },
    { id: "g2", title: "分组2", sourceFeatureIds: [] },
  ],
  sourceEntries: [
    { id: "e1", feature: "g1", sourceBatch: "b1", evidenceIds: ["x1"], conclusion: "入口1结论" },
    { id: "e2", feature: "g2", sourceBatch: "b1", evidenceIds: [], conclusion: "入口2结论" },
  ],
  questions: [
    { id: "q1", groupId: "g1", text: "问题1", answer: "回答1", status: "answered" },
    { id: "q2", entryIds: ["e2"], text: "问题2", answer: "", status: "open" },
  ],
  requirements: [
    { id: "r1", feature: "g2", statement: "只读边界" },
    { id: "r0", statement: "全图通用要求" },
  ],
  revision: { semanticRevision: "rev-7" },
});

test("分组指纹稳定：行序无关；updatedAt/revision 不计入", () => {
  const a = computePrototypeFingerprints(baseView());
  const shuffled = baseView();
  shuffled.features.reverse();
  shuffled.sourceEntries.reverse();
  shuffled.questions.reverse();
  shuffled.requirements.reverse();
  shuffled.features[0].updatedAt = "2026-09-08T00:00:00Z";
  shuffled.revision.semanticRevision = "rev-8";
  const b = computePrototypeFingerprints(shuffled);
  assert.equal(a.groups.get("g1"), b.groups.get("g1"));
  assert.equal(a.entries.get("e1"), b.entries.get("e1"));
});

test("归属问答变化只动对应分组；无法归属的通用要求动全部分组", () => {
  const before = computePrototypeFingerprints(baseView());
  const touched = baseView();
  touched.questions[1].answer = "新问题2回答";
  const mid = computePrototypeFingerprints(touched);
  assert.notEqual(before.groups.get("g2"), mid.groups.get("g2"));
  assert.equal(before.groups.get("g1"), mid.groups.get("g1"), "g1 与 e2/q2 无关不变");
  const global = baseView();
  global.requirements[1].statement = "改了的通用要求";
  const after = computePrototypeFingerprints(global);
  assert.notEqual(mid.groups.get("g1"), after.groups.get("g1"));
  assert.notEqual(mid.groups.get("g2"), after.groups.get("g2"));
  assert.equal(after.globalIssues, 1);
});

test("孤儿归属（指向已不存在分组）保守计入全部分组", () => {
  const view = baseView();
  view.questions.push({ id: "q9", groupId: "g-gone", text: "指向已删分组" });
  const result = computePrototypeFingerprints(view);
  const clean = computePrototypeFingerprints(baseView());
  assert.notEqual(result.groups.get("g1"), clean.groups.get("g1"));
  assert.notEqual(result.groups.get("g2"), clean.groups.get("g2"));
});

test("graph 集成：注入视图后 prototype 节点带指纹、entry→group parent 边成立、漂移可检", () => {
  const root = storeFixture({
    ".mf-dev-flow/planning/feature-map.json": {
      schemaVersion: 3, groups: [],
      features: [{ id: "f-one", parentId: null, title: "F1", scopeRefs: ["prototype:g1"], sourceEntries: [], dependsOn: [] }],
    },
  });
  const built = buildGraph(root, { prototypeView: baseView() });
  assert.deepEqual(built.problems, []);
  const nodeOf = ref => built.graph.nodes.find(n => n.ref === ref);
  assert.ok(nodeOf("prototype:g1").fingerprint.startsWith("sha256:"));
  assert.equal(nodeOf("prototype:e1").kind, "prototype-entry", "catalog 入口参与 kind 判定");
  assert.ok(built.graph.edges.some(e => e.from === "prototype:e1" && e.to === "prototype:g1" && e.kind === "parent" && e.declaredBy === "catalog"));
  assert.ok(!built.notes.some(n => n.includes("无 catalog 视图")));
  writeGraph(root, { prototypeView: baseView() });
  const driftedView = baseView();
  driftedView.sourceEntries[0].conclusion = "改了的入口1结论";
  const check = writeGraph(root, { check: true, prototypeView: driftedView });
  assert.equal(check.matches, false);
  assert.ok(check.drift.fingerprintChanged.some(c => c.ref === "prototype:e1"));
});
