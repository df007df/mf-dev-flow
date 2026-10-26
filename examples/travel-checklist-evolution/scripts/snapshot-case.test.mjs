import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { snapshotCase } from "./snapshot-case.mjs";

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-demo-snapshot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".mf-dev-flow", "planning"), { recursive: true });
  fs.writeFileSync(path.join(root, ".mf-dev-flow", "project.json"), "project-state\n");
  fs.writeFileSync(path.join(root, ".mf-dev-flow", "planning", "feature-map.json"), "feature-state\n");
  return root;
}

function writeLog(root, caseId, records) {
  fs.mkdirSync(path.join(root, "generation"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "generation", `${caseId}.jsonl`),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
}

test("snapshotCase refuses missing or unsuccessful provenance", (t) => {
  const root = fixture(t);
  assert.throws(() => snapshotCase(root, "case-01"), /执行记录/);
  writeLog(root, "case-01", [{ kind: "gate", exitCode: 1 }]);
  assert.throws(() => snapshotCase(root, "case-01"), /尚未通过最终门禁/);
  writeLog(root, "case-01", [{ kind: "command", exitCode: 0 }]);
  assert.throws(() => snapshotCase(root, "case-01"), /尚未通过最终门禁/);
});

test("snapshotCase copies active bytes and writes independently verifiable hashes", (t) => {
  const root = fixture(t);
  writeLog(root, "case-01", [
    { kind: "command", exitCode: 0 },
    { kind: "gate", exitCode: 0 },
  ]);

  const result = snapshotCase(root, "case-01");
  assert.equal(result.caseId, "case-01");
  const snapshotRoot = path.join(root, "milestones", "case-01", ".mf-dev-flow");
  assert.equal(fs.readFileSync(path.join(snapshotRoot, "project.json"), "utf8"), "project-state\n");
  assert.equal(fs.readFileSync(path.join(snapshotRoot, "planning", "feature-map.json"), "utf8"), "feature-state\n");

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "milestones", "case-01", "manifest.json"), "utf8"));
  assert.deepEqual(manifest.files, [
    { path: "planning/feature-map.json", sha256: hash("feature-state\n") },
    { path: "project.json", sha256: hash("project-state\n") },
  ]);
  fs.writeFileSync(path.join(root, ".mf-dev-flow", "project.json"), "changed-active\n");
  assert.equal(fs.readFileSync(path.join(snapshotRoot, "project.json"), "utf8"), "project-state\n");
});

test("snapshotCase can copy byte-identical state from a neutral execution workspace", (t) => {
  const exampleRoot = fixture(t);
  const executionRoot = fixture(t);
  writeLog(exampleRoot, "case-02", [{ kind: "gate", exitCode: 0 }]);
  fs.writeFileSync(path.join(executionRoot, ".mf-dev-flow", "project.json"), "neutral-state\n");

  const result = snapshotCase(exampleRoot, "case-02", { stateRoot: executionRoot });

  assert.equal(result.source, path.join(executionRoot, ".mf-dev-flow"));
  assert.equal(
    fs.readFileSync(path.join(exampleRoot, "milestones", "case-02", ".mf-dev-flow", "project.json"), "utf8"),
    "neutral-state\n",
  );
});
