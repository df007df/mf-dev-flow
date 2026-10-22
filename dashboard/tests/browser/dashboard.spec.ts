import { test, expect } from "@playwright/test";

test("原型完整报告按需加载，目录、截图与二次打开在 Next 中可用", async ({ page, request }) => {
  // 先直接请求，强制 Next/Turbopack 冷编译报告校验与文件路由，避免浏览器首屏 5s 超时
  expect((await request.get("/api/prototype?command=document&cursor=0&text-limit=1")).status()).toBe(200);
  expect((await request.get("/files/?path=prototype%2Freport.md")).status()).toBe(200);
  const ready = page.waitForResponse((response) => /\/api\/state\/?$/.test(new URL(response.url()).pathname) && response.ok(), { timeout: 20000 });
  await page.goto("/");
  await ready;
  await page.getByRole("button", { name: "查看完整分析报告", exact: true }).click();
  const document = page.locator(".dialog-content:not(.prompt-dialog)");
  await expect(document.locator(".markdown h1").first()).toContainText("原型分析报告", { timeout: 30000 });
  await expect(document.getByRole("navigation", { name: "文档目录" })).toBeVisible({ timeout: 15000 });
  // 归档截图走 assetBase=prototype 的真实文件：滚动进视口触发懒加载后必须解码成功
  const image = document.locator(".markdown img").first();
  await expect(image).toBeVisible({ timeout: 15000 });
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15000 })
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  // 二次打开仍完整渲染（按需加载的内容被复用）
  await page.getByRole("button", { name: "查看完整分析报告", exact: true }).click();
  await expect(document.locator(".markdown h1").first()).toContainText("原型分析报告", { timeout: 20000 });
  await page.keyboard.press("Escape");
});

test("AI 图标先弹窗预览再复制，支持嵌套弹窗与移动端且不误改剪贴板", async ({ page }) => {
  // Keep this interaction test isolated from the user's system clipboard.
  await page.addInitScript(() => {
    let value = "原剪贴板内容";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      readText: async () => value,
      writeText: async (text: string) => { value = text; },
    } });
  });
  await page.goto("/");
  await page.waitForResponse((response) => /\/api\/state\/?$/.test(new URL(response.url()).pathname) && response.ok(), { timeout: 20000 });
  // 任取一个带 Sparkles 的 AI 提示词按钮验证「先预览后复制」契约（与所在区块解耦）
  const rescan = page.getByRole("button", { name: "更新或添加系统信息", exact: true });
  await expect(rescan).toBeVisible();
  await expect(rescan).toHaveClass(/ai-prompt-button/);
  await expect(rescan.locator("svg.lucide-sparkles")).toHaveCount(1);
  await rescan.click();
  const preview = page.locator(".prompt-dialog");
  await expect(preview).toBeVisible();
  await expect(preview.locator(".prompt-preview")).toContainText("使用 mf-dev-flow 核验并更新或添加当前项目引用的外部系统信息");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("原剪贴板内容");
  const promptText = await preview.locator(".prompt-preview").innerText();
  await preview.getByRole("button", { name: "复制提示词", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(promptText);
  await expect(preview.getByRole("button", { name: "复制提示词", exact: true })).toHaveAttribute("title", /已复制/);
  await page.keyboard.press("Escape");
  await expect(rescan).toBeFocused();
  for (const label of ["打开功能地图继续推进功能", "扫描事实并更新功能地图", "更新或添加系统信息", "登记明确约定"]) {
    const prompt = page.getByRole("button", { name: label, exact: true });
    await expect(prompt).toHaveClass(/ai-prompt-button/);
    await expect(prompt.locator("svg.lucide-sparkles")).toHaveCount(1);
    await prompt.click();
    await expect(preview.locator(".prompt-preview")).not.toHaveText("");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(promptText);
    await preview.getByRole("button", { name: "关闭", exact: true }).click();
  }
  const copyId = page.getByRole("button", { name: "复制 ID", exact: true }).first();
  await expect(copyId).not.toHaveClass(/ai-prompt-button/);
  await expect(copyId.locator("svg.lucide-copy")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "复制功能更新提示词", exact: true })).toHaveClass(/ai-prompt-button/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rescan).toBeVisible();
  await rescan.click();
  await expect(preview).toBeVisible();
  const mobile = await preview.boundingBox();
  expect(mobile!.x).toBeGreaterThanOrEqual(0);
  expect(mobile!.x + mobile!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.locator(".planning-groups .feature-card").first().click();
  const featureDialog = page.getByRole("dialog");
  await featureDialog.getByRole("button", { name: "补充功能疑问", exact: true }).click();
  await expect(preview).toBeVisible();
  await expect(preview.locator(".prompt-preview")).toContainText("功能疑问补充：<回答已有疑问，或补充新的功能疑问、结论与依据>");
  await expect(page.locator(".dialog-content:not(.prompt-dialog)")).toHaveCount(1);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(promptText);
  await page.keyboard.press("Escape");
  await expect(page.locator(".prompt-dialog")).toHaveCount(0);
  await expect(featureDialog.getByRole("heading", { name: "功能说明", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("原型分组卡片显示稳定 ID 与用途，分组数据来自只读查询接口", async ({ page, request }) => {
  // native 目录模式下分组经 /api/prototype 只读查询拉取，不再嵌在 /api/state 里
  const query = await (
    await request.get("/api/prototype?command=query&collection=groups")
  ).json();
  const expected = [...(query.items ?? [])].sort(
    (left: any, right: any) =>
      (left.record?.order ?? Number.MAX_SAFE_INTEGER) - (right.record?.order ?? Number.MAX_SAFE_INTEGER) ||
      String(left.id).localeCompare(String(right.id)),
  );
  expect(expected.length).toBeGreaterThan(0);
  const state = await (await request.get("/api/state")).json();
  expect(state.prototype.counts.group).toBe(expected.length);
  await page.goto("/");
  await page.waitForResponse((response) => /\/api\/state\/?$/.test(new URL(response.url()).pathname) && response.ok(), { timeout: 20000 });
  const groups = page.locator(".prototype-group-card");
  await expect(groups).toHaveCount(expected.length);
  for (const group of expected) {
    const card = page.locator(`.prototype-group-card[data-group-id="${group.id}"]`);
    await expect(card.getByRole("heading", { name: group.record?.title ?? group.id, exact: true })).toBeVisible();
    await expect(card.locator(".prototype-group-id")).toHaveText(group.id);
    if (group.record?.purpose)
      await expect(card).toContainText(group.record.purpose);
    await expect(card.locator("img, .stages, .feature-labels")).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("运行态原型批次仅展示受限流程摘要，旧 HTML 批次不展示摘要", async ({ page }) => {
  let runtimeWorkflow = true;
  await page.route(/\/api\/state\/?(?:\?.*)?$/, async (route) => {
    const data = {
      generatedAt: "2026-09-07T12:34:56.000Z",
      project: { project: { name: "运行态摘要隔离夹具" } },
      current: { active: null },
      summary: { runs: 0, activeRuns: 0, tasks: {} },
      prototype: {
        native: true,
        status: "ready",
        semanticRevision: 3,
        counts: { group: 1, entry: 1, question: 0 },
        workflow: runtimeWorkflow ? {
            process: { id: "runtime-analysis", version: 1 },
            adapter: { id: "web-runtime", version: 1 },
            evidenceProfile: "runtime-only",
            activeStageId: "structure-model",
            activeAgentId: "structure-model",
            lastCheckpoint: {
              outcome: "validated",
              at: "2026-09-07T12:34:56.000Z",
              reason: "token=should-not-render",
              capture: { sessionId: "session-should-not-render" },
            },
            indexRevision: 3,
            status: "in_progress",
            sourceLocator: "https://demo.example.test/?token=should-not-render",
            manifestHash: "hash-should-not-render",
            activeAgent: { instructions: "instructions-should-not-render" },
          } : undefined,
      },
      planning: { groups: [], features: [], actionable: [] },
      system: { cards: [] },
      projectCards: [],
      runs: [],
    };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });

  await page.goto("/");
  const summary = page.getByLabel("运行态分析状态");
  await expect(summary).toContainText("流程 runtime-analysis@1");
  await expect(summary).toContainText("适配器 web-runtime@1");
  await expect(summary).toContainText("证据等级 运行态覆盖");
  await expect(summary).toContainText("当前阶段 structure-model");
  await expect(summary).toContainText("最近检查点 已验证");
  await expect(summary).toContainText("分析状态 分析中");
  await expect(summary).not.toContainText("token=should-not-render");
  await expect(summary).not.toContainText("session-should-not-render");
  await expect(summary).not.toContainText("hash-should-not-render");
  await expect(summary).not.toContainText("instructions-should-not-render");

  runtimeWorkflow = false;
  await page.reload();
  await expect(page.getByLabel("运行态分析状态")).toHaveCount(0);
});

test("列表与画板共用 P/W 标签，详情显示三类来源分析和评估理由", async ({
  page,
  request,
}) => {
  const state = await (await request.get("/api/state")).json();
  const ready = page.waitForResponse((response) => /\/api\/state\/?$/.test(new URL(response.url()).pathname) && response.ok(), { timeout: 20000 });
  await page.goto("/");
  await ready;
  await expect(page.locator(".planning-groups .feature-card")).toHaveCount(
    state.planning.features.length,
  );
  for (const feature of state.planning.features) {
    const card = page.locator(`.planning-groups .feature-card[data-feature-id="${feature.id}"]`);
    const node = page.locator(`.board-shell .react-flow__node[data-id="${feature.id}"]`);
    for (const item of [card, node]) {
      await expect(item.locator(".priority-label")).toHaveText(
        feature.priority || "P 未评估",
      );
      await expect(item.locator(".wave-label")).toHaveText(
        feature.wave || "W 未评估",
      );
    }
    await expect(node.locator(".feature-node-header .badge")).toHaveText(
      feature.status,
    );
    await expect(node).not.toContainText("功能状态");
    const stageProgress = card.locator(".stage-progress");
    await expect(stageProgress).toBeVisible();
    await expect(card.locator(".stages")).toHaveCount(0);
    await stageProgress.hover();
    await expect(stageProgress.locator(".stage-progress-tooltip")).toBeVisible();
  }
  const assessed = state.planning.features.find(
    (feature: any) => feature.analysis && feature.labelHistory?.length,
  );
  expect(assessed).toBeTruthy();
  await page.locator(`.planning-groups .feature-card[data-feature-id="${assessed.id}"]`).click();
  const dialog = page.getByRole("dialog");
  for (const name of [
    "原型推导",
    "开发项目现状",
    "外部系统依据",
    "范围与边界",
    "差距与待核验项",
    "P / W 标签依据",
  ])
    await expect(
      dialog.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  for (const label of ["补充功能疑问", "补充开发要求"])
    await expect(
      dialog.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
  await expect(
    dialog.locator(".feature-detail-top").getByRole("button", {
      name: "指定功能点完整开发",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "功能回答与要求提示词", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.locator(".feature-analysis-section")).toHaveCount(2);
  await expect(dialog.locator(".stages")).toHaveCount(0);
  await expect(dialog.locator(".feature-stage-card")).toHaveCount(
    Object.keys(assessed.stages).length,
  );
  await expect(dialog).toContainText(assessed.priorityReason);
  await expect(dialog).toContainText(assessed.waveReason);
  await dialog
    .getByText(`分析来源（${assessed.analysis.sources.length}）`, {
      exact: true,
    })
    .click();
  for (const source of assessed.analysis.sources)
    await expect(dialog).toContainText(source.ref);
  await dialog
    .getByText(`标签评估记录（${assessed.labelHistory.length}）`, {
      exact: true,
    })
    .click();
  await expect(dialog).toContainText(assessed.labelHistory.at(-1).runId);
  const withHistory = state.planning.features.find(
    (feature: any) => feature.history?.length,
  );
  expect(withHistory).toBeTruthy();
  await page.keyboard.press("Escape");
  await page
    .locator(
      `.planning-groups .feature-card[data-feature-id="${withHistory.id}"]`,
    )
    .click();
  const historyDialog = page.getByRole("dialog");
  const history = historyDialog.locator(".feature-history");
  await expect(history).not.toHaveAttribute("open", "");
  await expect(history.locator(".feature-history-card").first()).not.toBeVisible();
  await history.locator("summary").click();
  await expect(history).toHaveAttribute("open", "");
  await expect(historyDialog.locator(".feature-history-card")).toHaveCount(
    withHistory.history.length,
  );
  await expect(historyDialog.locator(".feature-history-card pre")).toHaveCount(
    0,
  );
  await expect(historyDialog).toContainText(withHistory.history[0].summary);
});

test("完整页面、功能详情、原型文档及截图在 Next 中可用", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const state = await (await request.get("/api/state")).json();
  // 真实工作区传播图走 buildGraph 纯读计算；先请求一次预热路由并核对确已建图
  const graphApi = await (await request.get("/api/graph")).json();
  expect(graphApi.counts.nodes).toBeGreaterThan(0);
  expect(graphApi.nodes.some((node: any) => node.kind === "feature")).toBe(true);
  const ready = page.waitForResponse((response) => /\/api\/state\/?$/.test(new URL(response.url()).pathname) && response.ok(), { timeout: 20000 });
  await page.goto("/");
  await ready;
  // 功能点依赖画板（.board-shell）与 M4 变更传播图共用 react-flow，功能画板节点数才等于功能点数
  const board = page.locator(".board-shell");
  await expect(board.locator(".react-flow__node")).toHaveCount(
    state.planning.features.length,
  );
  for (const name of [
    "项目卡片",
    "PRD 分析",
    "原型图分析",
    "原型分组",
    "系统卡片",
    "功能点看板",
    "功能点分组列表",
    "变更传播图",
    "运行历史",
  ])
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  // 图区标题带实时计数，用正则匹配
  await expect(
    page.getByRole("heading", { name: /变更传播图 · \d+ 节点 \/ \d+ 边/ }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator("iframe")).toHaveCount(0);
  const prototype = page
    .locator("section.section-card")
    .filter({
      has: page.getByRole("heading", { name: "原型图分析", exact: true }),
    })
    .first();
  await expect(
    prototype.locator(".feature-card, .stages, .feature-dependencies"),
  ).toHaveCount(0);
  // native 报告卡内嵌的是分组卡片与分析需求预览；完整报告正文只在对应对话框里出现，不外泄成行内 h1
  await expect(
    prototype.getByRole("heading", { name: "原型分析报告", exact: true }),
  ).toHaveCount(0);
  // native 目录：分组/入口计数来自 /api/state 的 counts 汇总
  await expect(prototype.locator(".prototype-report-metrics")).toContainText(
    `${state.prototype.counts.group} 个分组 · ${state.prototype.counts.entry} 个入口`,
  );
  const card = page
    .locator(".planning-groups .feature-card")
    .filter({
      hasText:
        state.planning.features.find(
          (feature: any) => feature.sourceScreenshots?.length,
        )?.id || state.planning.features[0].id,
    })
    .first();
  await card.click();
  const dialog = page.getByRole("dialog");
  for (const name of [
    "功能说明",
    "关联原型入口",
    "来源截图",
    "依赖功能",
    "功能疑问",
    "开发要求",
  ])
    await expect(
      dialog.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  const coreBlockHeadings = (await dialog.locator("h3").allTextContents()).filter(
    (name) =>
      [
        "功能说明",
        "关联原型入口",
        "来源截图",
        "功能分析",
        "P / W 标签依据",
        "依赖功能",
        "功能疑问",
        "开发要求",
        "交付阶段",
      ].includes(name),
  );
  expect(coreBlockHeadings).toEqual([
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
    dialog.getByRole("button", { name: "指定功能点完整开发" }),
  ).toBeVisible();
  const shot = dialog.locator(".evidence-thumb").first();
  await shot.click();
  await expect
    .poll(() =>
      page
        .getByRole("dialog")
        .last()
        .locator(".full-image")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  // native 目录：完整报告经“查看完整分析报告”按需打开（截图逐证的精确校验见报告文档专项）
  await page
    .getByRole("button", { name: "查看完整分析报告", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").locator(".markdown h1").first(),
  ).toContainText("原型分析报告");
  await expect(
    page.getByRole("dialog").getByRole("navigation", { name: "文档目录" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("依赖自上而下布局，拖拽、缩放和视口在刷新与轮询后保留", async ({ page, request }) => {
  const ready = page.waitForResponse((response) => /\/api\/state\/?$/.test(new URL(response.url()).pathname) && response.ok(), { timeout: 20000 });
  await page.goto("/");
  await ready;
  const board = page.locator(".board-shell");
  await board.scrollIntoViewIfNeeded();
  // M4 变更传播图与功能画板共用 react-flow，节点查询必须限定在功能画板内
  const node = board.locator(".react-flow__node").first();
  await expect(node).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).find((key) =>
          key.startsWith("mf-dev-flow:dependency-board"),
        ),
      ),
    )
    .toBeTruthy();
  // 等自动布局彻底稳定（fitAllNodes 在 120ms 定时器后才落位）再取基准 transform
  await expect
    .poll(
      async () => {
        const a = await node.evaluate((element: HTMLElement) => element.style.transform);
        await page.waitForTimeout(400);
        const b = await node.evaluate((element: HTMLElement) => element.style.transform);
        return a === b ? a : "__settling__";
      },
      { timeout: 10000 },
    )
    .not.toBe("__settling__");
  const original = await node.evaluate(
    (element: HTMLElement) => element.style.transform,
  );
  const state = await (await request.get("/api/state")).json();
  const positions = await board.locator(".react-flow__node").evaluateAll((elements) =>
    Object.fromEntries(elements.map((element) => {
      const node = element as HTMLElement;
      const transform = new DOMMatrixReadOnly(node.style.transform);
      return [node.dataset.id, { x: transform.m41, y: transform.m42, height: node.offsetHeight }];
    })),
  );
  for (const feature of state.planning.features) {
    for (const dependency of feature.dependsOn ?? []) {
      if (!positions[dependency]) continue;
      expect(positions[feature.id].y).toBeGreaterThan(
        positions[dependency].y + positions[dependency].height,
      );
    }
  }
  const box = await node.boundingBox();
  if (!box) throw new Error("缺少画板节点");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 65,
    box.y + box.height / 2 + 40,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect
    .poll(() =>
      node.evaluate((element: HTMLElement) => element.style.transform),
    )
    .not.toBe(original);
  const savedViewport = () =>
    page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem(
            Object.keys(localStorage).find((key) =>
              key.startsWith("mf-dev-flow:dependency-board"),
            )!,
          ) || "{}",
        ).viewport,
    );
  const beforeZoom = await savedViewport();
  await board.getByLabel("Zoom In").click();
  await expect
    .poll(async () => (await savedViewport())?.zoom)
    .toBeGreaterThan(beforeZoom.zoom);
  const pane = await board.boundingBox();
  if (!pane) throw new Error("缺少画板区域");
  await page.mouse.move(pane.x + 25, pane.y + 25);
  const beforePan = await savedViewport();
  await page.mouse.down();
  await page.mouse.move(pane.x + 70, pane.y + 45, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await savedViewport())?.x)
    .not.toBe(beforePan.x);
  const beforeWheel = await savedViewport();
  await page.mouse.wheel(0, -100);
  await expect
    .poll(async () => (await savedViewport())?.zoom)
    .toBeGreaterThan(beforeWheel.zoom);
  const layout = await page.evaluate(() =>
    localStorage.getItem(
      Object.keys(localStorage).find((key) =>
        key.startsWith("mf-dev-flow:dependency-board"),
      )!,
    ),
  );
  const position = await node.evaluate(
    (element: HTMLElement) => element.style.transform,
  );
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect
    .poll(() =>
      node.evaluate((element: HTMLElement) => element.style.transform),
    )
    .toBe(position);
  await page.reload();
  // reload 后容器宽度可能因 M4 新区块改变滚动条而变化，绝对 transform 会平移；
  // “用户布局是否被保留”以下面 localStorage 存档字符串为准（与刷新前的 transform 断言共同覆盖跨刷新/轮询保留）。
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem(
          Object.keys(localStorage).find((key) =>
            key.startsWith("mf-dev-flow:dependency-board"),
          )!,
        ),
      ),
    )
    .toBe(layout);
  // 恢复自动布局要跨 reload/滚动条宽度变化，绝对 transform 不可比；改为「重置幂等」自证：
  // 记录重置后的落位，拖拽一个节点后再重置，必须回到同一稳定值。
  await page.getByRole("button", { name: "恢复自动布局" }).click();
  // 重置后 fitAllNodes 在 120ms 定时器才落位，稳定后再取基准
  await expect
    .poll(
      async () => {
        const a = await node.evaluate((element: HTMLElement) => element.style.transform);
        await page.waitForTimeout(400);
        const b = await node.evaluate((element: HTMLElement) => element.style.transform);
        return a === b ? a : "__settling__";
      },
      { timeout: 10000 },
    )
    .not.toBe("__settling__");
  const resetPosition = await node.evaluate(
    (element: HTMLElement) => element.style.transform,
  );
  const resetBox = await node.boundingBox();
  if (!resetBox) throw new Error("缺少节点");
  await page.mouse.move(resetBox.x + resetBox.width / 2, resetBox.y + resetBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resetBox.x + resetBox.width / 2 + 30, resetBox.y + resetBox.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(() =>
      node.evaluate((element: HTMLElement) => element.style.transform),
    )
    .not.toBe(resetPosition);
  await page.getByRole("button", { name: "恢复自动布局" }).click();
  await expect
    .poll(() =>
      node.evaluate((element: HTMLElement) => element.style.transform),
    )
    .toBe(resetPosition);
  // 数据变更后自动布局会按新内容重新推导节点位置；这里守护的是「用户视口不被后台刷新覆盖」
  const viewportBeforePoll = await savedViewport();
  const firstNodeId = await node.getAttribute("data-id");
  await page.route(/\/api\/state\/?(\?.*)?$/, async (route) => {
    try {
      const response = await route.fetch();
      const data = await response.json();
      const target =
        (data.planning.features as any[]).find((feature: any) => feature.id === firstNodeId) ??
        data.planning.features[0];
      target.title = "功能状态轮询已更新";
      // route.fulfill 无 json 选项；直接给 body 才能真正替换上游响应
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    } catch {
      // 请求被页面中断时静默放行，避免 route callback 抛出未捕获异常
      await route.fallback().catch(() => {});
    }
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  // fresh=1 绕过服务端缓存且要枚举全部 run，叠加拦截器二次 fetch，给足 15s
  await expect(node).toContainText("功能状态轮询已更新", { timeout: 15000 });
  await expect.poll(() => savedViewport()).toEqual(viewportBeforePoll);
});

test("运行筛选、历史文档、API 参数和文件边界", async ({ page, request }) => {
  await page.goto("/");
  const state = await (await request.get("/api/state")).json();
  // dev 冷编译大运行的 /api/run 偶发 ECONNRESET：显式预热路由并对传输错误做有界重试（不改语义）
  const getRunDetail = async (type: string, id: string) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await request.get(`/api/run/?type=${type}&id=${encodeURIComponent(id)}`, { timeout: 30000 });
        if (response.ok()) return await response.json();
        lastError = new Error(`status ${response.status()}`);
      } catch (error) { lastError = error; }
      await page.waitForTimeout(500);
    }
    throw lastError;
  };
  for (const type of ["prototype", "refinement", "system", "delivery"]) {
    const run = state.runs.find((r: any) => r.type === type);
    if (!run) continue;
    const detail = await getRunDetail(type, run.id);
    expect(detail.run.id).toBe(run.id);
    await page.getByLabel("运行类型").selectOption(type);
    const item = page.locator(".run-item").filter({ hasText: run.id });
    await item.locator(".run-select").click();
    // 首次打开运行详情要经 /api/run（dev 下冷编译可能超过默认 5s）
    await expect(page.locator(".run-detail > .row code")).toHaveText(run.id, { timeout: 15000 });
    await expect(page.getByRole("tab").first()).toBeVisible();
  }
  expect((await request.get("/api/run")).status()).toBe(400);
  expect(
    (await request.get("/api/run?type=delivery&id=..%2Fproject")).status(),
  ).toBe(400);
  expect((await request.get("/files?path=..%2Fpackage.json")).status()).toBe(
    404,
  );
  expect((await request.post("/api/state", { data: {} })).status()).toBe(405);
  expect((await request.get("/board/")).status()).toBe(404);
});

test("PRD 分析独立成区显示两卡片，分析需求与分析历史并入原型图流程卡片", async ({ page, request }) => {
  const state = await (await request.get("/api/state")).json();
  const prd = state.prd;
  await page.goto("/");
  // 首屏状态要等 /api/state 返回；dev 冷编译可能超过默认 expect 超时。
  await page.waitForResponse(
    (response) =>
      /\/api\/state\/?$/.test(new URL(response.url()).pathname) &&
      response.ok(),
    { timeout: 20000 },
  );
  const prototype = page
    .locator(".section-card")
    .filter({ has: page.getByRole("heading", { name: "原型图分析", exact: true }) });
  const block = page
    .locator(".section-card")
    .filter({ has: page.getByRole("heading", { name: "PRD 分析", exact: true }) });
  // PRD 是独立区块，不再嵌在原型图分析里，且排在原型图分析之上。
  await expect(block).toHaveCount(1);
  await expect(prototype.locator(".prd-doc-card")).toHaveCount(0);
  const sectionTitles = await page
    .locator(".section-card .section-head h2")
    .allInnerTexts();
  expect(sectionTitles.indexOf("PRD 分析")).toBeGreaterThanOrEqual(0);
  expect(sectionTitles.indexOf("PRD 分析")).toBeLessThan(
    sectionTitles.indexOf("原型图分析"),
  );
  // 分析需求与分析历史展示在「完整原型图流程」报告卡片内部。
  await expect(
    prototype.locator(".prototype-report-card [aria-label='分析需求']"),
  ).toBeVisible();
  await expect(
    prototype.locator(".prototype-report-card [aria-label='分析历史']"),
  ).toBeVisible();
  if (!prd?.batch?.check?.ok || !prd.batch.documents.contradictions.exists) {
    await expect(block.locator(".prd-doc-card")).toHaveCount(1);
    await expect(
      block.getByRole("heading", { name: "PRD 分析尚未建立" }),
    ).toBeVisible();
    return;
  }
  const batch = prd.batch;
  await expect(block.locator(".prd-doc-card")).toHaveCount(2);
  const contradiction = block
    .locator(".prd-doc-card")
    .filter({ hasText: "矛盾与不清楚清单" });
  const redline = block
    .locator(".prd-doc-card")
    .filter({ hasText: "核心原则与红线证据索引" });
  await expect(contradiction).toContainText(
    `关联来源 ${batch.usedSourceCount} 篇`,
  );
  await expect(contradiction.locator(".badge")).toHaveText(/证据核验通过/);
  await expect(redline).toContainText(
    `高 ${batch.documents.redlines.tally.high} / 中 ${batch.documents.redlines.tally.medium}`,
  );
  await expect(redline).toContainText(batch.id);
  await contradiction.getByRole("button", { name: "查看会议文档" }).click();
  const document = page.locator(".dialog-content:not(.prompt-dialog)");
  await expect(document.locator(".markdown h1")).toContainText(
    "PRD 矛盾与不清楚清单",
  );
  await expect(document.locator(".markdown blockquote").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await contradiction.getByRole("button", { name: "核验并更新分析" }).click();
  const preview = page.locator(".prompt-dialog");
  await expect(preview.locator(".prompt-preview")).toContainText(
    `prd check --batch ${batch.id}`,
  );
  await page.keyboard.press("Escape");
});
