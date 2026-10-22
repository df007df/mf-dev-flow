"use client";
import * as Tabs from "@radix-ui/react-tabs";
import { useEffect, useState } from "react";
import { DashboardState, RunDetail } from "../lib/types";
import { stamp, readable } from "../lib/format";
import { Badge, CopyButton, DetailDialog, PromptButton, Section } from "./ui";
import { EvidenceGallery } from "./documents";
import { MarkdownContent } from "./markdown-content";
import { Stages } from "./features";
import { runHistoryView } from "./run-history-state";

const types: Record<string, string> = {
  prototype: "原型分析",
  refinement: "功能演进拆解",
  system: "系统信息更新",
  delivery: "开发执行",
};
export function Execution({ detail }: { detail: RunDetail }) {
  const [doc, setDoc] = useState(detail.documents?.[0]?.id || "");
  const [showScreenshots, setShowScreenshots] = useState(false);
  const current = detail.documents?.find((d: any) => d.id === doc);
  return (
    <>
      <div className="row">
        <div>
          <h3>{detail.run.title}</h3>
          <code>{detail.run.id}</code>
          {detail.run.ref && <CopyButton label="复制引用" text={detail.run.ref} />}
        </div>
        <Badge status={detail.run.status} />
      </div>
      <p>{readable(detail.run.notes || detail.run.summary)}</p>
      {detail.run.type === "prototype" && <p className="muted">开始：{stamp(detail.run.createdAt)} · 最近更新：{stamp(detail.run.updatedAt)}</p>}
      {detail.deliveryInput && (
        <>
          <p>
            任务输入：{detail.deliveryInput.source} · 开发强度：
            {detail.deliveryInput.intensity}
          </p>
          <p>
            功能：
            {(detail.deliveryInput.features || [])
              .map((f: any) => f.title || f.id)
              .join("、")}
          </p>
          {detail.referenceScope && (
            <p className={detail.referenceScope.referenceOnly ? "muted" : undefined}>
              范围性质：
              <span
                className={`scope-tag ${detail.referenceScope.referenceOnly ? "reference" : "committed"}`}
                title={detail.referenceScope.notice}
              >
                {detail.referenceScope.referenceOnly ? "参考范围，未承诺交付" : "承诺交付"}
              </span>
              （{detail.referenceScope.featureIds.length} 个功能 ID）
            </p>
          )}
          <Stages stages={detail.deliveryInput.stages} />
          {detail.stageGate && (
            <details>
              <summary>阶段门禁</summary>
              <pre>{JSON.stringify(detail.stageGate, null, 2)}</pre>
            </details>
          )}
        </>
      )}
      <h3>{detail.run.type === "prototype" ? "执行记录" : "并发任务"}</h3>
      {detail.tasks?.length ? (
        detail.tasks.map((task: any) => (
          <article key={task.id} className="task-card">
            <div className="row">
              <strong>{task.title}</strong>
              <Badge status={task.execution?.status || task.status} />
            </div>
            <code>{task.id}</code>
            {detail.run.type === "prototype" && <p className="muted">{stamp(task.execution?.updatedAt || task.createdAt)}</p>}
            <p>
              Agent：
              {task.execution?.agentId || task.execution?.agent || "未领取"} ·{" "}
              {task.phase}
            </p>
            <p>{readable(task.execution?.summary || task.summary)}</p>
            {task.execution?.blocker && (
              <p className="error">{task.execution.blocker}</p>
            )}
            <div className="actions">
              {task.ref && <CopyButton label="复制引用" text={task.ref} />}
              <DetailDialog
                title={`${task.title} · 改动文件`}
                trigger={<button className="button">查看改动文件</button>}
              >
                <pre>
                  {(
                    task.execution?.changedFiles ||
                    task.execution?.files ||
                    []
                  ).join("\n") || "尚未登记改动文件"}
                </pre>
              </DetailDialog>
              <DetailDialog
                title={`${task.title} · 执行详情`}
                trigger={<button className="button">执行详情</button>}
              >
                <pre>{JSON.stringify(task, null, 2)}</pre>
              </DetailDialog>
            </div>
            <details>
              <summary>继续当前任务提示词</summary>
              <PromptButton
                prompt={`使用 mf-dev-flow 继续当前任务。\n运行：${detail.run.id}。\n任务：${task.id}。\n当前状态：${task.execution?.status || task.status}。\n按默认流程继续。`}
              />
            </details>
          </article>
        ))
      ) : (
        <p className="empty">{detail.run.type === "prototype" ? "该次分析未单独登记任务日志，可查看下方分析文档。" : "此运行没有并发任务。"}</p>
      )}
      {detail.integration && (
        <details>
          <summary>总控合并验证</summary>
          <pre>{JSON.stringify(detail.integration, null, 2)}</pre>
        </details>
      )}
      <h3>运行文档</h3>
      <Tabs.Root value={doc} onValueChange={setDoc}>
        <Tabs.List className="tabs" aria-label="运行文档">
          {detail.documents?.map((d: any) => (
            <Tabs.Trigger key={d.id} value={d.id}>
              {d.title}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {current && (
          <Tabs.Content value={doc}>
            <MarkdownContent
              content={current.content}
              assetBase={detail.assetBase}
              documentPath={current.path?.startsWith(`${detail.assetBase}/`) ? current.path : `${detail.assetBase}/${current.path}`}
            />
          </Tabs.Content>
        )}
      </Tabs.Root>
      {detail.run.type === "delivery" || detail.deliveryInput ? (
        <>
          <h3>验证截图（固定一对）</h3>
          {detail.visualPairs?.length ? (
            detail.visualPairs.map((pair: any, index: number) => (
              <section key={pair.id || index}>
                <h4>{pair.state || pair.taskId}</h4>
                <div className="visual-pair">
                  {pair.screenshots?.map((shot: any) => (
                    <div key={shot.role}>
                      <strong>{shot.title || shot.role}</strong>
                      <p className="muted">
                        来源系统：{shot.sourceSystem?.label}
                      </p>
                      {shot.path ? (
                        <EvidenceGallery files={[shot]} />
                      ) : (
                        <p className="empty">尚未登记截图</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <p className="empty">尚未登记固定验证截图。</p>
          )}
          <h3>其他归档截图</h3>
          <p className="muted">
            仅在异常、偏差或额外状态需要单独说明时才显示补充截图。
          </p>
          <EvidenceGallery
            files={(detail.additionalScreenshots || []).filter(
              (shot: any) => shot.path,
            )}
          />
        </>
      ) : (
        <>
          <h3>归档截图</h3>
          <button className="button" onClick={() => setShowScreenshots(!showScreenshots)}>{showScreenshots ? "收起截图" : `查看截图（${detail.screenshots?.length || 0}）`}</button>
          {showScreenshots && <EvidenceGallery
            files={(detail.screenshots || []).map((path: string) => ({ path }))}
          />}
        </>
      )}
    </>
  );
}
export function RunHistory({ state }: { state: DashboardState }) {
  const [filter, setFilter] = useState("all");
  const [showArchivedRefinements, setShowArchivedRefinements] = useState(false);
  const [selected, setSelected] = useState<string>(
    state.current?.active?.id || state.runs[0]?.id || "",
  );
  const [detail, setDetail] = useState<RunDetail>();
  const [error, setError] = useState("");
  const run = state.runs.find((r) => r.id === selected);
  const history = runHistoryView({
    runs: state.runs,
    currentMapSource: state.planning?.sourceRun,
    filter,
    showArchivedRefinements,
  });
  useEffect(() => {
    if (!run) return;
    const controller = new AbortController();
    void fetch(
      `/api/run?type=${encodeURIComponent(run.type)}&id=${encodeURIComponent(run.id)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        return data;
      })
      .then((data) => {
        setDetail(data);
        setError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [run?.id, run?.type, state.generatedAt]);
  return (
    <Section title="运行历史">
      <div className="history-layout">
        <aside className="run-list">
          <label>
            运行类型
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">全部运行</option>
              {Object.entries(types).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {filter === "all" && history.archivedRefinementCount > 0 && (
            <button
              type="button"
              className="button"
              aria-expanded={showArchivedRefinements}
              onClick={() => setShowArchivedRefinements((visible) => !visible)}
            >
              {showArchivedRefinements
                ? `收起 ${history.archivedRefinementCount} 条已归档规划快照`
                : `显示 ${history.archivedRefinementCount} 条已归档规划快照`}
            </button>
          )}
          {history.runs.map((r: DashboardState["runs"][number]) => (
              <article
                key={r.id}
                className={selected === r.id ? "run-item selected" : "run-item"}
              >
                <button
                  className="run-select"
                  onClick={() => {
                    setSelected(r.id);
                    setDetail(undefined);
                  }}
                >
                  <span className="row">
                    <small>{types[r.type] || r.type}</small>
                    <Badge status={r.status} />
                  </span>
                  <strong>{r.title}</strong>
                  <code>{r.id}</code>
                  <small>{stamp(r.updatedAt)}</small>
                </button>
                {r.ref ? <CopyButton label="复制引用" text={r.ref} /> : <CopyButton label="复制 ID" text={r.id} />}
              </article>
            ))}
        </aside>
        <div className="run-detail">
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : detail ? (
            <Execution key={detail.run.id} detail={detail} />
          ) : (
            <p className="empty">{run ? "读取运行详情…" : "暂无运行记录。"}</p>
          )}
        </div>
      </div>
    </Section>
  );
}
