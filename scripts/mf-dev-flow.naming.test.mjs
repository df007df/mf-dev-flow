import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonical = "mf-dev-flow";
const legacy = ["mo", "fa"].join("");
const legacyName = new RegExp(`${legacy}(?!xue)`, "i");
const ignoredDirectories = new Set([".git", ".next", "node_modules"]);

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (ignoredDirectories.has(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}

test("uses mf-dev-flow consistently for entrypoints, persisted state, and temporary fixtures", () => {
  const cli = path.join(root, "scripts", `${canonical}.mjs`);
  assert.equal(fs.existsSync(cli), true, "the canonical CLI entrypoint must exist");
  const skill = fs.readFileSync(path.join(root, "SKILL.md"), "utf8");
  assert.match(skill, /^name: mf-dev-flow$/m);
  assert.match(skill, /^description: Use when /m, "the description must state only the discovery trigger");

  const result = spawnSync(process.execPath, [cli, "version", "--json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).skill, canonical);

  const leftovers = filesIn(root).flatMap(file => {
    const relative = path.relative(root, file);
    if (legacyName.test(relative)) return [`path:${relative}`];
    const source = fs.readFileSync(file);
    if (source.includes(0)) return [];
    return legacyName.test(source.toString("utf8")) ? [`content:${relative}`] : [];
  });
  assert.deepEqual(leftovers, []);

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), `${canonical}-naming-`));
  try {
    const status = spawnSync(process.execPath, [cli, "prototype", "status", "--json"], {
      cwd: fixture,
      encoding: "utf8",
    });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(fs.existsSync(path.join(fixture, `.${canonical}`, "prototype")), false);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
