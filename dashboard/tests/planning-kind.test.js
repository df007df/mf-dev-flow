// 看板 Phase 4 reader（kind 化 / 技术发布复评 / 参考范围）：
// 只读复用 modules/planning 的 kind 与 deliveryImpactClosure，验证看板投影
// 与 CLI 同源；不借真实项目，全部在 os.tmpdir() 隔离 fixture 内运行。
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planningSummary } from "../server/readers/planning.js";
import { runDetail, runSummary } from "../server/readers/runs.js";
import { readPrototypeRevision } from "../server/prototype-impact.js";

const tempDirs = [];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

// 复用 mf-dev-flow.technical-feature.test.mjs 的最小原型夹具，令 prototypeImpact
// 判定为 current，从而只暴露 kind 与 delivery 闭包这两项本次新增行为。
function storeFixture({ technicalReleased = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-dash-kind-")));
  tempDirs.push(root);
  const store = path.join(root, ".mf-dev-flow");
  writeJson(path.join(store, "prototype", "task.json"), {
    schemaVersion: 1,
    id: "proto-fixture",
    title: "fixture",
    status: "accepted",
    source: { prototypeRun: "test", prototypeVersion: "fixture" },
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  writeJson(path.join(store, "prototype", "feature-index.json"), {
    schemaVersion: 1,
    sourceRun: "test",
    features: [
      { id: "old-a", title: "old-a", sourceEntries: ["entry-1"] },
      { id: "old-b", title: "old-b", sourceEntries: ["entry-2"] },
    ],
  });
  writeJson(path.join(store, "prototype", "coverage.json"), {
    schemaVersion: 1,
    sourceInventory: {
      entries: [
        { id: "entry-1", feature: "old-a" },
        { id: "entry-2", feature: "old-b" },
      ],
    },
    coverage: [
      { id: "entry-1", status: "covered", evidence: [{ level: "observed", path: "screenshots/entry-1.png" }] },
      { id: "entry-2", status: "covered", evidence: [{ level: "observed", path: "screenshots/entry-2.png" }] },
    ],
  });
  writeJson(path.join(store, "prototype", "open-questions.json"), { schemaVersion: 1, sourceRun: "test", questions: [] });
  fs.mkdirSync(path.join(store, "prototype-runs", "test", "screenshots"), { recursive: true });
  fs.writeFileSync(path.join(store, "prototype-runs", "test", "screenshots", "entry-1.png"), "fixture");
  fs.writeFileSync(path.join(store, "prototype-runs", "test", "screenshots", "entry-2.png"), "fixture");
  fs.writeFileSync(path.join(store, "prototype", "原型图流程.md"), "# 原型图流程\n");
  const baseline = readPrototypeRevision(store);

  writeJson(path.join(store, "planning", "feature-map.json"), {
    schemaVersion: 4,
    sourceRun: "refinement-fixture",
    prototypeRun: null,
    evidenceCursor: "fixture",
    prototypeBaseline: baseline,
    groups: [
      { id: "old-a", title: "old-a", rank: 10, sourceFeatureIds: ["old-a"] },
      { id: "old-b", title: "old-b", rank: 20, sourceFeatureIds: ["old-b"] },
    ],
    features: [
      {
        id: "six-stage-review",
        kind: "product",
        title: "六关复习",
        parentId: "old-a",
        rank: 10,
        outcome: "用户完成六关复习",
        description: "复习判卷端到端验收",
        developmentRequirements: ["按原型核对"],
        sourceEntries: ["entry-1"],
        priority: "P0",
        wave: "W0",
        status: "not_started",
        dependsOn: technicalReleased ? ["backend-migration"] : [],
        systemCardRefs: [],
      },
      {
        id: "backend-migration",
        kind: "technical",
        title: "后端能力收口",
        parentId: "old-b",
        rank: 10,
        description: "迁移新能力至统一后端",
        developmentRequirements: ["按接口契约迁移"],
        priority: "P0",
        wave: "W0",
        status: technicalReleased ? "done" : "not_started",
        dependsOn: [],
        systemCardRefs: ["content-service-test"],
      },
    ],
    migrations: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  writeJson(path.join(store, "planning", "feature-history.json"), { events: [] });

  if (technicalReleased) {
    const runId = "20260101-120000Z-tech-fixture";
    const runDir = path.join(store, "delivery-runs", runId);
    writeJson(path.join(runDir, "run.json"), {
      schemaVersion: 1,
      id: runId,
      type: "delivery",
      title: "技术功能收口（fixture）",
      status: "in_progress",
      prototypeRun: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    writeJson(path.join(runDir, "work-plan.json"), {
      schemaVersion: 1,
      tasks: [
        {
          id: "task-tech",
          title: "后端能力收口",
          kind: "backend",
          scope: "technical",
          leafFeatureIds: ["backend-migration"],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    writeJson(path.join(runDir, "executions", "task-tech.json"), {
      schemaVersion: 2,
      runId,
      taskId: "task-tech",
      agent: "controller-fixture",
      status: "done",
      summary: "done",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  }
  return { root, store };
}

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

test("planningSummary: kind 归一化，技术叶子不会被读成产品", () => {
  const { store } = storeFixture();
  const summary = planningSummary(store);
  const byId = new Map(summary.features.map((feature) => [feature.id, feature]));
  assert.equal(summary.groups.find((group) => group.id === "old-a").ref, "mf-dev-flow:feature-group:old-a");
  assert.equal(byId.get("six-stage-review").ref, "mf-dev-flow:feature:six-stage-review");
  assert.equal(JSON.stringify(summary).includes("truthPointer"), false, "看板 state 只携带 Object Ref，不携带定位器");
  assert.equal(byId.get("six-stage-review").kind, "product");
  assert.equal(byId.get("backend-migration").kind, "technical");
});

test("planningSummary: 技术发布后依赖它的产品叶子被标为待复评", () => {
  const { store } = storeFixture({ technicalReleased: true });
  const summary = planningSummary(store);
  const byId = new Map(summary.features.map((feature) => [feature.id, feature]));
  const product = byId.get("six-stage-review");
  assert.equal(product.planningStatus, "review_required");
  assert.ok(
    product.blockers.some((item) => /技术发布待复评/.test(item) && /backend-migration/.test(item)),
    product.blockers.join("\n"),
  );
  assert.ok(
    !summary.actionable.some((feature) => feature.id === "six-stage-review"),
    "待复评的产品叶子不能出现在可执行清单",
  );
});

test("planningSummary: 未发布技术叶子时不产生技术发布阻塞", () => {
  const { store } = storeFixture();
  const summary = planningSummary(store);
  const byId = new Map(summary.features.map((feature) => [feature.id, feature]));
  assert.equal(byId.get("six-stage-review").planningStatus, "current");
  assert.ok(!byId.get("six-stage-review").blockers.some((item) => /技术发布待复评/.test(item)));
});

test("runDetail: manual 输入的 featureIds 标为参考范围而非承诺交付", () => {
  const { store } = storeFixture();
  const runId = "20260101-130000Z-manual-fixture";
  const runDir = path.join(store, "delivery-runs", runId);
  writeJson(path.join(runDir, "run.json"), {
    schemaVersion: 1,
    id: runId,
    type: "delivery",
    title: "manual 参考范围",
    status: "in_progress",
    deliveryInput: { file: "delivery-input.json", source: "manual", intensity: "high", featureIds: ["six-stage-review", "backend-migration"], createdAt: "2026-01-01T00:00:00.000Z" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  writeJson(path.join(runDir, "delivery-input.json"), { schemaVersion: 1, runId, source: "manual", intensity: "high", featureInputs: [], stages: [] });
  writeJson(path.join(runDir, "work-plan.json"), { schemaVersion: 1, tasks: [] });

  const detail = runDetail(store, "delivery", runId);
  assert.equal(detail.run.ref, `mf-dev-flow:run:delivery/${runId}`);
  assert.ok(detail.referenceScope);
  assert.equal(detail.referenceScope.referenceOnly, true);
  assert.deepEqual(detail.referenceScope.featureIds, ["six-stage-review", "backend-migration"]);
  assert.match(detail.referenceScope.notice, /参考范围，未承诺交付/);
});

test("运行与任务摘要投影使用确定性的 Object Ref", () => {
  const { store } = storeFixture({ technicalReleased: true });
  const runId = "20260101-120000Z-tech-fixture";
  const summary = runSummary(store, "delivery", runId);
  const detail = runDetail(store, "delivery", runId);

  assert.equal(summary.ref, `mf-dev-flow:run:delivery/${runId}`);
  assert.equal(detail.run.ref, `mf-dev-flow:run:delivery/${runId}`);
  assert.equal(detail.tasks[0].ref, `mf-dev-flow:task:delivery/${runId}/task-tech`);
});

test("runDetail: feature-map 输入标为承诺交付", () => {
  const { store } = storeFixture();
  const runId = "20260101-140000Z-featuremap-fixture";
  const runDir = path.join(store, "delivery-runs", runId);
  writeJson(path.join(runDir, "run.json"), {
    schemaVersion: 1,
    id: runId,
    type: "delivery",
    title: "feature-map 承诺范围",
    status: "in_progress",
    deliveryInput: { file: "delivery-input.json", source: "feature-map", intensity: "high", featureIds: ["six-stage-review"], createdAt: "2026-01-01T00:00:00.000Z" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  writeJson(path.join(runDir, "delivery-input.json"), { schemaVersion: 1, runId, source: "feature-map", intensity: "high", featureInputs: [], stages: [] });
  writeJson(path.join(runDir, "work-plan.json"), { schemaVersion: 1, tasks: [] });

  const detail = runDetail(store, "delivery", runId);
  assert.ok(detail.referenceScope);
  assert.equal(detail.referenceScope.referenceOnly, false);
  assert.match(detail.referenceScope.notice, /承诺范围/);
});

test("runDetail: 无 featureIds 的运行不产生范围标注", () => {
  const { store } = storeFixture();
  const runId = "20260101-150000Z-noscope-fixture";
  const runDir = path.join(store, "delivery-runs", runId);
  writeJson(path.join(runDir, "run.json"), {
    schemaVersion: 1,
    id: runId,
    type: "delivery",
    title: "无范围",
    status: "in_progress",
    deliveryInput: { file: "delivery-input.json", source: "manual", intensity: "low", createdAt: "2026-01-01T00:00:00.000Z" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  writeJson(path.join(runDir, "delivery-input.json"), { schemaVersion: 1, runId, source: "manual", intensity: "low", featureInputs: [], stages: [] });
  writeJson(path.join(runDir, "work-plan.json"), { schemaVersion: 1, tasks: [] });

  const detail = runDetail(store, "delivery", runId);
  assert.equal(detail.referenceScope, null);
});
