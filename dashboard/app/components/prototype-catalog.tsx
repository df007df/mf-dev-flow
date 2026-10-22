"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Badge, DetailDialog, PromptButton, Section } from "./ui";
import { MarkdownContent } from "./markdown-content";
import {
  PrototypeWorkflowSummary,
  prototypeWorkflowSummaryProps,
} from "./prototype-workflow-summary";
import { SUPPORTED_PROTOTYPE_REPORT_FORMAT_VERSIONS } from "../../../modules/prototype/core/report-format.js";

const reportDocuments = new Map<string, Promise<string>>();
let reportValidation: Promise<{ fingerprint: string }> | undefined;
const supportedReportFormatVersions = new Set<number>(SUPPORTED_PROTOTYPE_REPORT_FORMAT_VERSIONS);
const rebuildReportPrompt = `使用 mf-dev-flow 重新生成当前完整原型分析报告。\n先执行 prototype status --json，确认当前报告状态；然后执行 prototype report --json。\n只重建派生报告，不重新分析原型、不修改问题、需求、说明或已接受结论。完成后用 prototype document --text-limit 1 --json 核验报告可读取。`;

function reportStatusMessage(reportStatus?: Record<string, any>) {
  if (!reportStatus || reportStatus.status === "ready") return "";
  if (reportStatus.status === "generation_failed") return `完整报告自动生成失败：${reportStatus.message || "请重新生成报告。"}`;
  if (reportStatus.reason === "batch_unreadable") return "报告引用的分析批次不可读取。先定位批次或证据缺口，不能靠重建报告修复。";
  if (reportStatus.reason === "traversal_changed") return "报告对应的遍历记录已变化。先审计并完成取证验收，再更新报告。";
  if (reportStatus.status === "stale") return "完整报告尚未同步到最新原型记录。后续验收或语义变更会自动更新；当前旧记录可手动重建。";
  return "完整报告尚未生成；完成并验收原型分析后会自动生成。";
}

function reportDocumentError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Report stale|Report traversal changed/.test(message)) return "完整报告尚未同步到最新原型记录。请先用 prototype status 定位原因；只有派生报告不同步时才重建。";
  if (/Report not materialized/.test(message)) return "完整报告尚未生成；完成并验收原型分析后会自动生成。";
  return message;
}

function validatePrototypeReport() {
  if (reportValidation) return reportValidation;
  const pending = (async () => {
    const validation = await fetch(
      "/api/prototype/?command=document&cursor=0&text-limit=1",
      { cache: "no-store" },
    );
    const validationBody = await validation.json();
    if (!validation.ok)
      throw new Error(validationBody.error || "无法校验完整原型分析报告");
    if (!validationBody.fingerprint)
      throw new Error("完整原型分析报告缺少内容指纹");
    if (!supportedReportFormatVersions.has(Number(validationBody.formatVersion)))
      throw new Error("完整原型分析报告需要按受支持格式重新生成");
    return { fingerprint: String(validationBody.fingerprint) };
  })();
  reportValidation = pending;
  void pending.then(
    () => { if (reportValidation === pending) reportValidation = undefined; },
    () => { if (reportValidation === pending) reportValidation = undefined; },
  );
  return pending;
}

async function loadPrototypeReport() {
  // The semantic revision can stay unchanged when only evidence or report
  // presentation changes. Validate the report itself on every dialog open,
  // then reuse the large document only while its content fingerprint matches.
  const { fingerprint } = await validatePrototypeReport();
  const cached = reportDocuments.get(fingerprint);
  if (cached) return cached;
  const pending = (async () => {
    const response = await fetch(
      "/files/?path=prototype%2Freport.md",
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error("无法读取完整原型分析报告");
    return response.text();
  })();
  reportDocuments.clear();
  reportDocuments.set(fingerprint, pending);
  pending.catch(() => {
    if (reportDocuments.get(fingerprint) === pending) reportDocuments.delete(fingerprint);
  });
  return pending;
}

function PrototypeReportDocument({ revision }: { revision?: number }) {
  const [content, setContent] = useState<string>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    async function read() {
      try {
        const report = await loadPrototypeReport();
        if (mounted) {
          setContent(report);
          setError("");
        }
      } catch (error) {
        if (mounted) setError(reportDocumentError(error));
      }
    }
    void read();
    return () => { mounted = false; };
  }, [attempt, revision]);

  if (error) return <p className="error" role="alert">{error} <button onClick={() => { reportDocuments.clear(); setAttempt(attempt + 1); }}>重新读取</button></p>;
  if (content === undefined) return <p role="status">正在校验并读取完整分析报告…</p>;
  return (
    <MarkdownContent
      content={content}
      assetBase="prototype"
      documentPath="prototype/report.md"
      archiveImageLinks="explicit-only"
      renderLegacyEdgeEvidenceTables
    />
  );
}

export function PrototypeCatalogSection({
  data,
  history,
  requirements,
}: {
  data: Record<string, any>;
  history?: ReactNode;
  requirements?: ReactNode;
}) {
  const [groups, setGroups] = useState<any[]>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const workflow = prototypeWorkflowSummaryProps(data.workflow);

  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const request = async (cursor = 0, revision?: number) => {
          const params = new URLSearchParams({
            command: "query",
            collection: "groups",
            cursor: String(cursor),
            ...(revision === undefined ? {} : { revision: String(revision) }),
          });
          const response = await fetch(`/api/prototype?${params}`, {
            signal: controller.signal,
            cache: "no-store",
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "无法读取原型分组");
          return body;
        };

        const first = await request();
        const items = [...(first.items ?? [])];
        let cursor = first.nextCursor;
        while (cursor != null) {
          const next = await request(cursor, first.revision);
          items.push(...(next.items ?? []));
          cursor = next.nextCursor;
        }
        items.sort((left, right) =>
          (left.record?.order ?? Number.MAX_SAFE_INTEGER) - (right.record?.order ?? Number.MAX_SAFE_INTEGER)
          || String(left.id).localeCompare(String(right.id)),
        );
        if (!controller.signal.aborted) {
          setGroups(items);
          setError("");
        }
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") setError(error.message);
      }
    }
    void read();
    return () => controller.abort();
  }, [data.semanticRevision, attempt]);

  return (
    <>
      <Section title="原型图分析" action={<Badge status={data.status} />}>
        {workflow && (
          <div className="prototype-overview-grid">
            <PrototypeWorkflowSummary {...workflow} />
          </div>
        )}
        <section className="prototype-report-card" aria-label="完整原型图流程">
          <div className="prototype-report-head">
            <div>
              <p className="prototype-card-kicker">当前完整报告</p>
              <h3>完整原型图流程</h3>
              <p>每次原型分析都更新这份报告；完整分组在下方“原型分组”中展示。</p>
            </div>
            <DetailDialog
              title="完整原型图流程"
              trigger={<button className="button">查看完整分析报告</button>}
            >
              <PrototypeReportDocument revision={data.semanticRevision} />
            </DetailDialog>
          </div>
          <p className="prototype-report-metrics">
            语义版本 {data.semanticRevision} · {data.counts?.group ?? 0} 个分组 · {data.counts?.entry ?? 0} 个入口 · {data.counts?.question ?? 0} 个问题
          </p>
          {(requirements || history) && (
            <div className="prototype-overview-grid">
              {requirements}
              {history}
            </div>
          )}
          {reportStatusMessage(data.reportStatus) && <p className="error" role="status">{reportStatusMessage(data.reportStatus)} <PromptButton label={data.recovery?.action === "reobserve" || ["traversal_changed", "batch_unreadable"].includes(data.reportStatus?.reason) ? "定位报告缺口" : "重建完整报告"} prompt={data.recovery?.action === "reobserve" || ["traversal_changed", "batch_unreadable"].includes(data.reportStatus?.reason) ? "使用 mf-dev-flow 执行 prototype status --json，按页定位来源、批次和证据缺口，说明原因与下一步；先只做定位，沿用已有任务范围。" : rebuildReportPrompt} /></p>}
          {data.sourceProblems?.map((problem: string) => <p className="error" key={problem}>{problem}</p>)}
        </section>
      </Section>
      <Section title="原型分组">
        <p className="muted">以下分组全部来自当前完整报告。</p>
        {error && <p className="error" role="alert">{error} <button onClick={() => setAttempt(attempt + 1)}>重新读取</button></p>}
        {groups === undefined && !error && <p role="status">正在读取原型分组…</p>}
        {groups && (
          <div className="prototype-groups" aria-label="原型分组概览">
            {groups.map((item) => {
              const record = item.record ?? item;
              return (
                <article className="prototype-group-card" key={item.id} data-group-id={item.id}>
                  <h3>{record.title ?? item.id}</h3>
                  <code className="prototype-group-id">{item.id}</code>
                  {record.purpose && <p>{record.purpose}</p>}
                </article>
              );
            })}
            {!groups.length && <p className="empty">尚未登记原型分组。</p>}
          </div>
        )}
      </Section>
    </>
  );
}
