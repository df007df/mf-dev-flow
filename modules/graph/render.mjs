// graph render（M4）：从焦点节点做 dependents 闭包，按层级列布局导出确定性 SVG。
// 图数据是唯一真相，SVG 是投影产物：无时间戳、同输入字节一致，供复评/发布报告引用。
import { closure } from "./closure.mjs";

const escapeXml = value =>
  String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]));

const KIND_COLORS = {
  "prd-source": "#7c3aed",
  "system-card": "#db2777",
  "prototype-group": "#d97706",
  "prototype-entry": "#f59e0b",
  "prototype-source-file": "#a16207",
  feature: "#059669",
  "feature-group": "#10b981",
  task: "#2563eb",
  "code-file": "#64748b",
  release: "#dc2626",
};

export function renderFocusSvg(graph, focus, { depth = 3, maxNodes = 100 } = {}) {
  const result = closure(graph, [focus], { direction: "dependents", maxNodes });
  if (result.problems.length) throw new Error(result.problems.join("；"));
  const limited = result.affected.filter(item => item.depth <= depth);
  const members = [{ ref: focus, depth: 0 }, ...limited];
  const byDepth = new Map();
  for (const item of members) {
    if (!byDepth.has(item.depth)) byDepth.set(item.depth, []);
    byDepth.get(item.depth).push(item.ref);
  }
  const columns = [...byDepth.keys()].sort((a, b) => a - b);
  const width = 40 + columns.length * 350;
  const rows = Math.max(...columns.map(d => byDepth.get(d).length));
  const height = 110 + rows * 64;
  const positions = new Map();
  for (const [ci, d] of columns.entries())
    for (const [ri, ref] of [...byDepth.get(d)].sort().entries())
      positions.set(ref, { x: 40 + ci * 350, y: 80 + ri * 64 });
  const nodeOf = new Map(graph.nodes.map(node => [node.ref, node]));
  const memberSet = new Set(members.map(item => item.ref));
  const edges = graph.edges
    .filter(edge => memberSet.has(edge.from) && memberSet.has(edge.to))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const boxW = 240, boxH = 46;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#f8fafc"/>`,
    `<text x="40" y="42" font-family="ui-sans-serif,system-ui" font-size="16" fill="#0f172a">graph render · focus ${escapeXml(focus)} · depth≤${depth} · ${members.length} 节点 / ${edges.length} 边</text>`,
  ];
  for (const edge of edges) {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    const x1 = from.x + boxW, y1 = from.y + boxH / 2, x2 = to.x, y2 = to.y + boxH / 2;
    const leftFirst = x1 > x2;
    parts.push(
      `<line x1="${leftFirst ? x2 : x1}" y1="${leftFirst ? y2 : y1}" x2="${leftFirst ? x1 : x2}" y2="${leftFirst ? y1 : y2}" stroke="#94a3b8" stroke-width="1.5"/>`,
      `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 4}" font-size="10" fill="#64748b" text-anchor="middle">${escapeXml(edge.kind)}</text>`,
    );
  }
  for (const ref of [...memberSet].sort()) {
    const at = positions.get(ref);
    const node = nodeOf.get(ref);
    const color = KIND_COLORS[node?.kind ?? ""] ?? "#334155";
    parts.push(
      `<g><rect x="${at.x}" y="${at.y}" width="${boxW}" height="${boxH}" rx="8" fill="${color}"/>`,
      `<text x="${at.x + 12}" y="${at.y + 19}" font-size="12" fill="#f8fafc">${escapeXml((node?.label ?? ref).slice(0, 30))}</text>`,
      `<text x="${at.x + 12}" y="${at.y + 36}" font-size="10" fill="#e2e8f0">${escapeXml(`${node?.kind ?? "unknown"} ${ref}`.slice(0, 36))}</text></g>`,
    );
  }
  parts.push(`</svg>`);
  return `${parts.join("\n")}\n`;
}
