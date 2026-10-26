import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareDemoWorkspace } from "./demo-workspace.mjs";

test("prepareDemoWorkspace copies only public demo inputs into a clean workspace", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-demo-workspace-test-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const source = path.join(fixtureRoot, "source");
  const destination = path.join(fixtureRoot, "destination");
  fs.mkdirSync(path.join(source, "prd"), { recursive: true });
  fs.mkdirSync(path.join(source, "prototype"), { recursive: true });
  fs.mkdirSync(path.join(source, "app"), { recursive: true });
  fs.mkdirSync(path.join(source, ".mf-dev-flow"), { recursive: true });
  fs.writeFileSync(path.join(source, "prd", "v1.md"), "prd\n");
  fs.writeFileSync(path.join(source, "prototype", "v1.html"), "prototype\n");
  fs.writeFileSync(path.join(source, "app", "index.html"), "app\n");
  fs.writeFileSync(path.join(source, ".mf-dev-flow", "private.json"), "must-not-copy\n");
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, "stale.txt"), "stale\n");

  const result = prepareDemoWorkspace(source, destination);

  assert.equal(result.destination, destination);
  assert.equal(fs.readFileSync(path.join(destination, "prd", "v1.md"), "utf8"), "prd\n");
  assert.equal(fs.readFileSync(path.join(destination, "prototype", "v1.html"), "utf8"), "prototype\n");
  assert.equal(fs.readFileSync(path.join(destination, "app", "index.html"), "utf8"), "app\n");
  assert.equal(fs.existsSync(path.join(destination, ".mf-dev-flow")), false);
  assert.equal(fs.existsSync(path.join(destination, "stale.txt")), false);
});
