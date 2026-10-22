import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  apiMockScreenshotProblems,
  mockResponseFieldDefinitions,
} from "../modules/runtime/delivery.mjs";

const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
};

test("接口 Mock 验收要求完整 URL、完整 JSON 与可追溯字段定义", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-api-mock-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = { id: "fixture", dir: path.join(root, "delivery-runs", "fixture") };
  const task = { id: "trial-claim" };
  const directory = path.join(run.dir, "screenshots", "api-mock");
  const response = { code: 0, data: { entitlement: { status: "claimed", quota: 5 } } };
  write(path.join(directory, "response.png"), "fixture image");
  write(path.join(directory, "response.json"), response);
  write(path.join(run.dir, "api-mock-screenshots.json"), {
    schemaVersion: 1,
    evidence: [{
      taskId: task.id,
      screenshot: "screenshots/api-mock/response.png",
      method: "GET",
      url: "http://127.0.0.1:3000/api/v1/mock/trial",
      endpoint: "/api/v1/mock/trial",
      httpStatus: 200,
      action: "请求 Mock 接口。",
      responseFile: "screenshots/api-mock/response.json",
      response,
      fieldDefinitions: mockResponseFieldDefinitions(response),
    }],
  });

  assert.deepEqual(apiMockScreenshotProblems(run, task), []);

  write(path.join(run.dir, "api-mock-screenshots.json"), {
    schemaVersion: 1,
    evidence: [{
      taskId: task.id,
      screenshot: "screenshots/api-mock/response.png",
      method: "GET",
      endpoint: "/api/v1/mock/trial",
      httpStatus: 200,
      action: "请求 Mock 接口。",
    }],
  });
  assert.deepEqual(apiMockScreenshotProblems(run, task), [
    "接口 Mock 任务 trial-claim 的截图证据缺少完整 HTTP(S) Mock URL。",
    "接口 Mock 任务 trial-claim 缺少完整 JSON 响应或字段定义。",
  ]);
});
