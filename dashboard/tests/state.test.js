import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DASHBOARD_HOST,
  DASHBOARD_PORT,
  isPortListening,
  startDashboard,
} from "../server/start-dashboard.js";
import {
  prototypeQuestionProblems,
  prototypeQuestions,
} from "../server/state.js";

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function questionFixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "mf-dev-flow-dashboard-question-"),
  );
  const sourceRun = "prototype-question-fixture";
  const screenshot = path.join(
    directory,
    ".mf-dev-flow",
    "prototype-runs",
    sourceRun,
    "screenshots",
    "flow",
    "question.jpg",
  );
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  fs.writeFileSync(screenshot, "fixture");
  writeJson(path.join(directory, ".mf-dev-flow", "prototype", "task.json"), {
    source: { prototypeRun: sourceRun },
  });
  writeJson(path.join(directory, ".mf-dev-flow", "prototype", "coverage.json"), {
    coverage: [{ id: "question-entry" }],
  });
  writeJson(
    path.join(directory, ".mf-dev-flow", "prototype", "open-questions.json"),
    {
      schemaVersion: 1,
      sourceRun,
      questions: [
        {
          id: "fixture.question",
          status: "open",
          featureId: "fixture-feature",
          featureTitle: "夹具功能块",
          title: "夹具问题",
          question: "需要确认夹具行为。",
          impact: "影响夹具验收。",
          defaultDecision: "保持夹具默认值。",
          owner: "产品负责人",
          location: {
            document: "prototype/原型图流程.md",
            heading: "夹具功能块 > 待确认问题",
          },
          evidence: [
            {
              entryId: "question-entry",
              path: `prototype-runs/${sourceRun}/screenshots/flow/question.jpg`,
              action: "打开夹具截图",
            },
          ],
          answers: [],
        },
      ],
    },
  );
  return { directory, store: path.join(directory, ".mf-dev-flow") };
}


test("看板使用固定默认端口", () => {
  assert.equal(DASHBOARD_HOST, "127.0.0.1");
  assert.equal(DASHBOARD_PORT, 4173);
});

test("待确认问题必须关联当前原型运行中存在的截图与覆盖入口", () => {
  const item = questionFixture();
  try {
    assert.deepEqual(prototypeQuestionProblems(item.store), []);
    const index = prototypeQuestions(item.store);
    assert.match(index.questions[0].agentPrompt, /夹具功能块 > 待确认问题/);
    assert.match(index.questions[0].agentPrompt, /question.jpg/);

    const file = path.join(item.store, "prototype", "open-questions.json");
    const invalid = JSON.parse(fs.readFileSync(file, "utf8"));
    invalid.questions[0].evidence[0].path =
      "prototype-runs/prototype-question-fixture/screenshots/flow/missing.jpg";
    writeJson(file, invalid);
    assert.match(
      prototypeQuestionProblems(item.store).join("\n"),
      /截图不存在/,
    );
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("每项待确认问题的定位提示词只保留定位与用户回答入口", () => {
  const item = questionFixture();
  try {
    const question = prototypeQuestions(item.store).questions[0];
    assert.match(
      question.agentPrompt,
      /使用 mf-dev-flow 处理原型待确认问题：fixture.question/,
    );
    assert.match(question.agentPrompt, /Agent 回答：<请在此填写>/);
    assert.match(question.agentPrompt, /question.jpg/);
    assert.ok(question.agentPrompt.length < 280);
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("顶部待确认问题只显示 open，已解决问题保留在长期索引中", () => {
  const item = questionFixture();
  try {
    const file = path.join(item.store, "prototype", "open-questions.json");
    const index = JSON.parse(fs.readFileSync(file, "utf8"));
    index.questions.push({
      ...index.questions[0],
      id: "fixture.resolved-question",
      status: "resolved",
      answers: [{ answer: "已确认", conclusion: "保留历史结论。" }],
      resolvedAt: "2026-09-04T15:10:00.000Z",
    });
    writeJson(file, index);

    const visible = prototypeQuestions(item.store).questions;
    assert.equal(visible.length, 1);
    assert.equal(visible[0].id, "fixture.question");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).questions.length, 2);
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("端口已监听时直接复用，不再创建第二个看板服务", async () => {
  const occupied = http.createServer();
  occupied.listen(0, DASHBOARD_HOST);
  await once(occupied, "listening");
  const port = occupied.address().port;

  try {
    assert.equal(await isPortListening(port), true);
    const dashboard = await startDashboard({
      cwd: process.cwd(),
      args: [],
      port,
    });
    assert.deepEqual(dashboard, {
      status: "already_running",
      url: `http://${DASHBOARD_HOST}:${port}`,
    });
  } finally {
    occupied.close();
    await once(occupied, "close");
  }
});

test("未监听的端口可被识别", async () => {
  const probe = http.createServer();
  probe.listen(0, DASHBOARD_HOST);
  await once(probe, "listening");
  const port = probe.address().port;
  probe.close();
  await once(probe, "close");

  assert.equal(await isPortListening(port), false);
});
