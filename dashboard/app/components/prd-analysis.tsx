"use client";
import { DashboardState } from "../lib/types";
import { stamp } from "../lib/format";
import { Badge, PromptButton, Section } from "./ui";
import { DocumentButton } from "./documents";

type PrdState = NonNullable<DashboardState["prd"]>;
type PrdBatch = NonNullable<PrdState["batch"]>;
type PrdDocument = PrdBatch["documents"][keyof PrdBatch["documents"]];

const ingestPrompt = `使用 mf-dev-flow 执行 PRD 阅读与取证流程（先读 flows/prd/entry.md 与 protocol.md）：用 prd ingest 冻结 PRD 来源（文件/目录用 --file、--dir；Word 直接 ingest；钉钉文档经「钉钉文档」MCP 只读工具取全文后 --snapshot 登记）；再全量精读，按协议撰写 findings.json。PRD 原文只读，不得修改。`;

const verifyPrompt = (batchId: string) => `使用 mf-dev-flow 核验 PRD 会议材料（批次 ${batchId}）：先 prd status --json 确认来源无漂移，再 prd check --batch ${batchId} --json 逐字核验引文；有 problems 时只修改 findings.json 修正后复检，全部通过后 prd render --batch ${batchId} 重出两份会议文档。PRD 原文保持只读。`;

const renderPrompt = (batchId: string) => `使用 mf-dev-flow 生成 PRD 会议材料：先 prd check --batch ${batchId} --json，核验全部通过后执行 prd render --batch ${batchId}，生成矛盾与不清楚清单、核心原则与红线索引两份文档。check 不通过时先修 findings.json，不得改来源快照凑数。`;

function cardStatus(doc: PrdDocument, check: PrdBatch["check"], checkError: string | null) {
  if (!check) return { status: "failed", label: checkError ? "核验异常" : "未核验" };
  if (!check.ok) return { status: "failed", label: `证据核验未通过 · ${check.problems.length} 项` };
  if (!doc.exists) return { status: "pending", label: "核验通过 · 会议材料未生成" };
  return { status: "passed", label: `证据核验通过 · 逐字引文 ${check.checkedQuotes} 条` };
}

function PrdDocumentCard({
  title,
  intro,
  doc,
  batch,
}: {
  title: string;
  intro: string;
  doc: PrdDocument;
  batch: PrdBatch;
}) {
  const { status, label } = cardStatus(doc, batch.check, batch.checkError ?? null);
  const tally = doc.tally;
  return (
    <article className="prototype-overview-card prd-doc-card">
      <div className="row">
        <h3>{title}</h3>
        <Badge status={status} label={label} />
      </div>
      <p className="muted">{intro}</p>
      <p>
        {tally.items} 条 · 高 {tally.high} / 中 {tally.medium} / 低 {tally.low} · 引文证据 {tally.quotes} 条 · 关联来源 {batch.usedSourceCount} 篇
      </p>
      <p className="muted">
        批次 <code>{batch.id}</code> · {doc.exists ? `文档更新 ${stamp(doc.updatedAt)}` : "会议文档未生成（prd render 后提供）"} · 分析更新 {stamp(batch.updatedAt)}
      </p>
      {batch.checkError && <p className="error">{batch.checkError}</p>}
      {batch.check && !batch.check.ok && (
        <>
          {batch.check.problems.slice(0, 3).map((problem: any) => (
            <p className="error" key={`${problem.path}:${problem.message}`}>
              {problem.path}：{problem.message}
            </p>
          ))}
          {batch.check.problems.length > 3 && (
            <p className="error">另有 {batch.check.problems.length - 3} 项未展示，复制下方提示词让 Agent 逐项修复。</p>
          )}
        </>
      )}
      <div className="actions">
        {doc.exists && (
          <DocumentButton title={title} label="查看会议文档" content={doc.content} documentPath={doc.path} />
        )}
        <PromptButton
          label={batch.check?.ok && !doc.exists ? "生成会议材料" : "核验并更新分析"}
          prompt={
            batch.check?.ok && !doc.exists ? renderPrompt(batch.id) : verifyPrompt(batch.id)
          }
        />
      </div>
      {batch.check?.ok && doc.exists && batch.check.warnings.length > 0 && (
        <p className="muted">提示：{batch.check.warnings.length} 条会议补充建议（如背景/方向未写），不影响引文核验。</p>
      )}
    </article>
  );
}

function PrdEmptyCard({ prd }: { prd: PrdState | null | undefined }) {
  const hasBatch = !!prd?.batches?.length;
  const frozen = prd?.sourceCount ? `已冻结 ${prd.sourceCount} 篇来源，` : "PRD 来源未冻结，";
  return (
    <article className="prototype-overview-card prd-doc-card">
      <div className="row">
        <h3>PRD 分析尚未建立</h3>
        <Badge status="pending" label="未分析" />
      </div>
      <p>{frozen}尚无展示中的有效分析批次。矛盾与不清楚清单、原则与红线证据索引将在 findings.json 通过 prd check 后展示于此。</p>
      <div className="actions">
        <PromptButton
          label={hasBatch ? "修复并核验批次" : "执行 PRD 分析"}
          prompt={
            hasBatch
              ? `使用 mf-dev-flow 修复 PRD 分析批次：先 prd status --json 列出批次，再 prd check --batch <批次ID> --json 定位 findings.json 的问题（含解析失败），逐项修正后 prd render --batch <批次ID> 生成会议文档。PRD 原文保持只读。`
              : ingestPrompt
          }
        />
      </div>
    </article>
  );
}

export function PrdSection({ prd }: { prd: DashboardState["prd"] }) {
  const batch = prd?.batch && !prd.batch.parseError ? prd.batch : null;
  const documents = batch?.documents;
  return (
    <Section
      title="PRD 分析"
      action={
        <div className="actions">
          {batch?.check ? (
            <Badge
              status={batch.check.ok ? "passed" : "failed"}
              label={
                batch.check.ok
                  ? `证据核验通过 · 逐字引文 ${batch.check.checkedQuotes} 条`
                  : `证据核验未通过 · ${batch.check.problems.length} 项`
              }
            />
          ) : (
            <Badge status="pending" label="未分析" />
          )}
          <PromptButton
            label={batch ? "核验并更新分析" : "执行 PRD 分析"}
            prompt={batch ? verifyPrompt(batch.id) : ingestPrompt}
          />
        </div>
      }
    >
      <p className="muted">
        会议材料 · 只读取证 · {prd?.sourceCount ? `已冻结 ${prd.sourceCount} 篇来源` : "来源未冻结"}
        {batch?.check?.ok ? "，每条结论的引文都在服务端按冻结快照逐字实时核验" : ""}
      </p>
      {prd?.error && <p className="error">{prd.error}</p>}
      {batch?.parseError && <p className="error">{batch.parseError}</p>}
      {batch?.title && <p className="muted">{batch.title}</p>}
      <div className="card-grid prd-card-grid">
        {batch && documents ? (
          <>
            <PrdDocumentCard
              title="矛盾与不清楚清单"
              intro="业务逻辑互相冲突（contradiction）与口径不清楚（ambiguity）；每条附冻结快照中的逐字引文，开会逐项确认。"
              doc={documents.contradictions}
              batch={batch}
            />
            <PrdDocumentCard
              title="核心原则与红线证据索引"
              intro="核心原则（principle）与红线（redline）；每条含原文与出处，供讨论引用与变更复评作证据。"
              doc={documents.redlines}
              batch={batch}
            />
          </>
        ) : (
          <PrdEmptyCard prd={prd} />
        )}
      </div>
    </Section>
  );
}
