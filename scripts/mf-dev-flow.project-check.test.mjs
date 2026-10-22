import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { dashboardState } from "../dashboard/server/state.js";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "mf-dev-flow.mjs");
const directories = [];
const processes = [];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function run(cwd, ...args) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
}

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-project-check-"));
  directories.push(cwd);
  writeJson(path.join(cwd, "package.json"), {
    name: "checked-project",
    packageManager: "npm@10.0.0",
    engines: { node: ">=20" },
    scripts: {
      dev: 'node -e "setInterval(() => {}, 10000)"',
      test: 'node -e "process.exit(0)"',
      "test:e2e": 'node -e "process.exit(0)"',
    },
  });
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, "README.md"),
    "# 项目说明\n\n## 测试\n\n`npm test` 和 `npm run test:e2e`。\n\n## Environment / 部署\n\n线上地址：https://example.test\nDB 使用 DATABASE_URL。\n",
  );
  fs.writeFileSync(path.join(cwd, "docs", "目录结构.md"), "# 目录结构\n");
  writeJson(path.join(cwd, ".mf-dev-flow", "project.json"), {
    schemaVersion: 1,
    project: { name: "fixture" },
    codeRoots: [{ path: ".", role: "primary", writeBoundary: "可修改" }],
  });
  return cwd;
}

afterEach(() => {
  while (processes.length) processes.pop().kill("SIGTERM");
  while (directories.length) fs.rmSync(directories.pop(), { recursive: true, force: true });
});

test("项目检查真实运行启动、test、e2e，并登记文档扫描结果和环境", () => {
  const cwd = fixture();
  const result = run(cwd, "project", "check");
  assert.equal(result.status, 0, result.stderr);
  const cardFile = fs
    .readdirSync(path.join(cwd, ".mf-dev-flow", "projects"))
    .find((file) => file.endsWith(".json"));
  const card = JSON.parse(
    fs.readFileSync(path.join(cwd, ".mf-dev-flow", "projects", cardFile), "utf8"),
  );
  assert.equal(card.id, path.basename(cwd));
  assert.equal(card.title, path.basename(cwd));
  assert.equal(card.status, "passed");
  assert.equal(card.checks.start.passed, true);
  assert.equal(card.checks.test.passed, true);
  assert.equal(card.checks.e2e.passed, true);
  assert.deepEqual(
    card.documentation.documents.map((item) => item.path).sort(),
    ["README.md", "docs/目录结构.md"],
  );
  for (const document of card.documentation.documents) {
    assert.match(document.sha256, /^[a-f0-9]{64}$/, document.path);
    assert.equal(typeof document.updatedAt, "string", document.path);
  }
  assert.equal(
    card.documentation.onlineEnvironment.database,
    "已说明数据库连接/变量；敏感值不登记",
  );
  assert.deepEqual(card.documentation.onlineEnvironment.addresses, ["https://example.test"]);
  assert.equal(card.localPath, fs.realpathSync(cwd));
  const markdown = fs.readFileSync(
    path.join(cwd, ".mf-dev-flow", "projects", `${card.id}.md`),
    "utf8",
  );
  assert.ok(markdown.includes(`本地项目绝对路径：${card.localPath}`));
  assert.match(markdown, /线上地址：\n\s+- https:\/\/example\.test/);
  assert.equal(dashboardState(path.join(cwd, ".mf-dev-flow")).projectCards.length, 1);
});

test("项目卡片不会把 API 示例或本地联调地址当作线上地址", () => {
  const cwd = fixture();
  fs.writeFileSync(
    path.join(cwd, "README.md"),
    "# 项目说明\n\n## 测试\n\n`npm test` 和 `npm run test:e2e`。\n\n## 环境\n\n请求示例：https://api.example.test/api/v1/books\n本地联调：http://localhost:3100\nDB 使用 DATABASE_URL。\n",
  );
  const result = run(cwd, "project", "check");
  assert.equal(result.status, 0, result.stderr);
  const cardFile = fs
    .readdirSync(path.join(cwd, ".mf-dev-flow", "projects"))
    .find((file) => file.endsWith(".json"));
  const card = JSON.parse(
    fs.readFileSync(path.join(cwd, ".mf-dev-flow", "projects", cardFile), "utf8"),
  );
  assert.deepEqual(card.documentation.onlineEnvironment.addresses, []);
  const markdown = fs.readFileSync(
    path.join(cwd, ".mf-dev-flow", "projects", `${card.id}.md`),
    "utf8",
  );
  assert.match(markdown, /线上地址：\n- DB：/);
});

test("新增本地开发项目强制检查，并拒绝把只读参考项目写入项目卡片", () => {
  const cwd = fixture();
  const target = path.join(cwd, "target");
  fs.mkdirSync(target);
  fs.copyFileSync(path.join(cwd, "package.json"), path.join(target, "package.json"));
  fs.copyFileSync(path.join(cwd, "README.md"), path.join(target, "README.md"));
  fs.mkdirSync(path.join(target, "docs"));
  fs.copyFileSync(path.join(cwd, "docs", "目录结构.md"), path.join(target, "docs", "目录结构.md"));
  const refused = run(
    cwd,
    "project",
    "add",
    "--path",
    "target",
    "--role",
    "target",
    "--write-boundary",
    "可修改",
  );
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /必须同时传 --check/);
  const reference = run(
    cwd,
    "project",
    "add",
    "--path",
    "target",
    "--role",
    "reference",
    "--write-boundary",
    "只读；仅参考代码和数据",
    "--reference-only",
  );
  assert.notEqual(reference.status, 0);
  assert.match(reference.stderr, /不再使用 project add/);
});

test("项目卡片把文档当作观察证据：任意命名或缺失都不判失败", () => {
  const cwd = fixture();
  fs.unlinkSync(path.join(cwd, "README.md"));
  fs.mkdirSync(path.join(cwd, "docs", "notes"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, "docs", "notes", "任意约定.md"),
    "# 任意约定\n\n## 环境\n\n线上地址：https://example.test\n\nDB 使用 DATABASE_URL。\n\n`npm test` 与 `npm run test:e2e`。\n",
  );
  const result = run(cwd, "project", "check");
  assert.equal(result.status, 0, result.stderr);
  const cardFile = fs
    .readdirSync(path.join(cwd, ".mf-dev-flow", "projects"))
    .find((file) => file.endsWith(".json"));
  const card = JSON.parse(
    fs.readFileSync(path.join(cwd, ".mf-dev-flow", "projects", cardFile), "utf8"),
  );
  assert.equal(card.status, "passed");
  assert.deepEqual(card.problems, []);
  assert.deepEqual(
    card.documentation.documents.map((item) => item.path).sort(),
    ["docs/notes/任意约定.md", "docs/目录结构.md"].sort(),
  );
  assert.equal(card.documentation.onlineEnvironment.documented, true);
  assert.deepEqual(card.documentation.onlineEnvironment.addresses, [
    "https://example.test",
  ]);
  const markdown = fs.readFileSync(
    path.join(cwd, ".mf-dev-flow", "projects", `${card.id}.md`),
    "utf8",
  );
  assert.match(markdown, /- `docs\/notes\/任意约定\.md` · sha256 [a-f0-9]{64}/);

  fs.rmSync(path.join(cwd, "docs"), { recursive: true, force: true });
  const bare = run(cwd, "project", "check");
  assert.equal(bare.status, 0, bare.stderr);
  const bareCard = JSON.parse(
    fs.readFileSync(path.join(cwd, ".mf-dev-flow", "projects", cardFile), "utf8"),
  );
  assert.equal(bareCard.status, "passed");
  assert.deepEqual(bareCard.documentation.documents, []);
  const bareMarkdown = fs.readFileSync(
    path.join(cwd, ".mf-dev-flow", "projects", `${bareCard.id}.md`),
    "utf8",
  );
  assert.match(bareMarkdown, /未发现 Markdown 项目文档（仅观察结果，不影响状态）/);
});

test("占用端口的 Next 风格监听进程按工作目录复用，而不是误判为外部服务", async () => {
  const cwd = fixture();
  const port = 39000 + (process.pid % 1000);
  fs.writeFileSync(
    path.join(cwd, "server.cjs"),
    "require('node:net').createServer().listen(Number(process.argv[2]), () => console.log('ready'))\n",
  );
  const packageFile = path.join(cwd, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  packageJson.scripts.dev = `node server.cjs ${port} --port ${port}`;
  writeJson(packageFile, packageJson);

  const server = spawn(process.execPath, ["server.cjs", String(port)], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  processes.push(server);
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`fixture server exited: ${code}`)));
  });

  const result = run(cwd, "project", "check");
  assert.equal(result.status, 0, result.stderr);
  const cardFile = fs
    .readdirSync(path.join(cwd, ".mf-dev-flow", "projects"))
    .find((file) => file.endsWith(".json"));
  const card = JSON.parse(fs.readFileSync(path.join(cwd, ".mf-dev-flow", "projects", cardFile), "utf8"));
  assert.equal(card.status, "passed");
  assert.equal(card.checks.start.reusedExistingServer, true);
});

test("按相同代码库路径合并重复系统卡片", () => {
  const cwd = fixture();
  const cards = ["consumer-app", "consumer-app-reference"].map((id) => ({
    id,
    title: id,
    relationship: "参考",
    authority: "代码",
    status: "confirmed",
    lastVerifiedAt: "2026-09-04T00:00:00.000Z",
    sources: [
      {
        id: `${id}-source`,
        title: "代码",
        kind: "codebase",
        location: "../consumer-app",
        authority: "代码",
        accessPolicy: "只读",
        secretHandling: "无",
        status: "confirmed",
      },
    ],
    knownApis: [],
    apiUsages: [],
    technicalIssues: [],
    facts: [],
    designGuidance: [],
    openQuestions: [],
    changeLog: [],
  }));
  writeJson(path.join(cwd, ".mf-dev-flow", "system", "cards.json"), {
    schemaVersion: 2,
    cards,
    history: [],
  });
  const result = run(cwd, "system", "dedupe");
  assert.equal(result.status, 0, result.stderr);
  const document = JSON.parse(
    fs.readFileSync(path.join(cwd, ".mf-dev-flow", "system", "cards.json"), "utf8"),
  );
  assert.equal(document.cards.length, 1);
  assert.equal(document.cards[0].id, "consumer-app");
});
