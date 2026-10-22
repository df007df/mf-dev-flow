import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  projectCardMarkdown,
  projectCardProblems,
  projectDocumentation,
} from "../project.mjs";

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-project-card-"));
const cli = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../scripts/mf-dev-flow.mjs",
);

test("项目文档按扫描结果登记，不受固定文件名限制", () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.join(root, "documentation", "decisions"), { recursive: true });
    fs.writeFileSync(path.join(root, "项目说明.md"), "项目概览");
    fs.writeFileSync(
      path.join(root, "documentation", "decisions", "quality-gate.mdx"),
      "运行 pnpm test 与 pnpm test:e2e",
    );
    const documentation = projectDocumentation(
      root,
      { name: "fixture-project" },
      { test: "pnpm test", e2e: "pnpm test:e2e" },
    );

    assert.equal(Array.isArray(documentation.documents), true);
    assert.equal(documentation.documents.length, 2);
    assert.equal(documentation.testing.documented, true);
    assert.ok(
      documentation.documents.some((item) => item.path.endsWith("项目说明.md")),
    );
    assert.ok(
      documentation.documents.some((item) => item.path.endsWith("quality-gate.mdx")),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("项目卡片仅以项目信息和 test/e2e 的真实结果作为门禁", () => {
  const card = {
    title: "fixture-project",
    root: "/tmp/fixture-project",
    localPath: "/tmp/fixture-project",
    checks: {
      start: { passed: false },
      test: { passed: true },
      e2e: { passed: true },
    },
    documentation: {
      documents: [],
      testing: { unitCommand: "pnpm test", e2eCommand: "pnpm test:e2e" },
      onlineEnvironment: { addresses: [], database: null },
    },
    environment: { node: { version: "v22" }, packageManager: { name: "pnpm" } },
    status: "passed",
    problems: [],
  };

  assert.deepEqual(projectCardProblems(card), []);
  assert.match(projectCardMarkdown(card), /不参与项目检查门禁/);

  assert.deepEqual(projectCardProblems({ ...card, localPath: null }), [
    "项目信息不完整：localPath",
  ]);
  assert.deepEqual(projectCardProblems({ ...card, checks: { ...card.checks, e2e: { passed: false } } }), [
    "e2e 未真实通过",
  ]);
});

test("project check 在无 Markdown 文档的隔离项目中仍可通过", () => {
  const root = fixture();
  try {
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "fixture-project",
        scripts: {
          dev: "node -e \"setInterval(() => {}, 1000)\"",
          test: "node -e \"process.exit(0)\"",
          "test:e2e": "node -e \"process.exit(0)\"",
        },
      }),
    );
    fs.mkdirSync(path.join(root, ".mf-dev-flow"));
    fs.writeFileSync(
      path.join(root, ".mf-dev-flow", "project.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "fixture-project",
        codeRoots: [{ path: ".", role: "primary", writeBoundary: "fixture" }],
      }),
    );

    const result = spawnSync(process.execPath, [cli, "project", "check"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const card = JSON.parse(
      fs.readFileSync(
        path.join(root, ".mf-dev-flow", "projects", `${path.basename(root)}.json`),
        "utf8",
      ),
    );
    assert.equal(card.status, "passed");
    assert.deepEqual(card.documentation.documents, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
