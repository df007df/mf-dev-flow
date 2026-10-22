// 看板图读取（M4）：只读复用 modules/graph（buildGraph 为纯读计算，不落盘）。
// HTTP 边界沿用观察台契约：只查询，不执行 CLI 写命令；graph.json 存档读取方是 CLI `graph build`。
import path from "node:path";
import { buildGraph } from "../../../modules/graph/graph.mjs";
import { closure } from "../../../modules/graph/closure.mjs";
import { suggestDispatch } from "../../../modules/graph/dispatch.mjs";
import { renderFocusSvg } from "../../../modules/graph/render.mjs";

export function graphSnapshot(store) {
  const { graph, problems, notes } = buildGraph(path.dirname(store));
  return {
    schemaVersion: 1,
    counts: { nodes: graph.nodes.length, edges: graph.edges.length },
    nodes: graph.nodes,
    edges: graph.edges,
    problems,
    notes,
  };
}

/**
 * @param {string} store
 * @param {{seeds?: string[], direction?: string, limit?: number}} [options]
 */
export function graphImpact(store, { seeds = [], direction = "dependents", limit = 100 } = {}) {
  const snapshot = graphSnapshot(store);
  const result = closure(snapshot, seeds, { direction, maxNodes: limit });
  if (result.problems.length) return { schemaVersion: 1, problems: result.problems };
  return {
    schemaVersion: 1,
    seeds,
    direction,
    affected: result.affected,
    truncated: result.truncated,
    dispatchSuggestions: direction === "dependents" ? suggestDispatch(snapshot, seeds, result.affected) : [],
    note: "只读闭包与建议清单；开启复评任务须走 flow route/claim 授权。",
  };
}

/**
 * @param {string} store
 * @param {{focus: string, depth?: string|number}} options
 */
export function graphSvg(store, { focus, depth = 3 }) {
  const snapshot = graphSnapshot(store);
  return renderFocusSvg(snapshot, focus, { depth: Math.min(Math.max(Number(depth) || 3, 1), 5) });
}
