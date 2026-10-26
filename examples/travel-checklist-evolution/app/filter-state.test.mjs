import assert from "node:assert/strict";
import test from "node:test";

import { deriveFilterView, toggleFilter } from "./filter-state.mjs";

const items = [
  { id: "hotel", group: "before", done: true },
  { id: "map", group: "before", done: false },
  { id: "passport", group: "before", done: true },
  { id: "boarding", group: "during", done: true },
];

test("默认状态按两个阶段组织四项清单", () => {
  const initial = deriveFilterView(items, false);
  assert.deepEqual(initial.visibleIds, ["hotel", "map", "passport", "boarding"]);
  assert.deepEqual(initial.groups, [
    { id: "before", visibleIds: ["hotel", "map", "passport"] },
    { id: "during", visibleIds: ["boarding"] },
  ]);
  assert.equal(initial.resultText, "显示 4 / 4 项");
  assert.deepEqual(initial.summary, { visibleCount: 4, completedCount: 3, totalCount: 4 });
  assert.equal(initial.buttonText, "仅看已完成");
});

test("跨分组筛选和恢复保持两个阶段", () => {
  const completedOnly = deriveFilterView(items, toggleFilter(false));
  assert.deepEqual(completedOnly.visibleIds, ["hotel", "passport", "boarding"]);
  assert.deepEqual(completedOnly.groups, [
    { id: "before", visibleIds: ["hotel", "passport"] },
    { id: "during", visibleIds: ["boarding"] },
  ]);
  assert.equal(completedOnly.resultText, "显示 3 / 4 项");
  assert.deepEqual(completedOnly.summary, { visibleCount: 3, completedCount: 3, totalCount: 4 });
  assert.equal(completedOnly.buttonText, "显示全部项目");

  const restored = deriveFilterView(items, toggleFilter(true));
  assert.deepEqual(restored, deriveFilterView(items, false));
});

test("进度摘要随当前筛选结果同步更新", () => {
  assert.equal(deriveFilterView(items, false).summary.completedCount, 3);
  assert.deepEqual(deriveFilterView(items, true).summary, {
    visibleCount: 3,
    completedCount: 3,
    totalCount: 4,
  });
});
