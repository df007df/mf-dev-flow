import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "mf-dev-flow.mjs");

function fixture(t, id) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-validation-profile-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, value = "") => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
    return file;
  };
  const git = (...args) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "fixture");
  write("README.md", "fixture\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  write(".mf-dev-flow/project.json", "{\"schemaVersion\":1}\n");
  write(`.mf-dev-flow/delivery-runs/${id}/run.json`, JSON.stringify({
    schemaVersion: 1,
    id,
    type: "delivery",
    status: "in_progress",
    notes: [],
  }));
  write(`.mf-dev-flow/delivery-runs/${id}/delivery-input.json`, JSON.stringify({
    schemaVersion: 1,
    intensity: "focused",
    source: "manual",
    deliveryContract: { id: "generic-task", version: 1 },
    tasks: [],
  }));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  const execution = (task) => JSON.parse(fs.readFileSync(
    path.join(root, ".mf-dev-flow", "delivery-runs", id, "executions", `${task}.json`),
    "utf8",
  ));
  const plan = () => JSON.parse(fs.readFileSync(
    path.join(root, ".mf-dev-flow", "delivery-runs", id, "work-plan.json"),
    "utf8",
  ));
  const planFile = path.join(root, ".mf-dev-flow", "delivery-runs", id, "work-plan.json");
  return { root, write, run, execution, plan, planFile };
}

function acceptance(write, id, visual, checks = []) {
  const evidence = `.mf-dev-flow/delivery-runs/${id}/evidence/check.log`;
  write(evidence, "targeted verification passed\n");
  return write(`.mf-dev-flow/delivery-runs/${id}/acceptance.json`, JSON.stringify({
    type: "fix",
    version: 1,
    checks: [
      { id: "reproduction", status: "passed", evidence: ["evidence/check.log"] },
      { id: "resolution", status: "passed", evidence: ["evidence/check.log"] },
      { id: "regression", status: "passed", evidence: ["evidence/check.log"] },
    ],
    validation: { visual, ...(checks.length ? { checks } : {}) },
  }));
}

test("页面局部结构调整冻结自动档位，并把快速路径决策写入 execution", t => {
  const id = "local-ui";
  const { write, run, execution, plan } = fixture(t, id);
  const types = run("work", "types", "--json");
  assert.equal(types.status, 0, types.stderr);
  assert.ok(JSON.parse(types.stdout).validationProfiles.some(item => item.id === "local-ui-structural"));

  const planned = run(
    "work", "plan", "--run", id, "--task", "calendar-tag", "--title", "日历 TAG", "--kind", "fix",
    "--scope", "governance", "--writes", "src/pages/v2/my,e2e", "--validation-profile", "auto",
  );
  assert.equal(planned.status, 0, planned.stderr);
  assert.deepEqual(plan().tasks[0].validationProfile, {
    schemaVersion: 1,
    version: 1,
    requested: "auto",
    risk: "unclassified",
    classificationConfidence: "unclassified",
  });
  const brief = run("work", "delivery-brief", "--run", id, "--task", "calendar-tag");
  assert.equal(brief.status, 0, brief.stderr);
  assert.match(brief.stdout, /验证档位：auto/);
  assert.equal(run("work", "claim", "--run", id, "--task", "calendar-tag", "--agent", "root", "--session", "s-local").status, 0);
  write("src/pages/v2/my/index.tsx", "export default function Page() { return null; }\n");
  write("src/pages/v2/my/index.scss", ".tag { color: #673ab7; }\n");
  write("e2e/calendar-tag-check.js", "console.log('ok');\n");
  const accepted = acceptance(write, id, {
    status: "pending_user_review",
    reason: "当前会话没有图像分析通道。",
  }, [
    { id: "targeted-runtime-check", status: "passed", evidence: ["evidence/check.log"] },
    { id: "typecheck", status: "passed", evidence: ["evidence/check.log"] },
  ]);
  const finished = run(
    "work", "finish", "--run", id, "--task", "calendar-tag", "--agent", "root", "--status", "done",
    "--summary", "日历 TAG 完成", "--files", "src/pages/v2/my/index.tsx,src/pages/v2/my/index.scss,e2e/calendar-tag-check.js",
    "--tests", "node e2e/calendar-tag-check.js；npx tsc --noEmit", "--acceptance", accepted,
  );
  assert.equal(finished.status, 0, finished.stderr);
  assert.deepEqual(execution("calendar-tag").validationDecision, {
    schemaVersion: 1,
    requestedProfile: "auto",
    profile: "local-ui-structural",
    risk: "low",
    classificationConfidence: "high",
    basis: [
      "任务类型为 fix",
      "生产改动仅限同一页面入口的 TSX/样式文件",
      "附加文件仅限 tests/ 或 e2e/ 定向验证",
      "任务级 Git 基线与声明文件已精确对账",
    ],
    required: ["task-type-acceptance", "targeted-runtime-check", "typecheck"],
    skipped: [{ gate: "full-test-suite", reason: "local-ui-structural@1 已限定为页面本地展示改动" }],
    visual: {
      status: "pending_user_review",
      reason: "当前会话没有图像分析通道。",
    },
  });
});

test("服务层改动不满足局部 UI 条件时回退标准验证，不能留下跳过项", t => {
  const id = "service-change";
  const { write, run, execution } = fixture(t, id);
  const planned = run(
    "work", "plan", "--run", id, "--task", "service-fix", "--title", "服务修复", "--kind", "fix",
    "--scope", "governance", "--writes", "src", "--validation-profile", "local-ui-structural",
  );
  assert.equal(planned.status, 0, planned.stderr);
  assert.equal(run("work", "claim", "--run", id, "--task", "service-fix", "--agent", "root", "--session", "s-service").status, 0);
  write("src/consumer-app/services/catalog.ts", "export const catalog = [];\n");
  const accepted = acceptance(write, id, { status: "not_required" });
  const finished = run(
    "work", "finish", "--run", id, "--task", "service-fix", "--agent", "root", "--status", "done",
    "--summary", "服务修复完成", "--files", "src/consumer-app/services/catalog.ts", "--tests", "pnpm test",
    "--acceptance", accepted,
  );
  assert.equal(finished.status, 0, finished.stderr);
  const decision = execution("service-fix").validationDecision;
  assert.equal(decision.profile, "standard");
  assert.equal(decision.risk, "medium");
  assert.equal(decision.classificationConfidence, "low");
  assert.deepEqual(decision.skipped, []);
  assert.match(decision.basis.join("\n"), /不满足 local-ui-structural/);
});

test("视觉不可用必须留下原因，不能以空声明通过验收", t => {
  const id = "visual-required";
  const { write, run } = fixture(t, id);
  assert.equal(run(
    "work", "plan", "--run", id, "--task", "visual-fix", "--title", "视觉修复", "--kind", "fix",
    "--scope", "governance", "--writes", "src/pages/v2/my", "--validation-profile", "auto",
  ).status, 0);
  assert.equal(run("work", "claim", "--run", id, "--task", "visual-fix", "--agent", "root", "--session", "s-visual").status, 0);
  write("src/pages/v2/my/index.scss", ".tag { color: #673ab7; }\n");
  const accepted = acceptance(write, id, { status: "unavailable" });
  const finished = run(
    "work", "finish", "--run", id, "--task", "visual-fix", "--agent", "root", "--status", "done",
    "--summary", "视觉修复完成", "--files", "src/pages/v2/my/index.scss", "--tests", "截图已归档",
    "--acceptance", accepted,
  );
  assert.notEqual(finished.status, 0);
  assert.match(finished.stderr, /visual\.reason/);
});

test("快速路径必须为定向检查与 typecheck 提供独立证据", t => {
  const id = "missing-fast-evidence";
  const { write, run } = fixture(t, id);
  assert.equal(run(
    "work", "plan", "--run", id, "--task", "calendar-tag", "--title", "日历 TAG", "--kind", "fix",
    "--scope", "governance", "--writes", "src/pages/v2/my", "--validation-profile", "auto",
  ).status, 0);
  assert.equal(run("work", "claim", "--run", id, "--task", "calendar-tag", "--agent", "root", "--session", "s-fast-evidence").status, 0);
  write("src/pages/v2/my/index.tsx", "export default function Page() { return null; }\n");
  write("src/pages/v2/my/index.scss", ".tag { color: #673ab7; }\n");
  const accepted = acceptance(write, id, { status: "not_required" });
  const finished = run(
    "work", "finish", "--run", id, "--task", "calendar-tag", "--agent", "root", "--status", "done",
    "--summary", "日历 TAG 完成", "--files", "src/pages/v2/my/index.tsx,src/pages/v2/my/index.scss",
    "--tests", "node e2e/calendar-tag-check.js；npx tsc --noEmit", "--acceptance", accepted,
  );
  assert.notEqual(finished.status, 0);
  assert.match(finished.stderr, /validation\.checks/);
});

test("冻结的验证档位版本或名称被手改后，只能回退标准验证", t => {
  const id = "tampered-profile";
  const { write, run, execution, plan, planFile } = fixture(t, id);
  assert.equal(run(
    "work", "plan", "--run", id, "--task", "calendar-tag", "--title", "日历 TAG", "--kind", "fix",
    "--scope", "governance", "--writes", "src/pages/v2/my", "--validation-profile", "auto",
  ).status, 0);
  const frozen = plan();
  frozen.tasks[0].validationProfile.version = 999;
  frozen.tasks[0].validationProfile.requested = "unrecognized-profile";
  fs.writeFileSync(planFile, JSON.stringify(frozen));
  assert.equal(run("work", "claim", "--run", id, "--task", "calendar-tag", "--agent", "root", "--session", "s-tampered").status, 0);
  write("src/pages/v2/my/index.scss", ".tag { color: #673ab7; }\n");
  const accepted = acceptance(write, id, { status: "not_required" });
  const finished = run(
    "work", "finish", "--run", id, "--task", "calendar-tag", "--agent", "root", "--status", "done",
    "--summary", "日历 TAG 完成", "--files", "src/pages/v2/my/index.scss", "--tests", "pnpm test",
    "--acceptance", accepted,
  );
  assert.equal(finished.status, 0, finished.stderr);
  const decision = execution("calendar-tag").validationDecision;
  assert.equal(decision.profile, "standard");
  assert.equal(decision.classificationConfidence, "low");
  assert.deepEqual(decision.skipped, []);
  assert.match(decision.basis.join("\n"), /冻结的验证档位/);
});

test("同一运行的其他任务有实际改动时，局部 UI 任务不得使用快速路径", t => {
  const id = "shared-run-change";
  const { write, run, execution } = fixture(t, id);
  assert.equal(run(
    "work", "plan", "--run", id, "--task", "calendar-tag", "--title", "日历 TAG", "--kind", "fix",
    "--scope", "governance", "--writes", "src/pages/v2/my", "--validation-profile", "auto",
  ).status, 0);
  assert.equal(run(
    "work", "plan", "--run", id, "--task", "service-peer", "--title", "服务并行任务", "--kind", "generic",
    "--scope", "governance", "--writes", "src/consumer-app/services",
  ).status, 0);
  assert.equal(run("work", "claim", "--run", id, "--task", "calendar-tag", "--agent", "root", "--session", "s-shared").status, 0);
  write("src/pages/v2/my/index.scss", ".tag { color: #673ab7; }\n");
  write("src/consumer-app/services/catalog.ts", "export const catalog = [];\n");
  const accepted = acceptance(write, id, { status: "not_required" }, [
    { id: "targeted-runtime-check", status: "passed", evidence: ["evidence/check.log"] },
  ]);
  const finished = run(
    "work", "finish", "--run", id, "--task", "calendar-tag", "--agent", "root", "--status", "done",
    "--summary", "日历 TAG 完成", "--files", "src/pages/v2/my/index.scss", "--tests", "node e2e/calendar-tag-check.js",
    "--acceptance", accepted,
  );
  assert.equal(finished.status, 0, finished.stderr);
  const done = execution("calendar-tag");
  assert.equal(done.processData.gitReconciled, true);
  assert.equal(done.processData.taskGitReconciled, false);
  assert.deepEqual(done.processData.taskGitExtra, ["src/consumer-app/services/catalog.ts"]);
  assert.equal(done.validationDecision.profile, "standard");
  assert.deepEqual(done.validationDecision.skipped, []);
  assert.match(done.validationDecision.basis.join("\n"), /任务级 Git/);
});
