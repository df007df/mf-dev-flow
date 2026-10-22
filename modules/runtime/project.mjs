// Flow module extracted from the existing runtime; shared gates retain one implementation.

import path from "node:path";

import fs from "node:fs";

import { spawn, spawnSync } from "node:child_process";
import { STORE_DIRECTORY } from "../skill-identity.mjs";

import { STORE, currentFile, deliveryRoles, discoverProjectDocumentEvidence, ensureProject, executionIndexFile, fail, fileEvidence, now, projectCardFile, projectCardId, projectCardsDir, projectFile, readJson, required, valueFor, writeIfMissing, writeJson } from './shared.mjs';

export const projectCardMarkdownFile = (id) =>
  path.join(projectCardsDir(), `${id}.md`);

export function e2eEvidencePolicy(testText, e2eCommand) {
  const wechatide = /wechatide|微信开发者工具|小程序.*模拟器/i.test(
    `${testText ?? ""}\n${e2eCommand ?? ""}`,
  );
  return wechatide
    ? {
        runner: "wechatide",
        screenshotTool: "simulator_screenshot",
        allowH5Substitute: false,
        requiredEvidence: [
          "simulator_screenshot",
          "simulator_assertion",
          "console_or_network",
        ],
        summary:
          "微信开发者工具模拟器是小程序 UI 阶段的唯一验收运行器；H5 仅可调试。",
      }
    : {
        runner: "project-e2e",
        screenshotTool: null,
        allowH5Substitute: null,
        requiredEvidence: ["project_e2e"],
        summary: "按项目 E2E 命令与测试文档执行。",
      };
}

export function legacyProjectCardId(root) {
  return `project-${projectCardId(root)}`;
}

export function packageManagerFor(root, packageJson) {
  const declared = String(packageJson.packageManager ?? "");
  if (
    declared.startsWith("pnpm@") ||
    fs.existsSync(path.join(root, "pnpm-lock.yaml"))
  )
    return "pnpm";
  if (
    declared.startsWith("yarn@") ||
    fs.existsSync(path.join(root, "yarn.lock"))
  )
    return "yarn";
  return "npm";
}

export function scriptCommand(manager, script) {
  return manager === "npm" ? `npm run ${script}` : `${manager} ${script}`;
}

export function redactCommandOutput(value) {
  return String(value ?? "")
    .replace(
      /((?:PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL)\s*[=:]\s*|(?:password|secret)\s*[=:]\s*)\S+/g,
      "$1[REDACTED]",
    )
    .slice(-4000);
}

export function commandResult(command, cwd, timeout = 15 * 60 * 1000) {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout,
    maxBuffer: 1024 * 1024,
  });
  return {
    command,
    passed: result.status === 0 && !result.error,
    exitCode: result.status,
    signal: result.signal ?? null,
    output: redactCommandOutput(`${result.stdout ?? ""}${result.stderr ?? ""}`),
  };
}

export async function startProbe(command, cwd, waitMs = 2000) {
  return await new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill("SIGTERM");
      const killer = setTimeout(() => child.kill("SIGKILL"), 1000);
      killer.unref();
      resolve({ command, output: redactCommandOutput(output), ...result });
    };
    child.once("error", (error) =>
      finish({ passed: false, error: error.message, exitCode: null }),
    );
    child.once("exit", (code, signal) =>
      finish({
        passed: false,
        exitCode: code,
        signal,
        error: "启动进程在就绪探测前退出",
      }),
    );
    const timer = setTimeout(
      () => finish({ passed: true, exitCode: null, signal: null }),
      waitMs,
    );
  });
}

export function runningProjectProcess(root, port) {
  const listeners = spawnSync(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"],
    {
      encoding: "utf8",
    },
  );
  const pids = String(listeners.stdout ?? "")
    .split("\n")
    .filter((line) => line.startsWith("p"))
    .map((line) => line.slice(1))
    .filter(Boolean);
  return pids.some((pid) => {
    const processInfo = spawnSync("ps", ["-p", pid, "-o", "command="], {
      encoding: "utf8",
    });
    if (String(processInfo.stdout ?? "").includes(root)) return true;

    // Next's listener process is commonly shown as just `next-server (...)`.
    // Its command line no longer contains the project directory, so fall back
    // to the process working directory before treating an occupied port as an
    // unrelated service.
    const cwd = spawnSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], {
      encoding: "utf8",
    });
    return String(cwd.stdout ?? "")
      .split("\n")
      .some(
        (line) =>
          line.startsWith("n") &&
          path.resolve(line.slice(1)) === path.resolve(root),
      );
  });
}

export function projectDocumentation(root, packageJson, commands) {
  // 项目文档是观察证据，不是以固定文件名为准的交付前置条件。扫描结果可以是
  // 多份、零份或任意命名；项目卡片只记录它们，不因缺失而将项目标记为失败。
  const documents = discoverProjectDocumentEvidence(root);
  const documentText = documents
    .map((document) => {
      try {
        return fs.readFileSync(path.resolve(process.cwd(), document.path), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
  const explicitOnlineAddresses = documentText
    .split(/\r?\n/)
    .flatMap((line) => {
      // URLs in API examples or local-debug instructions are not deployment
      // evidence. Only a line that explicitly declares an online/production
      // address is allowed onto a project card.
      if (
        !/(?:线上|生产|部署|online|production).{0,24}(?:地址|域名|url|endpoint)|(?:地址|域名|url|endpoint).{0,24}(?:线上|生产|部署|online|production)/i.test(
          line,
        )
      )
        return [];
      return [...line.matchAll(/https?:\/\/[^\s<>()`"']+/g)].map((match) =>
        match[0].replace(/[，,。;；]+$/, ""),
      );
    });
  return {
    documents,
    testing: {
      unitCommand: commands.test ?? null,
      e2eCommand: commands.e2e ?? null,
      e2eEvidencePolicy: e2eEvidencePolicy(documentText, commands.e2e),
      documented:
        /(?:pnpm|npm|yarn).{0,80}(?:test|e2e)|(?:test|e2e).{0,80}(?:pnpm|npm|yarn)/is.test(
          documentText,
        ),
    },
    onlineEnvironment: {
      documented: /environment|环境|部署|production|线上/i.test(
        documentText,
      ),
      addresses: [...new Set(explicitOnlineAddresses)].slice(0, 10),
      database: /DATABASE_URL|database|数据库/i.test(documentText)
        ? "已说明数据库连接/变量；敏感值不登记"
        : null,
      deploymentStatus: /未部署|not deployed|待部署/i.test(documentText)
        ? "not_deployed"
        : "documented",
    },
    package: {
      name: packageJson.name ?? path.basename(root),
      packageManager: packageManagerFor(root, packageJson),
    },
  };
}

export function projectCardProblems(card) {
  const problems = [];
  const missingInfo = ["title", "root", "localPath"].filter(
    (field) => !card[field],
  );
  if (missingInfo.length)
    problems.push(`项目信息不完整：${missingInfo.join("、")}`);
  for (const key of ["test", "e2e"])
    if (card.checks?.[key]?.passed !== true) problems.push(`${key} 未真实通过`);
  return problems;
}

export function projectCardMarkdown(card) {
  const result = (item) => (item?.passed ? "通过" : "未通过");
  const docs = Array.isArray(card.documentation.documents)
    ? card.documentation.documents
    : [];
  return [
    `# ${card.title}`,
    "",
    `> 项目卡片 ID：\`${card.id}\` · 本地可开发项目 · 最近检查：${card.checkedAt}`,
    "",
    "## 交付职责",
    "",
    `- 代码根角色：${card.role ?? "未登记"}`,
    `- 本轮可承担：${(card.deliveryRoles ?? []).length ? card.deliveryRoles.join("、") : "未配置专用交付角色"}`,
    `- 交付边界：${card.accessPolicy ?? "未登记"}`,
    "",
    "## 检查门禁",
    "",
    `| 启动 | 单元测试 | E2E | 结论 |`,
    `| --- | --- | --- | --- |`,
    `| ${result(card.checks.start)} | ${result(card.checks.test)} | ${result(card.checks.e2e)} | ${card.status} |`,
    "",
    "## 项目文档（扫描结果）",
    "",
    "扫描只登记已发现的项目 Markdown 路径和指纹，不依赖固定文件名，也不参与项目检查门禁。线上信息只登记地址和 DB 变量/边界，绝不登记连接串或密钥值。",
    "",
    ...(docs.length
      ? docs.map((item) => `- \`${item.path}\` · sha256 ${item.sha256}`)
      : ["- 未发现 Markdown 项目文档（仅观察结果，不影响状态）。"]),
    "",
    "## 运行与环境",
    "",
    `- 本地项目绝对路径：${card.localPath ?? "未识别"}`,
    `- 本地服务地址：${card.localAddress ?? "未从启动命令识别"}`,
    `- 单元测试：${card.documentation.testing.unitCommand ?? "未发现"}`,
    `- E2E：${card.documentation.testing.e2eCommand ?? "未发现"}`,
    `- E2E 截图规则：${card.documentation.testing.e2eEvidencePolicy?.summary ?? "未结构化"}`,
    `- Node：${card.environment.node.version}（要求 ${card.environment.node.required ?? "未声明"}）`,
    `- 包管理器：${card.environment.packageManager.name} ${card.environment.packageManager.version ?? "未检测"}`,
    "- 线上地址：",
    ...(card.documentation.onlineEnvironment.addresses.length
      ? card.documentation.onlineEnvironment.addresses.map(
          (address) => `  - ${address}`,
        )
      : []),
    `- DB：${card.documentation.onlineEnvironment.database ?? "未说明"}`,
    "",
    "## 检查问题",
    "",
    ...(card.problems.length
      ? card.problems.map((item) => `- ${item}`)
      : ["- 无。"]),
    "",
  ].join("\n");
}

export async function checkProjectRoot(root, overrides = {}) {
  const location = path.resolve(process.cwd(), root.path);
  if (!fs.existsSync(location)) fail(`项目目录不存在：${root.path}`);
  const packageFile = path.join(location, "package.json");
  if (!fs.existsSync(packageFile))
    fail(
      `项目缺少 package.json，暂不能执行真实启动/test/e2e 检查：${root.path}`,
    );
  const packageJson = readJson(packageFile);
  const manager = packageManagerFor(location, packageJson);
  const commands = {
    start:
      overrides.start ??
      (packageJson.scripts?.dev
        ? scriptCommand(manager, "dev")
        : packageJson.scripts?.["dev:weapp"]
          ? scriptCommand(manager, "dev:weapp")
          : null),
    test:
      overrides.test ??
      (packageJson.scripts?.test ? scriptCommand(manager, "test") : null),
    e2e:
      overrides.e2e ??
      (packageJson.scripts?.["test:e2e"]
        ? scriptCommand(manager, "test:e2e")
        : null),
  };
  const localPort = /(?:-p|--port)\s+(\d+)/.exec(
    String(packageJson.scripts?.dev ?? ""),
  )?.[1];
  const documentation = projectDocumentation(location, packageJson, commands);
  const managerVersion = commandResult(
    `${manager} --version`,
    location,
    30_000,
  );
  const start = commands.start
    ? await startProbe(commands.start, location, overrides.startWaitMs ?? 2000)
    : { passed: false, error: "未发现启动命令" };
  if (
    !start.passed &&
    localPort &&
    /EADDRINUSE/.test(`${start.output ?? ""} ${start.error ?? ""}`) &&
    runningProjectProcess(location, localPort)
  ) {
    start.passed = true;
    start.reusedExistingServer = true;
    start.error = null;
  }
  const checks = {
    start,
    test: commands.test
      ? commandResult(commands.test, location)
      : { passed: false, error: "未发现 test 命令" },
    e2e: commands.e2e
      ? commandResult(commands.e2e, location)
      : { passed: false, error: "未发现 test:e2e 命令" },
  };
  const card = {
    schemaVersion: 3,
    id: projectCardId(root),
    title: path.basename(location),
    root: root.path,
    role: root.role,
    deliveryRoles: deliveryRoles(root),
    accessPolicy: root.writeBoundary,
    checkedAt: now(),
    checks,
    documentation,
    environment: {
      node: {
        version: process.version,
        required: packageJson.engines?.node ?? null,
      },
      packageManager: {
        name: manager,
        version: managerVersion.passed ? managerVersion.output.trim() : null,
      },
      packageJson: fs.existsSync(packageFile)
        ? fileEvidence(packageFile)
        : null,
    },
    localAddress: localPort ? `http://localhost:${localPort}` : null,
    localPath: location,
  };
  card.problems = projectCardProblems(card);
  card.status = card.problems.length ? "failed" : "passed";
  fs.mkdirSync(projectCardsDir(), { recursive: true });
  writeJson(projectCardFile(card.id), card);
  fs.writeFileSync(projectCardMarkdownFile(card.id), projectCardMarkdown(card));
  const legacyId = legacyProjectCardId(root);
  if (legacyId !== card.id) {
    for (const file of [
      projectCardFile(legacyId),
      projectCardMarkdownFile(legacyId),
    ]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
  return card;
}

export function init() {
  if (fs.existsSync(projectFile()))
    fail(`${STORE_DIRECTORY}/project.json 已存在；请人工确认后修改，避免覆盖项目基线。`);
  const createdAt = now();
  writeJson(projectFile(), {
    schemaVersion: 1,
    project: { name: required("--name"), background: required("--background") },
    prototype: {
      primary: true,
      kind: required("--prototype-kind"),
      location: required("--prototype-location"),
      access: "待补充",
      version: "待确认",
    },
    codeRoots: [
      {
        path: required("--code-root"),
        role: "primary",
        writeBoundary: "待确认",
      },
    ],
    testCommands: { unit: "待确认", e2e: "待确认" },
    confirmedAt: null,
    createdAt,
    changeLog: [
      {
        at: createdAt,
        summary: "创建项目基线；原型访问方式、版本和测试入口待确认。",
      },
    ],
  });
  writeJson(currentFile(), {
    schemaVersion: 1,
    active: null,
    updatedAt: createdAt,
  });
  writeJson(executionIndexFile(), {
    schemaVersion: 1,
    generatedAt: createdAt,
    runs: [],
  });
  for (const dir of [
    "prototype",
    "prototype-runs",
    "delivery-runs",
    "system",
    "system-runs",
    "assets",
  ]) {
    fs.mkdirSync(path.join(STORE, dir), { recursive: true });
  }
  writeIfMissing(
    path.join(STORE, "README.md"),
    "# mf-dev-flow 项目记录\n\n本目录保存项目基线、原型拆解与开发运行记录。\n",
  );
  console.log(`已创建 ${STORE}`);
}

export function projectRootByPath(project, value) {
  const requested = path.resolve(process.cwd(), value);
  return (project.codeRoots ?? []).find(
    (root) => path.resolve(process.cwd(), root.path) === requested,
  );
}

export async function projectCheck() {
  const project = ensureProject();
  const root = valueFor("--root")
    ? projectRootByPath(project, required("--root"))
    : project.codeRoots?.[0];
  if (!root) fail("项目基线没有可检查的 codeRoot；先用 project add 登记项目。");
  if (root.referenceOnly)
    fail("只读参考项目不再生成项目卡片；请建立 system 运行并更新系统卡片。");
  const card = await checkProjectRoot(root, {
    start: valueFor("--start-command"),
    test: valueFor("--test-command"),
    e2e: valueFor("--e2e-command"),
  });
  console.log(`${card.status} · ${projectCardMarkdownFile(card.id)}`);
  if (card.status !== "passed") process.exitCode = 1;
}

export async function projectAdd() {
  const project = ensureProject();
  const root = {
    path: required("--path"),
    role: required("--role"),
    writeBoundary: required("--write-boundary"),
  };
  if (projectRootByPath(project, root.path)) fail(`项目已登记：${root.path}`);
  if (process.argv.includes("--reference-only"))
    fail(
      "只读参考项目不再使用 project add；请建立 system 运行并以只读边界登记系统卡片。",
    );
  if (!process.argv.includes("--check"))
    fail("新增本地可开发项目必须同时传 --check 并真实通过启动、test、e2e。");
  project.codeRoots ??= [];
  project.codeRoots.push(root);
  project.changeLog ??= [];
  project.changeLog.push({
    at: now(),
    summary: `登记本地可开发项目代码根 ${root.path}（待项目检查）`,
  });
  writeJson(projectFile(), project);
  const card = await checkProjectRoot(root, {
    start: valueFor("--start-command"),
    test: valueFor("--test-command"),
    e2e: valueFor("--e2e-command"),
  });
  console.log(`${card.status} · ${projectCardMarkdownFile(card.id)}`);
  if (card.status !== "passed") process.exitCode = 1;
}

export function projectStatus() {
  ensureProject();
  const cards = fs.existsSync(projectCardsDir())
    ? fs
        .readdirSync(projectCardsDir())
        .filter((file) => file.endsWith(".json"))
        .map((file) => readJson(path.join(projectCardsDir(), file)))
    : [];
  if (!cards.length)
    return console.log(
      "项目卡片尚未建立；运行 project check 或 project add --check。",
    );
  for (const card of cards)
    console.log(
      `${card.title}：${card.status} · 启动/test/e2e 已检查 · ${card.checkedAt}`,
    );
}
