"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PromptButton } from "./ui";
import { featurePrompt } from "../lib/format";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type OnMoveEnd,
  type ReactFlowInstance,
  type Viewport,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Feature } from "../lib/types";
import { FeatureLabels, FeatureAnalysis } from "./feature-analysis";
import { Badge, CopyButton } from "./ui";
import { Maximize2, Minimize2 } from "lucide-react";
import { fileUrl } from "./documents";
import { STORE_DIRECTORY } from "../../../modules/skill-identity.mjs";

type Group = { id: string; ref?: string | null; title: string; rank?: number };
type Planning = {
  sourceRun?: string;
  updatedAt?: string;
  features: Feature[];
  groups: Group[];
};
type DashboardState = {
  project?: { project?: { name?: string } };
  planning?: Planning;
};
type StoredLayout = {
  positions: Record<string, { x: number; y: number }>;
  heights?: Record<string, number>;
  widths?: Record<string, number>;
  shotWidths?: Record<string, number>;
  viewport?: Viewport;
};
type FeatureNodeData = { feature: Feature; shotWidths: Record<string, number>; onImageLoad: (path: string, width: number) => void };

const screenshotColumns = 4;
const screenshotImageHeight = 1072;
const screenshotRowHeight = screenshotImageHeight;
const screenshotGap = 2;
const nodeMinimumWidth = 960;
const nodeMetadataHeight = 480;
const nodeHorizontalInset = 31;
// These are deliberately generous: a fitted graph otherwise makes the default
// layout look like a single dense block, especially once source screenshots
// make cards tall.
const nodeColumnGap = 64;
const nodeRowGap = 160;
const dependencyEdgeColor = "#5f3c9a";
const dependencyEdgeWidth = 2.6;
function shotWidth(path: string, widths: Record<string, number>) {
  return widths[path] ?? screenshotImageHeight / 2;
}
function nodeWidth(feature: Feature, widths: Record<string, number>) {
  const shots = feature.sourceScreenshots ?? [];
  let widest = 0;
  for (let index = 0; index < shots.length; index += screenshotColumns) {
    const row = shots.slice(index, index + screenshotColumns);
    widest = Math.max(widest, row.reduce((sum, shot) => sum + shotWidth(shot.path, widths), 0) + (row.length - 1) * screenshotGap);
  }
  return Math.max(nodeMinimumWidth, widest + nodeHorizontalInset);
}
function nodeHeight(feature: Feature) {
  const rows = Math.ceil((feature.sourceScreenshots?.length ?? 0) / screenshotColumns);
  return rows ? nodeMetadataHeight + rows * screenshotRowHeight + (rows - 1) * screenshotGap : nodeMetadataHeight;
}
const fitOptions = { padding: 0.14, minZoom: 0.05, maxZoom: 1 };

function NodeScreenshot({ shot, width, onImageLoad }: { shot: NonNullable<Feature["sourceScreenshots"]>[number]; width: number; onImageLoad: FeatureNodeData["onImageLoad"] }) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const reportWidth = useCallback(() => {
    const img = image.current;
    if (img?.naturalHeight) onImageLoad(shot.path, screenshotImageHeight * img.naturalWidth / img.naturalHeight);
  }, [shot.path, onImageLoad, screenshotImageHeight]);
  // Reconcile already-loaded images too: live style updates do not fire load again.
  useLayoutEffect(reportWidth, [reportWidth, screenshotImageHeight]);
  return (
    <figure className="feature-node-screenshot" style={{ width }} title={shot.action || shot.entryId}>
      {failed ? <div className="feature-node-image-empty" style={{ height: screenshotImageHeight }}>截图暂不可用</div> : (
        <img ref={image} src={fileUrl(shot.path)} alt={shot.action || `${shot.entryId} 来源截图`}
          width={width} height={screenshotImageHeight}
          loading="lazy" draggable={false} onError={() => setFailed(true)}
          onLoad={reportWidth} />
      )}
    </figure>
  );
}

function statusClass(status: string) {
  if (["done", "completed", "完成"].includes(status)) return "done";
  if (status === "blocked") return "blocked";
  return "active";
}

function FeatureNode({ data, selected }: NodeProps<Node<FeatureNodeData>>) {
  const feature = data.feature;
  const kind = feature.kind === "technical" ? "technical" : "product";
  return (
    <div
      className={`feature-node ${statusClass(feature.status)} kind-${kind} ${selected ? "selected" : ""}`}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="feature-node-header">
        <strong title={feature.title}>{feature.title}</strong>
        <Badge status={feature.status} />
      </div>
      <code>{feature.id}</code>
      <FeatureLabels feature={feature} />
      <div className="feature-node-status">
        <span>{feature.dependsOn?.length ?? 0} 项前置</span>
        <span>来源截图 {feature.sourceScreenshots?.length ?? 0} 张</span>
      </div>
      {feature.sourceScreenshots?.length ? (
        <div className="feature-node-screenshots" style={{ gap: screenshotGap }}
          role="region" aria-label={`${feature.title}全部来源截图`}>
          {Array.from({ length: Math.ceil(feature.sourceScreenshots.length / screenshotColumns) }, (_, row) => (
            <div className="feature-node-screenshot-row" style={{ gap: screenshotGap }} key={row}>
              {feature.sourceScreenshots!.slice(row * screenshotColumns, (row + 1) * screenshotColumns).map((shot, index) => (
                <NodeScreenshot key={`${shot.path}:${index}`} shot={shot} width={shotWidth(shot.path, data.shotWidths)} onImageLoad={data.onImageLoad} />
              ))}
            </div>
          ))}
        </div>
      ) : <div className="feature-node-image-empty">暂无关联来源截图</div>}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { feature: FeatureNode };

function ordered<T extends { rank?: number; id: string }>(items: T[]) {
  return [...items].sort(
    (left, right) =>
      (left.rank ?? Number.MAX_SAFE_INTEGER) -
        (right.rank ?? Number.MAX_SAFE_INTEGER) ||
      left.id.localeCompare(right.id),
  );
}

function dependencyLevel(
  feature: Feature,
  byId: Map<string, Feature>,
  seen = new Set<string>(),
): number {
  if (seen.has(feature.id)) return 0;
  seen.add(feature.id);
  const dependencies = (feature.dependsOn ?? [])
    .map((id) => byId.get(id))
    .filter((item): item is Feature => Boolean(item));
  return dependencies.length
    ? Math.max(
        ...dependencies.map((dependency) =>
          dependencyLevel(dependency, byId, new Set(seen)),
        ),
      ) + 1
    : 0;
}

function automaticNodes(
  planning: Planning,
  positions: StoredLayout["positions"] = {},
  shotWidths: Record<string, number> = {},
  onImageLoad: FeatureNodeData["onImageLoad"] = () => {},
): Node<FeatureNodeData>[] {
  const byId = new Map(
    planning.features.map((feature) => [feature.id, feature]),
  );
  const groups = ordered(planning.groups);
  const groupIndex = new Map(groups.map((group, index) => [group.id, index]));
  const sorted = [...planning.features].sort((left, right) => {
    const parent =
      (groupIndex.get(left.parentId ?? "") ?? 999) -
      (groupIndex.get(right.parentId ?? "") ?? 999);
    return (
      parent ||
      (left.rank ?? 9999) - (right.rank ?? 9999) ||
      left.id.localeCompare(right.id)
    );
  });
  const ranked = sorted.map((feature) => ({ feature, level: dependencyLevel(feature, byId) }));
  const levelWidths = new Map<number, number>();
  const levelHeights = new Map<number, number>();
  for (const { feature, level } of ranked) {
    levelHeights.set(level, Math.max(levelHeights.get(level) ?? 0, nodeHeight(feature)));
    levelWidths.set(level, (levelWidths.get(level) ?? -nodeColumnGap) + nodeWidth(feature, shotWidths) + nodeColumnGap);
  }
  const widestLevel = Math.max(0, ...levelWidths.values());
  const horizontalOffsets = new Map<number, number>();
  const levelOffsets = new Map<number, number>();
  let offset = 48;
  for (const level of [...levelHeights.keys()].sort((a, b) => a - b)) {
    levelOffsets.set(level, offset);
    offset += levelHeights.get(level)! + nodeRowGap;
  }
  return ranked.map(({ feature, level }) => {
    const x = horizontalOffsets.get(level) ?? (46 + (widestLevel - levelWidths.get(level)!) / 2);
    horizontalOffsets.set(level, x + nodeWidth(feature, shotWidths) + nodeColumnGap);
    return {
      id: feature.id,
      type: "feature",
      position: positions[feature.id] ?? {
        x,
        y: levelOffsets.get(level)!,
      },
      data: { feature, shotWidths, onImageLoad },
      style: { width: nodeWidth(feature, shotWidths) },
    };
  });
}

function featureEdges(features: Feature[]): Edge[] {
  const ids = new Set(features.map((feature) => feature.id));
  return features.flatMap((feature) =>
    (feature.dependsOn ?? [])
      .filter((id) => ids.has(id))
      .map((source) => ({
        id: `${source}->${feature.id}`,
        source,
        target: feature.id,
        type: "smoothstep",
        style: { stroke: dependencyEdgeColor, strokeWidth: dependencyEdgeWidth },
        markerEnd: { type: MarkerType.ArrowClosed, color: dependencyEdgeColor },
        animated: feature.status === "in_progress",
      })),
  );
}

function layoutStorageKey(state: DashboardState) {
  return `mf-dev-flow:dependency-board-layout:v11-airier-default-layout:${state.project?.project?.name ?? "default"}`;
}

function readLayout(key: string): StoredLayout {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    return { positions: value.positions ?? {}, heights: value.heights, widths: value.widths, shotWidths: value.shotWidths, viewport: value.viewport };
  } catch {
    return { positions: {} };
  }
}

function Board({ state }: { state: DashboardState }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FeatureNodeData>>(
    [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [viewport, setViewport] = useState<Viewport>();
  const [shotWidths, setShotWidths] = useState<Record<string, number>>({});
  const onImageLoad = useCallback((path: string, width: number) => {
    setShotWidths((current) => current[path] === width ? current : { ...current, [path]: width });
  }, []);
  const [expanded, setExpanded] = useState(false);
  const boardElement = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const normalViewport = useRef<Viewport | undefined>(undefined);
  const restoreViewportFrame = useRef<number | null>(null);
  const hydrated = useRef(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const flow = useRef<ReactFlowInstance<Node<FeatureNodeData>, Edge> | null>(
    null,
  );
  const storageKey = state ? layoutStorageKey(state) : null;
  const featureVersion = JSON.stringify(state.planning);

  const fitAllNodes = useCallback(async () => {
    const instance = flow.current;
    if (!instance) return;
    await instance.fitView(fitOptions);
    setViewport(instance.getViewport());
  }, []);

  const cancelPendingViewportRestore = useCallback(() => {
    if (restoreViewportFrame.current === null) return;
    window.cancelAnimationFrame(restoreViewportFrame.current);
    restoreViewportFrame.current = null;
  }, []);

  const toggleExpanded = async () => {
    cancelPendingViewportRestore();
    if (expanded) {
      if (document.fullscreenElement === boardElement.current) await document.exitFullscreen();
      setExpanded(false);
      return;
    }
    normalViewport.current = flow.current?.getViewport();
    setExpanded(true);
    try {
      await boardElement.current?.requestFullscreen();
    } catch {
      // Embedded browsers may deny native fullscreen; fill the window instead.
    }
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => () => cancelPendingViewportRestore(), [cancelPendingViewportRestore]);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.fullscreenElement) setExpanded(false);
    };
    window.addEventListener("keydown", escape);
    // Wait for React Flow's ResizeObserver to measure the expanded canvas.
    const timer = window.setTimeout(() => void fitAllNodes(), 120);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", escape);
      document.body.style.overflow = previousOverflow;
      const restoreViewport = normalViewport.current;
      if (restoreViewport) {
        // Leaving native fullscreen changes the canvas dimensions asynchronously.
        // Restore after that resize settles so React Flow cannot overwrite the
        // normal view with its intermediate fitted viewport.
        restoreViewportFrame.current = window.requestAnimationFrame(() => {
          restoreViewportFrame.current = window.requestAnimationFrame(() => {
            restoreViewportFrame.current = null;
            void flow.current?.setViewport(restoreViewport);
            setViewport(restoreViewport);
          });
        });
      }
      expandButton.current?.focus({ preventScroll: true });
    };
  }, [expanded, fitAllNodes]);

  useEffect(() => {
    if (!state?.planning || !storageKey) return;
    const saved = readLayout(storageKey);
    const widths = { ...saved.shotWidths, ...shotWidths };
    const sameSizes = state.planning.features.every((feature) => saved.heights?.[feature.id] === nodeHeight(feature) && saved.widths?.[feature.id] === nodeWidth(feature, widths));
    setNodes(automaticNodes(state.planning, sameSizes ? saved.positions : {}, widths, onImageLoad));
    setEdges(featureEdges(state.planning.features));
    if (!hydrated.current) setViewport(saved.viewport);
    const viewportTimer = window.setTimeout(() => {
      if (!hydrated.current) {
        if (saved.viewport) {
          flow.current?.setViewport(saved.viewport);
          setViewport(saved.viewport);
        } else {
          void fitAllNodes();
        }
        hydrated.current = true;
        setLayoutReady(true);
      }
    }, 80);
    return () => window.clearTimeout(viewportTimer);
  }, [featureVersion, storageKey, setEdges, setNodes, fitAllNodes, shotWidths, onImageLoad]);

  useEffect(() => {
    if (!layoutReady || !storageKey) return;
    const positions = Object.fromEntries(
      nodes.map((node) => [node.id, node.position]),
    );
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ positions, heights: Object.fromEntries(nodes.map((node) => [node.id, nodeHeight(node.data.feature)])), widths: Object.fromEntries(nodes.map((node) => [node.id, node.style?.width])), shotWidths: nodes[0]?.data.shotWidths, viewport: expanded ? normalViewport.current : viewport }),
      );
    } catch {
      /* Board remains usable when browser storage is disabled. */
    }
  }, [nodes, storageKey, viewport, layoutReady, expanded]);

  const onNodeClick: NodeMouseHandler<Node<FeatureNodeData>> = useCallback(
    (_, node) => {
      setSelectedId(node.id);
    },
    [],
  );
  const onMoveEnd: OnMoveEnd = useCallback(
    (_, nextViewport) => setViewport(nextViewport),
    [],
  );

  const planning = state?.planning;
  const selected =
    planning?.features.find((feature) => feature.id === selectedId) ??
    planning?.features[0];
  const summary = useMemo(
    () =>
      planning
        ? `${planning.features.length} 个功能点 · ${featureEdges(planning.features).length} 条依赖`
        : "读取功能地图中…",
    [planning],
  );

  const resetLayout = () => {
    if (!planning || !storageKey) return;
    const widths = { ...readLayout(storageKey).shotWidths, ...shotWidths };
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* Storage may be disabled. */
    }
    setNodes(automaticNodes(planning, {}, widths, onImageLoad));
    window.requestAnimationFrame(() => void fitAllNodes());
  };

  if (!planning) return <main className="loading">读取功能演进地图…</main>;

  return (
    <div ref={boardElement} className={`board-page${expanded ? " board-expanded" : ""}`}>
      <header className="board-header">
        <div>
          <p className="eyebrow">mf-dev-flow · 功能演进地图</p>
          <h3>功能点依赖画板</h3>
          <p>{summary}。前置功能在上，后续功能在下；支持拖动卡片、滚轮缩放和拖拽平移。</p>
        </div>
        <div className="board-actions">
          <button type="button" onClick={() => void fitAllNodes()}>显示全部节点</button>
          <button type="button" onClick={resetLayout}>恢复自动布局</button>
          <button ref={expandButton} type="button" aria-pressed={expanded} onClick={() => void toggleExpanded()}>
            {expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
            {expanded ? "退出全屏" : "全屏显示画板"}
          </button>
        </div>
      </header>
      <section className="board-shell" aria-label="功能点依赖画板">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onMoveEnd={onMoveEnd}
          onInit={(instance) => {
            flow.current = instance;
          }}
          minZoom={0.05}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(node) =>
              statusClass((node.data as FeatureNodeData).feature.status) ===
              "done"
                ? "#16845b"
                : statusClass((node.data as FeatureNodeData).feature.status) ===
                    "blocked"
                  ? "#c05f16"
                  : "#7655bd"
            }
          />
        </ReactFlow>
      </section>
      <aside className="feature-detail" aria-live="polite">
        {selected ? (
          <>
            <div>
              <span className={`status ${statusClass(selected.status)}`}>
                {selected.status}
              </span>
              <code>{selected.id}</code>
              {selected.ref && <CopyButton label="复制引用" text={selected.ref} />}
            </div>
            <h2>{selected.title}</h2>
            <FeatureLabels feature={selected} />
            <p>
              {selected.description || selected.outcome || "暂无概括说明。"}
            </p>
            <dl>
              <div>
                <dt>依赖功能</dt>
                <dd>
                  {selected.dependsOn?.length
                    ? selected.dependsOn.join("、")
                    : "无"}
                </dd>
              </div>
              <div>
                <dt>开发要求</dt>
                <dd>
                  {selected.developmentRequirements?.join("；") ||
                    "在交付任务阶段补充。"}
                </dd>
              </div>
            </dl>
            <FeatureAnalysis feature={selected} />
            <PromptButton label="复制功能更新提示词" prompt={featurePrompt(selected)} />
          </>
        ) : (
          "选择一个功能点查看详情。"
        )}
      </aside>
      <footer>
        依赖关系由功能地图维护；本画板仅保存本浏览器的布局与视口，不改写
        <code>{STORE_DIRECTORY}</code>。
      </footer>
    </div>
  );
}

export default function FeatureBoard({ state }: { state: DashboardState }) {
  return (
    <ReactFlowProvider>
      <Board state={state} />
    </ReactFlowProvider>
  );
}
