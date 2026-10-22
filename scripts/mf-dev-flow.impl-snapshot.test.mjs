import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "mf-dev-flow.mjs");
const temporaryDirectories = [];

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFixture({ features = null } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-impl-snapshot-"));
  temporaryDirectories.push(cwd);
  writeJson(path.join(cwd, ".mf-dev-flow", "project.json"), {
    schemaVersion: 1,
    project: { name: "fixture" },
    codeRoots: [{ path: ".", role: "primary" }],
  });
  writeJson(path.join(cwd, ".mf-dev-flow", "planning", "feature-map.json"), {
    schemaVersion: 3,
    groups: [],
    features:
      features ??
      [
        {
          id: "reader-core",
          title: "阅读器",
          status: "done",
          codeRefs: ["src/services/trial-api.ts", "src/pages", "src/missing.ts"],
        },
      ],
  });
  fs.mkdirSync(path.join(cwd, "src", "services"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "src", "pages"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "src", "pages", "node_modules", "vendor"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, "src", "services", "trial-api.ts"),
    [
      'import { request } from "../utils/request";',
      'import mockData from "./mock-data";',
      "// TODO: replace with real API",
      "export function getBooks() { return mockData.books; } // 未实现",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(cwd, "src", "pages", "index.tsx"),
    ['import { getBooks } from "../services/trial-api";', "", "export default function Page() { return getBooks(); }", ""].join("\n"),
  );
  fs.writeFileSync(path.join(cwd, "src", "pages", "node_modules", "vendor", "mock.js"), "export const mocked = 1;\n");
  return cwd;
}

function runImplSnapshot(cwd, args = []) {
  return spawnSync(process.execPath, [script, "feature", "impl-snapshot", ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("impl-snapshot 快照文件、目录与缺失引用，并命中 mock/planned 标记与 import 摘要", () => {
  const cwd = writeFixture();
  const result = runImplSnapshot(cwd, ["--id", "reader-core"]);
  assert.equal(result.status, 0, result.stderr);
  const snapshot = JSON.parse(result.stdout);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.featureId, "reader-core");
  assert.equal(snapshot.refs.length, 3);

  const [file, directory, missing] = snapshot.refs;
  assert.equal(file.kind, "file");
  assert.equal(file.exists, true);
  assert.match(file.sha256, /^[0-9a-f]{64}$/);
  assert.equal(file.lines, 5);
  assert.deepEqual(
    file.markers.mock.map((item) => item.token),
    ["mockdata"],
  );
  assert.deepEqual(
    file.markers.planned.map((item) => item.token).sort(),
    ["todo", "未实现"],
  );
  assert.ok(file.imports.includes("../utils/request"));
  assert.ok(file.imports.includes("./mock-data"));
  assert.equal(file.codeRoot.path, ".");
  assert.equal(file.codeRoot.gitHead, null);

  assert.equal(directory.kind, "directory");
  assert.equal(directory.truncated, false);
  assert.deepEqual(
    directory.files.map((item) => item.path),
    ["src/pages/index.tsx"],
  );
  assert.deepEqual(directory.files[0].imports, ["../services/trial-api"]);

  assert.equal(missing.kind, "missing");
  assert.equal(missing.exists, false);
});

test("impl-snapshot 在 git 代码根上记录 HEAD 与分支", () => {
  const cwd = writeFixture();
  const git = (args) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  git(["init", "-q"]);
  git(["-c", "user.email=t@example.com", "-c", "user.name=t", "add", "-A"]);
  git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init"]);
  const result = runImplSnapshot(cwd, ["--id", "reader-core"]);
  assert.equal(result.status, 0, result.stderr);
  const snapshot = JSON.parse(result.stdout);
  const head = spawnSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  assert.equal(snapshot.refs[0].codeRoot.gitHead, head);
  assert.match(snapshot.refs[0].codeRoot.gitBranch, /^(main|master)$/);
});

test("impl-snapshot 目录遍历尊重 --limit 并标记 truncated", () => {
  const cwd = writeFixture();
  fs.mkdirSync(path.join(cwd, "src", "pages", "nested"), { recursive: true });
  for (const name of ["a.ts", "b.ts", "c.ts"]) {
    fs.writeFileSync(path.join(cwd, "src", "pages", name), `export const ${name} = 1;\n`);
    fs.writeFileSync(path.join(cwd, "src", "pages", "nested", name), `export const ${name} = 1;\n`);
  }
  const result = runImplSnapshot(cwd, ["--id", "reader-core", "--limit", "2"]);
  assert.equal(result.status, 0, result.stderr);
  const snapshot = JSON.parse(result.stdout);
  const directory = snapshot.refs[1];
  assert.equal(directory.kind, "directory");
  assert.equal(directory.files.length, 2);
  assert.equal(directory.truncated, true);
});

test("impl-snapshot 是只读命令：不修改功能地图也不新增记录文件", () => {
  const cwd = writeFixture();
  const mapFile = path.join(cwd, ".mf-dev-flow", "planning", "feature-map.json");
  const mapBefore = fs.readFileSync(mapFile, "utf8");
  const recordsBefore = fs.readdirSync(path.join(cwd, ".mf-dev-flow"), { recursive: true }).sort();
  const result = runImplSnapshot(cwd, ["--id", "reader-core"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(mapFile, "utf8"), mapBefore);
  assert.deepEqual(fs.readdirSync(path.join(cwd, ".mf-dev-flow"), { recursive: true }).sort(), recordsBefore);
});

test("impl-snapshot 未知功能点、缺少 --id、未建地图分别给出明确失败或提示", () => {
  const cwd = writeFixture();
  const unknown = runImplSnapshot(cwd, ["--id", "no-such"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /功能地图中没有叶子功能：no-such/);

  const missingId = runImplSnapshot(cwd);
  assert.equal(missingId.status, 1);
  assert.match(missingId.stderr, /缺少 --id/);

  const noMap = writeFixture();
  fs.rmSync(path.join(noMap, ".mf-dev-flow", "planning"), { recursive: true, force: true });
  const result = runImplSnapshot(noMap, ["--id", "reader-core"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /功能地图尚未建立/);
});
