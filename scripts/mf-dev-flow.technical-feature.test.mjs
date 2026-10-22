import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  taskLeafFeatureIds,
  taskRelatedFeatureIds,
  taskLeafLink,
} from "../modules/runtime/shared.mjs";
import { readPrototypeRevision, deliveryImpactClosure, deliveryImpactRecords, impactReviewProblems } from "../modules/planning/impact.mjs";
import { featureMapProblems } from "../modules/runtime/planning.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "mf-dev-flow.mjs");
const temporaryDirectories = [];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function runCli(cwd, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd, encoding: "utf8", env: { ...process.env, MF_DEV_FLOW_BYPASS_NETWORK: "1" },
  });
}

function fixture({ source = "manual", technicalReleased = false, reviewedProductIds = [] } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-tech-feature-"));
  temporaryDirectories.push(cwd);
  const runId = "20260101-120000Z-tech-fixture";
  const runDir = path.join(cwd, ".mf-dev-flow", "delivery-runs", runId);
  const planningDir = path.join(cwd, ".mf-dev-flow", "planning");

  // Bootstrap a minimal accepted prototype so prototypeDevelopmentProblems
  // returns no problems during the gate check (it always runs for product
  // and technical tasks; governance tasks short-circuit before that gate).
  writeJson(path.join(cwd, ".mf-dev-flow", "project.json"), {
    schemaVersion: 1,
    project: { name: "tech feature fixture", background: "phase 1 unit" },
    codeRoots: [{ path: ".", role: "primary", writeBoundary: "src", deliveryRoles: ["ui-client"] }],
  });
  writeJson(path.join(cwd, ".mf-dev-flow", "prototype", "task.json"), {
    schemaVersion: 1,
    id: "proto-fixture",
    title: "fixture",
    status: "accepted",
    source: { prototypeRun: "test", prototypeVersion: "fixture" },
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  writeJson(path.join(cwd, ".mf-dev-flow", "prototype", "feature-index.json"), {
    schemaVersion: 1,
    sourceRun: "test",
    features: [
      { id: "old-a", title: "old-a", sourceEntries: ["entry-1"] },
      { id: "old-b", title: "old-b", sourceEntries: ["entry-2"] },
    ],
  });
  writeJson(path.join(cwd, ".mf-dev-flow", "prototype", "coverage.json"), {
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
  writeJson(path.join(cwd, ".mf-dev-flow", "prototype", "open-questions.json"), {
    schemaVersion: 1,
    sourceRun: "test",
    questions: [],
  });
  fs.mkdirSync(path.join(cwd, ".mf-dev-flow", "prototype-runs", "test", "screenshots"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".mf-dev-flow", "prototype-runs", "test", "screenshots", "entry-1.png"), "fixture");
  fs.writeFileSync(path.join(cwd, ".mf-dev-flow", "prototype-runs", "test", "screenshots", "entry-2.png"), "fixture");
  fs.writeFileSync(path.join(cwd, ".mf-dev-flow", "prototype", "原型图流程.md"), "# 原型图流程\n");
  const baseline = readPrototypeRevision(path.join(cwd, ".mf-dev-flow"));

  writeJson(path.join(cwd, ".mf-dev-flow", "current.json"), {
    schemaVersion: 1,
    active: { type: "delivery", id: runId },
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  writeJson(path.join(planningDir, "feature-map.json"), {
    schemaVersion: 3,
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
        dependsOn: [],
        systemCardRefs: [],
      },
      {
        id: "wordbook-lifecycle",
        title: "单词本生命周期",
        parentId: "old-b",
        rank: 10,
        outcome: "用户管理单词",
        description: "单词本 CRUD",
        developmentRequirements: ["按原型核对"],
        sourceEntries: ["entry-2"],
        priority: "P1",
        wave: "W1",
        status: "not_started",
        dependsOn: [],
        systemCardRefs: [],
      },
      {
        id: "backend-migration",
        kind: "technical",
        title: "Web 后端能力收口",
        parentId: "old-a",
        rank: 5,
        description: "将既有能力迁移至目标后端",
        developmentRequirements: ["按接口契约迁移", "完成新通道回归"],
        status: "not_started",
        dependsOn: [],
        systemCardRefs: ["content-service-test"],
      },
    ],
    migrations: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  if (technicalReleased || reviewedProductIds.length) {
    const mapFile = path.join(planningDir, "feature-map.json");
    const map = JSON.parse(fs.readFileSync(mapFile, "utf8"));
    const product = map.features.find((feature) => feature.id === "six-stage-review");
    product.dependsOn = ["backend-migration"];
    if (reviewedProductIds.length) {
      product.reassessment = {
        reviews: [{ decision: "keep", deliveryImpact: "preserve", targets: [...reviewedProductIds] }],
      };
    }
    writeJson(mapFile, map);
  }
  if (technicalReleased) {
    writeJson(path.join(runDir, "work-plan.json"), {
      schemaVersion: 1,
      tasks: [
        {
          id: "task-technical-released",
          title: "后端能力收口",
          kind: "backend",
          scope: "technical",
          leafFeatureIds: ["backend-migration"],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    writeJson(path.join(runDir, "executions", "task-technical-released.json"), {
      schemaVersion: 2,
      runId,
      taskId: "task-technical-released",
      agent: "controller-fixture",
      status: "done",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  }
  writeJson(path.join(runDir, "run.json"), {
    schemaVersion: 1,
    id: runId,
    type: "delivery",
    title: "技术功能收口（fixture）",
    status: "in_progress",
    deliveryInput: {
      file: "delivery-input.json",
      source,
      intensity: "high",
      featureIds: ["six-stage-review", "wordbook-lifecycle"],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    notes: [],
  });
  writeJson(path.join(runDir, "delivery-input.json"), {
    schemaVersion: 1,
    runId,
    source,
    intensity: "high",
    taskDescription: "fixture",
    deliveryContract: { id: "generic-task", version: 1 },
    featureInputs: [
      { id: "six-stage-review", planningRevision: null },
      { id: "wordbook-lifecycle", planningRevision: null },
    ],
    featureIds: ["six-stage-review", "wordbook-lifecycle"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    prototypeRun: null,
    carriedRisks: [],
    stages: [],
    extraction: null,
  });
  if (!technicalReleased) writeJson(path.join(runDir, "work-plan.json"), { schemaVersion: 1, tasks: [] });
  return { cwd, runId, runDir, planningDir };
}

afterEach(() => {
  for (const cwd of temporaryDirectories) fs.rmSync(cwd, { recursive: true, force: true });
  temporaryDirectories.length = 0;
});

// In-memory unit check first: governance tasks never expose bound feature ids.
test("taskLeafFeatureIds returns empty for governance regardless of relatedFeatureIds", () => {
  const task = { id: "t1", scope: "governance", leafFeatureIds: [], relatedFeatureIds: ["six-stage-review", "wordbook-lifecycle"] };
  const run = { id: "r1", type: "delivery" };
  // Force the explicit leafFeatureIds branch to act as a work plan entry.
  const link = taskLeafLink(run, task);
  assert.equal(link.scope, "governance");
  assert.deepEqual(taskLeafFeatureIds(run, task), []);
  assert.deepEqual(taskRelatedFeatureIds(run, task), ["six-stage-review", "wordbook-lifecycle"]);
});

test("CLI: governance plan with --related-features is accepted", () => {
  const { cwd, runId } = fixture();
  const res = runCli(cwd, "work", "plan",
    "--run", runId,
    "--task", "task-governance-fixture",
    "--title", "收口基础工作",
    "--kind", "backend",
    "--scope", "governance",
    "--related-features", "six-stage-review,wordbook-lifecycle",
    "--writes", "src/server/modules",
  );
  assert.equal(res.status, 0, res.stderr);
  const plan = JSON.parse(fs.readFileSync(path.join(cwd, ".mf-dev-flow", "delivery-runs", runId, "work-plan.json"), "utf8"));
  const planned = plan.tasks.find((t) => t.id === "task-governance-fixture");
  assert.equal(planned.scope, "governance");
  assert.deepEqual(planned.relatedFeatureIds, ["six-stage-review", "wordbook-lifecycle"]);
  assert.deepEqual(planned.leafFeatureIds, []);
});

test("CLI: product plan rejects --related-features", () => {
  const { cwd, runId } = fixture();
  const res = runCli(cwd, "work", "plan",
    "--run", runId,
    "--task", "task-product-fixture",
    "--title", "产品任务",
    "--kind", "ui",
    "--scope", "product",
    "--leaf-features", "six-stage-review",
    "--related-features", "wordbook-lifecycle",
    "--writes", "src/ui",
  );
  assert.notEqual(res.status, 0, res.stderr);
  assert.match(res.stderr, /不得登记 --related-features/);
});

test("CLI: technical plan with --leaf-features is accepted", () => {
  const { cwd, runId } = fixture();
  const res = runCli(cwd, "work", "plan",
    "--run", runId,
    "--task", "task-technical-fixture",
    "--title", "技术叶子绑定",
    "--kind", "backend",
    "--scope", "technical",
    "--leaf-features", "backend-migration",
    "--writes", "src/server",
  );
  assert.equal(res.status, 0, res.stderr);
  const plan = JSON.parse(fs.readFileSync(path.join(cwd, ".mf-dev-flow", "delivery-runs", runId, "work-plan.json"), "utf8"));
  const planned = plan.tasks.find((t) => t.id === "task-technical-fixture");
  assert.equal(planned.scope, "technical");
  assert.deepEqual(planned.leafFeatureIds, ["backend-migration"]);
});

test("merge-check: manual run with unbound featureIds surfaces reminders, not problems", () => {
  const { cwd, runId } = fixture({ source: "manual" });
  const planRes = runCli(cwd, "work", "plan",
    "--run", runId,
    "--task", "task-orphan",
    "--title", "orphan governance",
    "--kind", "backend",
    "--scope", "governance",
    "--related-features", "six-stage-review",
    "--writes", "src/server",
  );
  assert.equal(planRes.status, 0, planRes.stderr);
  const claimRes = runCli(cwd, "work", "claim",
    "--run", runId,
    "--task", "task-orphan",
    "--agent", "controller-fixture",
  );
  assert.equal(claimRes.status, 0, claimRes.stderr);
  const finishRes = runCli(cwd, "work", "finish",
    "--run", runId,
    "--task", "task-orphan",
    "--agent", "controller-fixture",
    "--status", "done",
    "--summary", "done",
    "--files", "src/server/x.ts",
    "--tests", "vitest 1/1",
  );
  assert.equal(finishRes.status, 0, finishRes.stderr);
  const mergeRes = runCli(cwd, "work", "merge-check", "--run", runId);
  // merge-check returns 0 with reminders; problems path returns non-zero.
  assert.equal(mergeRes.status, 0, mergeRes.stderr);
  assert.match(mergeRes.stdout, /叶子功能缺少独立产品任务：wordbook-lifecycle/);
});

test("CLI: product plan rejects technical leaf", () => {
  const { cwd, runId } = fixture();
  const res = runCli(cwd, "work", "plan",
    "--run", runId,
    "--task", "task-product-tech-leaf",
    "--title", "product over technical",
    "--kind", "ui",
    "--scope", "product",
    "--leaf-features", "backend-migration",
    "--writes", "src/ui",
  );
  assert.notEqual(res.status, 0, res.stderr);
  assert.match(res.stderr, /产品任务不能绑定技术叶子/);
});

test("CLI: technical plan rejects product leaf", () => {
  const { cwd, runId } = fixture();
  const res = runCli(cwd, "work", "plan",
    "--run", runId,
    "--task", "task-tech-product-leaf",
    "--title", "technical over product",
    "--kind", "backend",
    "--scope", "technical",
    "--leaf-features", "six-stage-review",
    "--writes", "src/server",
  );
  assert.notEqual(res.status, 0, res.stderr);
  assert.match(res.stderr, /技术任务只能绑定 kind=technical/);
});

test("featureMapProblems: v4 proposal with technical leaf is accepted without sourceEntries", () => {
  const { cwd, runId } = fixture();
  // Force featureMap to schemaVersion 4 so kind-aware checks fire.
  const planningDir = path.join(cwd, ".mf-dev-flow", "planning");
  const map = JSON.parse(fs.readFileSync(path.join(planningDir, "feature-map.json"), "utf8"));
  map.schemaVersion = 4;
  map.features[2].sourceEntries = undefined;
  writeJson(path.join(planningDir, "feature-map.json"), map);
  const refineRes = runCli(cwd, "feature", "refine");
  assert.equal(refineRes.status, 0, refineRes.stderr);
  const refinementDirs = fs.readdirSync(path.join(cwd, ".mf-dev-flow", "refinement-runs"));
  assert.equal(refinementDirs.length, 1);
  const refineId = refinementDirs[0];
  const proposalFile = path.join(cwd, ".mf-dev-flow", "refinement-runs", refineId, "proposal.json");
  const proposal = JSON.parse(fs.readFileSync(proposalFile, "utf8"));
  proposal.schemaVersion = 4;
  proposal.impactReviews = [];
  writeJson(proposalFile, proposal);
  const patch = {
    schemaVersion: 1,
    features: [
      {
        id: "backend-migration",
        kind: "technical",
        title: "Web 后端能力收口",
        parentId: "old-a",
        rank: 5,
        description: "将既有能力迁移至目标后端",
        developmentRequirements: ["按接口契约迁移"],
        status: "not_started",
        dependsOn: [],
        systemCardRefs: ["content-service-test"],
      },
    ],
  };
  const patchFile = path.join(cwd, ".mf-dev-flow", "refinement-runs", refineId, "patch-tech.json");
  writeJson(patchFile, patch);
  const patchRes = runCli(cwd, "feature", "proposal-patch",
    "--run", refineId,
    "--from", patchFile,
  );
  assert.equal(patchRes.status, 0, patchRes.stderr);
});

test("merge-check: feature-map run still blocks on unbound featureIds", () => {
  const { cwd, runId } = fixture({ source: "feature-map" });
  const planRes = runCli(cwd, "work", "plan",
    "--run", runId,
    "--task", "task-orphan-fm",
    "--title", "orphan governance",
    "--kind", "backend",
    "--scope", "governance",
    "--related-features", "six-stage-review",
    "--writes", "src/server",
  );
  assert.equal(planRes.status, 0, planRes.stderr);
  const claimRes = runCli(cwd, "work", "claim",
    "--run", runId,
    "--task", "task-orphan-fm",
    "--agent", "controller-fixture",
  );
  assert.equal(claimRes.status, 0, claimRes.stderr);
  const finishRes = runCli(cwd, "work", "finish",
    "--run", runId,
    "--task", "task-orphan-fm",
    "--agent", "controller-fixture",
    "--status", "done",
    "--summary", "done",
    "--files", "src/server/x.ts",
    "--tests", "vitest 1/1",
    "--no-feature", "governance 后端收口，与产品功能松耦合",
  );
  assert.equal(finishRes.status, 0, finishRes.stderr);
  const mergeRes = runCli(cwd, "work", "merge-check", "--run", runId);
  assert.notEqual(mergeRes.status, 0, mergeRes.stdout + mergeRes.stderr);
  assert.match(mergeRes.stderr, /叶子功能缺少独立产品任务/);
});

// Phase 3: technical-release → product impact closure.
test("deliveryImpactClosure: released technical leaf marks dependent product leaves affected", () => {
  const { cwd } = fixture({ technicalReleased: true });
  const map = JSON.parse(fs.readFileSync(path.join(cwd, ".mf-dev-flow", "planning", "feature-map.json"), "utf8"));
  const closure = deliveryImpactClosure(map, path.join(cwd, ".mf-dev-flow"));
  assert.equal(closure.status, "review_required");
  assert.deepEqual(closure.releasedTechnicalIds, ["backend-migration"]);
  assert.deepEqual(closure.affected.map((item) => item.id), ["six-stage-review"]);
  assert.equal(closure.affected[0].via, "backend-migration");
});

test("deliveryImpactClosure: reviewed product leaf is cleared from affected", () => {
  const { cwd } = fixture({ technicalReleased: true, reviewedProductIds: ["six-stage-review"] });
  const map = JSON.parse(fs.readFileSync(path.join(cwd, ".mf-dev-flow", "planning", "feature-map.json"), "utf8"));
  const closure = deliveryImpactClosure(map, path.join(cwd, ".mf-dev-flow"));
  assert.equal(closure.status, "current");
  assert.deepEqual(closure.affected, []);
  assert.deepEqual(closure.releasedTechnicalIds, ["backend-migration"]);
});

test("CLI: feature impact --trigger delivery --json reports affected product leaves", () => {
  const { cwd } = fixture({ technicalReleased: true });
  const res = runCli(cwd, "feature", "impact", "--trigger", "delivery", "--json");
  assert.equal(res.status, 0, res.stderr);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.trigger, "delivery");
  assert.equal(payload.status, "review_required");
  assert.deepEqual(payload.releasedTechnicalIds, ["backend-migration"]);
  assert.deepEqual(payload.affected.map((item) => item.id), ["six-stage-review"]);
});

test("CLI: feature impact --trigger delivery is blocked from product-task claiming", () => {
  const { cwd, runId } = fixture({ technicalReleased: true });
  const res = runCli(cwd, "work", "plan",
    "--run", runId,
    "--task", "task-after-tech-release",
    "--title", "技术发布后的产品任务",
    "--kind", "ui",
    "--scope", "product",
    "--leaf-features", "six-stage-review",
    "--writes", "src/ui",
  );
  assert.notEqual(res.status, 0, res.stderr);
  assert.match(res.stderr, /技术发布复评门禁/);
  assert.match(res.stderr, /six-stage-review（via backend-migration）/);
});

test("CLI: feature impact --trigger rejects invalid trigger value", () => {
  const { cwd } = fixture();
  const res = runCli(cwd, "feature", "impact", "--trigger", "bogus");
  assert.notEqual(res.status, 0, res.stderr);
  assert.match(res.stderr, /--trigger 只能是 prototype 或 delivery/);
});

// Phase 3 收尾校验：携带 reassessment 决策块的叶子不能只留空壳。
test("featureMapProblems: empty reassessment reviews block is rejected", () => {
  const context = {
    evidenceCursor: "fixture",
    systems: { cards: [] },
    prototype: { sourceEntries: [{ id: "entry-1" }], coverage: [{ id: "entry-1", status: "covered" }], requirements: [], questions: [], features: [] },
  };
  const proposal = (feature) => ({
    schemaVersion: 4,
    evidenceCursor: "fixture",
    groups: [{ id: "g1", title: "g1", rank: 10 }],
    features: [
      {
        id: "leaf-1",
        kind: "product",
        title: "leaf-1",
        parentId: "g1",
        rank: 10,
        outcome: "o",
        description: "d",
        developmentRequirements: ["r"],
        sourceEntries: ["entry-1"],
        priority: "P0",
        status: "not_started",
        ...feature,
      },
    ],
    migrations: [{ from: ["old"], to: ["leaf-1"] }],
  });
  const empty = featureMapProblems(proposal({ reassessment: { status: "reviewed", reviews: [] } }), context);
  assert.ok(empty.some((item) => /reassessment 必须包含非空 reviews/.test(item)), empty.join("\n"));
  const malformed = featureMapProblems(
    proposal({ reassessment: { status: "reviewed", reviews: [{ decision: "keep", deliveryImpact: "bogus", reason: "" }] } }),
    context,
  );
  assert.ok(malformed.some((item) => /deliveryImpact: preserve\/revalidate/.test(item)), malformed.join("\n"));
  assert.ok(malformed.some((item) => /复评决策缺少 reason/.test(item)), malformed.join("\n"));
  const clean = featureMapProblems(proposal({}), context);
  assert.ok(!clean.some((item) => /reassessment/.test(item)), clean.join("\n"));
  // graph 侧 { triggers } 形制不含 reviews，不能被误判为空壳。
  const triggers = featureMapProblems(
    proposal({ reassessment: { triggers: [{ triggerRef: "prototype:g1", triggerKind: "prototype-group", status: "open" }] } }),
    context,
  );
  assert.ok(!triggers.some((item) => /reassessment/.test(item)), triggers.join("\n"));
});

test("featureMapProblems: real project map passes reassessment shape checks", () => {
  // 只读校验已落地的真源地图（不跑被测 CLI、不改真实项目），确保新收尾校验
  // 与历史 reassessment 数据兼容；隔离 fixture 仍是行为断言的主路径。
  const projectMap = path.resolve(import.meta.dirname, "../../../../.mf-dev-flow/planning/feature-map.json");
  if (!fs.existsSync(projectMap)) return;
  const map = JSON.parse(fs.readFileSync(projectMap, "utf8"));
  const withReviews = map.features.filter((feature) => feature.reassessment && "reviews" in feature.reassessment);
  for (const feature of withReviews) {
    const reviews = feature.reassessment.reviews;
    assert.ok(Array.isArray(reviews) && reviews.length, `${feature.id} 的 reviews 不能为空`);
    for (const review of reviews) {
      assert.ok(["preserve", "revalidate"].includes(review.deliveryImpact), `${feature.id} deliveryImpact 非法`);
      assert.ok(["keep", "revise", "split", "merge", "retire", "add"].includes(review.decision), `${feature.id} decision 非法`);
      assert.ok(String(review.reason ?? "").trim(), `${feature.id} 缺少 reason`);
    }
  }
});

test("deliveryImpactRecords: product-scope done records never release technical leaves", () => {
  const map = {
    features: [
      { id: "tech-1", kind: "technical" },
      { id: "prod-1", kind: "product", dependsOn: ["tech-1"] },
    ],
  };
  const closure = deliveryImpactRecords(map, [
    { featureId: "tech-1", taskScope: "product", taskStatus: "done" },
    { featureId: "prod-1", taskScope: "product", taskStatus: "done" },
  ]);
  assert.equal(closure.status, "current");
  assert.deepEqual(closure.releasedTechnicalIds, []);
});

// Phase 3b：原型未变，但技术叶子已发布时，仍有复评义务，proposal 缺处置即阻断 apply。
test("impactReviewProblems: unrehearsed technical release forces review targets even without prototype change", () => {
  const previousMap = {
    prototypeBaseline: { fingerprint: "fp-1", schemaVersion: 1, global: false, sourceFiles: [], files: [], groups: [], entries: [], requirements: [], questions: [] },
    groups: [{ id: "g1", title: "g1", rank: 10 }],
    features: [
      { id: "tech-1", kind: "technical", parentId: "g1", rank: 5, title: "tech-1", status: "done" },
      { id: "prod-1", kind: "product", parentId: "g1", rank: 10, title: "prod-1", status: "not_started", dependsOn: ["tech-1"], sourceEntries: ["entry-1"] },
    ],
    migrations: [{ type: "unchanged", from: ["prod-1"], to: ["prod-1"], reason: "保持" }],
  };
  const revision = { fingerprint: "fp-1", sourceProblems: [], sourceFiles: [], files: [], groups: [], entries: [], requirements: [], questions: [] };
  const records = [{ featureId: "tech-1", taskScope: "technical", taskStatus: "done", runId: "r1", taskId: "t1" }];
  assert.equal(deliveryImpactRecords(previousMap, records).status, "review_required");
  const proposal = { ...structuredClone(previousMap), impactReviews: [] };
  const problems = impactReviewProblems({
    previousMap,
    revision,
    proposal,
    currentMap: previousMap,
    records,
  });
  assert.ok(
    problems.some((item) => /功能 prod-1 必须且只能有一条 impactReviews 复评结论/.test(item)),
    problems.join("\n"),
  );
});
