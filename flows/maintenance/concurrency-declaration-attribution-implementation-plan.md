# 并发声明与归因 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把并发写入的保护从"写入点拦截"改为"声明 + 快照对账"：声明由主 agent 一次性下达、跨运行不重叠为唯一硬保证；写入点降级为只记不拦的触碰台账；收尾用全树快照做区间归因与三桶对账，产出修复提示词供主 agent fix-forward。

**Architecture:** 三个机制分层。声明层（已有 + 9/10 预检）读 `work-plan.json` 的 `writes` 并集，宿主无关、是唯一硬保证；对账层新增全树 sha256 快照（`tree-snapshots.json`，差异链）形成时序区间，用"相邻快照之间只有一个活跃任务"做证据级归因，产出 `attributed` / `inferred` / `unattributed` 三桶与修复提示词；触碰层把现有租约改造为只追加观测的台账（`file-touches.json`），永不拒绝。

**Tech Stack:** Node.js ESM、`node:test`、`spawnSync` 驱动的隔离 fixture、既有 `gitValue` / `sha256File` / `runCoversFile` 工具。

**Spec:** `.codex/skills/mf-dev-flow/flows/maintenance/concurrency-declaration-attribution-design.md`

## Global Constraints

- 只写 `.codex/skills/mf-dev-flow/` 与临时 fixture；绝不读取、扫描或改写真实 `.mf-dev-flow`。
- 测试一律在 `os.tmpdir()` 的临时目录跑被测 CLI，`afterEach` / `after` 清理。
- 新增字段一律向后兼容：旧 `file-leases.json`、旧 execution 记录、缺 `tree-snapshots.json` 都必须可读。
- `attributed` / `inferred` / `unattributed` 的 `basis` 必须写入审计记录，推断结论绝不标成事实。
- 不新增提交纪律，不还原字节，不依赖 hook 覆盖。
- 每个 Phase 结束时全量隔离回归必须为 0 失败（跳过项仅允许既有历史像素审计用例）。

---

## File Structure

| 文件 | 职责 | 阶段 |
| --- | --- | --- |
| `modules/runtime/delivery/work.mjs` | 快照、归因、对账、触碰台账的核心实现（已有 work 命令族） | 1–4 |
| `modules/runtime/shared.mjs` | `mergeAuditReminders` 增加对账提醒；`readFileLeases` 兼容新 schema | 1, 4 |
| `modules/runtime/archive.mjs` | `run context` 增加 `treeSnapshots` 摘要（供修复提示词引用） | 3 |
| `modules/workflow/registry.json` | 新增 `work reconcile` 路由 | 3 |
| `scripts/mf-dev-flow.delivery-reconcile.test.mjs` | 对账与快照的隔离回归（新建） | 1–3 |
| `scripts/mf-dev-flow.lease.test.mjs` | 触碰台账回归（改写拒绝用例） | 4 |
| `scripts/mf-dev-flow.git-diff.test.mjs` | `gitUndeclared` 基准修正回归 | 1 |
| `flows/delivery/parallel.md` | 并发协议重写 | 4 |
| `integrations/README.md` | hook 语义与对账说明 | 4 |
| `integrations/host-gate-findings.md` | 更新并发模型结论 | 4 |
| `flows/maintenance/validation.md` | 本轮隔离验证记录 | 4 |

---

## Phase 1：对账基准与声明并集

**目的**：修掉 `gitUndeclared` 在并发下的方向性错误（拿单任务自报比整棵树），改为按运行声明并集比对。这是最小可用、独立可交付的一步。

### Task 1.1: `gitUndeclared` 改为按运行声明并集比对

**Files:**
- Modify: `.codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs:1266-1271`
- Test: `.codex/skills/mf-dev-flow/scripts/mf-dev-flow.git-diff.test.mjs`

**Interfaces:**
- Consumes: `runCoversFile(plan, filePath)`（`shared.mjs:907`，已存在）；`plan` 在 `workFinish` 内已可用。
- Produces: `execution.processData.gitUndeclared` 语义变更为"改动文件不在本运行声明并集内"；新增 `execution.processData.gitAttributed`（落在声明并集内的改动文件）。

- [ ] **Step 1: 写失败测试**

在 `mf-dev-flow.git-diff.test.mjs` 末尾追加（复用文件内已有的 `sh` / `run` / `write` / `readExecution` helper 风格）：

```js
test("同一运行内共享声明范围的改动不再被误报为未声明", () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-git-union-")));
  tempDirs.push(repo);
  const sh = (args, cwd = repo) => {
    const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: repo, encoding: "utf8" });
  const write = (relative, content = "") => {
    fs.mkdirSync(path.dirname(path.join(repo, relative)), { recursive: true });
    fs.writeFileSync(path.join(repo, relative), content);
  };
  const readExecution = (task) =>
    JSON.parse(fs.readFileSync(path.join(repo, `.mf-dev-flow/delivery-runs/audit/executions/${task}.json`), "utf8"));

  sh(["init", "-q"]);
  sh(["config", "user.email", "test@example.invalid"]);
  sh(["config", "user.name", "fixture"]);
  write("keep.txt", "base\n");
  sh(["add", "."]);
  sh(["commit", "-q", "-m", "base"]);
  write(".mf-dev-flow/project.json", "{\"schemaVersion\":1}\n");
  write(".mf-dev-flow/current.json", "{\"schemaVersion\":1,\"active\":{\"type\":\"delivery\",\"id\":\"audit\"}}\n");
  write(".mf-dev-flow/delivery-runs/audit/run.json", "{\"schemaVersion\":1,\"id\":\"audit\",\"type\":\"delivery\",\"status\":\"in_progress\",\"notes\":[]}\n");
  write(".mf-dev-flow/delivery-runs/audit/delivery-input.json", "{\"schemaVersion\":1,\"intensity\":\"focused\",\"source\":\"manual\",\"deliveryContract\":{\"id\":\"generic-task\",\"version\":1},\"tasks\":[]}\n");
  // 两个任务共享同一声明目录 src：task-b 只自报一个文件，task-a 改了另一个同目录文件。
  assert.equal(run(["work", "plan", "--run", "audit", "--task", "task-a", "--title", "A", "--kind", "generic", "--scope", "governance", "--writes", "src"]).status, 0);
  assert.equal(run(["work", "plan", "--run", "audit", "--task", "task-b", "--title", "B", "--kind", "generic", "--scope", "governance", "--writes", "src"]).status, 0);
  assert.equal(run(["work", "claim", "--run", "audit", "--task", "task-a", "--agent", "root", "--session", "s-a"]).status, 0);
  assert.equal(run(["work", "claim", "--run", "audit", "--task", "task-b", "--agent", "root", "--session", "s-a"]).status, 0);

  write("src/from-a.ts", "export const a = 1;\n");
  write("src/from-b.ts", "export const b = 1;\n");
  // task-b 只自报 from-b.ts；from-a.ts 是同运行 task-a 的改动，不应算作 task-b 的未声明。
  const finished = run(["work", "finish", "--run", "audit", "--task", "task-b", "--agent", "root", "--status", "done", "--summary", "完成", "--files", "src/from-b.ts", "--tests", "node --test"]);
  assert.equal(finished.status, 0, finished.stderr);
  const done = readExecution("task-b");
  assert.equal(done.processData.gitUndeclared, undefined);
  assert.deepEqual(done.processData.gitAttributed, ["src/from-a.ts", "src/from-b.ts"]);
  assert.equal(done.processData.gitReconciled, true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.git-diff.test.mjs`
Expected: 新用例 FAIL —— `done.processData.gitUndeclared` 目前为 `["src/from-a.ts"]`，且 `gitAttributed` 为 `undefined`。

- [ ] **Step 3: 改实现**

在 `work.mjs` 的 `workFinish` 里，把 `gitUndeclared` 的比对基准从 `declaredFiles` 改为运行声明并集，并输出 `gitAttributed`。将 1266–1271 行这段：

```js
    const undeclaredByGit = auditedGitFiles.filter(
      item => !declaredFiles.includes(item),
    );
    const unobservedByGit = declaredFiles.filter(
      item => !auditedGitFiles.includes(item) && !baselineFiles.has(item),
    );
```

替换为：

```js
    // 基准是运行声明并集，不是单任务自报：同运行任务共享声明，不互相误报；
    // 其他运行的改动也不落在本运行声明并集内，只进 unattributed 提示而非本任务未声明。
    const attributedByGit = auditedGitFiles.filter((item) =>
      runCoversFile(plan, item),
    );
    const undeclaredByGit = auditedGitFiles.filter(
      (item) => !runCoversFile(plan, item),
    );
    const unobservedByGit = declaredFiles.filter(
      item => !auditedGitFiles.includes(item) && !baselineFiles.has(item),
    );
```

并在紧随的 `execution.processData = {` 对象里，`gitReconciled` 之后新增一行：

```js
      ...(attributedByGit.length ? { gitAttributed: attributedByGit } : {}),
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.git-diff.test.mjs`
Expected: PASS（含既有 5 个用例 + 新增 1 个）。

- [ ] **Step 5: 回归既有基准用例**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.lease.test.mjs`
Expected: PASS（确认声明级预检与文件级租约未受影响）。

- [ ] **Step 6: Commit**

```bash
git add .codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs .codex/skills/mf-dev-flow/scripts/mf-dev-flow.git-diff.test.mjs
git commit -m "fix(mf-dev-flow): 以运行声明并集为 git 对账基准"
```

---

## Phase 2：全树快照与区间归因

**目的**：在 `work plan` / `work claim|bind` / `work finish` 三点记录全树 sha256，形成时序区间，使"某区间只有一个活跃任务"成为证据级归因依据。

### Task 2.1: 全树快照采集

**Files:**
- Modify: `.codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs:310-317`（新增 `gitTreeSnapshot`，保留 `gitSnapshot` 供 claim 基线用）
- Test: `.codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`（新建）

**Interfaces:**
- Consumes: `gitValue(root, args)`、`sha256File(file)`、`isProductGitPath(value)`（均在 `work.mjs` 内已定义）。
- Produces: `gitTreeSnapshot(root) → { baseCommit: string, files: { [path: string]: string } } | null`；路径为工作区相对、正斜杠分隔，值为 sha256 十六进制。

- [ ] **Step 1: 写失败测试**

创建 `.codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`：

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`
Expected: FAIL —— `mod.gitTreeSnapshot is not a function`。

- [ ] **Step 3: 实现 `gitTreeSnapshot`**

在 `work.mjs` 内 `gitSnapshot` 之后（约 318 行后）新增：

```js
// 全树快照：tracked + untracked 的产品文件 sha256，排除 .git、.mf-dev-flow 与技能目录。
// 与 gitSnapshot（仅脏文件，用于 claim 基线）职责不同：本函数给对账提供可比较的时间点。
export function gitTreeSnapshot(root) {
  const baseCommit = gitValue(root, ["rev-parse", "HEAD"]);
  if (!baseCommit) return null;
  const tracked = gitValue(root, [
    "-c", "core.quotePath=false", "ls-files", "-z",
  ]);
  const untracked = gitValue(root, [
    "-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard", "-z",
  ]);
  if (tracked === null || untracked === null) return null;
  const files = {};
  for (const file of [...tracked.split("\0"), ...untracked.split("\0")]) {
    if (!file || !isProductGitPath(file)) continue;
    files[file] = sha256File(path.resolve(root, file));
  }
  return { baseCommit, files };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add .codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs
git commit -m "feat(mf-dev-flow): 新增全树 sha256 快照采集"
```

### Task 2.2: 快照差异链存取

**Files:**
- Modify: `.codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs`（新增 `treeSnapshotsFile` / `recordTreeSnapshot` / `readTreeSnapshots`）
- Test: `.codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`

**Interfaces:**
- Consumes: `gitTreeSnapshot(root)`（Task 2.1）；`writeJson(file, value)`、`readJson(file)`、`now()`、`run.dir`。
- Produces:
  - `treeSnapshotsFile(run) → string`（`<run.dir>/tree-snapshots.json`）
  - `recordTreeSnapshot(run, { taskId, kind }) → void`，`kind ∈ {plan, claim, bind, finish}`
  - `readTreeSnapshots(run) → Array<{ at, taskId, kind, baseCommit, files: Record<string,string> }>`（按链重建的完整快照，按 `at` 升序）
  - 磁盘格式：`{ schemaVersion: 1, runId, entries: Array<{ at, taskId, kind, baseCommit, added, changed, removed }> }`；首条 `added` 为全量。

- [ ] **Step 1: 写失败测试**

在 `mf-dev-flow.delivery-reconcile.test.mjs` 追加：

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`
Expected: FAIL —— `mod.recordTreeSnapshot is not a function`。

- [ ] **Step 3: 实现差异链**

在 `work.mjs` 内 `gitTreeSnapshot` 之后新增：

```js
export function treeSnapshotsFile(run) {
  return path.join(run.dir, "tree-snapshots.json");
}

// 只存与前一条的差异；首条存全量。读取时按链重建，任何一条损坏都不静默跳过。
function diffSnapshot(previousFiles, files) {
  const added = {};
  const changed = {};
  const removed = [];
  for (const [file, sha] of Object.entries(files)) {
    if (previousFiles[file] === undefined) added[file] = sha;
    else if (previousFiles[file] !== sha) changed[file] = sha;
  }
  for (const file of Object.keys(previousFiles)) {
    if (files[file] === undefined) removed.push(file);
  }
  return { added, changed, removed };
}

export function recordTreeSnapshot(run, { taskId, kind }) {
  const snapshot = gitTreeSnapshot(process.cwd());
  if (!snapshot) return;
  const file = treeSnapshotsFile(run);
  const store = fs.existsSync(file)
    ? readJson(file)
    : { schemaVersion: 1, runId: run.id, entries: [] };
  const previous = store.entries.at(-1);
  const previousFiles = previous
    ? previous.__rebuilt ?? { ...previous.__base, ...previous.added, ...previous.changed }
    : {};
  const { added, changed, removed } = previous
    ? diffSnapshot(previousFiles, snapshot.files)
    : { added: snapshot.files, changed: {}, removed: [] };
  store.entries.push({
    at: now(),
    taskId,
    kind,
    baseCommit: snapshot.baseCommit,
    added,
    changed,
    removed,
  });
  writeJson(file, store);
}

export function readTreeSnapshots(run) {
  const file = treeSnapshotsFile(run);
  if (!fs.existsSync(file)) return [];
  const store = readJson(file);
  const rebuilt = [];
  let current = {};
  for (const entry of store.entries ?? []) {
    const next = { ...current };
    for (const [f, sha] of Object.entries(entry.added ?? {})) next[f] = sha;
    for (const [f, sha] of Object.entries(entry.changed ?? {})) next[f] = sha;
    for (const f of entry.removed ?? []) delete next[f];
    rebuilt.push({
      at: entry.at,
      taskId: entry.taskId,
      kind: entry.kind,
      baseCommit: entry.baseCommit,
      files: { ...next },
    });
    current = next;
  }
  return rebuilt;
}
```

> 注：`recordTreeSnapshot` 里的 `previous.__rebuilt` 分支不需要——直接调用 `readTreeSnapshots(run)` 取最后一条的 `files` 更简单。实现时用：
> ```js
> const rebuilt = readTreeSnapshots(run);
> const previousFiles = rebuilt.at(-1)?.files ?? {};
> ```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`
Expected: PASS（含 2.1 用例 + 新用例）。

- [ ] **Step 5: 在三个时机接上快照记录**

在 `work.mjs` 内插入调用。`workPlan()` 在 `writeJson(workPlanFile(run), plan);`（约 227 行）之后加：

```js
  recordTreeSnapshot(run, { taskId: id, kind: "plan" });
```

`workClaim()` 在 `rebuildExecutionIndex();`（约 418 行）之前加：

```js
  recordTreeSnapshot(run, { taskId, kind: "claim" });
```

`workBindSession()` 在 `writeJson(file, execution);`（约 511 行）之后加：

```js
  recordTreeSnapshot(run, { taskId, kind: "bind" });
```

`workFinish()` 在 `writeJson(file, execution);`（约 1305 行）之后加：

```js
  recordTreeSnapshot(run, { taskId, kind: "finish" });
```

> 注意：`workFinish` 里既有 `execution` 变量名与 `taskId`，直接复用；`recordTreeSnapshot` 是模块内函数无需 import。

- [ ] **Step 6: 回归全量确认无破坏**

Run: `node --test .codex/skills/mf-dev-flow/scripts/*.test.mjs .codex/skills/mf-dev-flow/modules/runtime/tests/*.test.mjs`
Expected: PASS，0 失败。

- [ ] **Step 7: Commit**

```bash
git add .codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs
git commit -m "feat(mf-dev-flow): 快照差异链存储并在计划/领取/收尾接入"
```

### Task 2.3: 区间归因

**Files:**
- Modify: `.codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs`（新增 `attributeByInterval`）
- Test: `.codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`

**Interfaces:**
- Consumes: `readTreeSnapshots(run)`（Task 2.2）；`executionFile(run, taskId)`、`readJson`；execution 的 `claimedAt` / `status`。
- Produces: `attributeByInterval(snapshotPairs, filePath) → { basis: "snapshot-interval", runId, taskId } | null`，其中 `snapshotPairs` 为 `Array<{ from, to, activeTasks: Array<{ runId, taskId }> }>`（由 Task 3.2 的对账构造）。

- [ ] **Step 1: 写失败测试**

在 `mf-dev-flow.delivery-reconcile.test.mjs` 追加：

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`
Expected: FAIL —— `mod.attributeByInterval is not a function`。

- [ ] **Step 3: 实现归因**

在 `work.mjs` 内 `readTreeSnapshots` 之后新增：

```js
// 证据级归因：某文件在相邻快照之间哈希变化，且该区间内只有一个活跃任务 → 归该任务。
// 多个活跃任务（含跨运行）时不猜，返回 null 交由上层降级为 inferred/unattributed。
export function attributeByInterval(snapshotPairs, filePath) {
  for (const pair of snapshotPairs) {
    const before = pair.from?.[filePath];
    const after = pair.to?.[filePath];
    const changed = before !== after;
    if (!changed) continue;
    if (pair.activeTasks.length === 1) {
      const [{ runId, taskId }] = pair.activeTasks;
      return { basis: "snapshot-interval", runId, taskId };
    }
    return null;
  }
  return null;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add .codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs
git commit -m "feat(mf-dev-flow): 区间归因给出证据级归属"
```

---

## Phase 3：对账视图与修复提示词

**目的**：把声明并集、快照区间、当前 diff 摆到一起，输出三桶归属与修复提示词。

### Task 3.1: 声明范围的交集与相关运行

**Files:**
- Modify: `.codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs`（新增 `relatedRunsFor` / `runIntersectsPlan`）
- Test: `.codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`

**Interfaces:**
- Consumes: `listRuns()`、`workPlanFile(run)`、`readJson`、`scopesOverlap(a, b)`、`runWriteScopes(plan)`。
- Produces:
  - `runIntersectsPlan(candidateRun, candidatePlan, targetScopes) → boolean`
  - `relatedRunsFor(run, plan) → Array<{ run, plan }>`（声明并集与目标运行相交的全部运行，含已终态者）

- [ ] **Step 1: 写失败测试**

在 `mf-dev-flow.delivery-reconcile.test.mjs` 追加（用 CLI 建两个运行更贴近真实，但此处直接测模块函数）：

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`
Expected: FAIL —— `mod.relatedRunsFor is not a function`。

- [ ] **Step 3: 实现**

在 `work.mjs` 内 `attributeByInterval` 之后新增：

```js
function runIntersectsPlan(candidatePlan, targetScopes) {
  return runWriteScopes(candidatePlan).some((scope) =>
    targetScopes.some((target) => scopesOverlap(scope, target)),
  );
}

// 相关运行 = 声明并集与目标运行相交的全部运行（含已终态但仍有未提交改动的运行）。
export function relatedRunsFor(run, plan) {
  const targetScopes = runWriteScopes(plan);
  return listRuns()
    .filter((entry) => entry.type === "delivery")
    .flatMap((entry) => {
      const file = workPlanFile(entry);
      if (!fs.existsSync(file)) return [];
      const candidatePlan = readJson(file);
      if (entry.id === run.id) return [{ run: entry, plan: candidatePlan }];
      return runIntersectsPlan(candidatePlan, targetScopes)
        ? [{ run: entry, plan: candidatePlan }]
        : [];
    });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add .codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs
git commit -m "feat(mf-dev-flow): 按声明并集计算对账相关运行"
```

### Task 3.2: 三桶对账计算

**Files:**
- Modify: `.codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs`（新增 `reconcileRun`）
- Test: `.codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`

**Interfaces:**
- Consumes: `relatedRunsFor`（3.1）、`readTreeSnapshots`（2.2）、`attributeByInterval`（2.3）、`runCoversFile`、`executionFile`。
- Produces: `reconcileRun(run) → { attributed, inferred, unattributed, declaredUnchanged, shared }`，字段均为对象数组：
  - `attributed: Array<{ file, runId, taskId, basis: "declaration-scope" }>`
  - `inferred: Array<{ file, runId, taskId, basis: "snapshot-interval" }>`
  - `unattributed: Array<{ file }>`
  - `declaredUnchanged: Array<{ file, runId, taskId }>`
  - `shared: Array<{ file, runIds: string[] }>`

- [ ] **Step 1: 写失败测试**

在 `mf-dev-flow.delivery-reconcile.test.mjs` 追加：

```js
test("对账把改动分入 attributed / unattributed / shared", () => {
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
    put('delivery-runs/r1/work-plan.json', { tasks: [{ id: 't1', writes: ['src'] }] });
    put('delivery-runs/r1/executions/t1.json', { taskId: 't1', status: 'done', claimedAt: '2026-09-10T00:00:00.000Z' });
    const run = { id: 'r1', type: 'delivery', dir: path2.join(STORE, 'delivery-runs', 'r1') };
    fs2.writeFileSync('src/a.ts', 'export const a = 2;\\n');
    fs2.writeFileSync('outside.md', 'not declared\\n');
    const result = mod.reconcileRun(run);
    process.stdout.write(JSON.stringify({
      attributed: result.attributed.map(i => i.file),
      unattributed: result.unattributed.map(i => i.file),
    }));
  `);
  const parsed = JSON.parse(output);
  assert.ok(parsed.attributed.includes("src/a.ts"));
  assert.ok(parsed.unattributed.includes("outside.md"));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`
Expected: FAIL —— `mod.reconcileRun is not a function`。

- [ ] **Step 3: 实现 `reconcileRun`**

在 `work.mjs` 内 `relatedRunsFor` 之后新增：

```js
function currentTreeChanges() {
  const snapshot = gitTreeSnapshot(process.cwd());
  const base = gitValue(process.cwd(), ["rev-parse", "HEAD"]);
  if (!snapshot || !base) return [];
  const tracked = gitValue(process.cwd(), [
    "-c", "core.quotePath=false", "diff", "--name-only", "-z", base, "--",
  ]) ?? "";
  const untracked = gitValue(process.cwd(), [
    "-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard", "-z",
  ]) ?? "";
  const paths = new Set();
  for (const file of [...tracked.split("\0"), ...untracked.split("\0")]) {
    if (file && isProductGitPath(file)) paths.add(file);
  }
  return [...paths].sort();
}

// 对账：把当前树改动分入三桶。归因基准是声明并集；歧义时用快照区间补证据；
// 无声明又无证据的进 unattributed，绝不默认算作本次任务改动。
export function reconcileRun(run) {
  const plan = ensureWorkPlan(run);
  const related = relatedRunsFor(run, plan);
  const shared = [];
  const attributed = [];
  const unattributed = [];
  for (const file of currentTreeChanges()) {
    const covering = related.filter((entry) => runCoversFile(entry.plan, file));
    if (covering.length > 1) {
      shared.push({ file, runIds: covering.map((entry) => entry.run.id).sort() });
      continue;
    }
    if (covering.length === 1) {
      const entry = covering[0];
      const owner = (entry.plan.tasks ?? []).find((task) =>
        runCoversFile({ tasks: [task] }, file),
      );
      attributed.push({
        file,
        runId: entry.run.id,
        taskId: owner?.id ?? null,
        basis: "declaration-scope",
      });
      continue;
    }
    unattributed.push({ file });
  }
  // 区间归因作为补充证据：对 unattributed 里能定位到唯一活跃任务的，提升为 inferred。
  const pairs = snapshotPairsFor(related);
  const inferred = [];
  const stillUnattributed = [];
  for (const item of unattributed) {
    const found = attributeByInterval(pairs, item.file);
    if (found) inferred.push({ file: item.file, ...found });
    else stillUnattributed.push(item);
  }
  // 声明但未改动：逐任务看它的声明范围内是否没有任何当前改动（范围过宽信号）。
  const changedSet = new Set(currentTreeChanges());
  const declaredUnchanged = [];
  for (const entry of related) {
    for (const task of entry.plan.tasks ?? []) {
      const touched = [...changedSet].some((file) =>
        (task.writes ?? []).some(
          (scope) => file === scope || file.startsWith(scope.replace(/\/+$/, "") + "/"),
        ),
      );
      if (!touched)
        declaredUnchanged.push({
          runId: entry.run.id,
          taskId: task.id,
          scopes: task.writes ?? [],
        });
    }
  }
  return { attributed, inferred, unattributed: stillUnattributed, declaredUnchanged, shared };
}

// 构造区间对：相邻快照之间，活跃任务 = 该区间内 claim/bind 过、且尚未 finish 的任务。
function snapshotPairsFor(related) {
  const points = [];
  for (const entry of related) {
    for (const snapshot of readTreeSnapshots(entry.run)) {
      points.push({ ...snapshot, runId: entry.run.id });
    }
  }
  points.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const pairs = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const activeTasks = related.flatMap((entry) =>
      (entry.plan.tasks ?? []).flatMap((task) => {
        const file = executionFile(entry.run, task.id);
        if (!fs.existsSync(file)) return [];
        const execution = readJson(file);
        if (execution.status !== "in_progress") return [];
        const claimedAt = execution.claimedAt;
        const finishedAt = execution.updatedAt;
        const overlaps =
          claimedAt && claimedAt < to.at && (!finishedAt || finishedAt > from.at);
        return overlaps ? [{ runId: entry.run.id, taskId: task.id }] : [];
      }),
    );
    pairs.push({ from: from.files, to: to.files, activeTasks });
  }
  return pairs;
}
```

> 注：`declaredUnchanged` 的 `currentTreeChanges()` 在循环内重复调用是性能问题——实现时先取一次 `const changed = currentTreeChanges()` 放在函数开头复用。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add .codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs
git commit -m "feat(mf-dev-flow): 三桶对账计算"
```

### Task 3.3: `work reconcile` 命令与修复提示词

**Files:**
- Modify: `.codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs`（新增 `workReconcile`）
- Modify: `.codex/skills/mf-dev-flow/modules/workflow/registry.json`（新增路由）
- Modify: `.codex/skills/mf-dev-flow/modules/runtime/shared.mjs:2677+`（`mergeAuditReminders` 增加对账提醒）
- Test: `.codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`

**Interfaces:**
- Consumes: `reconcileRun(run)`（3.2）、`leaseResponse` 同级输出风格。
- Produces: CLI `node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs work reconcile --run <ID>`，输出 `{ schemaVersion, run, attributed, inferred, unattributed, declaredUnchanged, shared, repairPrompts: string[] }`。

- [ ] **Step 1: 写失败测试**

在 `mf-dev-flow.delivery-reconcile.test.mjs` 追加：

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`
Expected: FAIL —— 命令未注册，输出为空。

- [ ] **Step 3: 实现命令与提示词**

在 `work.mjs` 内 `workIndex()` 之前新增：

```js
export function repairPromptsFor(result, run) {
  const prompts = [];
  for (const item of result.unattributed) {
    prompts.push(
      [
        `文件 ${item.file} 有改动但不在任何运行声明内。`,
        `请执行 fix-forward 重建：先运行 \`run context --id ${run.id}\` 读取各任务 summary 与 attempts 时间窗，`,
        `再读 \`delivery-runs/${run.id}/implementation.md\`，用当前 diff 判断该文件应有的内容并修正。`,
        `不要从 git 还原字节（该版本未被捕获）。`,
      ].join(""),
    );
  }
  for (const item of result.shared) {
    prompts.push(
      `文件 ${item.file} 落在多个运行声明内（${item.runIds.join("、")}）：请确认是否需 --allow-overlap，或人工判断归属后 fix-forward。`,
    );
  }
  for (const item of result.inferred) {
    prompts.push(
      `文件 ${item.file} 无声明但区间证据指向 ${item.runId}/${item.taskId}（basis: snapshot-interval）：请核实该任务是否越界写入并按需 fix-forward。`,
    );
  }
  return prompts;
}

export function workReconcile() {
  ensureProject();
  const run = resolveRun(required("--run"));
  const result = reconcileRun(run);
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        run: { id: run.id, type: run.type, status: run.run.status },
        ...result,
        repairPrompts: repairPromptsFor(result, run),
      },
      null,
      2,
    ),
  );
}
```

在 `modules/workflow/registry.json` 的 `commandRoutes` 中，`workConflictResolve` 那条之后插入：

```json
    { "command": "work", "subcommand": "reconcile", "module": "modules/runtime/delivery.mjs", "export": "workReconcile" },
```

> 确认 `modules/runtime/delivery.mjs` barrel 以 `export * from "./delivery/work.mjs"` 重导出（既有 barrel 已覆盖，无需改 barrel）。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs`
Expected: PASS。

- [ ] **Step 5: 接入 `merge-check` / `verify` 的对账摘要**

不向 execution 写入对账结果（避免与 Task 1.1 的 `gitUndeclared` 重复告警）。改为在 `workMergeCheck`
与 `workVerify` 内，审计提醒打印之后追加一行对账摘要：

```js
  const reconcile = reconcileRun(run);
  console.log(
    `对账：认领 ${reconcile.attributed.length} / 推断 ${reconcile.inferred.length} / 未认领 ${reconcile.unattributed.length}`,
  );
  if (reconcile.unattributed.length || reconcile.shared.length) {
    console.log("对账异常（请运行 work reconcile 查看修复提示词）：");
    for (const item of reconcile.unattributed) console.log(`- 未认领改动：${item.file}`);
    for (const item of reconcile.shared)
      console.log(`- 跨运行共享：${item.file}（${item.runIds.join("、")}）`);
  }
```

- [ ] **Step 6: 回归**

Run: `node --test .codex/skills/mf-dev-flow/scripts/*.test.mjs .codex/skills/mf-dev-flow/modules/workflow/tests/*.test.mjs`
Expected: PASS，0 失败。

- [ ] **Step 7: Commit**

```bash
git add .codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs .codex/skills/mf-dev-flow/modules/workflow/registry.json .codex/skills/mf-dev-flow/scripts/mf-dev-flow.delivery-reconcile.test.mjs
git commit -m "feat(mf-dev-flow): work reconcile 输出三桶与修复提示词"
```

---

## Phase 4：写入点降级为触碰台账

**目的**：取消 `work lease` 的一切拒绝语义，改为一本"谁在何时触碰了哪个文件"的台账；跨运行触碰可查但不拦。

### Task 4.1: `workLeaseForWrite` 改为只记录

**Files:**
- Modify: `.codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs:779-925`（`workLeaseForWrite` 全部 deny 分支改 allow + observations）
- Test: `.codex/skills/mf-dev-flow/scripts/mf-dev-flow.lease.test.mjs`（改写拒绝用例）

**Interfaces:**
- Consumes: `writeOwnershipForSession`、`readFileLeases`、`runCoversFile`。
- Produces: `workLeaseForWrite()` 永远返回 `verdict: "allow"`；新增 `observations: string[]`，取值 `no-active-run` / `out-of-scope` / `cross-run-scope` / `concurrent-same-file`；每次调用向**全局** `file-touches.json` 追加一条 `{ at, file, runId, taskId, sessionId, agent, observations }`（无活跃运行时 runId/taskId 为 null，仍记录）。

- [ ] **Step 1: 改写测试**

在 `mf-dev-flow.lease.test.mjs` 中，把 `跨运行写入范围重叠时直接拒绝文件租约` 用例整体替换为：

```js
test("跨运行写入范围重叠不再拒绝，记为 cross-run-scope 观测", () => {
  const item = parallelRunFixture({
    readerWrites: ["src/pages/v2/shelf"],
  });
  const file = path.join(item.cwd, "src", "pages", "v2", "shelf", "index.scss");
  const readerLease = command(item, [
    "work",
    "lease",
    "--for-write",
    "--session",
    "reader-session",
    "--file",
    file,
  ]);
  assert.equal(readerLease.status, 0, readerLease.stderr);
  assert.equal(readerLease.json.verdict, "allow");
  assert.ok(readerLease.json.observations.includes("cross-run-scope"));
});
```

同样把 `跨运行同名任务和同一会话也不能绕过范围冲突` 与 `同一会话跨重叠运行不能通过显式任务绕过冲突` 两个用例的 `deny` 断言改为 `allow` + `observations` 包含对应码（若文件不在任何 active 运行范围内则为 `out-of-scope`，在多个运行内则为 `cross-run-scope`）。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.lease.test.mjs`
Expected: FAIL —— 仍返回 `deny`。

- [ ] **Step 3: 改实现**

把 `workLeaseForWrite` 的每个 `return leaseResponse({ verdict: "deny", ... })` 替换为记录观测并继续。整体结构改为：

```js
export function workLeaseForWrite() {
  ensureProject();
  const sessionId = required("--session");
  const requestedFile = canonicalFilePath(required("--file"));
  const ownership = writeOwnershipForSession(sessionId, requestedFile);
  const observations = [];
  if (!ownership.activePlans.length) observations.push("no-active-run");
  if (ownership.coveredPlans.length > 1) observations.push("cross-run-scope");
  if (ownership.activePlans.length && !ownership.candidates.length)
    observations.push("no-active-run");
  if (ownership.candidates.length && !ownership.scoped.length)
    observations.push("out-of-scope");
  const sessionTask = ownership.scoped[0] ?? ownership.candidates[0] ?? null;
  if (sessionTask) {
    const { run } = sessionTask;
    const timestamp = Date.now();
    const heldElsewhere = ownership.activePlans
      .filter((entry) => entry.run.id !== run.id)
      .flatMap((entry) =>
        readFileLeases(entry.run).leases
          .filter((lease) => leaseIsActive(lease, entry.run, entry.plan, timestamp))
          .map((lease) => ({ lease, run: entry.run })),
      )
      .find(({ lease }) => lease.file === requestedFile);
    if (heldElsewhere) observations.push("concurrent-same-file");
  }
  // 台账是全局的：无活跃运行时也必须记录，否则 no-active-run 触碰会丢失。
  recordFileTouch({
    file: requestedFile,
    runId: sessionTask?.run.id ?? null,
    taskId: sessionTask?.task.id ?? null,
    sessionId,
    agent: sessionTask?.execution?.agent ?? null,
    observations,
  });
  leaseResponse({
    verdict: "allow",
    taskId: sessionTask?.task.id ?? null,
    observations,
  });
}
```

并在 `work.mjs` 内新增全局台账读写（锁按台账路径派生，复用既有 `acquireLeaseLock`）：

```js
export function fileTouchesFile() {
  return path.join(STORE, "file-touches.json");
}

function fileTouchLockFile() {
  const digest = crypto
    .createHash("sha256")
    .update(canonicalFilePath(fileTouchesFile()))
    .digest("hex");
  return path.join(STORE, "file-touch-locks", `${digest}.lock`);
}

function recordFileTouch(touch) {
  const lock = acquireLeaseLock(fileTouchLockFile());
  if (!lock) return;
  try {
    const file = fileTouchesFile();
    const store = fs.existsSync(file)
      ? readJson(file)
      : { schemaVersion: 1, updatedAt: null, touches: [] };
    store.touches.push({ at: now(), ...touch });
    store.updatedAt = now();
    writeJson(file, store);
  } finally {
    releaseFileLeaseLock(lock);
  }
}
```

> 全局台账而非每运行文件：无活跃运行的触碰也要留痕。原子锁保留——它保护台账并发写，与"是否拒绝写入"无关。`leaseResponse` 的 schemaVersion 字段保留。

> **必改调用点**：`releaseTaskLeases` 被 `workFinish`（写完 execution 后）与 `workCheckpointGate`（写完检查点后）调用；`releaseSessionLeases` 被 `policy-engine.mjs` 的三处 `stop` 流程调用。删除这些函数前，先把每个调用点改为对应的台账追加（`session-closed` / `task-closed` 标记）或直接删除该调用。漏改会在 `work finish` / `work checkpoint-gate` / hook stop 时抛错。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.lease.test.mjs`
Expected: PASS（改写后的 3 个用例 + 既有同运行共享、锁占用、释放等用例）。

- [ ] **Step 5: 确认 hook 不再拒绝**

在 `integrations/codex/hooks/policy-engine.mjs` 的 `handleBeforeWrite` 中，把 `if (lease.verdict === "allow") return { permission: "allow" };` 与后续 deny 分支简化为：

```js
  await runMfDevFlow(projectRoot, [
    "work", "lease", "--for-write", "--session", sessionId, "--file", await canonicalPath(rawFilePath),
  ]);
  return { permission: "allow" };
```

并删除 `deniedWriteMessage` 函数（无引用后）。运行 hook 测试：

Run: `node --test .codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.test.mjs`
Expected: PASS；若有断言依赖 deny 语义，同步改为 allow。

- [ ] **Step 6: `conflict-status` / `conflict-resolve` 语义改为确认触碰**

`workConflictStatus` 改为读 `file-touches.json` 并汇总 `cross-run-scope` 触碰；`workConflictResolve` 改为给触碰追加 `confirmedAt` / `confirmedBy`。测试同步改写（保留命令存在性与输出结构，去掉"解除锁"断言）。

Run: `node --test .codex/skills/mf-dev-flow/scripts/mf-dev-flow.lease.test.mjs`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add .codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs .codex/skills/mf-dev-flow/integrations/codex/hooks/policy-engine.mjs .codex/skills/mf-dev-flow/scripts/mf-dev-flow.lease.test.mjs
git commit -m "refactor(mf-dev-flow): 文件租约降级为只记不拦的触碰台账"
```

### Task 4.2: 协议与文档重写

**Files:**
- Modify: `.codex/skills/mf-dev-flow/flows/delivery/parallel.md`
- Modify: `.codex/skills/mf-dev-flow/integrations/README.md`
- Modify: `.codex/skills/mf-dev-flow/integrations/host-gate-findings.md`
- Modify: `.codex/skills/mf-dev-flow/SKILL.md`
- Modify: `.codex/skills/mf-dev-flow/flows/maintenance/validation.md`

- [ ] **Step 1: 重写 `parallel.md` 的并发模型段**

把「执行协议」第 3 条（PreToolUse 拒绝写入）改为：

```markdown
3. 写入点不再拦任何写入：`work lease` 降级为触碰台账，只记录"谁在何时触碰了哪个文件"（`file-touches.json`），永不拒绝。它只覆盖经过 hook 的写入（主会话 Edit/Write），子 agent、Bash/脚本、MCP 写盘都不产生条目，因此是辅助证据，不是归因基准。并发保护由两件事承担：登记时的声明不重叠预检（唯一硬保证），以及收尾时的声明并集对账。
```

并新增一节「声明与对账」：

```markdown
## 声明与对账

声明由主 agent 在拆解任务时一次性下达（`work plan --writes`，目录或文件前缀粒度）；子 agent 不声明、不需要 hook、不需要运行 ID。运行级可写边界是全部任务写入范围的并集。跨运行声明不重叠由 `work plan` / `work replan` 预检强制（默认拒绝，`--allow-overlap <理由>` 显式放行）。

保护不靠写入点拦截（子 agent 与 Bash 能绕过），而靠收尾对账：`work plan` / `work claim|bind` / `work finish` 各记一次全树快照（`tree-snapshots.json`），`work reconcile --run <ID>` 把当前树改动分入三桶——

- `attributed`：落在恰好一个运行/任务的声明内，`basis: declaration-scope`；
- `inferred`：无声明但快照区间内只有一个活跃任务，`basis: snapshot-interval`（证据级）；
- `unattributed`：无声明又无区间证据，显式标为未知，**绝不默认算作本次任务改动**。

对账同时给出"声明了但没改动"（范围过宽信号）与"落在多个声明内"（跨运行共享，需确认）。`unattributed` 与跨运行项会生成修复提示词，交主 agent 执行 fix-forward：依据 `run context` 的 tasks/summary/attempts、`implementation.md` 与当前 diff 重建内容，**不还原字节**（被覆盖且未捕获的版本无法找回）。

两类缺口必须分开：**越界写入**（任务存在、意图可查，可 fix-forward）与**无来源写入**（匹配不到任何任务声明，如 Bash 直写，意图不可读，只能标未知）。
```

- [ ] **Step 2: 更新 `integrations/README.md`**

把「hook 租约仍然只是快速反馈」整段与 PreToolUse 行改为：hook 只观测不拦截；`work lease` 为触碰台账；对账三件套为归因基准；表格中 `PreToolUse` 一行的"作用"列改为"记录文件触碰（不拒绝）"。

- [ ] **Step 3: 更新 `host-gate-findings.md` 的 2026-09-10 更新段**

追加：并发模型进一步演进——写入点不再拒绝，改为声明预检 + 快照对账 + 触碰台账；第 1 节"写范围重叠在 work plan 登记时即拒绝"的结论仍成立且是唯一硬保证。

- [ ] **Step 4: 更新 `SKILL.md` 并发句**

把"产品写入先 claim/bind-session，冲突查 conflict-status"改为"产品写入先 claim/bind-session；跨运行范围重叠由 work plan 预检拒绝；收尾用 work reconcile 对账，异常走 fix-forward"。

- [ ] **Step 5: 全量隔离回归**

Run:
```bash
node --test .codex/skills/mf-dev-flow/scripts/*.test.mjs .codex/skills/mf-dev-flow/modules/*/tests/*.test.mjs .codex/skills/mf-dev-flow/dashboard/tests/*.test.js .codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.test.mjs
```
Expected: 0 失败（跳过项仅既有历史像素审计用例）。

- [ ] **Step 6: 追加 `validation.md` 记录**

新增一节 `## 2026-09-10 并发声明与归因`，写改动清单、隔离声明（未读写真实 `.mf-dev-flow`）、逐套回归数字表、能力边界（触碰台账只覆盖 hook 写入；`unattributed` 为真缺口；归因 basis 分层；fix-forward 依赖运行目录叙述）。

- [ ] **Step 7: Commit**

```bash
git add .codex/skills/mf-dev-flow/flows .codex/skills/mf-dev-flow/integrations .codex/skills/mf-dev-flow/SKILL.md
git commit -m "docs(mf-dev-flow): 并发协议改为声明预检 + 快照对账"
```

---

## 自审记录

**Spec 覆盖：**
- 声明唯一所有权 + 保留预检 → Phase 1/4.2 协议段 ✓
- 取消写入点拒绝 → Task 4.1 ✓
- 全树快照（plan/claim/bind/finish）→ Task 2.1/2.2 ✓
- 区间归因 → Task 2.3 ✓
- 三桶 + 两类提示 + 修复提示词 → Task 3.2/3.3 ✓
- `gitUndeclared` 基准修正 → Task 1.1 ✓
- 触碰台账（只记不拦）+ 台账局限 → Task 4.1/4.2 ✓
- 两类缺口区分 → Task 4.2 ✓
- 文档一致性（parallel/README/host-gate-findings/SKILL/validation）→ Task 4.2 ✓

**已知实现注意点（已在对应步骤内标注）：**
- Task 2.2 Step 3 的 `__rebuilt` 分支应替换为 `readTreeSnapshots(run).at(-1)?.files`。
- Task 4.1 的触碰台账是**全局** `.mf-dev-flow/file-touches.json`（非每运行），锁按台账路径派生；`conflict-status` 按 runId 过滤，`no-active-run` 条目 runId 为 null。
- Task 4.1 移除 `acquireFileLeaseStoreLock` / `withFileLeaseStoreLock` / `releaseSessionLeases` / `releaseTaskLeases` 前，先确认已无调用点（`policy-engine.mjs` 的 `releaseSessionLeases` 调用需一并改为写 `session-closed` 台账标记或删除）。

**类型一致性：**
- `basis` 取值统一为 `"declaration-scope"` / `"snapshot-interval"`。
- 三桶字段名 `attributed` / `inferred` / `unattributed` / `declaredUnchanged` / `shared` 在 Task 3.2 定义、3.3 消费，一致。
- `observations` 取值 `no-active-run` / `out-of-scope` / `cross-run-scope` / `concurrent-same-file` 在 Task 4.1 定义与断言，一致。
