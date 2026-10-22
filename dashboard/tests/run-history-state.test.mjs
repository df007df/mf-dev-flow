import assert from "node:assert/strict";
import test from "node:test";
import { runHistoryView } from "../app/components/run-history-state.js";

const runs = [
  { id: "delivery-current", type: "delivery", title: "正在开发", status: "in_progress" },
  { id: "refinement-blocked", type: "refinement", title: "等待决策的规划", status: "blocked" },
  { id: "refinement-current", type: "refinement", title: "当前功能地图来源", status: "done" },
  { id: "refinement-old-done", type: "refinement", title: "旧完成规划", status: "done" },
  { id: "refinement-old-skipped", type: "refinement", title: "旧跳过规划", status: "skipped" },
  { id: "prototype-done", type: "prototype", title: "原型历史", status: "done" },
];

test("全部运行默认收起非当前的终态功能演进快照", () => {
  const view = runHistoryView({
    runs,
    currentMapSource: "refinement-current",
    filter: "all",
    showArchivedRefinements: false,
  });

  assert.deepEqual(
    view.runs.map((run) => run.id),
    [
      "delivery-current",
      "refinement-blocked",
      "refinement-current",
      "prototype-done",
    ],
  );
  assert.equal(view.archivedRefinementCount, 2);
});

test("展开后和显式筛选功能演进时均保留完整的规划历史", () => {
  const expanded = runHistoryView({
    runs,
    currentMapSource: "refinement-current",
    filter: "all",
    showArchivedRefinements: true,
  });
  assert.deepEqual(expanded.runs.map((run) => run.id), runs.map((run) => run.id));
  assert.equal(expanded.archivedRefinementCount, 2);

  const refinements = runHistoryView({
    runs,
    currentMapSource: "refinement-current",
    filter: "refinement",
    showArchivedRefinements: false,
  });
  assert.deepEqual(refinements.runs.map((run) => run.id), [
    "refinement-blocked",
    "refinement-current",
    "refinement-old-done",
    "refinement-old-skipped",
  ]);
  assert.equal(refinements.archivedRefinementCount, 2);
});
