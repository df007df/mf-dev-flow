import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  featureStageEvidence,
  featureStageMockContracts,
  featureStageVisualPairs,
  featureStageVisualReviews,
  featureStages,
} from "../server/readers/runs.js";

test("功能阶段保留被后续 UI 复验标为不适用的已确认 Mock 截图", (t) => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-stage-history-"));
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  const runId = "delivery-mock";
  const taskId = "trial-claim";
  const screenshots = path.join(store, "delivery-runs", runId, "screenshots", "api-mock");
  fs.mkdirSync(screenshots, { recursive: true });
  fs.writeFileSync(path.join(screenshots, "response.png"), "fixture image");
  fs.writeFileSync(
    path.join(store, "delivery-runs", runId, "api-mock-screenshots.json"),
    JSON.stringify({
      schemaVersion: 1,
      evidence: [{
        taskId,
        screenshot: "screenshots/api-mock/response.png",
        method: "GET",
        endpoint: "/api/v1/mock/trial",
        httpStatus: 200,
        action: "请求 fixture Mock 接口。",
      }],
    }),
  );
  const stages = featureStages(
    { status: "blocked", stages: { api_mock: { status: "not_applicable", summary: "本轮只复验 UI。" } } },
    [{
      at: "2026-09-06T07:20:03.033Z",
      runId,
      taskId,
      stage: {
        id: "api_mock",
        status: "confirmed",
        summary: "已登记 GET /api/v1/mock/trial 的实际 200 响应截图。",
      },
    }],
  );

  assert.equal(stages.api_mock.status, "confirmed");
  assert.equal(stages.api_mock.evidenceSource.runId, runId);
  assert.match(stages.api_mock.summary, /实际 200 响应截图/);
  assert.deepEqual(featureStageEvidence(store, "api_mock", stages.api_mock), [{
    path: `delivery-runs/${runId}/screenshots/api-mock/response.png`,
    label: "GET /api/v1/mock/trial · 200",
    action: "请求 fixture Mock 接口。",
  }]);
  assert.deepEqual(featureStageMockContracts(store, "api_mock", stages.api_mock), [{
    method: "GET",
    url: null,
    endpoint: "/api/v1/mock/trial",
    httpStatus: 200,
    responseFile: null,
    fieldDefinitions: [],
    response: null,
  }]);

  const prototype = path.join(store, "prototype", "analyses", "prototype-run", "screenshots");
  const ui = path.join(store, "delivery-runs", runId, "screenshots", "wechatide");
  fs.mkdirSync(prototype, { recursive: true });
  fs.mkdirSync(ui, { recursive: true });
  fs.writeFileSync(path.join(prototype, "home.png"), "fixture image");
  fs.writeFileSync(path.join(ui, "home.png"), "fixture image");
  fs.writeFileSync(
    path.join(store, "delivery-runs", runId, "validation-screenshot-pairs.json"),
    JSON.stringify({
      schemaVersion: 1,
      pairs: [{
        id: "home-pair",
        taskId,
        state: "new-user-home",
        action: "打开新用户首页。",
        screenshots: [
          { role: "reference", path: "prototype/analyses/prototype-run/screenshots/home.png" },
          { role: "result", path: `delivery-runs/${runId}/screenshots/wechatide/home.png` },
        ],
      }],
    }),
  );
  fs.writeFileSync(
    path.join(store, "delivery-runs", runId, "visual-region-reviews.json"),
    JSON.stringify({
      schemaVersion: 1,
      reviews: [{
        pairId: "home-pair",
        taskId,
        status: "failed",
        reviewedAt: "2026-09-06T07:20:03.033Z",
        regions: [{
          id: "hero",
          checks: [{ kind: "layout", status: "failed", detail: "标题间距不同。" }],
        }],
      }],
    }),
  );
  const visualStage = { evidenceSource: { runId, taskId } };
  assert.deepEqual(featureStageVisualPairs(store, "prototype_alignment", visualStage), [{
    id: "home-pair",
    state: "new-user-home",
    action: "打开新用户首页。",
    screenshots: [
      { path: "prototype/analyses/prototype-run/screenshots/home.png", label: "原型图", action: "打开新用户首页。" },
      { path: `delivery-runs/${runId}/screenshots/wechatide/home.png`, label: "UI 图", action: "打开新用户首页。" },
    ],
  }]);
  assert.deepEqual(featureStageVisualReviews(store, "prototype_alignment", visualStage), [{
    pairId: "home-pair",
    status: "failed",
    reviewedAt: "2026-09-06T07:20:03.033Z",
    differences: [{
      regionId: "hero",
      kind: "layout",
      status: "failed",
      detail: "标题间距不同。",
    }],
  }]);
});
