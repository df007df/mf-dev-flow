"use client";
// 变更传播图区（M4）：只读画布。点选种子节点 → 追踪 dependents 闭包并高亮，
// 展示 TaskType dispatch 建议（只建议不建运行）；SVG 导出走 /api/graph?svg=。
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CopyButton } from "./ui";

type GraphNode = {
  ref: string;
  objectRef?: string | null;
  kind: string;
  label: string | null;
  fingerprint: string | null;
  reassessment: { triggerRef: string; status: string }[];
};
type GraphEdge = { id: string; from: string; to: string; kind: string };
type GraphData = {
  counts?: { nodes: number; edges: number };
  nodes: GraphNode[];
  edges: GraphEdge[];
  problems?: string[];
  notes?: string[];
};
type ImpactData = {
  problems?: string[];
  affected?: { ref: string; kind: string; origin: string; depth: number; reason: string }[];
  dispatchSuggestions?: { openTaskType: string; batching: string; autoCreate: boolean; targets: string[] }[];
  note?: string;
};

const KIND_COLUMN: Record<string, number> = {
  "prd-source": 0,
  "system-card": 0,
  "prototype-group": 1,
  "prototype-entry": 1,
  "prototype-source-file": 1,
  feature: 2,
  "feature-group": 2,
  task: 3,
  "code-file": 3,
  release: 4,
};
const KIND_COLOR: Record<string, string> = {
  "prd-source": "#7c3aed",
  "system-card": "#db2777",
  "prototype-group": "#d97706",
  "prototype-entry": "#f59e0b",
  feature: "#059669",
  "feature-group": "#10b981",
  task: "#2563eb",
  "code-file": "#64748b",
};

export function GraphSection() {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState("");
  const [seed, setSeed] = useState("");
  const [impact, setImpact] = useState<ImpactData | null>(null);
  const [tracing, setTracing] = useState(false);
  const selectedNode = data?.nodes.find((node) => node.ref === seed) ?? null;

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/graph", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法读取变更传播图");
      setData(payload);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const trace = useCallback(async () => {
    if (!seed) return;
    setTracing(true);
    try {
      const response = await fetch(`/api/graph?impact=${encodeURIComponent(seed)}`, { cache: "no-store" });
      setImpact(await response.json());
    } finally {
      setTracing(false);
    }
  }, [seed]);

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [] as Node[], edges: [] as Edge[] };
    const highlighted = new Set((impact?.affected ?? []).map((item) => item.ref));
    const affected = impact && highlighted.size > 0;
    const rows: Record<number, number> = {};
    const flowNodes: Node[] = data.nodes.map((node) => {
      const column = KIND_COLUMN[node.kind] ?? 5;
      rows[column] = (rows[column] ?? 0) + 1;
      const isSeed = node.ref === seed;
      const inImpact = highlighted.has(node.ref);
      return {
        id: node.ref,
        position: { x: column * 300, y: rows[column] * 66 },
        data: { label: `${node.label ?? node.ref} · ${node.kind}${node.reassessment?.some((t) => t.status === "open") ? " ·有未清触发" : ""}` },
        style: {
          width: 250,
          fontSize: 11,
          padding: 6,
          background: KIND_COLOR[node.kind] ?? "#334155",
          color: "#f8fafc",
          border: isSeed ? "3px solid #0f172a" : inImpact ? "3px solid #facc15" : "1px solid transparent",
          opacity: affected && !inImpact && !isSeed ? 0.25 : 1,
        },
      };
    });
    const member = new Set(flowNodes.map((node) => node.id));
    const flowEdges: Edge[] = data.edges
      .filter((edge) => member.has(edge.from) && member.has(edge.to))
      .map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.kind,
        style: { stroke: "#94a3b8" },
        labelStyle: { fontSize: 9, fill: "#64748b" },
      }));
    return { nodes: flowNodes, edges: flowEdges };
  }, [data, impact, seed]);

  if (error)
    return (
      <section className="board" style={{ padding: 16 }}>
        <h2>变更传播图</h2>
        <p role="alert" className="error-banner">{error}（真实工作区先在仓库根执行 graph build）</p>
      </section>
    );
  if (!data) return <section style={{ padding: 16 }}><h2>变更传播图</h2><p className="empty">读取中…</p></section>;

  return (
    <section className="board" style={{ padding: 16 }}>
      <h2>变更传播图 · {data.counts?.nodes ?? 0} 节点 / {data.counts?.edges ?? 0} 边</h2>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
        <select value={seed} onChange={(e) => { setSeed(e.target.value); setImpact(null); }} style={{ maxWidth: 320 }}>
          <option value="">选择种子节点（来源/分组/功能点…）</option>
          {data.nodes.map((node) => (
            <option key={node.ref} value={node.ref}>
              {node.kind} · {node.label ?? node.ref}
            </option>
          ))}
        </select>
        <button className="button" type="button" disabled={!seed || tracing} onClick={() => void trace()}>追踪影响闭包</button>
        <button className="button" type="button" onClick={() => void load()}>重新读取</button>
        {seed && (
          <a href={`/api/graph?svg=${encodeURIComponent(seed)}`} download={`graph-${seed.replace(/[^a-z0-9]/gi, "-")}.svg`}>导出 SVG</a>
        )}
        {selectedNode?.objectRef && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <code>{selectedNode.objectRef}</code>
            <CopyButton label="复制引用" text={selectedNode.objectRef} />
          </span>
        )}
      </div>
      {(data.problems ?? []).length > 0 && (
        <p style={{ color: "#b45309", fontSize: 12 }}>构建问题 {data.problems!.length} 条：{data.problems!.slice(0, 3).join("；")}{data.problems!.length > 3 ? "…" : ""}</p>
      )}
      <div style={{ height: 420, border: "1px solid #e2e8f0", borderRadius: 10 }}>
        <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.2} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} onNodeClick={(_e, node) => { setSeed(String(node.id)); setImpact(null); }}>
          <Background gap={18} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {impact?.problems && <p role="alert" style={{ color: "#b91c1c", fontSize: 12 }}>{impact.problems.join("；")}</p>}
      {impact && (impact.affected ?? []).length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <strong>受影响 {impact.affected!.length} 个：</strong>
          <ul style={{ margin: "4px 0 8px 18px" }}>
            {impact.affected!.slice(0, 20).map((item) => (
              <li key={item.ref}>{item.ref} ← {item.origin}（depth {item.depth}）</li>
            ))}
          </ul>
          {(impact.dispatchSuggestions ?? []).map((suggestion) => (
            <p key={suggestion.openTaskType} style={{ margin: "4px 0" }}>
              建议：对 {suggestion.targets.length} 个功能点开 <code>{suggestion.openTaskType}</code>（{suggestion.batching}，autoCreate=false）——开启须走 flow route/claim 授权
            </p>
          ))}
          {impact.note && <p style={{ color: "#64748b" }}>{impact.note}</p>}
        </div>
      )}
    </section>
  );
}
