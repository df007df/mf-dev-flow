import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const dashboard = fileURLToPath(new URL("../../", import.meta.url));

test("Turbopack serves shared modules, read-only CLI pages and document image previews", { timeout: 120000 }, async (t) => {
  // A sibling app preserves production import paths and has its own build cache.
  const app = fs.mkdtempSync(path.join(path.dirname(dashboard), ".dashboard-smoke-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-dashboard-smoke-"));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  for (const name of ["app", "server", "next.config.mjs", "package.json", "tsconfig.json", "next-env.d.ts"])
    fs.cpSync(path.join(dashboard, name), path.join(app, name), { recursive: true });
  fs.symlinkSync(path.join(dashboard, "node_modules"), path.join(app, "node_modules"), "dir");
  const store = path.join(workspace, ".mf-dev-flow");
  fs.mkdirSync(store);
  const project = JSON.stringify({ project: { name: "Isolated module resolution fixture" } });
  fs.writeFileSync(path.join(store, "project.json"), project);
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  let output = "";
  child = spawn(process.execPath, [path.join(dashboard, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: app,
    env: { ...process.env, MF_DEV_FLOW_WORKSPACE_ROOT: workspace, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Next startup timed out: ${output}`)), 30000);
    const read = (chunk) => {
      output = (output + chunk).slice(-12000);
      if (output.includes("Ready in")) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Next exited ${code}: ${output}`)); });
  });
  const request = async (route) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(45000) });
    const body = await response.text();
    assert.equal(response.status, 200, `${route}: ${body.slice(0, 1200)}\n${output}`);
    return body;
  };
  assert.match(await request("/"), /MF-DEV-FLOW/);
  const state = JSON.parse(await request("/api/state/"));
  assert.equal(state.project.project.name, "Isolated module resolution fixture");
  const prototype = JSON.parse(await request("/api/prototype/"));
  assert.equal(prototype.items[0].status, "not_initialized");
  assert.deepEqual(fs.readdirSync(store), ["project.json"]);
  assert.equal(fs.readFileSync(path.join(store, "project.json"), "utf8"), project);

  // Reproduce canonical Markdown links and verify the rendered images, not
  // just HTTP 200 for the page shell. All archive data is synthetic.
  const write = (file, content) => {
    const target = path.join(store, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  write("prototype/task.json", JSON.stringify({ status: "blocked", source: { prototypeRun: "fixture-run" }, latestAudit: { status: "blocked", remainingSourceCandidates: 7 } }));
  write("prototype/原型图流程.md", "# 图片路径验证\n\n[首页链接](../prototype-runs/fixture-run/screenshots/首页.png)\n\n![内联图片](../prototype-runs/fixture-run/screenshots/首页.png)\n\n| 旧截图简写 |\n| --- |\n| `screenshots/首页.png` |\n\n[操作追踪](../prototype-runs/fixture-run/traces/capture.zip)\n\n[越界图片](../../outside.png)\n");
  write("prototype-runs/fixture-run/screenshots/首页.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY4sAAAAASUVORK5CYII=", "base64"));
  write("prototype-runs/fixture-run/traces/capture.zip", "synthetic trace fixture");
  write("prototype/feature-index.json", JSON.stringify({ features: [{ id: "home", title: "首页分组", sourceEntries: ["home-entry", "next-entry"] }] }));
  write("prototype/coverage.json", JSON.stringify({ coverage: [
    { id: "home-entry", status: "covered", evidence: [{ level: "observed", action: "打开首页", path: "screenshots/首页.png" }] },
    { id: "next-entry", status: "covered", evidence: [{ level: "observed", action: "打开后续页", path: "screenshots/下一页.png" }] },
  ] }));
  write("prototype-runs/fixture-run/screenshots/下一页.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY4sAAAAASUVORK5CYII=", "base64"));
  for (const [id, title, createdAt] of [["fixture-run", "本次原型核对", "2020-09-05T10:00:00Z"], ["older-run", "首次原型分析", "2020-09-04T10:00:00Z"]]) {
    write(`prototype-runs/${id}/run.json`, JSON.stringify({ id, type: "prototype", title, status: "blocked", createdAt, updatedAt: createdAt }));
    write(`prototype-runs/${id}/overview.md`, `# ${title}\n\n真实归档结构的隔离测试。`);
  }
  write("prototype-runs/fixture-run/work-plan.json", JSON.stringify({ tasks: [{ id: "check-home", title: "核对首页状态", createdAt: "2020-09-05T10:01:00Z" }] }));
  write("prototype-runs/fixture-run/executions/check-home.json", JSON.stringify({ status: "blocked", summary: "首页状态已核对，其他页面待检查", updatedAt: "2020-09-05T10:02:00Z" }));
  write("prototype-runs/fixture-run/audit-review.md", "# 审计记录\n\n保留尚未核验的状态差异。");
  write("planning/feature-map.json", JSON.stringify({
    sourceRun: "fixture-refinement",
    groups: [{ id: "fixture-group", title: "隔离功能块", rank: 10 }],
    features: [
      {
        id: "first-feature",
        parentId: "fixture-group",
        rank: 10,
        title: "首个功能点",
        description: "用户可完成首个可验收结果。",
        status: "not_started",
        priority: "P0",
        wave: "W0",
        priorityReason: "隔离场景的起点。",
        waveReason: "没有前置功能。",
        sourceEntries: ["home-entry"],
        developmentRequirements: ["保留可观察结果。"],
        analysis: {
          prototype: "隔离原型入口。",
          code: "隔离代码现状。",
          systems: "隔离系统边界。",
          scope: "只覆盖首个结果。",
          gaps: ["等待验收"],
          sources: ["prototype", "code", "system"].map((kind) => ({ kind, ref: `${kind}-fixture`, note: `${kind} 依据` })),
        },
      },
      {
        id: "second-feature",
        parentId: "fixture-group",
        rank: 20,
        title: "后续功能点",
        description: "用户可完成依赖后的结果。",
        status: "not_started",
        priority: "P1",
        wave: "W1",
        priorityReason: "依赖首个结果。",
        waveReason: "等待首个功能完成。",
        sourceEntries: ["next-entry"],
        dependsOn: ["first-feature"],
        developmentRequirements: ["复用首个结果。"],
        analysis: {
          prototype: "隔离原型后续入口。",
          code: "隔离代码后续现状。",
          systems: "隔离系统后续边界。",
          scope: "只覆盖后续结果。",
          gaps: ["等待联调"],
          sources: ["prototype", "code", "system"].map((kind) => ({ kind, ref: `${kind}-fixture`, note: `${kind} 依据` })),
        },
      },
    ],
  }));
  write("planning/功能演进地图.md", "# 隔离功能地图文本\n\n用于验证地图文本标签。\n");
  write("planning/acceptance-cases.json", JSON.stringify({
    schemaVersion: 1,
    revision: 1,
    records: [{
      id: "AC-FIRST-001",
      featureId: "first-feature",
      title: "首个结果可完整完成",
      detail: "从入口完成首个用户结果，并在最终阶段保留真实截图。",
      evidenceHints: ["首个结果的最终界面截图"],
      status: "active",
      origin: "user",
      revision: 1,
      createdAt: "2020-09-05T10:00:00Z",
      updatedAt: "2020-09-05T10:00:00Z",
      history: [],
      statusReason: null,
    }],
    requests: [],
    events: [{ revision: 1, at: "2020-09-05T10:00:00Z", kind: "acceptance_case_added", subject: "AC-FIRST-001" }],
    updatedAt: "2020-09-05T10:00:00Z",
  }));
  // M4：传播图——只读 API、建议口径与 SVG 投影；不写任何存档。
  write("prd/manifest.json", JSON.stringify({ schemaVersion: 1, sources: [{ id: "alpha-prd", title: "隔离 PRD" }] }));
  write("prd/sources/alpha-prd.md", "# 隔离 PRD\n");
  write("prd/analyses/fixture-batch/findings.json", JSON.stringify({ schemaVersion: 1, batchId: "fixture-batch", title: "隔离", summary: {}, sources: ["alpha-prd"], items: [], affectsLinks: [{ sourceId: "alpha-prd", to: "prototype:home-entry" }] }));
  const acceptanceCasesApi = JSON.parse(await request("/api/feature-acceptance/?feature=first-feature"));
  assert.equal(acceptanceCasesApi.activeCount, 1);
  assert.equal(acceptanceCasesApi.items[0].record.id, "AC-FIRST-001");
  const graphApi = JSON.parse(await request("/api/graph/"));
  assert.equal(graphApi.schemaVersion, 1);
  assert.ok(graphApi.nodes.some((node) => node.ref === "feature:first-feature"), JSON.stringify(graphApi.nodes?.map((n) => n.ref) ?? graphApi));
  assert.ok(graphApi.edges.some((edge) => edge.kind === "evidence-for" && edge.from === "prd:alpha-prd"));
  const impactApi = JSON.parse(await request(`/api/graph/?impact=${encodeURIComponent("prd:alpha-prd")}`));
  assert.ok(impactApi.affected.some((item) => item.ref === "feature:first-feature"));
  assert.ok((impactApi.dispatchSuggestions ?? []).every((suggestion) => suggestion.autoCreate === false));
  assert.match(await request(`/api/graph/?svg=${encodeURIComponent("prd:alpha-prd")}`), /^<svg/);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(
      page.getByRole("heading", { name: "项目卡片", exact: true }),
    ).toBeVisible();
    const topLevelModuleTitles = await page
      .locator("main.dashboard > section")
      .evaluateAll((sections) =>
        sections
          .map((section) =>
            section
              .querySelector(":scope > .section-head > h2, :scope > h2")
              ?.textContent?.trim(),
          )
          .filter(Boolean)
          .map((title) => title.replace(/ · \d+ 节点 \/ \d+ 边$/, "")),
      );
    assert.deepEqual(topLevelModuleTitles, [
      "项目卡片",
      "PRD 分析",
      "原型图分析",
      "原型分组",
      "系统卡片",
      "功能点看板",
      "功能点分组列表",
      "变更传播图",
      "运行历史",
    ]);
    const featureBoard = page
      .locator("section.section-card")
      .filter({
        has: page.getByRole("heading", {
          name: "功能点看板",
          exact: true,
        }),
      });
    const featureGroups = page
      .locator("section.section-card")
      .filter({
        has: page.getByRole("heading", {
          name: "功能点分组列表",
          exact: true,
        }),
      });
    const featureAcceptance = featureGroups.getByRole("region", { name: "功能级最终验收用例", exact: true });
    await expect(featureAcceptance.getByText("首个结果可完整完成", { exact: true })).toBeVisible();
    await expect(featureAcceptance.getByText(/功能：首个功能点/)).toBeVisible();
    await featureAcceptance.getByRole("button", { name: "管理最终验收用例", exact: true }).click();
    const featureAcceptancePrompt = page.getByRole("dialog", { name: "管理最终验收用例", exact: true });
    await expect(featureAcceptancePrompt.locator(".prompt-preview")).toContainText("feature acceptance add");
    await expect(featureAcceptancePrompt.locator(".prompt-preview")).toContainText("不回写、不变 stale");
    await featureAcceptancePrompt.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(featureBoard.locator(".react-flow__node")).toHaveCount(2);
    await expect(featureBoard.locator(".react-flow__node").first()).toBeVisible();
    await featureBoard.getByRole("button", { name: "恢复自动布局", exact: true }).click();
    await expect(featureBoard.locator(".react-flow__node").last()).toBeVisible();
    const board = featureBoard.locator(".board-page");
    const firstNode = board.locator('.react-flow__node[data-id="first-feature"]');
    const secondNode = board.locator('.react-flow__node[data-id="second-feature"]');
    for (const node of [firstNode, secondNode]) {
      await expect(node.locator(".feature-node-screenshots img")).toHaveCount(1);
      await expect.poll(() => node.locator("img").evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    }
    // Image sizing can restart initial layout; capture the normal viewport only
    // after that layout has been fitted and persisted.
    await expect.poll(() => page.evaluate(() => {
      const key = Object.keys(localStorage).find((item) => item.startsWith("mf-dev-flow:dependency-board-layout:"));
      return key ? Boolean(JSON.parse(localStorage.getItem(key)).viewport) : false;
    })).toBe(true);
    const firstBox = await firstNode.boundingBox();
    const secondBox = await secondNode.boundingBox();
    assert.ok(secondBox.y > firstBox.y + firstBox.height, "Screenshot cards must not overlap dependency rows");
    const typography = await firstNode.locator(".feature-node").evaluate((card) => ({
      title: Number.parseFloat(getComputedStyle(card.querySelector(".feature-node-header strong")).fontSize),
      code: Number.parseFloat(getComputedStyle(card.querySelector("code")).fontSize),
      metadata: Number.parseFloat(getComputedStyle(card.querySelector(".feature-node-status")).fontSize),
      labels: Number.parseFloat(getComputedStyle(card.querySelector(".feature-labels span")).fontSize),
      status: Number.parseFloat(getComputedStyle(card.querySelector(".badge")).fontSize),
      width: card.getBoundingClientRect().width / (card.parentElement.getBoundingClientRect().width / card.parentElement.offsetWidth),
    }));
    assert.deepEqual(
      { title: typography.title, code: typography.code, metadata: typography.metadata, labels: typography.labels, status: typography.status },
      { title: 48, code: 33, metadata: 33, labels: 33, status: 33 },
      "Node card title and text render at three times their original size",
    );
    assert.ok(typography.width >= 960, "The enlarged typography has enough card width to remain legible");
    // M4：传播图画布在真实页面上渲染
    const graphSection = page.locator("section").filter({ has: page.getByRole("heading", { name: /变更传播图/ }) });
    await expect(graphSection).toBeVisible();
    await expect.poll(() => graphSection.locator(".react-flow__node").count(), { timeout: 15000 }).toBeGreaterThan(3);
    await graphSection.getByRole("combobox").selectOption("prd:alpha-prd");
    await graphSection.getByRole("button", { name: "追踪影响闭包" }).click();
    await expect(graphSection.getByText(/建议：对 \d+ 个功能点开/)).toBeVisible();
    const defaultRowGap = await firstNode.evaluate((first, secondId) => {
      const second = document.querySelector(`.react-flow__node[data-id="${secondId}"]`);
      if (!second) throw new Error("Missing downstream node");
      const firstBounds = first.getBoundingClientRect();
      const secondBounds = second.getBoundingClientRect();
      const scale = firstBounds.width / first.offsetWidth;
      return (secondBounds.top - firstBounds.bottom) / scale;
    }, "second-feature");
    assert.ok(defaultRowGap >= 150, "Default dependency rows keep a visible gap between cards");
    const edgeAppearance = await board.locator(".react-flow__edge-path").evaluate((edge) => {
      const style = getComputedStyle(edge);
      return { color: style.stroke, width: Number.parseFloat(style.strokeWidth) };
    });
    assert.equal(edgeAppearance.color, "rgb(95, 60, 154)", "Dependency edges use the deeper accent color");
    assert.ok(edgeAppearance.width >= 2.5, "Dependency edges are visibly thicker");
    const viewport = board.locator(".react-flow__viewport");
    const originalViewport = await viewport.getAttribute("style");
    const originalPosition = await firstNode.getAttribute("style");
    await board.getByRole("button", { name: "全屏显示画板", exact: true }).click();
    await expect(board).toHaveClass(/board-expanded/);
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await expect(board.locator(".feature-detail")).toBeHidden();
    const expandedBox = await board.boundingBox();
    assert.equal(Math.round(expandedBox.width), page.viewportSize().width);
    assert.equal(Math.round(expandedBox.height), page.viewportSize().height);
    await board.getByRole("button", { name: "显示全部节点", exact: true }).click();
    await expect(firstNode).toBeInViewport();
    await expect(secondNode).toBeInViewport();
    await expect(firstNode).toHaveAttribute("style", originalPosition);
    await board.getByRole("button", { name: "退出全屏", exact: true }).click();
    await expect(board).not.toHaveClass(/board-expanded/);
    await expect(viewport).toHaveAttribute("style", originalViewport);
    await expect(board.getByRole("button", { name: "全屏显示画板", exact: true })).toBeFocused();
    // Embedded browsers can deny the Fullscreen API; window expansion and Esc still work.
    await page.evaluate(() => { HTMLElement.prototype.requestFullscreen = async () => { throw new Error("Unavailable in embedded browser"); }; });
    await page.setViewportSize({ width: 390, height: 844 });
    await board.getByRole("button", { name: "全屏显示画板", exact: true }).click();
    await expect(board).toHaveClass(/board-expanded/);
    await expect(board.getByRole("button", { name: "退出全屏", exact: true })).toBeInViewport();
    await expect.poll(() => board.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(board).not.toHaveClass(/board-expanded/);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route(/\/files\/\?path=grid-portrait-\d+\.svg$/, async (route) => {
      const index = Number(route.request().url().match(/grid-portrait-(\d+)/)[1]);
      await route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${index % 2 ? 180 : 120}" height="268"><rect width="100%" height="100%" fill="#7655bd"/></svg>` });
    });
    await page.route(/\/api\/state\/?(?:\?.*)?$/, async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const firstShot = data.planning.features[0].sourceScreenshots[0];
      data.planning.features[0].sourceScreenshots = [
        ...Array.from({ length: 8 }, (_, index) => ({ ...firstShot, path: `grid-portrait-${index}.svg`, action: `来源图片 ${index + 1}` })),
        { path: "missing.png", entryId: "missing-entry", action: "缺失图片测试" },
      ];
      data.planning.features[1].sourceScreenshots = [];
      await route.fulfill({ response, json: data });
    });
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(firstNode.locator(".feature-node-screenshot")).toHaveCount(9);
    await expect(secondNode).toContainText("暂无关联来源截图");
    await board.getByRole("button", { name: "显示全部节点", exact: true }).click();
    const shots = firstNode.locator(".feature-node-screenshots");
    await expect.poll(() => shots.locator("img").evaluateAll((images) => images.length === 8 && images.every((img) => img.complete && img.naturalWidth > 0 && img.clientHeight === 1072 && Math.abs(img.clientWidth - img.clientHeight * img.naturalWidth / img.naturalHeight) <= 1))).toBe(true);
    await expect.poll(() => shots.evaluate((element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
    await expect(shots.locator("figcaption")).toHaveCount(0);
    assert.ok(await shots.locator("figure:has(img)").evaluateAll((figures) => figures.every((figure) => {
      const style = getComputedStyle(figure);
      const img = figure.querySelector("img");
      return style.borderWidth === "0px" && style.backgroundColor === "rgba(0, 0, 0, 0)" && figure.offsetWidth === img.offsetWidth && figure.offsetHeight === img.offsetHeight;
    })), "Screenshot containers match image bounds with no frame or caption strip");
    const spacing = await firstNode.locator(".feature-node").evaluate((card) => {
      const status = card.querySelector(".feature-node-status").getBoundingClientRect();
      const gallery = card.querySelector(".feature-node-screenshots").getBoundingClientRect();
      const picture = card.querySelector(".feature-node-screenshots img").getBoundingClientRect();
      const bounds = card.getBoundingClientRect();
      const scale = bounds.width / card.offsetWidth;
      return { above: (picture.top - status.bottom) / scale, below: (bounds.bottom - gallery.bottom) / scale };
    });
    assert.ok(spacing.above >= 10 && spacing.above <= 14, "Images retain a proportional gap below the enlarged status row");
    assert.ok(spacing.below >= 10 && spacing.below <= 15, "Card ends after the final screenshot row with its proportional padding");
    const grid = await shots.locator("figure").evaluateAll((elements) => elements.map((element) => ({ x: element.offsetLeft, y: element.offsetTop, width: element.offsetWidth, bottom: element.offsetTop + element.offsetHeight })));
    assert.deepEqual(grid.slice(0, 4).map((item) => item.y), Array(4).fill(grid[0].y));
    assert.ok(grid[4].y > grid[0].y && grid[4].x === grid[0].x);
    assert.ok(grid[8].y > grid[4].y && grid[8].x === grid[0].x);
    for (let index = 1; index < 4; index++) assert.equal(grid[index].x - grid[index - 1].x - grid[index - 1].width, 2, "Mixed aspect ratios keep a 2px gap");
    assert.ok(await firstNode.evaluate((element) => element.offsetWidth >= 960), "The enlarged typography has enough card width to remain legible");
    const nodeGeometry = await firstNode.evaluate((element) => ({ height: element.offsetHeight, y: element.getBoundingClientRect().bottom }));
    assert.ok(grid[8].bottom <= nodeGeometry.height, "All screenshot rows stay inside the card");
    assert.ok((await secondNode.boundingBox()).y > nodeGeometry.y, "Downstream nodes move below the expanded card");
    await board.getByRole("button", { name: "显示全部节点", exact: true }).click();
    await expect(firstNode).toContainText("截图暂不可用");
    await page.unroute(/\/api\/state\/?(?:\?.*)?$/);
    await page.unroute(/\/files\/\?path=grid-portrait-\d+\.svg$/);
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(firstNode.locator(".feature-node-screenshot")).toHaveCount(1);
    await featureGroups.getByRole("button", { name: "查看完整功能点详情", exact: true }).click();
    const planningDocument = page.getByRole("dialog", { name: "完整功能点详情 · 2 个功能点", exact: true });
    await expect(planningDocument.locator(".feature-document-item")).toHaveCount(2);
    await expect(planningDocument.locator('[data-feature-id="first-feature"]')).toContainText("隔离原型入口。");
    await expect(planningDocument.locator('[data-feature-id="second-feature"]')).toContainText("依赖功能");
    await expect(planningDocument.locator(".prototype-entry-list")).toHaveCount(2);
    await expect(planningDocument.locator('[data-feature-id="first-feature"] .prototype-entry-list')).toContainText("home-entry");
    await expect(planningDocument.locator('[data-feature-id="second-feature"] .prototype-entry-list')).toContainText("next-entry");
    const firstFeatureHeadings = await planningDocument
      .locator('[data-feature-id="first-feature"] h3')
      .allTextContents();
    assert.deepEqual(firstFeatureHeadings.slice(1), [
      "功能说明",
      "关联原型入口",
      "来源截图",
      "功能分析",
      "P / W 标签依据",
      "依赖功能",
      "功能疑问",
      "开发要求",
      "交付阶段",
    ]);
    await expect(
      planningDocument.locator('[data-feature-id="first-feature"] .prototype-source-screenshots'),
    ).toContainText("复用关联原型入口在原型文档中的 observed 截图");
    const documentToc = planningDocument.getByRole("navigation", { name: "功能点详情目录", exact: true });
    await expect(documentToc.getByRole("button", { name: "首个功能点", exact: true })).toBeVisible();
    await expect(documentToc.getByRole("button", { name: "后续功能点", exact: true })).toBeVisible();
    await documentToc.getByRole("button", { name: "后续功能点", exact: true }).click();
    await expect(planningDocument.locator('[data-feature-id="second-feature"]')).toBeInViewport();
    await planningDocument.getByRole("button", { name: "关闭", exact: true }).click();
    const card = page.locator("section.section-card").filter({ has: page.getByRole("heading", { name: "原型图分析", exact: true }) });
    const requirements = card.locator(".prototype-analysis-requirements");
    const analysisHistory = card.getByRole("region", { name: "分析历史", exact: true });
    const reportCard = card.getByRole("region", { name: "完整原型图流程", exact: true });
    const prototypeGroups = page
      .locator("section.section-card")
      .filter({
        has: page.getByRole("heading", { name: "原型分组", exact: true }),
      });
    await expect(requirements).toContainText("尚未记录 AR");
    await expect(analysisHistory.getByRole("button", { name: "查看历史", exact: true })).toBeVisible();
    await expect(reportCard.getByRole("heading", { name: "完整原型图流程", exact: true })).toBeVisible();
    await expect(reportCard.locator(".prototype-report-head").getByRole("button", { name: "添加或修改分析需求", exact: true })).toHaveCount(0);
    await requirements.getByRole("button", { name: "维护 AR 记录", exact: true }).click();
    const requirementsPrompt = page.getByRole("dialog", { name: "维护 AR 记录", exact: true });
    await expect(requirementsPrompt.locator(".prompt-preview")).toContainText("prototype analysis-requirements add/revise/withdraw");
    await expect(requirementsPrompt.locator(".prompt-preview")).toContainText("按功能点拆成 AC");
    await expect(requirementsPrompt.getByRole("button", { name: "复制提示词", exact: true })).toBeVisible();
    await requirementsPrompt.getByRole("button", { name: "关闭", exact: true }).click();
    write("prototype/analysis-requirements.md", "# 2026-09-10 首页验收样板\n\n这不是分析阶段要求。\n");
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(requirements.getByText("检测到旧版 Markdown 历史材料，当前不会作为 AR 自动应用或迁移。像“首页验收样板”这类最终验收内容，应按功能点拆成 AC；只有明确属于分析阶段的条目才可另建 AR。", { exact: true })).toBeVisible();
    const analysisRequirementsRegistry = (instruction, revision = 1, additionalRecords = []) => JSON.stringify({
      schemaVersion: 1,
      revision,
      records: [{
        id: "AR-HOME-001",
        title: "首页角色范围",
        instruction,
        scope: { sourceTypes: ["html"], modes: ["full"] },
        evidenceHints: ["首页角色差异截图"],
        status: "active",
        origin: "user",
        revision,
        createdAt: "2020-09-05T10:00:00Z",
        updatedAt: "2020-09-05T10:0" + revision + ":00Z",
        history: [],
        statusReason: null,
      }, ...additionalRecords],
      requests: [],
      events: [{ revision, at: "2020-09-05T10:0" + revision + ":00Z", kind: "analysis_requirement_updated", subject: "AR-HOME-001" }],
      updatedAt: "2020-09-05T10:0" + revision + ":00Z",
    });
    write("prototype/analysis-requirements.json", analysisRequirementsRegistry(
      "新用户只看首页；日常态遍历所有页面。",
      1,
      [{
        id: "AR-READER-002",
        title: "阅读器恢复状态",
        instruction: "恢复阅读后核对进度和书签是否一致。",
        scope: { sourceTypes: ["html"], modes: ["full"] },
        evidenceHints: ["恢复阅读后的书签截图"],
        status: "active",
        origin: "user",
        revision: 1,
        createdAt: "2020-09-05T10:00:00Z",
        updatedAt: "2020-09-05T10:01:00Z",
        history: [],
        statusReason: null,
      }],
    ));
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(requirements.getByText("新用户只看首页；日常态遍历所有页面。", { exact: true })).toBeVisible();
    await expect(requirements.getByText("首页角色范围", { exact: true })).toBeVisible();
    const requirementStrip = requirements.locator(".analysis-requirement-list");
    await expect(requirementStrip.locator(".analysis-requirement")).toHaveCount(2);
    assert.deepEqual(
      await requirementStrip.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          display: style.display,
          flexWrap: style.flexWrap,
          overflowX: style.overflowX,
          scrollsHorizontally: element.scrollWidth > element.clientWidth,
        };
      }),
      {
        display: "flex",
        flexWrap: "nowrap",
        overflowX: "auto",
        scrollsHorizontally: true,
      },
    );
    write("prototype/analysis-requirements.json", analysisRequirementsRegistry("已更新：角色切换后在受影响页面取证。", 2));
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(requirements.getByText("已更新：角色切换后在受影响页面取证。", { exact: true })).toBeVisible();
    await expect(prototypeGroups.getByText("首页分组", { exact: true })).toBeVisible();
    await expect(page.getByText("历史原型归档（新目录未初始化）", { exact: true })).toHaveCount(0);
    await analysisHistory.getByRole("button", { name: "查看历史", exact: true }).click();
    const history = page.getByRole("dialog", { name: "原型分析历史", exact: true });
    await expect(history.locator(".analysis-history-item")).toHaveCount(2);
    await expect(history.locator(".analysis-history-item").first()).toContainText("本次原型核对");
    await history.getByRole("button", { name: /本次原型核对/ }).click();
    await expect(history.getByRole("heading", { name: "执行记录", exact: true })).toBeVisible();
    await expect(history.getByText("首页状态已核对，其他页面待检查", { exact: true })).toBeVisible();
    await history.getByRole("tab", { name: "审计记录", exact: true }).click();
    await expect(history.getByText("保留尚未核验的状态差异。", { exact: true })).toBeVisible();
    await history.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.getByText("入口观察数量不代表全量分析通过", { exact: false })).toBeVisible();
    await expect(page.getByText("仍有 7 个源码候选未验证", { exact: false })).toBeVisible();
    await reportCard.getByRole("button", { name: "查看完整分析报告", exact: true }).click();
    const markdown = page.getByRole("dialog").locator(".markdown");
    const images = markdown.locator("img");
    await expect(images).toHaveCount(3);
    for (const img of await images.all()) {
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
      assert.match(await img.getAttribute("src"), /^\/files\/?\?path=/);
    }
    const trace = markdown.getByRole("link", { name: "操作追踪" });
    assert.equal((await page.request.get(new URL(await trace.getAttribute("href"), page.url()).href)).status(), 200);
    await expect(markdown.locator("a").filter({ hasText: "越界图片" })).not.toHaveAttribute("href");
    await images.first().click();
    await expect(page.getByRole("dialog", { name: "原型证据截图", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // New catalog batches and earlier runs share the same card/history entry.
    fs.mkdirSync(path.join(workspace, "source"));
    fs.writeFileSync(path.join(workspace, "source/index.html"), "<main>Native history fixture</main>");
    const input = path.join(workspace, "analysis-input.json");
    const cli = path.join(dashboard, "../scripts/mf-dev-flow.mjs");
    const invoke = (...args) => {
      const result = spawnSync(process.execPath, [cli, "prototype", ...args], { cwd: workspace, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).items[0];
    };
    fs.writeFileSync(input, JSON.stringify({ schemaVersion: 1, source: { type: "html", location: "source/index.html" }, scope: { mode: "partial", observableBoundary: "隔离测试指定范围" } }));
    const initialized = invoke("init", "--input", input, "--batch", "native-first", "--request-id", "native-first");
    invoke("report");
    fs.writeFileSync(input, JSON.stringify({ schemaVersion: 1, source: { type: "html", location: "source/index.html" }, scope: { mode: "full", observableBoundary: "隔离测试全部范围" } }));
    const nativeSecond = invoke("init", "--input", input, "--batch", "native-second", "--request-id", "native-second", "--expected-revision", String(initialized.semanticRevision));
    const batchPage = JSON.parse(await request("/api/prototype/?command=query&collection=batches"));
    assert.equal(batchPage.items.length, 2);
    const nativeArResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.ok()
        && url.pathname === "/api/prototype/"
        && url.searchParams.get("command") === "analysis-requirements";
    }, { timeout: 15000 });
    await page.reload();
    await nativeArResponse;
    await expect(requirements.getByText("已更新：角色切换后在受影响页面取证。", { exact: true })).toBeVisible();
    await expect(page.getByLabel("运行态分析状态")).toHaveCount(0);
    const nativeHistoryResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.ok()
        && url.pathname === "/api/prototype/"
        && url.searchParams.get("command") === "query"
        && url.searchParams.get("collection") === "batches";
    }, { timeout: 15000 });
    await card.getByRole("button", { name: "查看历史", exact: true }).click();
    await nativeHistoryResponse;
    await expect(history.locator(".analysis-history-item")).toHaveCount(4);
    await history.getByRole("button", { name: /指定范围原型分析/ }).click();
    await expect(history.getByText("创建分析批次", { exact: true })).toBeVisible();
    await history.getByRole("button", { name: "查看当次报告", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "当次原型分析报告", exact: true }).getByText("隔离测试指定范围", { exact: false })).toBeVisible();

    const runtimeInput = path.join(workspace, "runtime-analysis-input.json");
    fs.writeFileSync(runtimeInput, JSON.stringify({
      schemaVersion: 1,
      source: {
        type: "runtime",
        adapter: "web-runtime@1",
        locator: { url: "https://preview.example.test/app?token=should-not-render#fragment" },
        revision: "fixture-preview-r1",
      },
      scope: { mode: "full", observableBoundary: "隔离运行态页面范围" },
    }));
    invoke(
      "init",
      "--process", "runtime-analysis@1",
      "--adapter", "web-runtime@1",
      "--evidence-profile", "runtime-only",
      "--agent", "scope-snapshot",
      "--input", runtimeInput,
      "--batch", "runtime-web",
      "--request-id", "runtime-web",
      "--expected-revision", String(nativeSecond.semanticRevision),
    );
    // The smoke test read state before creating the catalog, so update the
    // route's short-lived cache through the same public refresh path the
    // dashboard uses. The following normal state read must then see the
    // persisted runtime workflow.
    await request("/api/state/?fresh=1");
    const runtimeState = JSON.parse(await request("/api/state/"));
    assert.equal(runtimeState.prototype.workflow.process.id, "runtime-analysis");
    assert.equal(runtimeState.prototype.workflow.adapter.id, "web-runtime");
    assert.equal(runtimeState.prototype.workflow.evidenceProfile, "runtime-only");
    assert.equal(runtimeState.prototype.workflow.activeStageId, "structure-model");
    assert.doesNotMatch(JSON.stringify(runtimeState.prototype), /token=should-not-render/);
    const runtimeStateResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.ok() && url.pathname === "/api/state/";
    }, { timeout: 15000 });
    await page.reload();
    await runtimeStateResponse;
    const summary = page.getByLabel("运行态分析状态");
    await expect(summary).toContainText("流程 runtime-analysis@1");
    await expect(summary).toContainText("适配器 web-runtime@1");
    await expect(summary).toContainText("证据等级 运行态覆盖");
    await expect(summary).toContainText("当前阶段 structure-model");
    await expect(summary).not.toContainText("token=should-not-render");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
