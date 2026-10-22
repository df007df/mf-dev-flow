"use client";

import { useEffect, useState } from "react";
import type { Planning } from "../lib/types";
import { stamp } from "../lib/format";
import { PromptButton } from "./ui";

type AcceptanceCase = {
  id: string;
  featureId: string;
  title: string;
  detail: string;
  evidenceHints?: string[];
  status: "active" | "superseded" | "withdrawn";
  statusReason?: string | null;
  updatedAt?: string;
};

type AcceptanceCasesState = {
  recorded: boolean;
  fingerprint: string | null;
  activeCount: number;
  updatedAt?: string | null;
  records: AcceptanceCase[];
};

const statusLabel: Record<AcceptanceCase["status"], string> = {
  active: "生效中",
  superseded: "已替代",
  withdrawn: "已撤回",
};

function prompt() {
  return [
    "维护 mf-dev-flow 的功能级最终验收用例台账。",
    "先执行 feature acceptance list --json，确认当前 revision 和已有记录；再按需用 feature acceptance add、revise 或 withdraw 写入。",
    "每条 AC 只绑定一个现有功能点，写清可判定的最终验收结果与证据提示。",
    "它只会冻结到之后新建的该功能交付任务的 end_to_end_acceptance 阶段；已有任务和原型分析批次不回写、不变 stale。",
    "不要把功能最终验收用例写进 prototype analysis-requirements，也不要改动旧的 analysis-requirements.md。",
  ].join("\n");
}

export function FeatureAcceptanceCases({
  planning,
  refreshedAt,
}: {
  planning?: Planning;
  refreshedAt: string;
}) {
  const [data, setData] = useState<AcceptanceCasesState>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const featureNames = new Map(
    (planning?.features ?? []).map((feature) => [feature.id, feature.title]),
  );

  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const request = async (cursor = 0, fingerprint?: string) => {
          const params = new URLSearchParams({
            cursor: String(cursor),
            limit: "20",
            ...(fingerprint ? { fingerprint } : {}),
          });
          const response = await fetch("/api/feature-acceptance?" + params, {
            signal: controller.signal,
            cache: "no-store",
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "无法读取最终验收用例");
          if (body.items?.some((item: any) => item.oversized))
            throw new Error("最终验收用例记录过长，暂时无法完整显示");
          return body;
        };
        const first = await request();
        const records: AcceptanceCase[] = [];
        let page = first;
        while (true) {
          records.push(...(page.items ?? []).map((item: any) => item.record).filter(Boolean));
          if (page.nextCursor == null) break;
          page = await request(page.nextCursor, first.fingerprint ?? undefined);
        }
        if (controller.signal.aborted) return;
        setData({
          recorded: Boolean(first.recorded),
          fingerprint: first.fingerprint ?? null,
          activeCount: Number(first.activeCount ?? 0),
          updatedAt: first.updatedAt,
          records,
        });
        setError("");
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") setError(error.message);
      }
    }
    void read();
    return () => controller.abort();
  }, [refreshedAt, attempt]);

  return (
    <section className="feature-acceptance-cases" aria-label="功能级最终验收用例">
      <div className="feature-acceptance-cases-heading">
        <div>
          <h3>功能级最终验收用例</h3>
          <p className="muted">
            独立于原型分析要求；仅在创建新的交付任务时冻结进该功能的端到端验收阶段。
          </p>
        </div>
        <PromptButton label="管理最终验收用例" prompt={prompt()} />
      </div>
      {error ? (
        <p className="error" role="alert">
          {error} <button onClick={() => setAttempt((value) => value + 1)}>重新读取</button>
        </p>
      ) : !data ? (
        <p className="muted">正在读取最终验收用例…</p>
      ) : (
        <>
          <p className="muted">
            {data.recorded ? "已登记" : "尚未建立"} · 生效 {data.activeCount} 条
            {data.updatedAt ? " · 更新于 " + stamp(data.updatedAt) : ""}
          </p>
          {data.records.length ? (
            <div className="feature-acceptance-case-list">
              {data.records.map((record) => (
                <article
                  className={"feature-acceptance-case " + record.status}
                  key={record.id}
                >
                  <div className="feature-acceptance-case-heading">
                    <div>
                      <code>{record.id}</code>
                      <strong>{record.title}</strong>
                    </div>
                    <span>{statusLabel[record.status]}</span>
                  </div>
                  <p className="muted">
                    功能：{featureNames.get(record.featureId) || record.featureId} <code>{record.featureId}</code>
                  </p>
                  <p>{record.detail}</p>
                  {record.evidenceHints?.length ? (
                    <p className="muted">证据提示：{record.evidenceHints.join("；")}</p>
                  ) : null}
                  {record.statusReason ? (
                    <p className="muted">状态说明：{record.statusReason}</p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="empty">尚未登记功能级最终验收用例。</p>
          )}
        </>
      )}
    </section>
  );
}
