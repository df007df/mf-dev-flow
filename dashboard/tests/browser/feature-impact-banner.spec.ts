import { test, expect } from "@playwright/test";

const state = {
  generatedAt: "2026-10-26T08:00:00.000Z",
  project: { project: { name: "旅行清单示例" } },
  current: { active: null },
  summary: { runs: 1, activeRuns: 0, tasks: { done: 1 } },
  prototype: { native: false, status: "ready", groups: [], coverage: { total: 0, covered: 0 } },
  planning: {
    groups: [{ id: "trip-preparation", title: "旅行准备", rank: 1 }],
    features: [{
      id: "trip-list-filter",
      title: "按完成状态筛选清单",
      parentId: "trip-preparation",
      status: "done",
      planningStatus: "review_required",
      priority: 1,
      dependsOn: [],
      stages: {},
      blockers: ["原型变更待复评：需先核对范围、状态、依赖与 P/W，不能继续旧规划开发。"],
    }],
    actionable: [],
    prototypeImpact: {
      status: "review_required",
      global: true,
      changedGroupIds: ["trip-groups", "trip-list"],
      changedEntryIds: ["trip-groups-default", "trip-list-default"],
      affected: [{
        id: "trip-list-filter",
        status: "done",
        reasons: ["prototype_entry_changed", "prototype_group_changed"],
      }],
    },
  },
  system: { cards: [] },
  projectCards: [],
  runs: [],
};

test("功能分组区在原型变化后直接展示影响复评摘要", async ({ page }) => {
  await page.route((url) => url.pathname.replace(/\/$/, "") === "/api/state", async (route) => {
    await route.fulfill({ json: state });
  });
  await page.route((url) => url.pathname.replace(/\/$/, "") === "/api/graph", async (route) => {
    await route.fulfill({ json: { counts: { nodes: 0, edges: 0 }, nodes: [], edges: [], problems: [] } });
  });

  await page.goto("/");

  const impact = page.getByRole("region", { name: "功能变更影响" });
  await expect(impact.getByRole("heading", { name: "变更影响待复评" })).toBeVisible();
  await expect(impact).toContainText("2 个原型分组变化");
  await expect(impact).toContainText("2 个原型入口变化");
  await expect(impact).toContainText("按完成状态筛选清单");
  await expect(impact).toContainText("原型入口变化");
  await expect(impact).toContainText("原型分组变化");
});
