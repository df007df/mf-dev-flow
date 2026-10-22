// 隔离 fixture 回归：只读写临时目录与技能文件，绝不触碰真实 .mf-dev-flow。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { routeFlow } from "../../workflow/route.mjs";

const skill = fileURLToPath(new URL("../../../", import.meta.url));
const CLI = path.join(skill, "scripts/mf-dev-flow.mjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-prd-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
};
function cli(root, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch { /* caller asserts */ }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}
const storeOf = (root) => path.join(root, ".mf-dev-flow/prd");
const snapshotOf = (root, id) => fs.readFileSync(path.join(storeOf(root), "sources", `${id}.md`), "utf8");

// --- 最小 zip（stored）用于构造 .docx fixture ---
let crcTable;
const crc32 = (buf) => {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries.map((e) => ({ name: e.name, data: Buffer.from(e.data, "utf8") }))) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const body = Buffer.concat(locals);
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, central, end]);
}

const DOCUMENT_XML = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>单词本</w:t></w:r></w:p><w:p><w:r><w:t>家长可以设置&#26085;&#27966;目标 &amp; 新词上限。</w:t></w:r><w:r><w:t>共 3 档。</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>列一</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>列二</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/><w:sectPr/></w:body></w:document>`;

test("prd flow is routable without touching product stores", (t) => {
  const root = fixture(t);
  const route = routeFlow({ root, flow: "prd" });
  assert.equal(route.flow, "prd");
  assert.ok(fs.existsSync(path.join(skill, route.entry)));
  assert.equal(route.goal.mode, "analyze");
  assert.deepEqual(route.goal.allowedWrites, ["prd/"]);
  assert.equal(route.nextCommand, "prd status --json");
  const intent = routeFlow({ root, intent: "prd status" });
  assert.equal(intent.flow, "prd");
  assert.equal(intent.goal.mode, "inspect");
  assert.deepEqual(intent.goal.allowedWrites, []);
  assert.equal(fs.existsSync(path.join(root, ".mf-dev-flow")), false);
});

test("ingest freezes text sources, is idempotent and detects original drift", (t) => {
  const root = fixture(t);
  const original = path.join(root, "docs/prd.md");
  write(original, "# 示例学习应用\n家长每天最多收到一条学习提醒。\n");
  const before = fs.readFileSync(original);
  const first = cli(root, ["prd", "ingest", "--file", "docs/prd.md"]);
  assert.equal(first.status, 0, first.stderr);
  const id = first.json.sources[0].id;
  assert.match(id, /^prd-[0-9a-f]{12}$/);
  assert.deepEqual(snapshotOf(root, id), "# 示例学习应用\n家长每天最多收到一条学习提醒。\n");
  assert.deepEqual(fs.readFileSync(original), before, "原件必须逐字节不变");
  const again = cli(root, ["prd", "ingest", "--file", "docs/prd.md"]);
  assert.equal(again.json.sources[0].reused, true);
  assert.equal(again.json.sources[0].id, id);
  let status = cli(root, ["prd", "status"]);
  assert.equal(status.json.sources.length, 1);
  assert.equal(status.json.sources[0].drift.state, "clean");
  fs.appendFileSync(original, "\n补充：最多两条。\n");
  status = cli(root, ["prd", "status"]);
  assert.equal(status.json.sources[0].drift.state, "modified");
  fs.rmSync(original);
  status = cli(root, ["prd", "status"]);
  assert.equal(status.json.sources[0].drift.state, "missing");
});

test("ingest --dir collects supported files and unsupported extensions fail closed", (t) => {
  const root = fixture(t);
  write(path.join(root, "prd/a.md"), "A 正文\n");
  write(path.join(root, "prd/nested/b.txt"), "B 正文\n");
  write(path.join(root, "prd/.hidden/c.md"), "忽略\n");
  write(path.join(root, "prd/~$temp.docx"), "忽略\n");
  write(path.join(root, "prd/p.pdf"), "忽略\n");
  const dir = cli(root, ["prd", "ingest", "--dir", "prd"]);
  assert.equal(dir.status, 0, dir.stderr);
  assert.deepEqual(dir.json.sources.map((s) => s.title).sort(), ["a", "b"]);
  const pdf = cli(root, ["prd", "ingest", "--file", "prd/p.pdf"]);
  assert.notEqual(pdf.status, 0);
  assert.match(pdf.stderr, /暂不支持/);
});

test("docx ingest extracts headings entities and table rows", (t) => {
  const root = fixture(t);
  const docx = path.join(root, "spec.docx");
  fs.writeFileSync(docx, storedZip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "word/document.xml", data: DOCUMENT_XML },
  ]));
  const result = cli(root, ["prd", "ingest", "--file", "spec.docx"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.sources[0].format, "docx");
  const text = snapshotOf(root, result.json.sources[0].id);
  assert.match(text, /^# 单词本\n/);
  assert.ok(text.includes("家长可以设置日派目标 & 新词上限。共 3 档。"), text);
  assert.ok(text.includes("列一 | 列二"), text);
  const fake = path.join(root, "broken.docx");
  fs.writeFileSync(fake, "not a zip");
  const bad = cli(root, ["prd", "ingest", "--file", "broken.docx"]);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /word\/document\.xml/);
});

test("snapshot ingest registers online docs and rejects bad urls", (t) => {
  const root = fixture(t);
  write(path.join(root, "frozen.md"), "# 示例学习应用 PRD\n必须免费试用 3 章。\n");
  const ok = cli(root, ["prd", "ingest", "--snapshot", "frozen.md", "--url", "https://alidocs.dingtalk.com/i/nodes/X1", "--title", "示例学习应用PRD"]);
  assert.equal(ok.status, 0, ok.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(storeOf(root), "manifest.json"), "utf8"));
  assert.equal(manifest.sources[0].origin.kind, "dingtalk");
  assert.equal(manifest.sources[0].title, "示例学习应用PRD");
  const status = cli(root, ["prd", "status"]);
  assert.equal(status.json.sources[0].drift.state, "unverifiable");
  const bad = cli(root, ["prd", "ingest", "--snapshot", "frozen.md", "--url", "ftp://x/y"]);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /http\(s\)/);
});

const makeFindings = (id, overrides = {}) => ({
  schemaVersion: 1,
  batchId: id,
  title: "示例学习应用 PRD 取证",
  summary: { background: "K12 英语小程序", direction: "先跑通阅读闭环" },
  ...overrides,
});
const item = (over = {}) => ({
  id: "C-01",
  kind: "contradiction",
  title: "提醒频次口径冲突",
  statement: "§2 与 §5 对每日提醒上限不一致。",
  severity: "high",
  evidence: [{ source: "", locator: "§2", quote: "家长每天最多收到一条学习提醒。" }],
  ...over,
});

function prepared(t) {
  const root = fixture(t);
  write(path.join(root, "docs/prd.md"), "# 示例学习应用\n家长每天最多收到一条学习提醒。\n新词上限\n每日 10 个\n");
  const source = cli(root, ["prd", "ingest", "--file", "docs/prd.md"]).json.sources[0];
  const findings = (batchId, items) => {
    write(path.join(storeOf(root), `analyses/${batchId}/findings.json`), makeFindings(batchId, { sources: [source.id], items }));
    return batchId;
  };
  return { root, source, findings };
}

test("check verifies verbatim quotes and rejects paraphrase fabrication", (t) => {
  const { root, source, findings } = prepared(t);
  const withWs = item({ evidence: [{ source: source.id, locator: "§2", quote: "家长每天\n  最多收到一条学习提醒。" }] });
  const paraphrase = item({ id: "C-02", evidence: [{ source: source.id, locator: "§5", quote: "家长每天最多两条提醒" }] });
  const ghost = item({ id: "C-03", evidence: [{ source: "不存在-1", locator: "§6", quote: "家长每天最多收到一条学习提醒。" }] });
  const noEvidence = item({ id: "C-04", evidence: [] });
  const dup = item({ kind: "vibe" });
  const dangling = item({ id: "C-05", kind: "ambiguity", conflictsWith: ["C-99"], evidence: [{ source: source.id, locator: "表格", quote: "新词上限 每日 10 个" }] });
  const batch = findings("bad", [dup, withWs, paraphrase, ghost, noEvidence, dangling]);
  const checked = cli(root, ["prd", "check", "--batch", batch]);
  assert.equal(checked.status, 1);
  assert.equal(checked.json.ok, false);
  const problems = checked.json.problems;
  assert.ok(problems.some((p) => p.path.includes("items[C-02]") && p.message.includes("逐字")), JSON.stringify(problems));
  assert.ok(problems.some((p) => p.path.includes("items[C-03]") && p.message.includes("不在本批")), JSON.stringify(problems));
  assert.ok(problems.some((p) => p.message.includes("至少一条逐字引文")));
  assert.ok(problems.some((p) => p.path.includes("items[C-05]") && p.message.includes("关联条目不存在")));
  assert.ok(problems.some((p) => p.message.includes("kind")));
  assert.ok(!problems.some((p) => p.path.includes("items[C-01]") && p.message.includes("逐字")), "跨行空白折叠后的逐字引用应通过");
  const good = findings("good", [
    withWs,
    item({ id: "R-01", kind: "redline", evidence: [{ source: source.id, locator: "§2", quote: "家长每天最多收到一条学习提醒。" }], conflictsWith: [] }),
  ]);
  const okCheck = cli(root, ["prd", "check", "--batch", good]);
  assert.equal(okCheck.status, 0, okCheck.stdout + okCheck.stderr);
  assert.equal(okCheck.json.ok, true);
  assert.equal(okCheck.json.checkedQuotes, 2);
  assert.deepEqual(okCheck.json.problems, []);
});

test("check tolerates missing summary as warning only", (t) => {
  const { root, source, findings } = prepared(t);
  const findingsPath = (batchId) => path.join(storeOf(root), `analyses/${batchId}/findings.json`);
  const batch = findings("nosummary", [item({ evidence: [{ source: source.id, locator: "§2", quote: "家长每天最多收到一条学习提醒。" }] })]);
  const data = JSON.parse(fs.readFileSync(findingsPath(batch), "utf8"));
  delete data.summary;
  write(findingsPath(batch), data);
  const result = cli(root, ["prd", "check", "--batch", batch]);
  assert.equal(result.json.ok, true, JSON.stringify(result.json.problems));
  assert.ok(result.json.warnings.some((w) => w.path.startsWith("summary.")));
});

test("render refuses unchecked evidence then derives deterministic meeting docs", (t) => {
  const { root, source, findings } = prepared(t);
  const badBatch = findings("bad-render", [item({ evidence: [{ source: source.id, locator: "§2", quote: "编造的原文" }] })]);
  const refused = cli(root, ["prd", "render", "--batch", badBatch]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /render 拒绝/);
  assert.equal(fs.existsSync(path.join(storeOf(root), "analyses/bad-render/contradictions.md")), false);
  const batch = findings("ok-render", [
    item({ evidence: [{ source: source.id, locator: "§2", quote: "家长每天最多收到一条学习提醒。" }] }),
    item({ id: "A-01", kind: "ambiguity", severity: "low", title: "上限档位口径", statement: "表格三档与正文不一致。", question: "以哪处为准？", evidence: [{ source: source.id, locator: "表格", quote: "新词上限 每日 10 个" }] }),
    item({ id: "R-01", kind: "redline", severity: "high", title: "免费试用红线", statement: "试用不得收费。", evidence: [{ source: source.id, locator: "§2", quote: "家长每天最多收到一条学习提醒。" }] }),
  ]);
  const rendered = cli(root, ["prd", "render", "--batch", batch]);
  assert.equal(rendered.status, 0, rendered.stderr);
  const contradictions = fs.readFileSync(path.join(storeOf(root), "analyses/ok-render/contradictions.md"), "utf8");
  const redlines = fs.readFileSync(path.join(storeOf(root), "analyses/ok-render/redlines.md"), "utf8");
  assert.ok(contradictions.includes("[C-01]") && contradictions.includes("[A-01]") && !contradictions.includes("[R-01]"));
  assert.ok(redlines.includes("[R-01]") && !redlines.includes("[C-01]"));
  assert.ok(contradictions.includes("> 家长每天最多收到一条学习提醒。"));
  assert.ok(contradictions.includes("待确认：以哪处为准？"));
  assert.ok(contradictions.includes("> 背景：K12 英语小程序"));
  assert.ok(redlines.includes("《prd》") && redlines.includes("§2"));
  const first = Buffer.from(contradictions);
  cli(root, ["prd", "render", "--batch", batch]);
  assert.deepEqual(Buffer.from(fs.readFileSync(path.join(storeOf(root), "analyses/ok-render/contradictions.md"))), first, "render 必须确定性");
});

test("batch ids and outputs stay inside the prd store", (t) => {
  const root = fixture(t);
  for (const batch of ["../outside", "..", "."]) {
    const result = cli(root, ["prd", "check", "--batch", batch]);
    assert.notEqual(result.status, 0, batch);
  }
  assert.equal(fs.existsSync(path.join(root, "outside")), false);
  assert.equal(fs.existsSync(path.join(root, ".mf-dev-flow", "analyses")), false);
});

test("check --against 以候选快照重算引文门禁并输出影响面", (t) => {
  const { root, source, findings } = prepared(t);
  const batch = findings("against", [
    item({ id: "C-10", evidence: [{ source: source.id, locator: "§2", quote: "家长每天最多收到一条学习提醒。" }] }),
    item({ id: "R-10", kind: "redline", severity: "high", title: "上限红线", statement: "新词上限口径。", evidence: [{ source: source.id, locator: "表格", quote: "新词上限 每日 10 个" }] }),
  ]);
  write(path.join(root, "same.md"), snapshotOf(root, source.id));
  const unchanged = cli(root, ["prd", "check", "--batch", batch, "--source", source.id, "--against", "same.md"]);
  assert.equal(unchanged.status, 0, unchanged.stdout + unchanged.stderr);
  assert.equal(unchanged.json.mode, "against-candidate");
  assert.equal(unchanged.json.snapshotChanged, false);
  assert.equal(unchanged.json.candidateOk, true);
  assert.deepEqual(unchanged.json.impactedItems, []);
  write(path.join(root, "cand.md"), "# 示例学习应用\n家长每天最多收到三条学习提醒。\n新词上限\n每日 10 个\n");
  const changed = cli(root, ["prd", "check", "--batch", batch, "--source", source.id, "--against", "cand.md"]);
  assert.equal(changed.status, 1);
  assert.equal(changed.json.snapshotChanged, true);
  assert.equal(changed.json.baselineOk, true);
  assert.deepEqual(changed.json.impactedItems, ["C-10"]);
  assert.ok(changed.json.newlyFailed.every((problem) => problem.path.includes("items[C-10]")), JSON.stringify(changed.json.newlyFailed));
  assert.ok(!changed.json.newlyFailed.some((problem) => problem.path.includes("items[R-10]")), "未受影响引文不得计入影响面");
  const missingPair = cli(root, ["prd", "check", "--batch", batch, "--against", "cand.md"]);
  assert.equal(missingPair.status, 1);
  assert.match(missingPair.stderr, /--against 需要同时 --source/);
  const ghost = cli(root, ["prd", "check", "--batch", batch, "--source", "不存在-1", "--against", "cand.md"]);
  assert.equal(ghost.status, 1);
  assert.match(ghost.stderr, /不在 manifest/);
});
