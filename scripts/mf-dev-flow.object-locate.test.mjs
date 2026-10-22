// 隔离 fixture 回归：object locate 只能解析临时工作区中的真源。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { formatObjectRef } from "../modules/kernel/object-ref.mjs";
import { prototypeCommand } from "../modules/prototype/cli.mjs";
import { fixture as prototypeFixture } from "../modules/prototype/tests/fixtures.mjs";

const skill = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(skill, "scripts/mf-dev-flow.mjs");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-object-locate-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = path.join(root, ".mf-dev-flow");

  writeJson(path.join(store, "project.json"), {
    schemaVersion: 1,
    project: { name: "定位测试项目" },
  });
  writeJson(path.join(store, "projects", "app.json"), {
    schemaVersion: 1,
    id: "app",
    title: "应用项目卡",
    status: "passed",
  });
  writeJson(path.join(store, "prototype", "feature-index.json"), {
    schemaVersion: 1,
    features: [{ id: "reading", title: "阅读" }],
  });
  writeJson(path.join(store, "prototype", "coverage.json"), {
    schemaVersion: 1,
    sourceInventory: {
      entries: [{ id: "entry-home", title: "首页", feature: "reading" }],
      sourceFiles: [{ path: "prototype/index.html", sha256: "sha256:source" }],
    },
    coverage: [],
  });
  writeJson(path.join(store, "prd", "manifest.json"), {
    schemaVersion: 1,
    sources: [{ id: "prd-a", title: "阅读 PRD", origin: { kind: "file" }, format: "text" }],
  });
  fs.mkdirSync(path.join(store, "prd", "sources"), { recursive: true });
  fs.writeFileSync(path.join(store, "prd", "sources", "prd-a.md"), "# 阅读 PRD\n");
  writeJson(path.join(store, "prd", "analyses", "batch-a", "findings.json"), {
    schemaVersion: 1,
    batchId: "batch-a",
    title: "阅读 PRD 分析",
    sources: ["prd-a"],
    items: [],
  });
  writeJson(path.join(store, "system", "cards.json"), {
    schemaVersion: 2,
    cards: [{ id: "system-a", title: "系统 A", status: "confirmed" }],
  });
  writeJson(path.join(store, "planning", "feature-map.json"), {
    schemaVersion: 4,
    groups: [{ id: "core", title: "核心能力", rank: 10 }],
    features: [{ id: "reader", title: "阅读器", parentId: "core", status: "in_progress" }],
  });
  writeJson(path.join(store, "delivery-runs", "delivery-1", "run.json"), {
    schemaVersion: 1,
    id: "delivery-1",
    type: "delivery",
    title: "阅读器交付",
    status: "in_progress",
  });
  writeJson(path.join(store, "delivery-runs", "delivery-1", "work-plan.json"), {
    schemaVersion: 1,
    tasks: [{ id: "task-a", title: "实现阅读器", kind: "ui", status: "pending" }],
  });
  writeJson(path.join(store, "delivery-runs", "delivery-1", "executions", "task-a.json"), {
    schemaVersion: 1,
    id: "task-a",
    status: "completed",
    updatedAt: "2026-09-10T00:00:00Z",
  });
  writeJson(path.join(store, "tasks", "kernel-1.json"), {
    schemaVersion: 1,
    kind: "run",
    id: "kernel-1",
    title: "内核运行",
    status: "completed",
  });
  writeJson(path.join(store, "tasks", "kernel-1", "task-k.json"), {
    schemaVersion: 1,
    kind: "task",
    id: "kernel-1/task-k",
    runId: "kernel-1",
    title: "内核任务",
    status: "completed",
  });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "reader.ts"), "export const reader = true;\n");
  return root;
}

function locate(root, kind, key) {
  const ref = formatObjectRef({ kind, key });
  const result = spawnSync(process.execPath, [cli, "object", "locate", "--ref", ref, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  return {
    ref,
    status: result.status,
    stderr: result.stderr,
    json: JSON.parse(result.stdout),
  };
}

test("object locate：所有已有 V1 真源在隔离工作区可精确定位", (t) => {
  const root = fixture(t);
  const cases = [
    ["project", "project", ".mf-dev-flow/project.json", "project.json", "定位测试项目"],
    ["project-card", "app", ".mf-dev-flow/projects/app.json", "projects/app.json", "应用项目卡"],
    ["prototype-group", "reading", ".mf-dev-flow/prototype/feature-index.json", "prototype/feature-index.json", "阅读"],
    ["prototype-entry", "entry-home", ".mf-dev-flow/prototype/coverage.json", "prototype/coverage.json", "首页"],
    ["prototype-source", "prototype/index.html", ".mf-dev-flow/prototype/coverage.json", "prototype/coverage.json", "prototype/index.html"],
    ["prd-source", "prd-a", ".mf-dev-flow/prd/manifest.json", "prd/manifest.json", "阅读 PRD"],
    ["prd-batch", "batch-a", ".mf-dev-flow/prd/analyses/batch-a/findings.json", "prd/analyses/batch-a/findings.json", "阅读 PRD 分析"],
    ["system-card", "system-a", ".mf-dev-flow/system/cards.json", "system/cards.json", "系统 A"],
    ["feature-group", "core", ".mf-dev-flow/planning/feature-map.json", "planning/feature-map.json", "核心能力"],
    ["feature", "reader", ".mf-dev-flow/planning/feature-map.json", "planning/feature-map.json", "阅读器"],
    ["run", "delivery/delivery-1", ".mf-dev-flow/delivery-runs/delivery-1/run.json", "delivery-runs/delivery-1/run.json", "阅读器交付"],
    ["task", "delivery/delivery-1/task-a", ".mf-dev-flow/delivery-runs/delivery-1/work-plan.json", "delivery-runs/delivery-1/work-plan.json", "实现阅读器"],
    ["run", "kernel/kernel-1", ".mf-dev-flow/tasks/kernel-1.json", "tasks/kernel-1.json", "内核运行"],
    ["task", "kernel/kernel-1/task-k", ".mf-dev-flow/tasks/kernel-1/task-k.json", "tasks/kernel-1/task-k.json", "内核任务"],
    ["code-file", "src/reader.ts", "src/reader.ts", "src/reader.ts", "src/reader.ts"],
  ];

  for (const [kind, key, expectedPath, expectedStorage, expectedTitle] of cases) {
    const result = locate(root, kind, key);
    assert.equal(result.status, 0, `${kind}: ${result.stderr}`);
    assert.equal(result.json.object.ref, result.ref);
    assert.equal(result.json.object.kind, kind);
    assert.equal(result.json.object.key, key);
    assert.equal(result.json.truthPointer.path, expectedPath);
    assert.equal(result.json.truthPointer.storage, expectedStorage);
    assert.equal(result.json.summary.title ?? result.json.summary.name ?? result.json.summary.path, expectedTitle);
  }
});

test("object locate：未知、格式错误和逃逸引用均明确拒绝", (t) => {
  const root = fixture(t);
  const run = (ref) => {
    const result = spawnSync(process.execPath, [cli, "object", "locate", "--ref", ref, "--json"], {
      cwd: root,
      encoding: "utf8",
    });
    return { status: result.status, json: JSON.parse(result.stdout), stderr: result.stderr };
  };

  const missing = run(formatObjectRef({ kind: "feature", key: "ghost" }));
  assert.equal(missing.status, 1);
  assert.equal(missing.json.error.code, "not_found");

  for (const ref of [
    "mf-dev-flow:unknown:x",
    "mf-dev-flow:task:delivery/delivery-1",
    "mf-dev-flow:code-file:src/%2E%2E/secret.txt",
    "mf-dev-flow:code-file:%2Fetc/passwd",
  ]) {
    const result = run(ref);
    assert.equal(result.status, 1, ref);
    assert.equal(result.json.error.code, "invalid_ref", ref);
  }

  const release = run(formatObjectRef({ kind: "release", key: "r1" }));
  assert.equal(release.status, 1);
  assert.equal(release.json.error.code, "not_found");
});

test("object locate：现代 prototype catalog 经公共 transport 定位，不直接读取 SQLite", (t) => {
  const catalog = prototypeFixture(t, false, true);
  catalog.complete();
  const accepted = prototypeCommand(
    ["accept", "--request-id", "object-locate-accept", "--expected-revision", "1"],
    catalog.root,
  );
  assert.equal(accepted.semanticRevision, 2);

  for (const [kind, key, pointer] of [
    ["prototype-group", "home", "/semantic/groups/home"],
    ["prototype-entry", "a", "/semantic/entries/a"],
    ["prototype-source", "source/index.html", "/sourceFiles/source~1index.html"],
  ]) {
    const result = locate(catalog.root, kind, key);
    assert.equal(result.status, 0, `${kind}: ${result.stderr}`);
    assert.equal(result.json.truthPointer.storage, "prototype/catalog.sqlite");
    assert.equal(result.json.truthPointer.pointer, pointer);
  }
});
