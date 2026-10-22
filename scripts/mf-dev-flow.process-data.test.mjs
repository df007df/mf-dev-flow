// M1 集成：hook 观测对账三态 + kernel 双写 + feature-map 来源任务的功能点索引强制。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "mf-dev-flow.mjs");
const cleanup = [];
after(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function deliveryFixture({ runId, deliveryInput, planTasks, featureMap }) {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-process-data-")));
  const stateDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-process-state-")));
  cleanup.push(cwd, stateDir);
  const base = path.join(cwd, ".mf-dev-flow");
  writeJson(path.join(base, "project.json"), { schemaVersion: 1 });
  writeJson(path.join(base, "current.json"), { schemaVersion: 1, active: { type: "delivery", id: runId } });
  const runDir = path.join(base, "delivery-runs", runId);
  writeJson(path.join(runDir, "run.json"), {
    schemaVersion: 1, id: runId, type: "delivery", title: `运行 ${runId}`,
    status: "in_progress", notes: [],
    createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z",
    ...(deliveryInput ? { deliveryInput } : {}),
  });
  writeJson(path.join(runDir, "work-plan.json"), {
    schemaVersion: 1,
    tasks: planTasks.map(t => ({ phase: "general", dependsOn: [], stageDefinitions: [], ...t })),
  });
  if (featureMap) writeJson(path.join(base, "planning", "feature-map.json"), featureMap);
  return { cwd, stateDir, runDir, base };
}

function command(item, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: item.cwd,
    encoding: "utf8",
    env: { ...process.env, MF_DEV_FLOW_CODEX_GATE_STATE_DIR: item.stateDir },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function writeHookState(item, sessionId, files, observedAt = "2026-12-31T00:00:00Z") {
  const key = crypto
    .createHash("sha256")
    .update(`${path.resolve(item.cwd)}\u0000${sessionId}`)
    .digest("hex");
  writeJson(path.join(item.stateDir, `${key}.json`), {
    schemaVersion: 1,
    projectRoot: item.cwd,
    sessionId,
    files: files.map(p => ({ path: p, observedAt })),
  });
}

const kernelTask = (item, runId, taskId) => readJson(path.join(item.base, "tasks", runId, `${taskId}.json`));
const executionOf = (item, runId, taskId) => readJson(path.join(item.base, "delivery-runs", runId, "executions", `${taskId}.json`));

test("无 hook 观测时完成记录保持 declared 降级", () => {
  const item = deliveryFixture({ runId: "pd-legacy", planTasks: [{ id: "task-a", title: "A", writes: ["src"] }] });
  assert.equal(command(item, ["work", "claim", "--run", "pd-legacy", "--task", "task-a", "--agent", "root", "--session", "s-legacy"]).code, 0);
  assert.equal(fs.existsSync(path.join(item.base, "coordination")), false);
  const claimed = kernelTask(item, "pd-legacy", "task-a");
  assert.equal(claimed.status, "in_progress");
  assert.deepEqual(claimed.typeRef, { id: "generic-delivery", version: 1 });
  assert.equal(command(item, ["work", "finish", "--run", "pd-legacy", "--task", "task-a", "--agent", "root", "--status", "blocked", "--files", "src/a.ts", "--tests", "未运行：阻塞在环境", "--summary", "阻塞"]).code, 0);
  assert.equal(fs.existsSync(path.join(item.base, "coordination")), false);
  assert.equal(kernelTask(item, "pd-legacy", "task-a").status, "blocked");
  const execution = executionOf(item, "pd-legacy", "task-a");
  assert.equal(execution.processData?.provenance ?? "declared", "declared");
  assert.equal(kernelTask(item, "pd-legacy", "task-a").processData.provenance, "declared");
});

test("运行内并发 hook 未声明只保留审计，不阻塞 finish", () => {
  const item = deliveryFixture({ runId: "pd-miss", planTasks: [{ id: "task-a", title: "A", writes: ["src"] }] });
  assert.equal(command(item, ["work", "claim", "--run", "pd-miss", "--task", "task-a", "--agent", "root", "--session", "s-1"]).code, 0);
  writeHookState(item, "s-1", ["src/observed.ts", "src/sibling.ts"]);
  const result = command(item, ["work", "finish", "--run", "pd-miss", "--task", "task-a", "--agent", "root", "--status", "blocked", "--files", "src/observed.ts", "--tests", "t", "--summary", "s"]);
  assert.equal(result.code, 0, result.err + result.out);
  const execution = executionOf(item, "pd-miss", "task-a");
  assert.deepEqual(execution.processData.undeclared, ["src/sibling.ts"]);
  assert.equal(execution.processData.complete, false);
});

test("补齐声明后 hook 对账 reconciled 并透传 kernel", () => {
  const item = deliveryFixture({ runId: "pd-reconciled", planTasks: [{ id: "task-a", title: "A", writes: ["src"] }] });
  assert.equal(command(item, ["work", "claim", "--run", "pd-reconciled", "--task", "task-a", "--agent", "root", "--session", "s-1"]).code, 0);
  writeHookState(item, "s-1", ["src/observed.ts", "src/extra.ts"]);
  const explained = command(item, ["work", "finish", "--run", "pd-reconciled", "--task", "task-a", "--agent", "root", "--status", "blocked", "--files", "src/observed.ts,src/extra.ts", "--tests", "t", "--summary", "s"]);
  assert.equal(explained.code, 0, explained.err + explained.out);
  const execution = executionOf(item, "pd-reconciled", "task-a");
  assert.deepEqual(execution.processData, { hookHealth: "observed", provenance: "reconciled", complete: true });
  const kernel = kernelTask(item, "pd-reconciled", "task-a");
  assert.equal(kernel.processData.complete, true);
  assert.deepEqual(kernel.touchedRefs.map(t => t.ref).sort(), ["code:src/extra.ts", "code:src/observed.ts"]);
  assert.ok(kernel.touchedRefs.every(t => t.provenance === "reconciled"));
});

test("--explain-undeclared 允许非本任务改动并保留降级标记", () => {
  const item = deliveryFixture({ runId: "pd-explain", planTasks: [{ id: "task-a", title: "A", writes: ["src"] }] });
  assert.equal(command(item, ["work", "claim", "--run", "pd-explain", "--task", "task-a", "--agent", "root", "--session", "s-2"]).code, 0);
  writeHookState(item, "s-2", ["src/a.ts", "src/editor-noise.ts"]);
  const result = command(item, ["work", "finish", "--run", "pd-explain", "--task", "task-a", "--agent", "root", "--status", "blocked", "--files", "src/a.ts", "--tests", "t", "--summary", "s", "--explain-undeclared", "editor-noise 是保存时格式化，非本任务产物"]);
  assert.equal(result.code, 0, result.err + result.out);
  const execution = executionOf(item, "pd-explain", "task-a");
  assert.deepEqual(execution.processData.undeclared, ["src/editor-noise.ts"]);
  assert.equal(execution.processData.complete, false);
});

test("同一会话可并发领取同运行任务，finish 不被兄弟任务观测阻塞", () => {
  const item = deliveryFixture({
    runId: "pd-shared-run",
    planTasks: [
      { id: "task-a", title: "A", writes: ["src"] },
      { id: "task-b", title: "B", writes: ["src"] },
    ],
  });
  const claim = (taskId) => command(item, ["work", "claim", "--run", "pd-shared-run", "--task", taskId, "--agent", "root", "--session", "shared"]);
  assert.equal(claim("task-a").code, 0);
  assert.equal(claim("task-b").code, 0);
  writeHookState(item, "shared", ["src/a.ts", "src/b.ts"]);
  const finishA = command(item, ["work", "finish", "--run", "pd-shared-run", "--task", "task-a", "--agent", "root", "--status", "blocked", "--files", "src/a.ts", "--tests", "t", "--summary", "A"]);
  assert.equal(finishA.code, 0, finishA.err + finishA.out);
  const execution = executionOf(item, "pd-shared-run", "task-a");
  assert.deepEqual(execution.processData.undeclared, ["src/b.ts"]);
  assert.equal(readJson(path.join(item.base, "delivery-runs", "pd-shared-run", "run.json")).status, "in_progress");
});

test("merge-check 允许共享文件并以提醒标记范围外改动", () => {
  const item = deliveryFixture({
    runId: "pd-shared-merge",
    planTasks: [
      { id: "task-a", title: "A", writes: ["src"] },
      { id: "task-b", title: "B", writes: ["src"] },
    ],
  });
  const claim = (taskId) => command(item, ["work", "claim", "--run", "pd-shared-merge", "--task", taskId, "--agent", "root", "--session", "shared"]);
  assert.equal(claim("task-a").code, 0);
  assert.equal(claim("task-b").code, 0);

  const outside = command(item, ["work", "finish", "--run", "pd-shared-merge", "--task", "task-a", "--agent", "root", "--status", "done", "--files", "docs/outside.md", "--tests", "t", "--summary", "A"]);
  assert.equal(outside.code, 0, outside.err + outside.out);
  assert.deepEqual(executionOf(item, "pd-shared-merge", "task-a").scopeWarnings, ["docs/outside.md"]);

  const finish = (taskId) => command(item, ["work", "finish", "--run", "pd-shared-merge", "--task", taskId, "--agent", "root", "--status", "done", "--files", "src/shared.ts", "--tests", "t", "--summary", taskId]);
  assert.equal(finish("task-b").code, 0);
  const merged = command(item, ["work", "merge-check", "--run", "pd-shared-merge"]);
  assert.equal(merged.code, 0, merged.err + merged.out);
  assert.match(merged.out, /审计提醒（不阻塞合并，请主 agent 复核）/);
  assert.match(merged.out, /声明改动超出运行写入范围：docs\/outside\.md/);
});

test("merge-check 输出非阻塞审计提醒", () => {
  const item = deliveryFixture({ runId: "pd-merge-audit", planTasks: [{ id: "task-a", title: "A", writes: ["src"] }] });
  const git = (args) => {
    const result = spawnSync("git", ["-C", item.cwd, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.invalid"]);
  git(["config", "user.name", "fixture"]);
  git(["add", "."]);
  git(["commit", "-q", "-m", "base"]);
  assert.equal(command(item, ["work", "claim", "--run", "pd-merge-audit", "--task", "task-a", "--agent", "root", "--session", "s-audit"]).code, 0);
  writeHookState(item, "s-audit", ["src/a.ts", "src/hook-extra.ts"]);
  fs.mkdirSync(path.join(item.cwd, "src"), { recursive: true });
  fs.mkdirSync(path.join(item.cwd, "outside"), { recursive: true });
  fs.writeFileSync(path.join(item.cwd, "src", "a.ts"), "export {}\n");
  fs.writeFileSync(path.join(item.cwd, "src", "git-extra.ts"), "export {}\n");
  // 声明范围是 writes=["src"]：src 内的改动落在运行声明并集内，不构成未声明；
  // 只有声明范围外的改动才应触发 git 未声明提醒。
  fs.writeFileSync(path.join(item.cwd, "outside", "git-extra.ts"), "export {}\n");
  const finished = command(item, ["work", "finish", "--run", "pd-merge-audit", "--task", "task-a", "--agent", "root", "--status", "done", "--files", "src/a.ts", "--tests", "t", "--summary", "s"]);
  assert.equal(finished.code, 0, finished.err + finished.out);

  const result = command(item, ["work", "merge-check", "--run", "pd-merge-audit"]);
  assert.equal(result.code, 0, result.err + result.out);
  assert.match(result.out, /可进入总 agent 合并验证/);
  assert.match(result.out, /审计提醒（不阻塞合并，请主 agent 复核）/);
  assert.match(result.out, /task-a：hook 观测到未声明改动：src\/hook-extra\.ts/);
  assert.match(result.out, /task-a：git 审计发现未声明改动：outside\/git-extra\.ts/);
  // 声明范围内的改动即使未自报，也只属 attributed，不再报为 git 未声明。
  // 用整行匹配：旧的自报基准会把 src/git-extra.ts 也列进同一行，此处必须失败。
  assert.doesNotMatch(result.out, /git 审计发现未声明改动：[^\n]*src\/git-extra\.ts/);
});

test("feature-map 来源运行：终态强制关联功能点并回填执行索引", () => {
  const featureMap = {
    schemaVersion: 3,
    groups: [],
    features: [{ id: "feat-x", title: "X", parentId: null, rank: 1, outcome: "o", status: "pending" }],
  };
  const item = deliveryFixture({
    runId: "pd-link",
    deliveryInput: { source: "feature-map", featureInputs: [{ id: "feat-x", title: "X" }] },
    planTasks: [{ id: "task-a", title: "A", writes: ["src"] }],
    featureMap,
  });
  assert.equal(command(item, ["work", "claim", "--run", "pd-link", "--task", "task-a", "--agent", "root", "--session", "s-3"]).code, 0);
  const rejected = command(item, ["work", "finish", "--run", "pd-link", "--task", "task-a", "--agent", "root", "--status", "blocked", "--files", "none", "--tests", "阻塞未运行", "--summary", "s"]);
  assert.equal(rejected.code, 1);
  assert.match(rejected.err + rejected.out, /尚未关联功能点/);
  const ok = command(item, ["work", "finish", "--run", "pd-link", "--task", "task-a", "--agent", "root", "--status", "blocked", "--files", "none", "--tests", "阻塞未运行", "--summary", "s", "--features", "feat-x"]);
  assert.equal(ok.code, 0, ok.err + ok.out);
  const plan = readJson(path.join(item.runDir, "work-plan.json"));
  assert.deepEqual(plan.tasks.find(t => t.id === "task-a").leafFeatureIds, ["feat-x"]);
  const index = readJson(path.join(item.base, "execution-index.json"));
  const indexed = index.runs.find(r => r.id === "pd-link").tasks.find(t => t.id === "task-a");
  assert.deepEqual(indexed.features, ["feat-x"]);
  assert.deepEqual(kernelTask(item, "pd-link", "task-a").sourceRefs, ["feature:feat-x"]);
});

test("task id 与叶子同名时自动关联，不需显式 --features", () => {
  const featureMap = { schemaVersion: 3, groups: [], features: [{ id: "task-a", title: "A", rank: 1, status: "pending" }] };
  const item = deliveryFixture({
    runId: "pd-auto",
    deliveryInput: { source: "feature-map", featureInputs: [{ id: "task-a", title: "A" }] },
    planTasks: [{ id: "task-a", title: "A", writes: ["src"] }],
    featureMap,
  });
  assert.equal(command(item, ["work", "claim", "--run", "pd-auto", "--task", "task-a", "--agent", "root", "--session", "s-5"]).code, 0);
  const result = command(item, ["work", "finish", "--run", "pd-auto", "--task", "task-a", "--agent", "root", "--status", "blocked", "--files", "none", "--tests", "阻塞未运行", "--summary", "s"]);
  assert.equal(result.code, 0, result.err + result.out);
  const plan = readJson(path.join(item.runDir, "work-plan.json"));
  assert.deepEqual(plan.tasks.find(t => t.id === "task-a").leafFeatureIds, ["task-a"]);
});

test("feature-map 来源中的非功能任务须显式 --no-feature 说明", () => {
  const featureMap = { schemaVersion: 3, groups: [], features: [{ id: "other", title: "O", rank: 1, status: "pending" }] };
  const item = deliveryFixture({
    runId: "pd-nofeat",
    deliveryInput: { source: "feature-map", featureInputs: [{ id: "other", title: "O" }] },
    planTasks: [{ id: "env-fix", title: "环境修复", writes: ["src"] }],
    featureMap,
  });
  assert.equal(command(item, ["work", "claim", "--run", "pd-nofeat", "--task", "env-fix", "--agent", "root", "--session", "s-4"]).code, 0);
  const result = command(item, ["work", "finish", "--run", "pd-nofeat", "--task", "env-fix", "--agent", "root", "--status", "blocked", "--files", "src/x.ts", "--tests", "t", "--summary", "s", "--no-feature", "构建环境修复，与功能地图无关"]);
  assert.equal(result.code, 0, result.err + result.out);
  assert.equal(executionOf(item, "pd-nofeat", "env-fix").noFeatureJustification, "构建环境修复，与功能地图无关");
});
