import { test, expect } from "@playwright/test";

// M4 看板区块（变更传播图）的浏览器契约：/api/state、/api/graph 全部 mock，
// 只验证渲染与交互，不依赖真实工作区的数据状态。
const state = {
  generatedAt: "2026-09-08T10:00:00.000Z",
  project: { project: { name: "M4 看板区块夹具" } },
  current: { active: null },
  summary: { runs: 0, activeRuns: 0, tasks: {} },
  prototype: { native: false, status: "blocked", groups: [], coverage: { total: 0, covered: 0 } },
  planning: { groups: [], features: [], actionable: [] },
  system: { cards: [] },
  projectCards: [],
  runs: [],
};

const graph = {
  schemaVersion: 1,
  counts: { nodes: 6, edges: 5 },
  nodes: [
    { ref: "prd:alpha", kind: "prd-source", label: "隔离PRD", fingerprint: null, reassessment: [] },
    { ref: "prototype:home", kind: "prototype-group", label: "首页分组", fingerprint: "f1", reassessment: [{ triggerRef: "prd:alpha", status: "open" }] },
    { ref: "prototype:home-entry", kind: "prototype-entry", label: "首页入口", fingerprint: null, reassessment: [] },
    { ref: "feature:login", kind: "feature", label: "登录功能", fingerprint: null, reassessment: [] },
    { ref: "feature:pay", kind: "feature", label: "支付功能", fingerprint: null, reassessment: [] },
    { ref: "task:fixture-delivery/login", kind: "task", label: "登录交付", fingerprint: null, reassessment: [] },
  ],
  edges: [
    { id: "e1", from: "prd:alpha", to: "prototype:home", kind: "evidence-for" },
    { id: "e2", from: "prototype:home", to: "prototype:home-entry", kind: "parent" },
    { id: "e3", from: "prototype:home", to: "feature:login", kind: "scope-ref" },
    { id: "e4", from: "prototype:home", to: "feature:pay", kind: "scope-ref" },
    { id: "e5", from: "task:fixture-delivery/login", to: "feature:login", kind: "implements" },
  ],
  problems: [],
  notes: [],
};

const impact = {
  schemaVersion: 1,
  seeds: ["prd:alpha"],
  direction: "dependents",
  affected: [
    { ref: "prototype:home", kind: "prototype-group", origin: "prd:alpha", depth: 1, via: [], reason: "" },
    { ref: "feature:login", kind: "feature", origin: "prd:alpha", depth: 2, via: [], reason: "" },
    { ref: "feature:pay", kind: "feature", origin: "prd:alpha", depth: 2, via: [], reason: "" },
    { ref: "task:fixture-delivery/login", kind: "task", origin: "prd:alpha", depth: 3, via: [], reason: "" },
  ],
  truncated: false,
  dispatchSuggestions: [
    { openTaskType: "feature-impact-review", batching: "per-trigger", autoCreate: false, targets: ["feature:login", "feature:pay"] },
  ],
  note: "只读闭包与建议清单；开启复评任务须走 flow route/claim 授权。",
};

async function mockBoardApis(page: import("@playwright/test").Page) {
  let graphReads = 0;
  await page.route((url) => url.pathname.replace(/\/$/, "") === "/api/graph", async (route) => {
    graphReads += 1;
    const params = new URL(route.request().url()).searchParams;
    if (params.has("impact")) {
      await route.fulfill({ json: impact });
      return;
    }
    if (params.has("svg")) {
      await route.fulfill({ contentType: "image/svg+xml; charset=utf-8", body: "<svg xmlns='http://www.w3.org/2000/svg'></svg>" });
      return;
    }
    await route.fulfill({ json: graph });
  });
  await page.route((url) => url.pathname.replace(/\/$/, "") === "/api/state", async (route) => {
    await route.fulfill({ json: state });
  });
  return { reads: () => graphReads };
}

test("变更传播图：画布渲染、种子追踪闭包、只读建议与 SVG 导出", async ({ page }) => {
  const mock = await mockBoardApis(page);
  await page.goto("/");
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: /变更传播图/ }) });
  await expect(section.getByRole("heading", { name: "变更传播图 · 6 节点 / 5 边", exact: true })).toBeVisible();
  await expect(section.locator(".react-flow__node")).toHaveCount(6);
  const seedNode = section.locator('.react-flow__node[data-id="prd:alpha"]');
  await expect(seedNode).toContainText("隔离PRD · prd-source");
  // 有未清复评触发的节点要在画布上直接可见
  await expect(section.locator('.react-flow__node[data-id="prototype:home"]')).toContainText("·有未清触发");

  await section.getByRole("combobox").selectOption("prd:alpha");
  await section.getByRole("button", { name: "追踪影响闭包", exact: true }).click();
  await expect(section.getByText("受影响 4 个：", { exact: false })).toBeVisible();
  await expect(section.getByText("feature:login ← prd:alpha（depth 2）")).toBeVisible();
  const suggestion = section.getByText(/建议：对 2 个功能点开/);
  await expect(suggestion).toContainText("feature-impact-review");
  await expect(suggestion).toContainText("per-trigger");
  await expect(suggestion).toContainText("autoCreate=false");
  // 种子与受影响节点在画布上高亮（浏览器会把十六进制色序列化成 rgb()）
  await expect(seedNode).toHaveAttribute("style", /border:\s*3px solid rgb\(15,\s*23,\s*42\)/);
  await expect(section.locator('.react-flow__node[data-id="feature:pay"]')).toHaveAttribute("style", /border:\s*3px solid rgb\(250,\s*204,\s*21\)/);
  await expect(section.locator('.react-flow__node[data-id="prototype:home-entry"]')).toHaveAttribute("style", /opacity:\s*0\.25/);
  // SVG 导出是只读下载链接，指向当前种子
  await expect(section.getByRole("link", { name: "导出 SVG" })).toHaveAttribute("href", /svg=prd%3Aalpha/);

  // 点画布节点即选种子，并清空上一轮闭包结果
  await section.locator('.react-flow__node[data-id="prototype:home"]').click();
  await expect(section.getByRole("combobox")).toHaveValue("prototype:home");
  await expect(section.getByText("受影响 4 个：", { exact: false })).toHaveCount(0);

  // 重新读取会再拉一次快照（计数包含上方的种子/画布渲染读取）
  const before = mock.reads();
  await section.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect.poll(() => mock.reads()).toBeGreaterThan(before);
});
