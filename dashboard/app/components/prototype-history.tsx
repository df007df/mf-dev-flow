"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import type { DashboardState, RunDetail } from "../lib/types";
import { stamp } from "../lib/format";
import { Badge, DetailDialog } from "./ui";
import { Execution } from "./run-history";
import { fileUrl } from "./documents";
import { MarkdownContent } from "./markdown-content";

type HistoryItem = Record<string, any> & { id: string; key: string; native: boolean };
const statusLabels: Record<string, string> = { done: "已完成", completed: "已完成", blocked: "未完成 · 有阻塞", in_progress: "分析中", pending: "未完成", skipped: "已跳过", unverified: "待核验" };

function SavedReport({ file }: { file: string }) {
  const [content, setContent] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(fileUrl(file), { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("无法读取该次分析报告");
      return response.text();
    }).then(setContent).catch(error => { if (error.name !== "AbortError") setError(error.message); });
    return () => controller.abort();
  }, [file]);
  return error ? <p role="alert" className="error">{error}</p> : content === undefined ? <p role="status">读取报告…</p> : <MarkdownContent content={content} documentPath={file} />;
}

function AnalysisDetail({ item }: { item: HistoryItem }) {
  const [detail, setDetail] = useState<RunDetail>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (item.native) return;
    const controller = new AbortController();
    fetch(`/api/run?type=prototype&id=${encodeURIComponent(item.id)}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "无法读取执行记录");
      return body;
    }).then(setDetail).catch(error => { if (error.name !== "AbortError") setError(error.message); });
    return () => controller.abort();
  }, [item.id, item.native]);
  if (!item.native) return error ? <p className="error" role="alert">{error}</p> : detail ? <Execution detail={detail} /> : <p role="status">读取执行记录…</p>;
  if (item.error) return <p className="error" role="alert">{item.error}</p>;
  return <>
    <p className="muted">来源：{item.source}</p>
    <p>{item.observableBoundary}</p>
    <p>{item.counts?.group ?? 0} 个分组 · {item.counts?.entry ?? 0} 个入口 · {item.counts?.evidence ?? 0} 条证据</p>
    <h3>执行记录</h3>
    <ol className="analysis-event-list">{item.executionLog?.map((event: any) => <li key={event.id}><time>{stamp(event.at)}</time><span>{event.title}</span></li>)}</ol>
    <p className="muted">展示已登记的执行节点，具体操作与证据见当次报告。</p>
    {item.reportPath ? <DetailDialog title="当次原型分析报告" trigger={<button className="button">查看当次报告</button>}><SavedReport file={item.reportPath} /></DetailDialog> : <p className="empty">该次分析尚未生成报告。</p>}
  </>;
}

function PrototypeHistory({ state }: { state: DashboardState }) {
  const [batches, setBatches] = useState<HistoryItem[]>([]);
  const [page, setPage] = useState<any>();
  const [cursor, setCursor] = useState(0);
  const [revision, setRevision] = useState<number>();
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(Boolean(state.prototype?.native));
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (!state.prototype?.native) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ command: "query", collection: "batches", cursor: String(cursor), ...(cursor && revision !== undefined ? { revision: String(revision) } : {}) });
    fetch(`/api/prototype?${params}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "无法读取分析历史");
      if (body.items?.some((item: any) => item.oversized)) throw new Error("分析记录过大，无法显示完整历史。");
      return body;
    }).then(body => {
      setPage(body);
      const items = body.items.map((item: any) => ({ ...(item.record ?? item), id: item.id, key: `batch:${item.id}`, native: true }));
      setBatches(previous => cursor ? [...previous.filter(item => !items.some((next: HistoryItem) => next.key === item.key)), ...items] : items);
    }).catch(error => { if (error.name !== "AbortError") setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [state.prototype?.native, cursor, revision, attempt]);
  const items: HistoryItem[] = [...state.runs.filter(run => run.type === "prototype").map<HistoryItem>(run => ({ ...run, id: String(run.id), key: `run:${run.id}`, native: false })), ...batches].sort((a, b) => String(b.createdAt || b.updatedAt || "").localeCompare(String(a.createdAt || a.updatedAt || "")) || b.key.localeCompare(a.key));
  return <>
    <p className="muted">每次原型分析一条记录，按开始时间倒序排列。展开查看执行记录、分析文档和证据。</p>
    {items.length > 0 && <ol className="analysis-history-list">{items.map(item => <li key={item.key} className="analysis-history-item">
      <button className="analysis-history-toggle" aria-expanded={selected === item.key} onClick={() => setSelected(selected === item.key ? "" : item.key)}>
        <time>{stamp(item.createdAt || item.updatedAt)}</time>
        <strong>{item.title || item.id}</strong>
        <Badge status={item.status} label={item.accepted ? "已验收" : statusLabels[item.status] || item.status} />
        <span>{selected === item.key ? "收起" : "查看记录"}</span>
      </button>
      {selected === item.key && <div className="analysis-history-detail"><p><code>{item.id}</code></p><AnalysisDetail key={item.key} item={item} /></div>}
    </li>)}</ol>}
    {!loading && !error && !items.length && <p className="empty">暂无原型分析执行记录。</p>}
    {loading && <p role="status">读取分析历史…</p>}
    {error && <p role="alert" className="error">{error} <button onClick={() => { setCursor(0); setRevision(undefined); setAttempt(attempt + 1); }}>重新读取</button></p>}
    {page?.nextCursor != null && <button className="button" disabled={loading} onClick={() => { setRevision(page.revision); setCursor(page.nextCursor); }}>加载更多分析记录</button>}
  </>;
}

export function PrototypeHistoryButton({ state }: { state: DashboardState }) {
  return <DetailDialog title="原型分析历史" trigger={<button className="button"><History size={15} aria-hidden="true" />查看历史</button>}><PrototypeHistory state={state} /></DetailDialog>;
}

export function PrototypeHistoryCard({ state }: { state: DashboardState }) {
  const archivedRuns = state.runs.filter((run) => run.type === "prototype").length;
  return <section className="prototype-overview-card" aria-label="分析历史">
    <div className="row">
      <h3>分析历史</h3>
      <PrototypeHistoryButton state={state} />
    </div>
    <p>每次分析都是对“完整原型图流程”的一次修订，执行过程和当时的证据快照保留在历史中。</p>
    <p className="muted">
      {archivedRuns > 0 ? `已有 ${archivedRuns} 条归档执行记录` : "尚无归档执行记录"}
      {state.prototype?.native ? "；原生分析批次会在打开历史后按页读取。" : "。"}
    </p>
  </section>;
}
