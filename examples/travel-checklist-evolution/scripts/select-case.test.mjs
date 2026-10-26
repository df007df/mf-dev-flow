import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { selectCase } from "./select-case.mjs";

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-demo-select-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-demo-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(outside, "sentinel.txt"), "keep");
  const state = "case-03-state\n";
  const milestone = path.join(root, "milestones", "case-03");
  fs.mkdirSync(path.join(milestone, ".mf-dev-flow"), { recursive: true });
  fs.writeFileSync(path.join(milestone, ".mf-dev-flow", "project.json"), state);
  fs.writeFileSync(
    path.join(milestone, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      caseId: "case-03",
      files: [{ path: "project.json", sha256: hash(state) }],
    }, null, 2)}\n`,
  );
  return { root, outside, milestone, state };
}

test("selectCase restores only a validated milestone and is repeatable", (t) => {
  const { root, outside, state } = fixture(t);
  fs.mkdirSync(path.join(root, ".mf-dev-flow"), { recursive: true });
  fs.writeFileSync(path.join(root, ".mf-dev-flow", "old.txt"), "old");

  const first = selectCase(root, "case-03");
  assert.equal(first.caseId, "case-03");
  assert.equal(fs.readFileSync(path.join(root, ".mf-dev-flow", "project.json"), "utf8"), state);
  assert.equal(fs.existsSync(path.join(root, ".mf-dev-flow", "old.txt")), false);

  const second = selectCase(root, "case-03");
  assert.equal(second.caseId, "case-03");
  assert.equal(fs.readFileSync(path.join(root, ".mf-dev-flow", "project.json"), "utf8"), state);
  assert.equal(fs.readFileSync(path.join(outside, "sentinel.txt"), "utf8"), "keep");
});

test("selectCase rejects unknown IDs and a tampered snapshot before replacing active state", (t) => {
  const { root, milestone } = fixture(t);
  fs.mkdirSync(path.join(root, ".mf-dev-flow"), { recursive: true });
  fs.writeFileSync(path.join(root, ".mf-dev-flow", "active.txt"), "preserve");

  assert.throws(() => selectCase(root, "../../outside"), /未知演进 Case/);
  fs.writeFileSync(path.join(milestone, ".mf-dev-flow", "project.json"), "tampered\n");
  assert.throws(() => selectCase(root, "case-03"), /哈希不一致/);
  assert.equal(fs.readFileSync(path.join(root, ".mf-dev-flow", "active.txt"), "utf8"), "preserve");
});
