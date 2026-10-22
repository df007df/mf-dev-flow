import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prdSummary } from "../server/readers/prd.js";

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const SNAPSHOT = "家长每天最多设置 8 个新词。\n兑换码一经使用不可退。\n";

function prdFixture({ quote = "最多设置 8 个新词", documents = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-dashboard-prd-"));
  const store = path.join(directory, ".mf-dev-flow");
  const prd = path.join(store, "prd");
  writeJson(path.join(prd, "manifest.json"), {
    schemaVersion: 1,
    sources: [
      {
        id: "doc-a",
        title: "07_记单词系统",
        origin: { kind: "dingtalk", url: "https://alidocs.dingtalk.com/i/nodes/doc-a" },
        format: "text",
        ingestedAt: "2026-09-08T03:01:36.056Z",
      },
    ],
  });
  fs.mkdirSync(path.join(prd, "sources"), { recursive: true });
  fs.writeFileSync(path.join(prd, "sources", "doc-a.md"), SNAPSHOT);
  const batch = path.join(prd, "analyses", "b1");
  writeJson(path.join(batch, "findings.json"), {
    schemaVersion: 1,
    batchId: "b1",
    title: "夹具 PRD 批次",
    summary: { background: "背景理解。", direction: "方向理解。" },
    sources: ["doc-a"],
    items: [
      {
        id: "C-01",
        kind: "contradiction",
        title: "新词上限口径冲突",
        statement: "两处规则互相矛盾。",
        severity: "high",
        evidence: [{ source: "doc-a", locator: "§6", quote }],
        question: "上限以哪处为准？",
      },
      {
        id: "L-01",
        kind: "redline",
        title: "码一经使用不可退",
        statement: "红线：不退费。",
        severity: "high",
        evidence: [{ source: "doc-a", locator: "§3", quote: "兑换码一经使用不可退。" }],
      },
    ],
  });
  if (documents) {
    fs.writeFileSync(path.join(batch, "contradictions.md"), "# 矛盾清单\n\n- C-01 新词上限口径冲突\n");
    fs.writeFileSync(path.join(batch, "redlines.md"), "# 红线索引\n\n- L-01 码一经使用不可退\n");
  }
  return { directory, store };
}

test("未冻结 PRD 来源时看板返回空", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-dashboard-prd-none-"));
  try {
    assert.equal(prdSummary(path.join(directory, ".mf-dev-flow")), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("PRD 批次展示统计、核验状态与两份会议文档", () => {
  const item = prdFixture();
  try {
    const prd = prdSummary(item.store);
    assert.equal(prd.sourceCount, 1);
    assert.equal(prd.sources[0].ref, "mf-dev-flow:prd-source:doc-a");
    assert.equal(prd.batches[0].ref, "mf-dev-flow:prd-batch:b1");
    assert.equal(prd.batch.id, "b1");
    assert.equal(prd.batch.ref, "mf-dev-flow:prd-batch:b1");
    assert.equal(prd.batch.check.ok, true);
    assert.equal(prd.batch.check.checkedQuotes, 2);
    assert.deepEqual(prd.batch.items, {
      contradiction: 1,
      ambiguity: 0,
      principle: 0,
      redline: 1,
    });
    assert.equal(prd.batch.documents.contradictions.exists, true);
    assert.match(prd.batch.documents.contradictions.content, /C-01/);
    assert.equal(prd.batch.documents.contradictions.tally.items, 1);
    assert.equal(prd.batch.documents.contradictions.tally.high, 1);
    assert.equal(prd.batch.documents.redlines.exists, true);
    assert.equal(prd.batch.documents.redlines.tally.items, 1);
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("转述引文核验失败并精确到条目路径", () => {
  const item = prdFixture({ quote: "最多可以设置成八个新词" });
  try {
    const prd = prdSummary(item.store);
    assert.equal(prd.batch.check.ok, false);
    assert.match(
      prd.batch.check.problems.map((p) => `${p.path}:${p.message}`).join("\n"),
      /items\[C-01\]\.evidence\[0\]\.quote.*逐字/,
    );
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("快照缺失记为该来源问题而不是崩溃", () => {
  const item = prdFixture();
  fs.rmSync(path.join(item.store, "prd", "sources", "doc-a.md"));
  try {
    const prd = prdSummary(item.store);
    assert.equal(prd.batch.check.ok, false);
    assert.match(
      prd.batch.check.problems.map((p) => `${p.path}:${p.message}`).join("\n"),
      /sources\[doc-a\].*快照缺失/,
    );
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("会议文档未生成时卡片标记 exists=false", () => {
  const item = prdFixture({ documents: false });
  try {
    const prd = prdSummary(item.store);
    assert.equal(prd.batch.check.ok, true);
    assert.equal(prd.batch.documents.contradictions.exists, false);
    assert.equal(prd.batch.documents.redlines.exists, false);
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});

test("manifest 形状不符时返回可读错误", () => {
  const item = prdFixture();
  fs.writeFileSync(path.join(item.store, "prd", "manifest.json"), `{"schemaVersion": 2}\n`);
  try {
    const prd = prdSummary(item.store);
    assert.equal(prd.batch, null);
    assert.match(prd.error, /形状不符/);
  } finally {
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
});
