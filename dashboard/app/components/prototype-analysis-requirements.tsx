"use client";

import { useEffect, useRef, useState } from "react";
import { stamp } from "../lib/format";
import { PromptButton } from "./ui";

type RequirementRecord = {
  id: string;
  title: string;
  instruction: string;
  scope?: {
    sourceTypes?: string[];
    modes?: string[];
    labels?: string[];
  };
  evidenceHints?: string[];
  status: "active" | "superseded" | "withdrawn";
  revision?: number;
  updatedAt?: string;
  statusReason?: string | null;
};

type RequirementsState = {
  recorded: boolean;
  origin: string;
  fingerprint: string | null;
  updatedAt?: string | null;
  activeCount: number;
  records: RequirementRecord[];
  legacy?: {
    path?: string;
    disposition?: "unclassified" | "classified" | "excluded";
  } | null;
};

const statusLabel: Record<RequirementRecord["status"], string> = {
  active: "生效中",
  superseded: "已替代",
  withdrawn: "已撤回",
};

function scopeLabel(scope?: RequirementRecord["scope"]) {
  const parts = [
    scope?.sourceTypes?.length ? "来源：" + scope.sourceTypes.join("、") : "",
    scope?.modes?.length ? "范围：" + scope.modes.join("、") : "",
    scope?.labels?.length ? "标签：" + scope.labels.join("、") : "",
  ].filter(Boolean);
  return parts.join(" · ") || "默认适用于后续新建分析批次";
}

export function PrototypeAnalysisRequirements({ refreshedAt, source }: { refreshedAt: string; source?: string }) {
  const [data, setData] = useState<RequirementsState>();
  // null is the valid fingerprint for an empty registry. Keep undefined as
  // the never-loaded sentinel so a first empty response still renders.
  const fingerprint = useRef<string | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const request = async (cursor = 0, version?: string) => {
          const params = new URLSearchParams({
            command: "analysis-requirements",
            cursor: String(cursor),
            limit: "20",
            ...(version ? { fingerprint: version } : {}),
          });
          const response = await fetch("/api/prototype?" + params, {
            signal: controller.signal,
            cache: "no-store",
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "无法读取分析要求");
          if (body.items?.some((item: any) => item.oversized))
            throw new Error("分析要求记录过长，暂时无法完整显示");
          return body;
        };
        const first = await request();
        if (first.fingerprint === fingerprint.current) {
          setError("");
          return;
        }
        const records: RequirementRecord[] = [];
        let page = first;
        while (true) {
          records.push(...(page.items ?? []).map((item: any) => item.record).filter(Boolean));
          if (page.nextCursor == null) break;
          page = await request(page.nextCursor, first.fingerprint ?? undefined);
        }
        if (controller.signal.aborted) return;
        fingerprint.current = first.fingerprint ?? null;
        setData({
          recorded: Boolean(first.recorded),
          origin: first.origin || "none",
          fingerprint: first.fingerprint ?? null,
          updatedAt: first.updatedAt,
          activeCount: Number(first.activeCount ?? 0),
          records,
          legacy: first.legacy ?? null,
        });
        setError("");
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") setError(error.message);
      }
    }
    void read();
    return () => controller.abort();
  }, [refreshedAt, attempt]);

  const prompt =
    "使用 mf-dev-flow 的原型流程，维护独立的分析要求（AR）记录。\\n" +
    (source ? "适用原型：" + source + "。\\n" : "") +
    "先运行 prototype analysis-requirements list --json，确认现有 AR、版本和历史材料状态。\\n" +
    "每条 AR 只表达原型分析阶段额外需要核对的事实、操作范围或证据提示；使用 prototype analysis-requirements add/revise/withdraw 和 JSON 输入文件维护，保留其他不冲突记录。\\n" +
    "不要直接编辑 analysis-requirements.md，也不要把其中旧材料直接迁入 AR。若其内容属于最终验收，应按功能点拆成 AC；只有明确属于原型分析阶段的条目才可另建 AR。\\n" +
    "新增或修订 AR 只会进入后续新建或明确选择复评的分析批次，不能把已验收批次标为 stale。\\n" +
    "本次只保存 AR 记录，不启动原型分析、规划或开发。完成后再次运行 list 核对结果。\\n\\n" +
    "用户希望添加、修改或撤回的分析要求：\\n<请填写内容>";

  return (
    <section
      className="prototype-analysis-requirements prototype-overview-card"
      role="region"
      aria-label="分析要求"
    >
      <div className="row">
        <h3>分析要求（AR）</h3>
        <PromptButton label="维护 AR 记录" prompt={prompt} />
      </div>
      <p className="muted">
        AR 是原型分析阶段的独立输入记录。新记录只作用于后续新批次；已冻结批次保持可追溯，不因台账更新而失效。
      </p>
      {error && (
        <p className="error" role="alert">
          {error} <button onClick={() => setAttempt(attempt + 1)}>重新读取</button>
        </p>
      )}
      {!data && !error && <p role="status">读取 AR 记录…</p>}
      {data?.legacy?.disposition === "unclassified" && (
        <p className="analysis-requirements-legacy">
          检测到旧版 Markdown 历史材料，当前不会作为 AR 自动应用或迁移。像“首页验收样板”这类最终验收内容，应按功能点拆成 AC；只有明确属于分析阶段的条目才可另建 AR。
        </p>
      )}
      {data ? (
        <>
          <p className="muted">
            {data.recorded ? "已记录" : "尚未建立"} · 生效 {data.activeCount} 条
            {data.updatedAt ? " · 更新于 " + stamp(data.updatedAt) : ""}
          </p>
          {data.records.length ? (
            <div className="analysis-requirement-list">
              {data.records.map((record) => (
                <article className={"analysis-requirement " + record.status} key={record.id}>
                  <div className="analysis-requirement-heading">
                    <div>
                      <code>{record.id}</code>
                      <strong>{record.title}</strong>
                    </div>
                    <span>{statusLabel[record.status]}</span>
                  </div>
                  <p>{record.instruction}</p>
                  <p className="muted">{scopeLabel(record.scope)}</p>
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
            <p className="empty">
              尚未记录 AR。只有明确属于原型分析阶段的额外核对要求才应在这里新增；最终验收用例请登记为 AC。
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
