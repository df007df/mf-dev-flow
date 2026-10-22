import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPrototypeMap, prototypeMapProblems } from "../server/prototype-map-audit.js";
import { discoverPrototypeSource, digest } from "../server/prototype-source-map.js";

const cli = fileURLToPath(new URL("../../scripts/mf-dev-flow.mjs", import.meta.url));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2)); };
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function fixture(t) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-source-map-"));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  const runDirectory = path.join(workspaceRoot, ".mf-dev-flow/prototype-runs/test");
  write(path.join(workspaceRoot, ".mf-dev-flow/project.json"), { schemaVersion: 1, project: { name: "fixture" }, prototype: { kind: "html", location: "prototype/index.html", version: "fixture" }, codeRoots: [] });
  write(path.join(workspaceRoot, "prototype/index.html"), '<div class="page" id="home"><button id="go">Go</button></div><script>let mode = "a"; document.querySelector("#go").addEventListener("click", () => { if (mode === "a") document.title = "A"; else document.title = "B"; });</script>');
  write(path.join(runDirectory, "run.json"), { id: "test", type: "prototype", scope: "full", status: "in_progress" });
  write(path.join(runDirectory, "coverage.json"), { coverage: [] });
  fs.mkdirSync(path.join(runDirectory, "screenshots"));
  const params = { workspaceRoot, runDirectory };
  createPrototypeMap(params);
  const source = read(path.join(runDirectory, "source-map.json"));
  const graph = read(path.join(runDirectory, "interaction-map.json"));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  for (const id of ["a", "b"]) fs.writeFileSync(path.join(runDirectory, `screenshots/${id}.png`), png);
  write(path.join(runDirectory, "traces/actions.jsonl"), '{"fixture":true,"action":"click","assertion":"passed"}\n');
  const evidence = (id) => [{ level: "observed", path: `screenshots/${id}.png`, action: `reset ${id}, click Go`, trace: "traces/actions.jsonl", capturedAt: new Date(Date.parse(source.createdAt) + 1000).toISOString(), assertion: { expected: id.toUpperCase(), actual: id.toUpperCase(), passed: true } }];
  const sourceIds = source.candidates.map((c) => c.id);
  graph.status = "converged";
  graph.remainingCandidateIds = [];
  graph.nodes = ["a", "b"].map((id) => ({ id, label: `Home ${id}`, resetAction: `reset mode ${id}`, entryIds: [id], evidence: evidence(id) }));
  graph.edges = ["a", "b"].map((id) => ({ id: `go-${id}`, from: id, to: id, status: "covered", sourceIds, candidateOutcomes: Object.fromEntries(source.candidates.filter((c) => c.kind === "branch").map((c) => [c.id, id === "a" ? "true" : "false"])), action: { type: "click", target: "#go", force: false, script: false }, outcome: `Title ${id.toUpperCase()}`, evidence: evidence(id) }));
  graph.stateSpaces = [{ id: "home", sourceIds, dimensions: { mode: ["a", "b"] }, reductions: [] }];
  graph.candidateReviews = source.candidates.map((c) => ({ id: c.id, status: "mapped", ...(c.kind === "page" ? { nodeIds: ["a", "b"] } : c.kind === "state" ? { stateSpaceIds: ["home"] } : { edgeIds: ["go-a", "go-b"] }) }));
  graph.runtimeDiscoveries = ["a", "b"].map((id) => ({ id: `button-${id}`, nodeId: id, locator: "#go", event: "click", edgeIds: [`go-${id}`] }));
  graph.runtimeSweeps = ["a", "b"].map((id) => ({ nodeId: id, discoveryIds: [`button-${id}`], evidence: evidence(id) }));
  const coverage = {
    sourceInventory: { completeness: "verified", sourceFiles: source.sourceFiles, entries: ["a", "b"].map((id) => ({ id, feature: "home" })) },
    sourceInteractionInventory: { completeness: "verified", status: "converged", remainingControlIds: [], controls: [{ id: "go", source: "index.html#go", states: ["a", "b"], status: "covered", evidence: evidence("a") }], stateVectors: ["a", "b"].map((id) => ({ id, spaceId: "home", values: { mode: id }, resetAction: `fresh mode ${id}`, evidence: evidence(id) })) },
    coverage: ["a", "b"].map((id) => ({ id, status: "covered", evidence: evidence(id) })),
    traversal: { status: "converged", visitedEntryIds: ["a", "b"], remainingEntryIds: [] },
  };
  const save = () => { write(path.join(runDirectory, "interaction-map.json"), graph); write(path.join(runDirectory, "coverage.json"), coverage); };
  const check = () => { save(); return prototypeMapProblems({ ...params, run: read(path.join(runDirectory, "run.json")), coverage }); };
  save();
  return { ...params, graph, source, coverage, check, save, evidence };
}

test("独立 HTML/AST 发现隐藏控件、委托绑定、动态模板、分支与存储，不执行源码", (t) => {
  const f = fixture(t);
  const file = path.join(f.workspaceRoot, "prototype/extra.html");
  write(file, '<button hidden onclick="if(ok) alert(1)">hidden</button><script>throw new Error("must not execute"); const stored=localStorage.getItem("mode"); document.addEventListener("click", e=>e.target.closest(".dynamic")); box.innerHTML=`<a href="x">dynamic</a>`; function choose(v){return v ? 1 : 2;}</script><template><input id="later"></template>');
  const found = discoverPrototypeSource({ workspaceRoot: f.workspaceRoot, location: "prototype/index.html" });
  assert.deepEqual(found.problems, []);
  for (const kind of ["page", "control", "event", "branch", "state", "dynamic"]) assert.ok(found.candidates.some((c) => c.kind === kind && c.file.endsWith("extra.html")), kind);
  assert.ok(found.candidates.some((c) => c.snippet.includes('id="later"')));
  assert.deepEqual(found, discoverPrototypeSource({ workspaceRoot: f.workspaceRoot, location: "prototype/index.html" }));
});

test("完整的临时交互记录通过；地图命令不修改长期真源、旧证据或自动操作", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.check(), []);
  assert.equal(fs.existsSync(path.join(f.workspaceRoot, ".mf-dev-flow/prototype")), false);
  assert.throws(() => createPrototypeMap(f), /已有操作证据|已存在/);
});

test("删除已覆盖分母、删候选核对、少一个分支都会拒绝", (t) => {
  for (const mutate of [
    (f) => { f.graph.candidateReviews.pop(); },
    (f) => { const c = f.source.candidates.find((c) => c.kind === "branch"); f.graph.edges[1].candidateOutcomes[c.id] = "true"; },
    (f) => { f.graph.edges.pop(); },
    (f) => { f.coverage.sourceInteractionInventory.stateVectors.pop(); },
  ]) {
    const f = fixture(t); mutate(f); assert.ok(f.check().length);
  }
});

test("源码新增按钮、文件、分支或篡改初始候选，都不能被空队列掩盖", (t) => {
  for (const mutate of [
    (f) => fs.appendFileSync(path.join(f.workspaceRoot, "prototype/index.html"), '<button id="missing">new</button>'),
    (f) => write(path.join(f.workspaceRoot, "prototype/new.js"), 'document.onclick = () => alert("new")'),
    (f) => { f.source.candidates.pop(); write(path.join(f.runDirectory, "source-map.json"), f.source); },
    (f) => { f.coverage.sourceInventory.sourceFiles = f.source.sourceFiles.map((s) => ({ ...s, path: `../${s.path}` })); },
  ]) { const f = fixture(t); mutate(f); assert.ok(f.check().length); }
});

test("强制点击、脚本触发、无断言、无追踪、旧截图时间与越界证据全部拒绝", (t) => {
  for (const mutate of [
    (f) => { f.graph.edges[0].action.force = true; },
    (f) => { f.graph.edges[0].action.script = true; },
    (f) => { f.graph.edges[0].evidence[0].assertion.passed = false; },
    (f) => { delete f.graph.edges[0].evidence[0].trace; },
    (f) => { f.graph.edges[0].evidence[0].capturedAt = "2000-01-01T00:00:00Z"; },
    (f) => { f.graph.edges[0].evidence[0].path = "screenshots"; },
    (f) => { const outside = path.join(f.workspaceRoot, "outside.png"); write(outside, "fixture"); fs.symlinkSync(outside, path.join(f.runDirectory, "screenshots/escape.png")); f.graph.edges[0].evidence[0].path = "screenshots/escape.png"; },
  ]) { const f = fixture(t); mutate(f); assert.ok(f.check().length); }
});

test("所有状态组合逐一对账；约简必须带定位、复核人且不得重复计数", (t) => {
  const f = fixture(t);
  const space = f.graph.stateSpaces[0];
  f.coverage.sourceInteractionInventory.stateVectors.pop();
  assert.ok(f.check().some((p) => p.includes("状态组合未验证")));
  space.reductions = [{ values: { mode: "b" }, reason: "fixture equivalent visual state", reviewer: "test", sourceIds: [f.source.candidates[0].id] }];
  assert.deepEqual(f.check(), []);
  space.reductions.push(space.reductions[0]);
  assert.ok(f.check().some((p) => p.includes("约简重复")));
});

test("每个运行态控件及页面重新盘点必须关联可回放交互", (t) => {
  for (const mutate of [
    (f) => { f.graph.runtimeSweeps.pop(); },
    (f) => { f.graph.runtimeDiscoveries.push({ id: "unvisited", nodeId: "a", locator: "#new", event: "click", edgeIds: [] }); },
    (f) => { f.graph.runtimeDiscoveries[0].edgeIds = ["go-b"]; },
    (f) => { f.coverage.traversal.visitedEntryIds = ["a"]; },
  ]) { const f = fixture(t); mutate(f); assert.ok(f.check().length); }
});

test("解析失败、损坏记录 fail closed，不把不支持的源码当作无交互", (t) => {
  const f = fixture(t);
  write(path.join(f.workspaceRoot, "prototype/broken.js"), "function ???");
  assert.ok(f.check().some((p) => p.includes("无法解析")));
  write(path.join(f.runDirectory, "interaction-map.json"), "{");
  assert.ok(prototypeMapProblems({ ...f, run: {}, coverage: f.coverage })[0].includes("无法核验"));
});

test("CLI audit 只读；run done 和 prototype init 共用门禁，拒绝旧自报完整记录", (t) => {
  const f = fixture(t);
  const invoke = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: f.workspaceRoot, encoding: "utf8" });
  const before = fs.readFileSync(path.join(f.runDirectory, "run.json"));
  const valid = invoke("prototype", "audit", "--run", "test");
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(digest(before), digest(fs.readFileSync(path.join(f.runDirectory, "run.json"))));
  f.graph.candidateReviews = []; f.save();
  for (const args of [
    ["prototype", "audit", "--run", "test"],
    ["run", "set", "--type", "prototype", "--id", "test", "--status", "done"],
    ["prototype", "init", "--from-run", "test"],
  ]) { const result = invoke(...args); assert.notEqual(result.status, 0); assert.match(result.stderr, /源码候选/); }
  assert.equal(fs.existsSync(path.join(f.workspaceRoot, ".mf-dev-flow/prototype")), false);
  fs.unlinkSync(path.join(f.runDirectory, "source-map.json"));
  assert.match(invoke("prototype", "audit", "--run", "test").stderr, /缺少操作前独立生成/);
});
