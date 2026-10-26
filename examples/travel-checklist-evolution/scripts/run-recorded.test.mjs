import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { recordCommand } from "./run-recorded.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-demo-record-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

const records = (root, caseId) => fs
  .readFileSync(path.join(root, "generation", `${caseId}.jsonl`), "utf8")
  .trim()
  .split("\n")
  .map(JSON.parse);

test("recordCommand runs the real CLI and records hashes without absolute paths or raw output", (t) => {
  const root = fixture(t);
  const result = recordCommand(root, "case-01", ["flow", "list", "--json"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /\"flows\"/);
  const [record] = records(root, "case-01");
  assert.equal(record.kind, "command");
  assert.deepEqual(record.argv, ["flow", "list", "--json"]);
  assert.equal(record.exitCode, 0);
  assert.match(record.stdoutSha256, /^[a-f0-9]{64}$/);
  assert.match(record.stderrSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(record).includes(root), false);
  assert.equal(JSON.stringify(record).includes(result.stdout), false);
});

test("recordCommand preserves failures, supports gate records, and rejects absolute arguments", (t) => {
  const root = fixture(t);
  const failed = recordCommand(root, "case-02", ["not-a-command"]);
  assert.notEqual(failed.status, 0);
  const passed = recordCommand(root, "case-02", ["flow", "list", "--json"], { gate: true });
  assert.equal(passed.status, 0);
  assert.deepEqual(records(root, "case-02").map((record) => record.kind), ["command", "gate"]);
  assert.throws(
    () => recordCommand(root, "case-02", ["prd", "ingest", "--file", path.join(root, "prd.md")]),
    /相对路径/,
  );
  assert.throws(() => recordCommand(root, "case-99", ["flow", "list"]), /未知演进 Case/);
});

test("recordCommand can execute in a neutral workspace while keeping provenance with the example", (t) => {
  const executionRoot = fixture(t);
  const exampleRoot = fixture(t);
  const result = recordCommand(executionRoot, "case-01", ["flow", "list", "--json"], {
    provenanceRoot: exampleRoot,
    recordedCwd: "<neutral-demo-workspace>",
  });

  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(executionRoot, "generation", "case-01.jsonl")), false);
  const [record] = records(exampleRoot, "case-01");
  assert.equal(record.cwd, "<neutral-demo-workspace>");
  assert.equal(JSON.stringify(record).includes(executionRoot), false);
  assert.equal(JSON.stringify(record).includes(exampleRoot), false);
});
