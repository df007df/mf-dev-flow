"use client";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { DashboardState } from "./lib/types";
import { stamp } from "./lib/format";
import {
  FeatureBoardSection,
  FeatureGroupListSection,
} from "./components/features";
import {
  ProjectSection,
  PrototypeSection,
  SystemSection,
} from "./components/source-sections";
import { RunHistory } from "./components/run-history";
import { PrdSection } from "./components/prd-analysis";
import { GraphSection } from "./components/graph-board";

export default function Page() {
  const [state, setState] = useState<DashboardState>();
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal, fresh = false) => {
    try {
      const response = await fetch(fresh ? "/api/state/?fresh=1" : "/api/state/", { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法读取观察台状态");
      setState(data);
      setError("");
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") setError(e.message);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let first = true;
    let timer: number | undefined;
    const poll = async () => {
      if (!document.hidden) {
        await load(controller.signal, first);
        first = false;
      }
      if (active) timer = window.setTimeout(poll, 30000);
    };
    void poll();
    return () => {
      active = false;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [load]);
  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">MF-DEV-FLOW · 本地流程观察台</span>
          <h1>{state?.project?.project?.name || "项目观察台"}</h1>
          <p>原型图分析、功能演进、系统事实与开发执行</p>
        </div>
        <div className="refresh">
          <span>
            {state ? `更新于 ${stamp(state.generatedAt)}` : "读取中…"}
          </span>
          <button className="button" onClick={() => void load(undefined, true)}>
            <RefreshCw size={15} /> 刷新
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="error-banner">
          {error} <button onClick={() => void load(undefined, true)}>重试</button>
        </p>
      )}
      {state ? (
        <>
          <div className="metrics">
            {[
              ["原型图分析", state.prototype?.task?.status || state.prototype?.status || "未分析"],
              [
                "已登记入口观察",
                state.prototype?.native ? `${state.prototype?.counts?.entry || 0} 个入口` : `${state.prototype?.coverage?.covered || 0} / ${state.prototype?.coverage?.total || 0}`,
              ],
              ["系统卡片", state.system?.cards?.length || 0],
              [
                "当前执行 / 历史",
                `${state.summary.activeRuns} / ${state.summary.runs}`,
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <ProjectSection cards={state.projectCards} />
          <PrdSection prd={state.prd} />
          <PrototypeSection state={state} />
          <SystemSection system={state.system} />
          <FeatureBoardSection
            planning={state.planning}
            project={state.project}
          />
          <FeatureGroupListSection
            planning={state.planning}
            refreshedAt={state.generatedAt}
          />
          <GraphSection />
          <RunHistory state={state} />
          {(state as any).compaction && (
            <details className="compaction">
              <summary>上下文压缩状态</summary>
              <pre>{JSON.stringify((state as any).compaction, null, 2)}</pre>
            </details>
          )}
          <footer className="dashboard-footer">
            每 30 秒自动读取当前记录，隐藏页面暂停 · 布局保存在本浏览器 · 提示词交给 Agent
            后按默认流程执行
          </footer>
        </>
      ) : (
        !error && <p className="empty">正在读取当前项目…</p>
      )}
    </main>
  );
}
