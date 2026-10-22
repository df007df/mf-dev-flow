import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prototypeGroupDocument, prototypeGroupSummaries, PROTOTYPE_SUPPLEMENT_SECTION } from "../server/prototype-groups.js";

test("CLI 新建分组带 ID，旧报告汇总自动补 ID 但不改写来源运行", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-group-cli-"));
  const script = fileURLToPath(new URL("../../scripts/mf-dev-flow.mjs", import.meta.url));
  const invoke = (...args) => {
    const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    const store = path.join(cwd, ".mf-dev-flow");
    const run = path.join(store, "prototype-runs", "proto");
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(store, "project.json"), JSON.stringify({ schemaVersion: 1, project: { name: "test" }, prototype: { version: "test" }, codeRoots: [] }));
    fs.writeFileSync(path.join(run, "run.json"), JSON.stringify({ id: "proto", type: "prototype", scope: "partial", status: "pending" }));
    fs.writeFileSync(path.join(run, "coverage.json"), JSON.stringify({ sourceInventory: { entries: [{ id: "entry", feature: "group" }] }, coverage: [] }));
    invoke("feature", "new", "--run", "proto", "--id", "group", "--title", "测试分组", "--priority", "P0");
    const report = path.join(run, "features", "group.md");
    const fresh = fs.readFileSync(report, "utf8");
    assert.ok(fresh.includes("- 分组 ID：`group`"));
    assert.ok(fresh.includes(PROTOTYPE_SUPPLEMENT_SECTION));
    assert.doesNotMatch(fresh, /实现状态|未完成原因/);
    const legacy = fresh.replace("- 分组 ID：`group`\n\n", "").replace(`${PROTOTYPE_SUPPLEMENT_SECTION}\n\n`, "");
    fs.writeFileSync(report, legacy);
    invoke("prototype", "init", "--from-run", "proto");
    const canonical = fs.readFileSync(path.join(store, "prototype", "原型图流程.md"), "utf8");
    assert.ok(canonical.includes("- 分组 ID：`group`"));
    assert.ok(canonical.includes(PROTOTYPE_SUPPLEMENT_SECTION));
    assert.equal(fs.readFileSync(report, "utf8"), legacy);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("信息补充是固定信息入口，保留已有回答及补充内容且重复合并不追加", () => {
  const source = "# 原型标题\n\n- 分组 ID：`group`\n\n## 待确认问题（已解决，保留记录）\n\n- 原问题：是否跳转？\n- Agent 回答：只解锁，不跳转。\n\n## 更新记录\n\n- 已有记录。\n";
  const result = prototypeGroupDocument(source, "group");
  assert.ok(result.includes("- 原问题：是否跳转？\n- Agent 回答：只解锁，不跳转。"));
  assert.ok(result.endsWith("## 更新记录\n\n- 已有记录。\n"));
  assert.ok(result.indexOf("### 信息补充") > result.indexOf("## 待确认问题"));
  assert.ok(result.indexOf("### 信息补充") < result.indexOf("## 更新记录"));
  const withUserContent = result.replace(PROTOTYPE_SUPPLEMENT_SECTION, `${PROTOTYPE_SUPPLEMENT_SECTION}\n\n- 用户提供：每次解锁显示提示。`);
  assert.equal(prototypeGroupDocument(withUserContent, "group"), withUserContent);
});

test("分组报告补入稳定 ID，重复汇总幂等，拒绝不一致 ID", () => {
  const source = "# 原型标题\n\n## 交互\n原始证据与说明\n";
  const document = prototypeGroupDocument(source, "reading-library");
  assert.ok(document.includes("- 分组 ID：`reading-library`"));
  assert.ok(document.endsWith("## 交互\n原始证据与说明\n"));
  assert.equal(prototypeGroupDocument(document, "reading-library"), document);
  assert.throws(() => prototypeGroupDocument(document, "different"), /ID.*不一致/);
});

test("分组截图按 observed 真实图片去重，排除缺失、目录、越界和推断证据", () => {
  const sourceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-group-shots-"));
  try {
    const archive = path.join(sourceDirectory, "screenshots");
    fs.mkdirSync(archive);
    fs.writeFileSync(path.join(archive, "page.png"), "fixture");
    fs.writeFileSync(path.join(archive, "modal.jpg"), "fixture");
    fs.writeFileSync(path.join(archive, "inferred.png"), "fixture");
    fs.writeFileSync(path.join(sourceDirectory, "outside.png"), "fixture");
    fs.mkdirSync(path.join(archive, "folder.png"));
    fs.symlinkSync(path.join(sourceDirectory, "outside.png"), path.join(archive, "escape.png"));
    fs.symlinkSync(path.join(archive, "page.png"), path.join(archive, "alias.png"));
    const result = prototypeGroupSummaries({
      sourceDirectory,
      features: [{ id: "a", title: "A", sourceEntries: ["one", "two"] }, { id: "b", sourceEntries: [] }],
      questionIndex: { questions: [] },
      coverage: { coverage: [
        { id: "one", evidence: ["page.png", "alias.png", "missing.png", "escape.png", "folder.png"].map((file) => ({ level: "observed", path: `screenshots/${file}` })) },
        { id: "two", evidence: [
          { level: "observed", path: "screenshots/page.png" },
          { level: "observed", path: "screenshots/modal.jpg" },
          { level: "inferred", path: "screenshots/inferred.png" },
        ] },
        { id: "unrelated", evidence: [{ level: "observed", path: "screenshots/inferred.png" }] },
      ] },
    });
    assert.equal(result.groups[0].screenshotCount, 2);
    assert.equal(result.groups[0].unavailableScreenshotCount, 3);
    assert.equal(result.groups[1].screenshotCount, 0);
    assert.deepEqual(result.problems, []);
  } finally {
    fs.rmSync(sourceDirectory, { recursive: true, force: true });
  }
});

test("问题按所属分组计数，区分开放、全部解决、无问题与无法核验", () => {
  const input = {
    features: ["mixed", "resolved", "none"].map((id) => ({ id, sourceEntries: [] })),
    questionIndex: { questions: [
      { id: "q1", featureId: "mixed", status: "open" },
      { id: "q2", featureId: "mixed", status: "resolved", answers: [{ text: "一次回答" }, { text: "再次确认" }] },
      { id: "q3", featureId: "resolved", status: "resolved", answer: "兼容旧字段", evidence: [{ entryId: "mixed" }] },
    ] },
  };
  const { groups } = prototypeGroupSummaries(input);
  assert.deepEqual(groups.map((group) => group.questions), [
    { total: 2, open: 1, resolved: 1, answers: 2, status: "open" },
    { total: 1, open: 0, resolved: 1, answers: 1, status: "resolved" },
    { total: 0, open: 0, resolved: 0, answers: 0, status: "none" },
  ]);
  for (const patch of [
    { questionIndex: null },
    { questionProblems: ["证据已失效"] },
    { questionIndex: { questions: [{ id: "q4", featureId: "missing", status: "open" }] } },
    { questionIndex: { questions: [{ id: "q5", featureId: "mixed", status: "other" }] } },
  ]) {
    const invalid = prototypeGroupSummaries({ ...input, ...patch });
    assert.ok(invalid.problems.length);
    assert.ok(invalid.groups.every((group) => group.questions.status === "unverified"));
  }
});
