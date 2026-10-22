// git-diff 能力命令集成测试：真实临时 git 仓库验证 name-status 清单、untracked 选项与注入拒绝。
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "mf-dev-flow.mjs");
const tempDirs = [];

function sh(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function gitFixture() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-gitdiff-")));
  tempDirs.push(repo);
  sh(repo, ["init", "-q"]);
  sh(repo, ["config", "user.email", "test@example.invalid"]);
  sh(repo, ["config", "user.name", "fixture"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  fs.writeFileSync(path.join(repo, "c.txt"), "keep-me\n");
  sh(repo, ["add", "."]);
  sh(repo, ["commit", "-q", "-m", "first"]);
  const baseSha = sh(repo, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "two\n");
  fs.writeFileSync(path.join(repo, "b.txt"), "added\n");
  fs.rmSync(path.join(repo, "c.txt"));
  sh(repo, ["add", "-A"]);
  sh(repo, ["commit", "-q", "-m", "second"]);
  fs.writeFileSync(path.join(repo, "u.txt"), "untracked\n");
  return { repo, baseSha };
}

function runGitDiff(args) {
  const result = spawnSync(process.execPath, [cli, "capability", "git-diff", ...args], { encoding: "utf8" });
  return result;
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test("base→工作区给出 A/M/D 清单并记录两侧 commit", () => {
  const { repo, baseSha } = gitFixture();
  const result = runGitDiff(["--repo", repo, "--base", baseSha, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.base.sha, baseSha);
  assert.equal(parsed.head.ref, "working-tree");
  assert.deepEqual(parsed.files, [
    { status: "A", path: "b.txt" },
    { status: "M", path: "a.txt" },
    { status: "D", path: "c.txt" },
  ].sort((x, y) => (x.path < y.path ? -1 : 1)));
});

test("--include-untracked 单列 U；默认不计", () => {
  const { repo, baseSha } = gitFixture();
  const plain = JSON.parse(runGitDiff(["--repo", repo, "--base", baseSha]).stdout);
  assert.ok(!plain.files.some(f => f.path === "u.txt"));
  const withUntracked = JSON.parse(runGitDiff(["--repo", repo, "--base", baseSha, "--include-untracked"]).stdout);
  assert.deepEqual(withUntracked.files.filter(f => f.path === "u.txt"), [{ status: "U", path: "u.txt" }]);
});

test("显式 head 与范围/注入引用被拒绝或正确解析", () => {
  const { repo, baseSha } = gitFixture();
  const headSha = sh(repo, ["rev-parse", "HEAD"]);
  const explicit = JSON.parse(runGitDiff(["--repo", repo, "--base", baseSha, "--head", headSha]).stdout);
  assert.equal(explicit.head.sha, headSha);
  assert.equal(explicit.files.length, 3);
  const range = runGitDiff(["--repo", repo, "--base", `${baseSha}..HEAD`]);
  assert.equal(range.status, 1);
  assert.match(range.stderr, /不是合法 git 引用/);
  const injection = runGitDiff(["--repo", repo, "--base", "--output=/tmp/pwned"]);
  assert.equal(injection.status, 1);
  const ghost = runGitDiff(["--repo", repo, "--base", "deadbeefdeadbeef"]);
  assert.equal(ghost.status, 1);
  const notRepo = runGitDiff(["--repo", os.tmpdir(), "--base", "HEAD"]);
  assert.equal(notRepo.status, 1);
});

test("work claim 记录 git 基线；finish 保留 git 审计并排除未变化的基线脏文件", () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-git-audit-")));
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
  const readExecution = () => JSON.parse(fs.readFileSync(path.join(repo, ".mf-dev-flow/delivery-runs/audit/executions/gov-a.json"), "utf8"));

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
  assert.equal(run(["work", "plan", "--run", "audit", "--task", "gov-a", "--title", "Git audit", "--kind", "generic", "--scope", "governance", "--writes", "src"]).status, 0);

  // 基线脏文件属于前一个工作流，claim 后内容未变，不得转嫁给本任务。
  write("baseline-unrelated.txt", "before claim\n");
  assert.equal(run(["work", "claim", "--run", "audit", "--task", "gov-a", "--agent", "root", "--session", "s-git"]).status, 0);
  const execution = readExecution();
  assert.match(execution.baseCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(execution.baseDirtyFiles.map(item => item.file), ["baseline-unrelated.txt"]);

  write("src/task.ts", "export {};\n");
  write("undeclared.txt", "after claim\n");
  const finished = run(["work", "finish", "--run", "audit", "--task", "gov-a", "--agent", "root", "--status", "done", "--summary", "完成", "--files", "src/task.ts", "--tests", "node --test"]);
  assert.equal(finished.status, 0, finished.stderr);
  const done = readExecution();
  assert.equal(done.processData.gitReconciled, false);
  assert.deepEqual(done.processData.gitUndeclared, ["undeclared.txt"]);
  assert.equal(done.processData.gitUnobserved, undefined);
});

test("claim 后的基线脏文件被回退时报告 gitReverted，不再静默蒸发", () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-git-revert-")));
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
  const readExecution = () => JSON.parse(fs.readFileSync(path.join(repo, ".mf-dev-flow/delivery-runs/audit/executions/gov-a.json"), "utf8"));

  sh(["init", "-q"]);
  sh(["config", "user.email", "test@example.invalid"]);
  sh(["config", "user.name", "fixture"]);
  write("peer.txt", "committed base\n");
  sh(["add", "."]);
  sh(["commit", "-q", "-m", "base"]);

  write(".mf-dev-flow/project.json", "{\"schemaVersion\":1}\n");
  write(".mf-dev-flow/current.json", "{\"schemaVersion\":1,\"active\":{\"type\":\"delivery\",\"id\":\"audit\"}}\n");
  write(".mf-dev-flow/delivery-runs/audit/run.json", "{\"schemaVersion\":1,\"id\":\"audit\",\"type\":\"delivery\",\"status\":\"in_progress\",\"notes\":[]}\n");
  write(".mf-dev-flow/delivery-runs/audit/delivery-input.json", "{\"schemaVersion\":1,\"intensity\":\"focused\",\"source\":\"manual\",\"deliveryContract\":{\"id\":\"generic-task\",\"version\":1},\"tasks\":[]}\n");
  assert.equal(run(["work", "plan", "--run", "audit", "--task", "gov-a", "--title", "Git revert", "--kind", "generic", "--scope", "governance", "--writes", "src"]).status, 0);

  // 另一会话的未提交改动在 claim 前已存在，进入 baseDirtyFiles 快照。
  write("peer.txt", "peer work in progress\n");
  assert.equal(run(["work", "claim", "--run", "audit", "--task", "gov-a", "--agent", "root", "--session", "s-git"]).status, 0);
  const execution = readExecution();
  assert.deepEqual(execution.baseDirtyFiles.map(item => item.file), ["peer.txt"]);

  // 模拟并发会话在共享工作树上 git stash/checkout：peer.txt 回到已提交内容。
  write("peer.txt", "committed base\n");
  write("src/task.ts", "export {};\n");
  const finished = run(["work", "finish", "--run", "audit", "--task", "gov-a", "--agent", "root", "--status", "done", "--summary", "完成", "--files", "src/task.ts", "--tests", "node --test"]);
  assert.equal(finished.status, 0, finished.stderr);
  const done = readExecution();
  assert.equal(done.processData.gitReconciled, false);
  assert.deepEqual(done.processData.gitReverted, ["peer.txt"]);
  // 被回退的文件不再出现在 diff 清单，因此不会被误报为未观测。
  assert.equal(done.processData.gitUnobserved, undefined);
});

test("finish 后被 git stash 回退的已登记文件阻断 merge-check 与通过验证", () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-git-post-finish-stash-")));
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

  sh(["init", "-q"]);
  sh(["config", "user.email", "test@example.invalid"]);
  sh(["config", "user.name", "fixture"]);
  write("src/task.ts", "export const version = 'base';\n");
  sh(["add", "."]);
  sh(["commit", "-q", "-m", "base"]);
  write(".mf-dev-flow/project.json", "{\"schemaVersion\":1}\n");
  write(".mf-dev-flow/current.json", "{\"schemaVersion\":1,\"active\":{\"type\":\"delivery\",\"id\":\"audit\"}}\n");
  write(".mf-dev-flow/delivery-runs/audit/run.json", "{\"schemaVersion\":1,\"id\":\"audit\",\"type\":\"delivery\",\"status\":\"in_progress\",\"notes\":[]}\n");
  write(".mf-dev-flow/delivery-runs/audit/delivery-input.json", "{\"schemaVersion\":1,\"intensity\":\"focused\",\"source\":\"manual\",\"deliveryContract\":{\"id\":\"generic-task\",\"version\":1},\"tasks\":[]}\n");
  assert.equal(run(["work", "plan", "--run", "audit", "--task", "gov-a", "--title", "Post-finish stash", "--kind", "generic", "--scope", "governance", "--writes", "src"]).status, 0);
  assert.equal(run(["work", "claim", "--run", "audit", "--task", "gov-a", "--agent", "root", "--session", "s-git"]).status, 0);

  write("src/task.ts", "export const version = 'finished';\n");
  const finished = run(["work", "finish", "--run", "audit", "--task", "gov-a", "--agent", "root", "--status", "done", "--summary", "完成", "--files", "src/task.ts", "--tests", "node --test"]);
  assert.equal(finished.status, 0, finished.stderr);
  const execution = JSON.parse(fs.readFileSync(path.join(repo, ".mf-dev-flow/delivery-runs/audit/executions/gov-a.json"), "utf8"));
  assert.deepEqual(
    execution.processData.gitFinishFiles?.map((item) => item.file),
    ["src/task.ts"],
    JSON.stringify(execution.processData),
  );

  // 后续合法集成可继续改同一文件；门禁只应识别回到基线或消失，不能把新内容误判为回退。
  write("src/task.ts", "export const version = 'integrated';\n");
  const changedAfterFinish = run(["work", "merge-check", "--run", "audit"]);
  assert.equal(changedAfterFinish.status, 0, `${changedAfterFinish.stdout}\n${changedAfterFinish.stderr}`);

  sh(["stash", "push", "--message", "post-finish"]);
  assert.equal(fs.readFileSync(path.join(repo, "src/task.ts"), "utf8"), "export const version = 'base';\n");

  const mergeCheck = run(["work", "merge-check", "--run", "audit"]);
  assert.notEqual(mergeCheck.status, 0, `${mergeCheck.stdout}\n${mergeCheck.stderr}`);
  assert.match(mergeCheck.stderr, /gitPostFinishReverted：.*src\/task\.ts/);
  const verify = run(["work", "verify", "--run", "audit", "--status", "passed", "--commands", "node --test", "--summary", "完成"]);
  assert.notEqual(verify.status, 0, `${verify.stdout}\n${verify.stderr}`);
  assert.match(verify.stderr, /gitPostFinishReverted：.*src\/task\.ts/);
});

test("finish 后回到 claim 时已有脏内容的已登记文件也阻断合并", () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-git-post-finish-claim-")));
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

  sh(["init", "-q"]);
  sh(["config", "user.email", "test@example.invalid"]);
  sh(["config", "user.name", "fixture"]);
  write("src/task.ts", "export const version = 'base';\n");
  sh(["add", "."]);
  sh(["commit", "-q", "-m", "base"]);
  write(".mf-dev-flow/project.json", "{\"schemaVersion\":1}\n");
  write(".mf-dev-flow/current.json", "{\"schemaVersion\":1,\"active\":{\"type\":\"delivery\",\"id\":\"audit\"}}\n");
  write(".mf-dev-flow/delivery-runs/audit/run.json", "{\"schemaVersion\":1,\"id\":\"audit\",\"type\":\"delivery\",\"status\":\"in_progress\",\"notes\":[]}\n");
  write(".mf-dev-flow/delivery-runs/audit/delivery-input.json", "{\"schemaVersion\":1,\"intensity\":\"focused\",\"source\":\"manual\",\"deliveryContract\":{\"id\":\"generic-task\",\"version\":1},\"tasks\":[]}\n");
  assert.equal(run(["work", "plan", "--run", "audit", "--task", "gov-a", "--title", "Claim baseline", "--kind", "generic", "--scope", "governance", "--writes", "src"]).status, 0);

  write("src/task.ts", "export const version = 'peer';\n");
  assert.equal(run(["work", "claim", "--run", "audit", "--task", "gov-a", "--agent", "root", "--session", "s-git"]).status, 0);
  const claimed = JSON.parse(fs.readFileSync(path.join(repo, ".mf-dev-flow/delivery-runs/audit/executions/gov-a.json"), "utf8"));
  assert.match(claimed.baseDirtyFiles[0].blob, /^[0-9a-f]{40}$/);
  write("src/task.ts", "export const version = 'finished';\n");
  const finished = run(["work", "finish", "--run", "audit", "--task", "gov-a", "--agent", "root", "--status", "done", "--summary", "完成", "--files", "src/task.ts", "--tests", "node --test"]);
  assert.equal(finished.status, 0, finished.stderr);

  // A stale stash/apply can restore the pre-claim dirty version rather than HEAD.
  write("src/task.ts", "export const version = 'peer';\n");
  const mergeCheck = run(["work", "merge-check", "--run", "audit"]);
  assert.notEqual(mergeCheck.status, 0, `${mergeCheck.stdout}\n${mergeCheck.stderr}`);
  assert.match(mergeCheck.stderr, /gitPostFinishReverted：.*src\/task\.ts/);
});

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

test("声明不相交的并发运行：对方声明范围内的改动不算本运行的 gitUndeclared", () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-git-crossrun-")));
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
  const readExecution = (runId, task) =>
    JSON.parse(fs.readFileSync(path.join(repo, `.mf-dev-flow/delivery-runs/${runId}/executions/${task}.json`), "utf8"));

  sh(["init", "-q"]);
  sh(["config", "user.email", "test@example.invalid"]);
  sh(["config", "user.name", "fixture"]);
  write("keep.txt", "base\n");
  sh(["add", "."]);
  sh(["commit", "-q", "-m", "base"]);

  // 两个声明不相交的并发运行：A 拥有 src/theme，B 拥有 src/review。
  write(".mf-dev-flow/project.json", "{\"schemaVersion\":1}\n");
  write(".mf-dev-flow/current.json", "{\"schemaVersion\":1,\"active\":{\"type\":\"delivery\",\"id\":\"bravo\"}}\n");
  for (const runId of ["alpha", "bravo"]) {
    write(`.mf-dev-flow/delivery-runs/${runId}/run.json`, `{\"schemaVersion\":1,\"id\":\"${runId}\",\"type\":\"delivery\",\"status\":\"in_progress\",\"notes\":[]}\n`);
    write(`.mf-dev-flow/delivery-runs/${runId}/delivery-input.json`, "{\"schemaVersion\":1,\"intensity\":\"focused\",\"source\":\"manual\",\"deliveryContract\":{\"id\":\"generic-task\",\"version\":1},\"tasks\":[]}\n");
  }
  assert.equal(run(["work", "plan", "--run", "alpha", "--task", "theme-task", "--title", "Theme", "--kind", "generic", "--scope", "governance", "--writes", "src/theme"]).status, 0);
  assert.equal(run(["work", "claim", "--run", "alpha", "--task", "theme-task", "--agent", "root", "--session", "s-a"]).status, 0);
  assert.equal(run(["work", "plan", "--run", "bravo", "--task", "review-task", "--title", "Review", "--kind", "generic", "--scope", "governance", "--writes", "src/review"]).status, 0);
  // B 的 claim 基线先落盘，随后 A 才写入自己的文件：A 的改动因此落在 B 的审计窗口内。
  assert.equal(run(["work", "claim", "--run", "bravo", "--task", "review-task", "--agent", "root", "--session", "s-b"]).status, 0);
  write("src/theme/theme.css", "body { color: red; }\n");
  write("src/review/review.ts", "export const r = 1;\n");

  const finished = run(["work", "finish", "--run", "bravo", "--task", "review-task", "--agent", "root", "--status", "done", "--summary", "完成", "--files", "src/review/review.ts", "--tests", "node --test"]);
  assert.equal(finished.status, 0, finished.stderr);
  const done = readExecution("bravo", "review-task");
  // A 的文件属于 A 的声明并集（由那边的 reconcile 归因），绝不能算成 B 的未声明改动。
  assert.equal(done.processData.gitUndeclared, undefined);
  assert.ok(!JSON.stringify(done.processData).includes("src/theme/theme.css"));
  assert.deepEqual(done.processData.gitAttributed, ["src/review/review.ts"]);
  assert.equal(done.processData.gitReconciled, true);
});
