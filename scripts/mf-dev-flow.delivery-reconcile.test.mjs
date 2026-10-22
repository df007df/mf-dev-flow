import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workModule = path.join(skillDir, "modules/runtime/delivery/work.mjs");
const tempDirs = [];

function sh(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function gitRepo() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-snapshot-")));
  tempDirs.push(repo);
  sh(repo, ["init", "-q"]);
  sh(repo, ["config", "user.email", "test@example.invalid"]);
  sh(repo, ["config", "user.name", "fixture"]);
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/a.ts"), "export const a = 1;\n");
  sh(repo, ["add", "."]);
  sh(repo, ["commit", "-q", "-m", "base"]);
  return repo;
}

// 在隔离 cwd 下动态 import work.mjs，避免 STORE 常量绑定到真实工作区。
function callIn(repo, source) {
  const script = `
    const mod = await import(${JSON.stringify(workModule)});
    ${source}
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: repo,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test("gitTreeSnapshot 枚举全树产品文件并排除 .git 与技能目录", () => {
  const repo = gitRepo();
  fs.mkdirSync(path.join(repo, ".codex/skills/mf-dev-flow"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".codex/skills/mf-dev-flow/x.md"), "tooling\n");
  fs.writeFileSync(path.join(repo, "src/untracked.ts"), "export const u = 2;\n");
  const output = callIn(repo, `
    const snap = mod.gitTreeSnapshot(process.cwd());
    process.stdout.write(JSON.stringify({ baseCommit: snap.baseCommit, files: Object.keys(snap.files).sort() }));
  `);
  const parsed = JSON.parse(output);
  assert.match(parsed.baseCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(parsed.files, ["src/a.ts", "src/untracked.ts"]);
});

test("快照差异链可重建出每个时间点的完整文件集", () => {
  const repo = gitRepo();
  const output = callIn(repo, `
    const fs2 = await import('node:fs');
    const path2 = await import('node:path');
    const STORE = path2.join(process.cwd(), '.mf-dev-flow');
    const run = { id: 'r1', type: 'delivery', dir: path2.join(STORE, 'delivery-runs', 'r1') };
    fs2.mkdirSync(run.dir, { recursive: true });
    mod.recordTreeSnapshot(run, { taskId: 't1', kind: 'plan' });
    fs2.writeFileSync('src/a.ts', 'export const a = 2;\\n');
    mod.recordTreeSnapshot(run, { taskId: 't1', kind: 'claim' });
    fs2.writeFileSync('src/b.ts', 'export const b = 1;\\n');
    mod.recordTreeSnapshot(run, { taskId: 't1', kind: 'finish' });
    const rebuilt = mod.readTreeSnapshots(run);
    process.stdout.write(JSON.stringify(rebuilt.map(s => ({ kind: s.kind, paths: Object.keys(s.files).sort() }))));
  `);
  const rebuilt = JSON.parse(output);
  assert.deepEqual(rebuilt.map(s => s.kind), ["plan", "claim", "finish"]);
  assert.deepEqual(rebuilt[0].paths, ["src/a.ts"]);
  assert.deepEqual(rebuilt[1].paths, ["src/a.ts"]);
  assert.deepEqual(rebuilt[2].paths, ["src/a.ts", "src/b.ts"]);
});

test("区间内只有一个活跃任务时哈希变化归该任务", () => {
  const repo = gitRepo();
  const output = callIn(repo, `
    const pairs = [
      { from: {}, to: { 'src/a.ts': 'sha-new' }, activeTasks: [{ runId: 'r1', taskId: 't1' }] },
    ];
    const attributed = mod.attributeByInterval(pairs, 'src/a.ts');
    const ambiguous = mod.attributeByInterval(
      [{ from: {}, to: { 'src/a.ts': 'sha-new' }, activeTasks: [{ runId: 'r1', taskId: 't1' }, { runId: 'r2', taskId: 't2' }] }],
      'src/a.ts',
    );
    const untouched = mod.attributeByInterval(pairs, 'src/other.ts');
    process.stdout.write(JSON.stringify({ attributed, ambiguous, untouched }));
  `);
  const parsed = JSON.parse(output);
  assert.deepEqual(parsed.attributed, { basis: "snapshot-interval", runId: "r1", taskId: "t1" });
  assert.equal(parsed.ambiguous, null);
  assert.equal(parsed.untouched, null);
});

test("相关运行按声明并集相交计算，包含已终态运行", () => {
  const repo = gitRepo();
  const output = callIn(repo, `
    const fs2 = await import('node:fs');
    const path2 = await import('node:path');
    const STORE = path2.join(process.cwd(), '.mf-dev-flow');
    const put = (rel, value) => {
      const file = path2.join(STORE, rel);
      fs2.mkdirSync(path2.dirname(file), { recursive: true });
      fs2.writeFileSync(file, JSON.stringify(value));
    };
    for (const [id, writes, status] of [
      ['r-target', ['src/pages/v2/review'], 'in_progress'],
      ['r-overlap', ['src/pages/v2'], 'done'],
      ['r-disjoint', ['src/consumer-app/services'], 'in_progress'],
    ]) {
      put('delivery-runs/' + id + '/run.json', { id, type: 'delivery', status });
      put('delivery-runs/' + id + '/work-plan.json', { tasks: [{ id: 't', writes }] });
    }
    const target = { id: 'r-target', type: 'delivery', dir: path2.join(STORE, 'delivery-runs', 'r-target') };
    const plan = JSON.parse(fs2.readFileSync(path2.join(target.dir, 'work-plan.json')));
    const related = mod.relatedRunsFor(target, plan).map(e => e.run.id).sort();
    process.stdout.write(JSON.stringify(related));
  `);
  assert.deepEqual(JSON.parse(output), ["r-overlap", "r-target"]);
});

test("对账把改动分入 attributed / unattributed / shared，且 shared 优先于 attributed", () => {
  const repo = gitRepo();
  const output = callIn(repo, `
    const fs2 = await import('node:fs');
    const path2 = await import('node:path');
    const STORE = path2.join(process.cwd(), '.mf-dev-flow');
    const put = (rel, value) => {
      const file = path2.join(STORE, rel);
      fs2.mkdirSync(path2.dirname(file), { recursive: true });
      fs2.writeFileSync(file, JSON.stringify(value));
    };
    put('delivery-runs/r1/run.json', { id: 'r1', type: 'delivery', status: 'in_progress' });
    put('delivery-runs/r1/work-plan.json', { tasks: [{ id: 't1', writes: ['src', 'docs'] }] });
    put('delivery-runs/r1/executions/t1.json', { taskId: 't1', status: 'done', claimedAt: '2026-09-10T00:00:00.000Z' });
    put('delivery-runs/r2/run.json', { id: 'r2', type: 'delivery', status: 'in_progress' });
    put('delivery-runs/r2/work-plan.json', { tasks: [{ id: 't2', writes: ['src'] }] });
    put('delivery-runs/r2/executions/t2.json', { taskId: 't2', status: 'done', claimedAt: '2026-09-10T00:00:00.000Z' });
    const run = { id: 'r1', type: 'delivery', dir: path2.join(STORE, 'delivery-runs', 'r1') };
    fs2.mkdirSync('docs', { recursive: true });
    fs2.writeFileSync('src/a.ts', 'export const a = 2;\\n');
    fs2.writeFileSync('docs/only.md', 'only r1 declares docs\\n');
    fs2.writeFileSync('outside.md', 'not declared\\n');
    const result = mod.reconcileRun(run);
    process.stdout.write(JSON.stringify({
      attributed: result.attributed.map(i => i.file),
      unattributed: result.unattributed.map(i => i.file),
      shared: result.shared.map(i => ({ file: i.file, runIds: i.runIds })),
    }));
  `);
  const parsed = JSON.parse(output);
  const shared = parsed.shared.find(entry => entry.file === "src/a.ts");
  assert.deepEqual(shared?.runIds, ["r1", "r2"]);
  assert.ok(!parsed.attributed.includes("src/a.ts"));
  assert.ok(parsed.attributed.includes("docs/only.md"));
  assert.ok(!parsed.shared.some(entry => entry.file === "docs/only.md"));
  assert.ok(parsed.unattributed.includes("outside.md"));
});

test("work reconcile 输出三桶与携带来源引用的修复提示词", () => {
  const repo = gitRepo();
  fs.mkdirSync(path.join(repo, ".mf-dev-flow/delivery-runs/r1/executions"), { recursive: true });
  const put = (rel, value) =>
    fs.writeFileSync(path.join(repo, ".mf-dev-flow", rel), JSON.stringify(value));
  put("project.json", { schemaVersion: 1 });
  put("delivery-runs/r1/run.json", { id: "r1", type: "delivery", status: "in_progress" });
  put("delivery-runs/r1/work-plan.json", { tasks: [{ id: "t1", title: "T1", writes: ["src"] }] });
  put("delivery-runs/r1/executions/t1.json", {
    taskId: "t1",
    status: "done",
    claimedAt: "2026-09-10T00:00:00.000Z",
    summary: "改了 src 里的东西",
  });
  fs.writeFileSync(path.join(repo, "outside.md"), "not declared\n");
  const result = spawnSync(
    process.execPath,
    [path.join(skillDir, "scripts/mf-dev-flow.mjs"), "work", "reconcile", "--run", "r1"],
    { cwd: repo, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout.trim());
  assert.ok(parsed.unattributed.some((i) => i.file === "outside.md"));
  assert.ok(parsed.repairPrompts.some((p) => p.includes("outside.md")));
});

// 端到端回归（Ruling 11）：任务 finish 后，其 claim→finish 窗口内写入的越界文件
// 必须落到 inferred（basis: snapshot-interval）而不是 unattributed。
// 驱动真实 CLI（plan → claim → 写盘 → finish → reconcile），不用合成快照对。
function cliFixtureRun(repo, runId) {
  fs.mkdirSync(path.join(repo, ".mf-dev-flow", "delivery-runs", runId), { recursive: true });
  const put = (rel, value) =>
    fs.writeFileSync(path.join(repo, ".mf-dev-flow", rel), JSON.stringify(value));
  put("project.json", { schemaVersion: 1 });
  put("current.json", { schemaVersion: 1, active: { type: "delivery", id: runId } });
  put(`delivery-runs/${runId}/run.json`, {
    schemaVersion: 1,
    id: runId,
    type: "delivery",
    status: "in_progress",
    notes: [],
  });
  put(`delivery-runs/${runId}/delivery-input.json`, {
    schemaVersion: 1,
    intensity: "focused",
    source: "manual",
    deliveryContract: { id: "generic-task", version: 1 },
    tasks: [],
  });
}

function runCli(repo, args) {
  const result = spawnSync(
    process.execPath,
    [path.join(skillDir, "scripts/mf-dev-flow.mjs"), ...args],
    { cwd: repo, encoding: "utf8" },
  );
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return result;
}

test("端到端：终态任务窗口内的越界文件经区间证据进 inferred 而非 unattributed", () => {
  const repo = gitRepo();
  cliFixtureRun(repo, "e2e");
  runCli(repo, ["work", "plan", "--run", "e2e", "--task", "t1", "--title", "E2E", "--kind", "generic", "--scope", "governance", "--writes", "src"]);
  runCli(repo, ["work", "claim", "--run", "e2e", "--task", "t1", "--agent", "root", "--session", "s-e2e"]);
  // claim 之后、finish 之前写入声明范围外的文件：区间归属证据应指向 t1。
  fs.writeFileSync(path.join(repo, "stray.md"), "written during t1 window\n");
  runCli(repo, ["work", "finish", "--run", "e2e", "--task", "t1", "--agent", "root", "--status", "done", "--summary", "完成", "--files", "none", "--tests", "未运行：治理任务无测试要求"]);
  const result = runCli(repo, ["work", "reconcile", "--run", "e2e"]);
  const parsed = JSON.parse(result.stdout.trim());
  const inferred = parsed.inferred.find((i) => i.file === "stray.md");
  assert.ok(inferred, `stray.md 应进 inferred，实际输出：${JSON.stringify(parsed)}`);
  assert.equal(inferred.basis, "snapshot-interval");
  assert.equal(inferred.runId, "e2e");
  assert.equal(inferred.taskId, "t1");
  assert.ok(!parsed.unattributed.some((i) => i.file === "stray.md"));
});

test("端到端：双任务同时在场的区间不把越界文件误归因给任一任务", () => {
  const repo = gitRepo();
  cliFixtureRun(repo, "e2e2");
  runCli(repo, ["work", "plan", "--run", "e2e2", "--task", "t1", "--title", "T1", "--kind", "generic", "--scope", "governance", "--writes", "src"]);
  runCli(repo, ["work", "plan", "--run", "e2e2", "--task", "t2", "--title", "T2", "--kind", "generic", "--scope", "governance", "--writes", "src"]);
  // 两任务先后领取（均保持 in_progress），越界文件写在两次领取之后。
  runCli(repo, ["work", "claim", "--run", "e2e2", "--task", "t1", "--agent", "root", "--session", "s-1"]);
  runCli(repo, ["work", "claim", "--run", "e2e2", "--task", "t2", "--agent", "root", "--session", "s-2"]);
  fs.writeFileSync(path.join(repo, "stray.md"), "ambiguous window\n");
  // bind-session 会记录一次新快照（kind=bind）：包围 stray.md 变化的区间内
  // t1 与 t2 都处于 claim 后未 finish 的活跃状态 → 证据歧义。
  runCli(repo, ["work", "bind-session", "--run", "e2e2", "--task", "t1", "--agent", "root", "--session", "s-1b"]);
  const result = runCli(repo, ["work", "reconcile", "--run", "e2e2"]);
  const parsed = JSON.parse(result.stdout.trim());
  // 关键断言：绝不归因给后领取的 t2（也不能归给 t1——两个窗口都覆盖该区间）。
  assert.ok(
    !parsed.inferred.some((i) => i.file === "stray.md" && i.taskId === "t2"),
    `stray.md 不得推断为 t2，实际 inferred：${JSON.stringify(parsed.inferred)}`,
  );
  assert.ok(
    !parsed.inferred.some((i) => i.file === "stray.md"),
    `双活跃任务区间应保持歧义，实际 inferred：${JSON.stringify(parsed.inferred)}`,
  );
  assert.ok(parsed.unattributed.some((i) => i.file === "stray.md"));
});

test("派发简报汇总其他运行的声明范围、任务状态与当前脏文件", () => {
  const repo = gitRepo();
  cliFixtureRun(repo, "dispatch-main");
  runCli(repo, [
    "work", "plan", "--run", "dispatch-main", "--task", "main-task",
    "--title", "主任务", "--kind", "generic", "--scope", "governance", "--writes", "src",
  ]);

  const otherDir = path.join(repo, ".mf-dev-flow", "delivery-runs", "dispatch-other");
  fs.mkdirSync(path.join(otherDir, "executions"), { recursive: true });
  fs.writeFileSync(
    path.join(otherDir, "run.json"),
    JSON.stringify({ id: "dispatch-other", type: "delivery", status: "in_progress" }),
  );
  fs.writeFileSync(
    path.join(otherDir, "work-plan.json"),
    JSON.stringify({ tasks: [{ id: "other-task", title: "其他任务", writes: ["src"] }] }),
  );
  fs.writeFileSync(
    path.join(otherDir, "executions", "other-task.json"),
    JSON.stringify({
      taskId: "other-task",
      status: "in_progress",
      claimedAt: "2026-09-11T00:00:00.000Z",
      updatedAt: "2026-09-11T00:01:00.000Z",
      changedFiles: ["src/a.ts"],
    }),
  );
  fs.writeFileSync(path.join(repo, "src/a.ts"), "export const a = 2;\n");

  const result = runCli(repo, [
    "work", "delivery-brief", "--run", "dispatch-main", "--task", "main-task", "--dispatch",
  ]);
  const brief = JSON.parse(result.stdout.trim());
  assert.equal(brief.verdict, "block");
  assert.deepEqual(brief.task.writes, ["src"]);
  assert.deepEqual(brief.relatedRuns, [{
    runId: "dispatch-other",
    runStatus: "in_progress",
    tasks: [{
      taskId: "other-task",
      title: "其他任务",
      status: "in_progress",
      writes: ["src"],
      changedFiles: ["src/a.ts"],
      claimedAt: "2026-09-11T00:00:00.000Z",
      updatedAt: "2026-09-11T00:01:00.000Z",
    }],
  }]);
  assert.deepEqual(brief.dirtyFiles, [{
    file: "src/a.ts",
    otherRunIds: ["dispatch-other"],
  }]);
});

test("进行中运行里的终态相交任务只要求 review，不误报为正在写入", () => {
  const repo = gitRepo();
  cliFixtureRun(repo, "dispatch-finished-main");
  runCli(repo, [
    "work", "plan", "--run", "dispatch-finished-main", "--task", "main-task",
    "--title", "主任务", "--kind", "generic", "--scope", "governance", "--writes", "src",
  ]);
  const otherDir = path.join(repo, ".mf-dev-flow", "delivery-runs", "dispatch-finished-other");
  fs.mkdirSync(path.join(otherDir, "executions"), { recursive: true });
  fs.writeFileSync(
    path.join(otherDir, "run.json"),
    JSON.stringify({ id: "dispatch-finished-other", type: "delivery", status: "in_progress" }),
  );
  fs.writeFileSync(
    path.join(otherDir, "work-plan.json"),
    JSON.stringify({ tasks: [{ id: "other-task", title: "已完成任务", writes: ["src"] }] }),
  );
  fs.writeFileSync(
    path.join(otherDir, "executions", "other-task.json"),
    JSON.stringify({ taskId: "other-task", status: "done", changedFiles: [] }),
  );

  const result = runCli(repo, [
    "work", "delivery-brief", "--run", "dispatch-finished-main", "--task", "main-task", "--dispatch",
  ]);
  const brief = JSON.parse(result.stdout.trim());
  assert.equal(brief.verdict, "review");
  assert.equal(brief.relatedRuns[0].tasks[0].status, "done");
});

test("已登记的跨运行共享范围仍要求主 agent review，而不是直接派发", () => {
  const repo = gitRepo();
  cliFixtureRun(repo, "dispatch-approved-main");
  runCli(repo, [
    "work", "plan", "--run", "dispatch-approved-main", "--task", "main-task",
    "--title", "主任务", "--kind", "generic", "--scope", "governance", "--writes", "src",
  ]);
  cliFixtureRun(repo, "dispatch-approved-other");
  runCli(repo, [
    "work", "plan", "--run", "dispatch-approved-other", "--task", "other-task",
    "--title", "其他任务", "--kind", "generic", "--scope", "governance", "--writes", "src",
    "--allow-overlap", "已知共享目录，但由主 agent 复核后派发",
  ]);

  const result = runCli(repo, [
    "work", "delivery-brief", "--run", "dispatch-approved-main", "--task", "main-task", "--dispatch",
  ]);
  const brief = JSON.parse(result.stdout.trim());
  assert.equal(brief.verdict, "review");
  assert.deepEqual(brief.overlapApprovals, ["dispatch-approved-other"]);
  assert.deepEqual(brief.dirtyFiles, []);
});

function writeVerifiableGenericRun(repo, runId, taskId, writes) {
  cliFixtureRun(repo, runId);
  runCli(repo, [
    "work", "plan", "--run", runId, "--task", taskId,
    "--title", taskId, "--kind", "generic", "--scope", "governance",
    "--writes", writes.join(","),
  ]);
  const runDir = path.join(repo, ".mf-dev-flow", "delivery-runs", runId);
  fs.writeFileSync(
    path.join(runDir, "plan.md"),
    [
      `# ${taskId} · 开发计划`,
      "",
      "## 开发任务输入",
      "",
      "- 对账门禁夹具。",
      "",
      "## 并发任务",
      "",
      "<!-- mf-dev-flow:task-todo:start -->",
      `- [x] \`${taskId}\` · 已完成。`,
      "<!-- mf-dev-flow:task-todo:end -->",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(runDir, "implementation.md"), "# 实时记录\n\n已完成夹具任务。\n");
  fs.writeFileSync(path.join(runDir, "verification.md"), "# 测试与回归\n\n夹具验证通过。\n");
  fs.writeFileSync(
    path.join(runDir, "executions", `${taskId}.json`),
    JSON.stringify({
      schemaVersion: 2,
      taskId,
      agent: "root",
      status: "done",
      claimedAt: "2026-09-11T00:00:00.000Z",
      updatedAt: "2026-09-11T00:02:00.000Z",
      summary: "已完成",
      changedFiles: ["src/a.ts"],
      stages: {},
      attempts: [],
    }),
  );
}

function rawCli(repo, args) {
  return spawnSync(
    process.execPath,
    [path.join(skillDir, "scripts/mf-dev-flow.mjs"), ...args],
    { cwd: repo, encoding: "utf8" },
  );
}

test("未裁决的 shared 与 unattributed 改动阻止 verify，通过逐项裁决后才放行", () => {
  const repo = gitRepo();
  writeVerifiableGenericRun(repo, "verify-main", "main-task", ["src"]);
  const mainRunFile = path.join(repo, ".mf-dev-flow", "delivery-runs", "verify-main", "run.json");
  const mainRun = JSON.parse(fs.readFileSync(mainRunFile, "utf8"));
  mainRun.status = "done";
  fs.writeFileSync(mainRunFile, JSON.stringify(mainRun));
  writeVerifiableGenericRun(repo, "verify-other", "other-task", ["src"]);
  mainRun.status = "in_progress";
  fs.writeFileSync(mainRunFile, JSON.stringify(mainRun));
  fs.writeFileSync(path.join(repo, "src/a.ts"), "export const a = 2;\n");
  fs.writeFileSync(path.join(repo, "outside.md"), "no declared owner\n");

  const firstVerify = rawCli(repo, [
    "work", "verify", "--run", "verify-main", "--status", "passed",
    "--commands", "node --test", "--summary", "验证通过",
  ]);
  assert.notEqual(firstVerify.status, 0);
  assert.match(firstVerify.stderr, /src\/a\.ts/);
  assert.match(firstVerify.stderr, /outside\.md/);

  runCli(repo, [
    "work", "reconcile", "--run", "verify-main", "--resolve", "shared",
    "--file", "src/a.ts", "--summary", "由主 agent 合并后归 verify-main 负责", "--by", "root",
  ]);
  const secondVerify = rawCli(repo, [
    "work", "verify", "--run", "verify-main", "--status", "passed",
    "--commands", "node --test", "--summary", "验证通过",
  ]);
  assert.notEqual(secondVerify.status, 0);
  assert.match(secondVerify.stderr, /outside\.md/);

  runCli(repo, [
    "work", "reconcile", "--run", "verify-main", "--resolve", "unattributed",
    "--file", "outside.md", "--summary", "确认是本轮整合时新增的说明文件", "--by", "root",
  ]);
  const finalVerify = rawCli(repo, [
    "work", "verify", "--run", "verify-main", "--status", "passed",
    "--commands", "node --test", "--summary", "验证通过",
  ]);
  assert.equal(finalVerify.status, 0, `${finalVerify.stderr}\n${finalVerify.stdout}`);
});
