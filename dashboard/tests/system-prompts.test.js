import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { systemDocumentPrompt } from "../server/system-prompts.js";
import { systemSummary } from "../server/readers/sources.js";

test("统一模板保留原问题、技术问题 ID 和证据定位，不把已解决项作为待回答项", () => {
  const card = {
    id: "catalog", title: "目录系统", lastVerifiedAt: "2026-09-05T00:00:00Z",
    openQuestions: ["首批允许哪些字段？", "何时提供只读账号？"],
    technicalIssues: [
      { id: "missing-account", title: "只读账号缺失", status: "open", summary: "同步暂不可用" },
      { id: "sparse-fields", title: "字段覆盖不足", status: "monitoring", summary: "下游保持可空" },
      { id: "fixed-mapping", title: "映射已修正", status: "resolved" },
    ],
    changeLog: [{ runId: "old" }, { runId: "current" }, { action: "issue_updated" }],
  };
  const before = structuredClone(card);
  const prompt = systemDocumentPrompt(card);
  assert.equal(prompt.cardId, card.id);
  for (const value of [card.title, ...card.openQuestions, card.lastVerifiedAt,
    ".mf-dev-flow/system/cards/catalog.md", "来源运行：current",
    "technicalIssues[id=missing-account].evidence", "technicalIssues[id=sparse-fields].evidence",
    "同步暂不可用", "下游保持可空"])
    assert.ok(prompt.answer.includes(value), value);
  assert.ok(!prompt.answer.includes("fixed-mapping"));
  assert.equal(prompt.answer.match(/Agent 回答：/g)?.length, 4);
  assert.deepEqual(card, before);
  const reordered = systemDocumentPrompt({ ...card, openQuestions: [...card.openQuestions].reverse() });
  for (const question of card.openQuestions) assert.ok(reordered.answer.includes(`原问题：${question}`));
});

test("系统读取派生统一模板：待确认项为空仍可回答技术问题，读取不改写文件", () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-system-prompts-"));
  try {
    const card = { id: "legacy", title: "存量系统", technicalIssues: [
      { id: "missing-contract", title: "契约缺失", status: "open", summary: "需要确认" },
    ] };
    fs.mkdirSync(path.join(store, "system", "cards"), { recursive: true });
    const file = path.join(store, "system", "cards.json");
    const markdownFile = path.join(store, "system", "cards", "legacy.md");
    const json = JSON.stringify({ cards: [card] });
    const markdown = "# 存量系统\n\n> 系统卡片 ID：`legacy`\n\n## 待确认问题\n\n- 无。\n";
    fs.writeFileSync(file, json);
    fs.writeFileSync(markdownFile, markdown);
    const summary = systemSummary(store);
    assert.equal(summary.cards[0].ref, "mf-dev-flow:system-card:legacy");
    assert.deepEqual(summary.cards[0].questionPrompt, systemDocumentPrompt(card));
    assert.ok(summary.cards[0].questionPrompt.answer.includes("missing-contract"));
    assert.equal(summary.cards[0].questionPrompt.answer.match(/Agent 回答：/g)?.length, 1);
    assert.equal(summary.cards[0].content, markdown);
    assert.equal(fs.readFileSync(file, "utf8"), json);
    assert.equal(fs.readFileSync(markdownFile, "utf8"), markdown);
    const empty = systemDocumentPrompt({ id: "empty", title: "空卡片" });
    assert.ok(!empty.answer.includes("undefined"));
    assert.ok(!empty.answer.includes("Agent 回答："));
  } finally {
    fs.rmSync(store, { recursive: true, force: true });
  }
});
