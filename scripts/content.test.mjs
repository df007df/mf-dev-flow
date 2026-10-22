// content hash / content compare CLI 回归：只读写临时目录，绝不触碰真实 .mf-dev-flow。
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const skill = fileURLToPath(new URL("../", import.meta.url));
const CLI = path.join(skill, "scripts/mf-dev-flow.mjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-content-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
};
function cli(root, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch { /* caller asserts */ }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

test("content hash 输出与 crypto 一致的 sha256，--json 形状固定", (t) => {
  const root = fixture(t);
  const file = path.join(root, "doc.md");
  write(file, "# 标题\n内容行\n");
  const human = cli(root, ["content", "hash", "--file", "doc.md"]);
  const expected = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  assert.equal(human.status, 0, human.stderr);
  assert.ok(human.stdout.startsWith(expected));
  const json = cli(root, ["content", "hash", "--file", "doc.md", "--json"]).json;
  assert.deepEqual(
    { v: json.schemaVersion, c: json.command, f: json.file, b: json.bytes, h: json.sha256 },
    { v: 1, c: "content hash", f: "doc.md", b: Buffer.byteLength("# 标题\n内容行\n"), h: expected },
  );
  const missing = cli(root, ["content", "hash", "--file", "nope.md"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /不存在/);
});

test("content compare：字节一致、空白折叠、strict 与 fail-on-changed", (t) => {
  const root = fixture(t);
  write(path.join(root, "a.md"), "第一行\n第二行\n第三行\n");
  write(path.join(root, "same.md"), "第一行\n第二行\n第三行\n");
  write(path.join(root, "ws.md"), "第一行\r\n第二行  \r\n\r\n\r\n\r\n第三行\r\n");
  const identical = cli(root, ["content", "compare", "--a", "a.md", "--b", "same.md", "--json"]);
  assert.deepEqual(
    { s: identical.json.identical, c: identical.json.changed },
    { s: true, c: false },
  );
  const folded = cli(root, ["content", "compare", "--a", "a.md", "--b", "ws.md", "--json"]);
  assert.deepEqual(
    { i: folded.json.identical, n: folded.json.normalizedIdentical, c: folded.json.changed, x: folded.json.diff === undefined || folded.json.diff.blocks.length >= 0 },
    { i: false, n: true, c: false, x: true },
  );
  assert.equal(folded.status, 0);
  const strict = cli(root, ["content", "compare", "--a", "a.md", "--b", "ws.md", "--strict", "--fail-on-changed", "--json"]);
  assert.equal(strict.json.changed, true);
  assert.equal(strict.status, 1);
});

test("content compare 给出行级差异块（changed 合并、added 独立、行号 1 基）", (t) => {
  const root = fixture(t);
  write(path.join(root, "a.md"), "第一行\n第二行\n第三行\n第四行\n");
  write(path.join(root, "edit.md"), "第一行\n第二行改\n第三行\n第四行\n");
  write(path.join(root, "insert.md"), "第一行\n第二行\n插入\n第三行\n第四行\n");
  write(path.join(root, "cut.md"), "第一行\n第三行\n第四行\n");
  const changed = cli(root, ["content", "compare", "--a", "a.md", "--b", "edit.md", "--json"]);
  assert.equal(changed.json.changed, true);
  assert.equal(changed.json.diff.blockCount, 1);
  const [block] = changed.json.diff.blocks;
  assert.deepEqual(
    { op: block.op, af: block.a.from, at: block.a.to, bf: block.b.from, bt: block.b.to },
    { op: "changed", af: 2, at: 2, bf: 2, bt: 2 },
  );
  const added = cli(root, ["content", "compare", "--a", "a.md", "--b", "insert.md", "--json"]);
  assert.equal(added.json.diff.blockCount, 1);
  assert.equal(added.json.diff.blocks[0].op, "added");
  assert.deepEqual(added.json.diff.blocks[0].a, { from: 3, to: 2, lines: [], truncated: false });
  assert.equal(added.json.diff.addedLines, 1);
  const removed = cli(root, ["content", "compare", "--a", "a.md", "--b", "cut.md", "--json"]);
  assert.equal(removed.json.diff.blockCount, 1);
  assert.equal(removed.json.diff.blocks[0].op, "removed");
  assert.deepEqual(removed.json.diff.blocks[0].a.lines, ["第二行"]);
  assert.equal(removed.json.diff.removedLines, 1);
});

test("content compare 二进制内容只比哈希，不出行级差异", (t) => {
  const root = fixture(t);
  write(path.join(root, "a.md"), "文本\n");
  fs.writeFileSync(path.join(root, "b.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  const result = cli(root, ["content", "compare", "--a", "a.md", "--b", "b.bin", "--json"]);
  assert.equal(result.json.changed, true);
  assert.equal(result.json.diff, undefined);
  assert.match(result.json.note, /二进制/);
});
