import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skill = fileURLToPath(new URL("../", import.meta.url));
const cliPath = path.join(skill, "scripts", "mf-dev-flow.mjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-coordination-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function cli(root, args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: "utf8" });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch { /* caller asserts the process result */ }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

test("version --json 公开当前技能与 local-only coordination 能力", (t) => {
  const result = cli(fixture(t), ["version", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.json, {
    schemaVersion: 1,
    skill: "mf-dev-flow",
    version: "1.1.0",
    coordination: {
      eventSchemaVersion: 1,
      defaultPublisher: "disabled",
      localOutbox: "explicit-injection-only",
    },
  });
});

test("coordination status 在未启用 Outbox 时只读且不创建目录", (t) => {
  const root = fixture(t);
  const result = cli(root, ["coordination", "status", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.json, {
    schemaVersion: 1,
    mode: "local-only",
    state: "not-enabled",
    identity: { state: "absent", installationId: null },
    outbox: { state: "absent", queuedCount: 0, invalidCount: 0, events: [] },
    next: "Outbox 仅在显式注入时启用；当前没有网络同步。",
  });
  assert.deepEqual(fs.readdirSync(root), []);
});

test("coordination status 拒绝非正的读取上限", (t) => {
  const result = cli(fixture(t), ["coordination", "status", "--json", "--limit", "0"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /limit/);
});
