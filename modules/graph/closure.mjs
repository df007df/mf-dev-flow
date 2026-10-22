// 泛化传播闭包（M2）：把 change-impact 的"反查→parent 后代→dependsOn 反向→不动点"提炼为类型无关算法。
// 除 evidence-for 外，传播边方向约定统一为"依赖方 → 被依赖方"（scope-ref/parent/depends-on/sourced-from），
// 因此"受影响者"恒等于指向当前节点的入边另一端；evidence-for 数据方向是"来源 → 被支持实体"（M2 §3.1），
// 遍历时对调 hub。task/code 是记录终点，不参与置脏传播。只读、不建运行；输出含路径供审计。
import { PROPAGATION_KINDS, SINK_PREFIXES } from "./graph.mjs";

const INVERTED_KINDS = new Set(["evidence-for"]);

function indexEdges(graph, direction) {
  const map = new Map();
  for (const edge of graph.edges) {
    const inverted = INVERTED_KINDS.has(edge.kind);
    let hub, spoke;
    if (direction === "dependents") {
      if (!PROPAGATION_KINDS.has(edge.kind)) continue;
      [hub, spoke] = inverted ? [edge.from, edge.to] : [edge.to, edge.from];
      if (SINK_PREFIXES.has(String(spoke).split(":")[0])) continue;
    } else {
      [hub, spoke] = inverted ? [edge.to, edge.from] : [edge.from, edge.to];
    }
    if (!map.has(hub)) map.set(hub, []);
    map.get(hub).push({ node: spoke, edge });
  }
  for (const list of map.values()) list.sort((a, b) => (a.node < b.node ? -1 : 1));
  return map;
}

export function validateSeeds(graph, seeds) {
  const known = new Set(graph.nodes.map(node => node.ref));
  return seeds.filter(ref => !known.has(ref));
}

/** dependents：谁受影响（置脏传播）；sources：影响源自哪里（git 圈范围/看板下钻方向）。 */
export function closure(graph, seeds, { direction = "dependents", maxNodes = 500 } = {}) {
  const unknown = validateSeeds(graph, seeds);
  if (unknown.length) return { problems: unknown.map(ref => `种子引用不在图中：${ref}`), affected: [] };
  const adjacency = indexEdges(graph, direction);
  const nodeKinds = new Map(graph.nodes.map(node => [node.ref, node.kind]));
  const visited = new Set(seeds);
  const queue = seeds.map(ref => ({ ref, origin: ref, depth: 0, path: [] }));
  const affected = [];
  while (queue.length && affected.length < maxNodes) {
    const current = queue.shift();
    for (const { node, edge } of adjacency.get(current.ref) ?? []) {
      if (visited.has(node)) continue;
      visited.add(node);
      const entry = {
        ref: node,
        kind: nodeKinds.get(node) ?? null,
        origin: current.origin,
        depth: current.depth + 1,
        via: edge.id,
        edgeKind: edge.kind,
        reason: `${current.origin} → (${edge.kind}@depth${current.depth + 1}) → ${node}`,
      };
      affected.push(entry);
      queue.push({ ref: node, origin: current.origin, depth: current.depth + 1, path: [...current.path, edge.id] });
    }
  }
  affected.sort((a, b) => a.depth - b.depth || (a.ref < b.ref ? -1 : 1));
  return { problems: [], affected, truncated: visited.size > maxNodes };
}
