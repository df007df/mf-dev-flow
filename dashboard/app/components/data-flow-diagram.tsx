"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export type DataFlowNode = {
  /** Mermaid 节点 id（英文短串，无空格）。 */
  id: string;
  /** 节点标题。 */
  title: string;
  /** 节点标注：文件路径 / 接口名 / 数据结构名 / 关键实现点。 */
  note?: string;
  /** 泳道：frontend / backend / storage / impl。 */
  lane: "frontend" | "backend" | "storage" | "impl";
};

export type DataFlowEdge = {
  from: string;
  to: string;
  label?: string;
};

export type DataFlowSpec = {
  /** 泳道标题。 */
  lanes: { id: DataFlowNode["lane"]; title: string }[];
  nodes: DataFlowNode[];
  edges: DataFlowEdge[];
};

export function dataFlowSource(spec: DataFlowSpec): string {
  const escape = (value: string) =>
    value
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, " ");
  const usedIds = new Set<string>();
  const uniqueNodeId = (raw: string) => {
    let candidate = raw;
    let suffix = 1;
    while (usedIds.has(candidate)) {
      suffix += 1;
      candidate = `${raw}_${suffix}`;
    }
    usedIds.add(candidate);
    return candidate;
  };
  for (const node of spec.nodes) uniqueNodeId(node.id);
  const nodeLines = spec.nodes.map((node) => {
    const safeTitle = escape(node.title);
    const safeNote = node.note ? escape(node.note) : "";
    const label = safeNote ? `${safeTitle}<br/>${safeNote}` : safeTitle;
    return `  ${node.id}["${label}"]`;
  });
  const subgraphBlocks = spec.lanes
    .map((lane) => {
      const members = spec.nodes
        .filter((node) => node.lane === lane.id)
        .map((node) => `    ${node.id}`);
      if (!members.length) return "";
      const safeTitle = escape(lane.title);
      return `  subgraph lane_${lane.id.replace(/[^a-zA-Z0-9_]/g, "_")}["${safeTitle}"]\n    direction TB\n${members.join("\n")}\n  end`;
    })
    .filter(Boolean)
    .join("\n");
  const edges = spec.edges
    .map((edge) => {
      if (!edge.label) return `  ${edge.from} --> ${edge.to}`;
      const safe = escape(edge.label).replace(/\|/g, "¦");
      return `  ${edge.from} -->|"${safe}"| ${edge.to}`;
    })
    .join("\n");
  return [
    "flowchart LR",
    nodeLines.join("\n"),
    subgraphBlocks,
    edges,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderMermaid(target: HTMLElement, source: string) {
  return import("mermaid").then(async ({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
    });
    try {
      await mermaid.parse(source);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[data-flow-diagram] mermaid parse failed", { source, error });
      target.replaceChildren();
      const pre = document.createElement("pre");
      pre.className = "mermaid";
      pre.dataset.parseError = String((error as Error)?.message || error);
      pre.textContent = source;
      target.appendChild(pre);
      return;
    }
    await mermaid.run({ nodes: target.querySelectorAll("pre.mermaid"), suppressErrors: true });
  });
}

function MermaidHost({ source, containerClass }: { source: string; containerClass: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    let cancelled = false;
    renderMermaid(target, source)
      .then(() => {
        if (cancelled || !target.isConnected) return;
      })
      .catch(() => {
        /* Keep raw source on failure. */
      });
    return () => {
      cancelled = true;
    };
  }, [source]);
  return (
    <div className={containerClass} ref={ref}>
      <pre className="mermaid">{source}</pre>
    </div>
  );
}

export type DataFlowContext = {
  question?: string;
  answer?: string;
  conclusion?: string;
  answerActor?: string;
};

export function DataFlowDiagram({ spec, context }: { spec: DataFlowSpec; context?: DataFlowContext }) {
  const source = dataFlowSource(spec);
  const titleId = useId();
  const [expanded, setExpanded] = useState(false);
  const zoomBody = (
    <div className="data-flow-zoom-layout">
      <aside className="data-flow-zoom-text">
        {context?.question ? (
          <p className="data-flow-zoom-question">
            <span className="feature-question-answer-label">问题</span>
            {context.question}
          </p>
        ) : null}
        {context?.answer ? (
          <p className="feature-question-answer-body">
            <span className="feature-question-answer-label">
              {context.answerActor ? `${context.answerActor} · 回答` : "Agent · 回答"}
            </span>
            {context.answer}
          </p>
        ) : null}
        {context?.conclusion ? (
          <p className="feature-question-answer-conclusion">
            <span className="feature-question-answer-label">结论</span>
            {context.conclusion}
          </p>
        ) : null}
      </aside>
      <ZoomableDiagram source={source} />
    </div>
  );
  return (
    <div className="feature-question-answer-diagram-block">
      <div className="feature-question-answer-diagram-header">
        <strong id={titleId}>数据流转</strong>
        <button
          type="button"
          className="feature-question-answer-zoom"
          aria-label="放大查看数据流转"
          onClick={() => setExpanded(true)}
        >
          放大
        </button>
      </div>
      <MermaidHost source={source} containerClass="data-flow-diagram" />
      {expanded ? (
        <Dialog.Root open={expanded} onOpenChange={setExpanded}>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="dialog-content data-flow-zoom-dialog">
              <header>
                <Dialog.Title>数据流转</Dialog.Title>
                <Dialog.Close className="icon-button" aria-label="关闭">
                  <X size={18} />
                </Dialog.Close>
              </header>
              <Dialog.Description className="sr-only">问题、Agent 回答、结论与数据流转流程图</Dialog.Description>
              <div className="dialog-body data-flow-zoom-body">{zoomBody}</div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
}

const ZOOM_STEP = 0.2;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4;

function ZoomableDiagram({ source }: { source: string }) {
  const [scale, setScale] = useState(1);
  const zoomIn = () => setScale((value) => Math.min(ZOOM_MAX, +(value + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setScale((value) => Math.max(ZOOM_MIN, +(value - ZOOM_STEP).toFixed(2)));
  const reset = () => setScale(1);
  return (
    <div className="data-flow-zoom-graph">
      <div className="data-flow-zoom-toolbar">
        <span className="data-flow-zoom-scale">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={zoomOut} disabled={scale <= ZOOM_MIN} aria-label="缩小">
          缩小
        </button>
        <button type="button" onClick={zoomIn} disabled={scale >= ZOOM_MAX} aria-label="放大">
          放大
        </button>
        <button type="button" onClick={reset} disabled={scale === 1} aria-label="还原">
          还原
        </button>
      </div>
      <div className="data-flow-zoom-stage">
        <div className="data-flow-diagram data-flow-diagram--zoom" style={{ transform: `scale(${scale})` }}>
          <MermaidHost source={source} containerClass="data-flow-diagram-inner" />
        </div>
      </div>
    </div>
  );
}