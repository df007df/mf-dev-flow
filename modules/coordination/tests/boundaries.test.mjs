import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("纯契约与投影不越过 I/O 边界", () => {
  for (const relative of [
    "modules/coordination/contracts.mjs",
    "modules/coordination/identity.mjs",
    "modules/kernel/projection.mjs",
  ]) {
    const source = fs.readFileSync(path.join(skillRoot, relative), "utf8");
    assert.doesNotMatch(source, /node:fs|node:path|node:child_process|process\.cwd\(|process\.env|\bfetch\s*\(/);
  }
});

test("Outbox 与只读状态没有网络能力，Hook 不导入协同模块", () => {
  const outbox = fs.readFileSync(path.join(skillRoot, "modules/coordination/local-outbox.mjs"), "utf8");
  assert.doesNotMatch(outbox, /node:http|node:https|node:net|undici|\bfetch\s*\(/);
  const status = fs.readFileSync(path.join(skillRoot, "modules/coordination/status.mjs"), "utf8");
  assert.doesNotMatch(status, /node:http|node:https|node:net|undici|\bfetch\s*\(/);
  const hook = fs.readFileSync(path.join(skillRoot, "integrations/codex/hooks/mf-dev-flow.mjs"), "utf8");
  assert.doesNotMatch(hook, /coordination\/(?:local-outbox|publisher|status)/);
});
