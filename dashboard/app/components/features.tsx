"use client";
import { Feature, Planning } from "../lib/types";
import { developmentPrompt, order, stamp } from "../lib/format";
import { Badge, DetailDialog, PromptButton, Section } from "./ui";
import { EvidenceGallery } from "./documents";
import FeatureBoard from "./feature-board";
import { FeatureLabels, FeatureAnalysis } from "./feature-analysis";
import { DataFlowDiagram, type DataFlowSpec } from "./data-flow-diagram";
import { FeatureAcceptanceCases } from "./feature-acceptance-cases";

const stageNames: Record<string, string> = {
  solution_design: "方案设计",
  development: "功能开发",
  prototype_alignment: "原型对齐",
  api_mock: "API / Mock",
  technical_implementation: "技术实现",
  end_to_end_acceptance: "端到端验收",
};

const impactReasonNames: Record<string, string> = {
  prototype_entry_changed: "原型入口变化",
  prototype_group_changed: "原型分组变化",
  global_or_unattributed_change: "全局或未归属变化",
  migration_descendant: "迁移关系影响",
};

function impactReasonLabel(reason: string) {
  if (impactReasonNames[reason]) return impactReasonNames[reason];
  if (reason.startsWith("descendant:")) return `上级范围变化（${reason.slice("descendant:".length)}）`;
  return reason;
}

function FeatureImpactReview({ planning }: { planning: Planning }) {
  const impact = planning.prototypeImpact;
  if (!impact || impact.status !== "review_required" || !impact.affected?.length) return null;
  const features = new Map(planning.features.map((feature) => [feature.id, feature]));
  return (
    <section className="feature-impact-review" aria-label="功能变更影响">
      <div className="feature-impact-review-heading">
        <div>
          <span className="feature-impact-kicker">PRD / 原型已变化</span>
          <h3>变更影响待复评</h3>
          <p>
            已检测到 {impact.changedGroupIds?.length ?? 0} 个原型分组变化、
            {impact.changedEntryIds?.length ?? 0} 个原型入口变化；旧功能状态会保留，但在复评前不能沿用旧规划继续开发。
          </p>
        </div>
        <span className="feature-impact-count">{impact.affected.length} 个受影响功能</span>
      </div>
      <div className="feature-impact-list">
        {impact.affected.map((item) => {
          const feature = features.get(item.id);
          return (
            <article key={item.id}>
              <div>
                <strong>{feature?.title ?? item.id}</strong>
                <code>{item.id}</code>
              </div>
              <Badge status="review_required" />
              <p>{(item.reasons ?? []).map(impactReasonLabel).join(" · ") || "需要复评"}</p>
            </article>
          );
        })}
      </div>
      {impact.problems?.length ? <p className="error">{impact.problems.join("；")}</p> : null}
    </section>
  );
}

type StageEvidence = { path: string; label?: string; action?: string };
type AcceptanceCriterion = { id: string; title: string; detail: string };
type AcceptanceResult = {
  status?: "passed" | "failed" | "not_applicable";
  summary?: string;
  evidence?: string[];
  updatedAt?: string;
};
type StageDocumentation = {
  description?: string;
  process?: Array<{ id: string; title: string; detail: string }>;
  outputs?: Array<{ id: string; title: string; detail: string }>;
};
type MockContract = {
  method?: string;
  url?: string | null;
  endpoint?: string | null;
  httpStatus?: number | null;
  responseFile?: string | null;
  fieldDefinitions?: Array<{ path: string; type: string }>;
  response?: unknown;
};
type Stage = {
  id: string;
  status?: string;
  summary?: string;
  documentation?: StageDocumentation | null;
  acceptanceCriteria?: AcceptanceCriterion[];
  acceptanceResults?: Record<string, AcceptanceResult>;
  evidence?: StageEvidence[];
  evidenceSource?: { runId?: string; taskId?: string; note?: string };
  latestRunNote?: string | null;
  mockContracts?: MockContract[];
  visualPairs?: Array<{
    id: string;
    state: string;
    action?: string;
    screenshots: StageEvidence[];
  }>;
  visualReviews?: Array<{
    pairId: string;
    status: string;
    reviewedAt?: string | null;
    differences: Array<{
      regionId: string;
      kind: string;
      status: string;
      detail: string;
    }>;
  }>;
};
type StagesInput = Record<string, Omit<Stage, "id">> | Stage[];

function stageEntries(stages: StagesInput = {}): Stage[] {
  return Array.isArray(stages)
    ? stages
    : Object.entries(stages).map(([id, stage]) => ({ id, ...stage }));
}

function stageTone(status?: string) {
  const value = status?.toLowerCase();
  if (["confirmed", "done", "completed", "passed"].includes(value || ""))
    return "done";
  if (["blocked", "failed"].includes(value || "")) return "blocked";
  if (value === "in_progress") return "progress";
  if (value === "not_applicable") return "not-applicable";
  return "pending";
}

function stageProgress(entries: Stage[]) {
  const applicable = entries.filter((stage) => stage.status !== "not_applicable");
  const closed = applicable.filter((stage) =>
    ["confirmed", "done"].includes(stage.status || ""),
  ).length;
  return { applicable, closed };
}

function stageProgressLabel(entries: Stage[], applicable: Stage[], closed: number) {
  return !entries.length
    ? "阶段尚未建立"
    : !applicable.length
      ? `${entries.length} 项已豁免 · 无开发闭环`
      : `${closed}/${applicable.length} 阶段已闭环`;
}

export function Stages({
  stages = {},
}: {
  stages?: StagesInput;
}) {
  const entries = stageEntries(stages);
  const { applicable, closed } = stageProgress(entries);
  return (
    <div className="stages">
      <p className="muted">
        {!entries.length
          ? "阶段尚未建立"
          : !applicable.length
            ? `${entries.length} 项已豁免 · 无开发闭环`
            : `${closed}/${applicable.length} 阶段已闭环`}
      </p>
      {entries.map((stage) => (
        <span key={stage.id} title={stage.summary}>
          {stageNames[stage.id] || stage.id} <Badge status={stage.status} />
        </span>
      ))}
    </div>
  );
}

export function StageProgressRing({ stages }: { stages?: StagesInput }) {
  const entries = stageEntries(stages);
  const { applicable, closed } = stageProgress(entries);
  const progressLabel = stageProgressLabel(entries, applicable, closed);
  const segment = entries.length ? 100 / entries.length : 0;
  const visibleSegment = Math.max(0, segment - 1.5);

  return (
    <span className="stage-progress" aria-label={`阶段进度：${progressLabel}`}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="stage-progress-track" cx="20" cy="20" r="15.9155" />
        {entries.map((stage, index) => (
          <circle
            key={stage.id}
            className={`stage-progress-segment ${stageTone(stage.status)}`}
            cx="20"
            cy="20"
            r="15.9155"
            pathLength="100"
            strokeDasharray={`${visibleSegment} ${100 - visibleSegment}`}
            strokeDashoffset={-index * segment}
            transform="rotate(-90 20 20)"
          />
        ))}
        <text x="20" y="21" textAnchor="middle">
          {entries.length && applicable.length ? `${closed}/${applicable.length}` : "—"}
        </text>
      </svg>
      <span className="stage-progress-tooltip" role="tooltip">
        <strong>阶段详情 · {progressLabel}</strong>
        {entries.length ? (
          entries.map((stage) => (
            <span className="stage-progress-tooltip-row" key={stage.id}>
              <span>{stageNames[stage.id] || stage.id}</span>
              <Badge status={stage.status} />
              <span>{stage.summary || "暂无阶段说明"}</span>
            </span>
          ))
        ) : (
          <span className="stage-progress-tooltip-empty">暂无阶段记录</span>
        )}
      </span>
    </span>
  );
}

export function FeatureStageCards({ stages }: { stages?: StagesInput }) {
  const entries = stageEntries(stages);
  const { applicable, closed } = stageProgress(entries);
  return (
    <section className="feature-stage-section">
      <div className="feature-stage-heading">
        <h3>交付阶段</h3>
        <p>{stageProgressLabel(entries, applicable, closed)}</p>
      </div>
      {entries.length ? (
        <div className="feature-stage-grid">
          {entries.map((stage) => (
            <article
              className={`feature-stage-card ${stageTone(stage.status)}`}
              key={stage.id}
            >
              <div>
                <strong>{stageNames[stage.id] || stage.id}</strong>
                <Badge status={stage.status} />
              </div>
              <p>{stage.summary || "暂无阶段说明"}</p>
              {stage.documentation ? (
                <section className="feature-stage-documentation">
                  <strong>阶段说明</strong>
                  <p>{stage.documentation.description || stage.summary || "待补充"}</p>
                  <strong>阶段过程</strong>
                  <ol>
                    {stage.documentation.process?.map((item) => (
                      <li key={item.id}>
                        <b>{item.title}：</b>{item.detail}
                      </li>
                    ))}
                  </ol>
                  <strong>阶段产出</strong>
                  <ul>
                    {stage.documentation.outputs?.map((item) => (
                      <li key={item.id}>
                        <b>{item.title}：</b>{item.detail}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {stage.acceptanceCriteria?.length ? (
                <section className="feature-stage-acceptance">
                  <strong>验收内容</strong>
                  <ul>
                    {stage.acceptanceCriteria.map((criterion) => (
                      <li key={criterion.id}>
                        <b>{criterion.title}：</b>{criterion.detail}
                        {stage.acceptanceResults?.[criterion.id] ? (
                          <p className="feature-stage-acceptance-result">
                            用例结果：{stage.acceptanceResults[criterion.id].status || "待记录"}
                            {stage.acceptanceResults[criterion.id].summary
                              ? " · " + stage.acceptanceResults[criterion.id].summary
                              : ""}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {stage.evidenceSource && (
                <p className="feature-stage-source">
                  证据来源：{stage.evidenceSource.runId}/{stage.evidenceSource.taskId}。
                  {stage.evidenceSource.note}
                </p>
              )}
              {stage.id === "api_mock" ? (
                <section className="feature-stage-mock-contracts">
                  <strong>已归档 Mock 契约</strong>
                  {stage.mockContracts?.length ? stage.mockContracts.map((contract, index) => (
                    <details key={`${contract.url ?? contract.endpoint ?? "mock"}-${index}`}>
                      <summary>
                        {contract.method || "HTTP"} {contract.url || contract.endpoint || "URL 待补充"}
                        {contract.httpStatus ? ` · ${contract.httpStatus}` : ""}
                      </summary>
                      <p><b>字段定义：</b>{contract.fieldDefinitions?.length
                        ? contract.fieldDefinitions.map((field) => `${field.path}: ${field.type}`).join("；")
                        : "未归档"}</p>
                      <p><b>完整 JSON：</b>{contract.responseFile || "未归档"}</p>
                      {contract.response !== null && contract.response !== undefined ? (
                        <pre>{JSON.stringify(contract.response, null, 2)}</pre>
                      ) : null}
                    </details>
                  )) : (
                    <p className="feature-stage-empty-output">
                      尚未归档当前交付的 Mock 契约。完成阶段后此处会显示完整 URL、响应截图、完整 JSON 与字段定义。
                    </p>
                  )}
                </section>
              ) : null}
              {stage.id === "prototype_alignment" ? (
                <section className="feature-stage-visual-output">
                  <strong>已归档截图对</strong>
                  {stage.visualPairs?.length ? stage.visualPairs.map((pair) => {
                    const reviews = stage.visualReviews?.filter(
                      (review) => review.pairId === pair.id,
                    ) ?? [];
                    return (
                      <article className="feature-stage-visual-pair" key={pair.id}>
                        <h4>{pair.state}</h4>
                        <p>{pair.action || "复现动作待补充"}</p>
                        <div className="visual-pair">
                          {pair.screenshots.map((shot) => (
                            <div key={shot.path}>
                              <strong>{shot.label || "归档截图"}</strong>
                              <EvidenceGallery files={[shot]} />
                            </div>
                          ))}
                        </div>
                        {reviews.length ? reviews.map((review, index) => (
                          <section
                            className={`feature-stage-difference ${review.status}`}
                            key={`${review.pairId}-${index}`}
                          >
                            <strong>{review.differences.length ? "差异对照" : "逐区审查"}</strong>
                            <p>审查状态：{review.status}</p>
                            {review.differences.length ? (
                              <ul>
                                {review.differences.map((difference, differenceIndex) => (
                                  <li key={`${difference.regionId}-${difference.kind}-${differenceIndex}`}>
                                    <b>{difference.regionId} / {difference.kind}：</b>{difference.detail}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p>该截图对的全部业务区块均已通过。</p>
                            )}
                          </section>
                        )) : (
                          <p className="feature-stage-empty-output">尚未归档这组截图的逐区审查结论。</p>
                        )}
                      </article>
                    );
                  }) : (
                    <p className="feature-stage-empty-output">
                      尚未归档当前交付的原型图 / UI 图截图对。完成阶段后按同一业务状态并排显示。
                    </p>
                  )}
                </section>
              ) : null}
              {stage.evidence?.length ? (
                <div className="feature-stage-evidence">
                  <strong>阶段截图</strong>
                  <EvidenceGallery files={stage.evidence} />
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">暂无阶段记录</p>
      )}
    </section>
  );
}

const historyTypeNames: Record<string, string> = {
  stage_updated: "阶段状态更新",
  task_finished: "任务完成记录",
  verification_updated: "验证结果更新",
};

function featureQuestionPrompt(feature: Feature) {
  return `使用 mf-dev-flow 更新功能演进地图。\n功能：${feature.id} · ${feature.title}。\n功能疑问补充：<回答已有疑问，或补充新的功能疑问、结论与依据>`;
}

function developmentRequirementPrompt(feature: Feature) {
  return `使用 mf-dev-flow 更新功能演进地图。\n功能：${feature.id} · ${feature.title}。\n开发要求补充：<补充或调整开发范围、验收要求、依赖与约束>`;
}

function FeatureHistory({ history = [] }: Pick<Feature, "history">) {
  if (!history.length) return null;
  return (
    <details className="feature-history">
      <summary>开发历史（{history.length}）</summary>
      <div className="feature-history-list">
        {history.map((entry) => {
          const status =
            entry.stage?.status ?? entry.verification?.status ?? entry.taskStatus;
          const title =
            entry.stage?.title ??
            historyTypeNames[entry.type || ""] ??
            "开发记录";
          return (
            <article className="feature-history-card" key={entry.id}>
              <div className="feature-history-card-header">
                <div>
                  <strong>{title}</strong>
                  <span>
                    {stamp(entry.at)} · {entry.taskTitle || entry.runTitle || "任务待标注"}
                  </span>
                </div>
                <Badge status={status} />
              </div>
              <p>{entry.summary || entry.stage?.summary || "暂无记录摘要。"}</p>
              {entry.decision && (
                <p>
                  <b>决策：</b>{entry.decision}
                </p>
              )}
              {entry.blocker && (
                <p className="error">
                  <b>阻塞：</b>{entry.blocker}
                </p>
              )}
              {entry.verification?.commands && (
                <p className="feature-history-verification">
                  <b>验证：</b>{entry.verification.commands}
                </p>
              )}
              <footer>
                {entry.runId && <code>{entry.runId}</code>}
                {entry.phase && <span>{entry.phase}</span>}
              </footer>
            </article>
          );
        })}
      </div>
    </details>
  );
}

export function FeatureDetail({
  feature,
  interactive = true,
}: {
  feature: Feature;
  interactive?: boolean;
}) {
  const prototypeEntries: NonNullable<Feature["prototypeEntries"]> = feature.prototypeEntries?.length
    ? feature.prototypeEntries
    : (feature.sourceEntries ?? []).map((id) => ({ id, title: id }));
  return (
    <>
      <div className="feature-detail-top">
        <div>
          <code>{feature.id}</code>
          <Badge status={feature.status} />
          <FeatureLabels feature={feature} />
        </div>
        {interactive && (
          <PromptButton
            label="指定功能点完整开发"
            prompt={developmentPrompt(feature)}
            primary
          />
        )}
      </div>
      <h3>功能说明</h3>
      <p>{feature.description || feature.outcome || "待补充"}</p>
      <section className="feature-detail-section prototype-entry-section">
        <h3>关联原型入口</h3>
        {prototypeEntries.length ? (
          <ul className="prototype-entry-list">
            {prototypeEntries.map((entry) => (
              <li key={entry.id}>
                <code>{entry.id}</code>
                {entry.title && entry.title !== entry.id && <span>{entry.title}</span>}
                {entry.groupId && <span className="muted">原型分组：{entry.groupId}</span>}
                {typeof entry.evidenceCount === "number" && (
                  <span className="muted">来源证据：{entry.evidenceCount}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="error">未关联原型入口；功能地图门禁不会允许该功能点被应用。</p>
        )}
      </section>
      <section className="feature-detail-section prototype-source-screenshots">
        <h3>来源截图</h3>
        <p className="muted">
          复用关联原型入口在原型文档中的 observed 截图；功能地图不另行复制截图。
        </p>
        <EvidenceGallery files={feature.sourceScreenshots || []} />
      </section>
      <FeatureAnalysis feature={feature} />
      <h3>依赖功能</h3>
      <div className="feature-dependencies">
        {feature.dependsOn?.length
          ? feature.dependsOn.map((id) => <code key={id}>{id}</code>)
          : "无前置依赖"}
      </div>
      <section className="feature-detail-section">
        <div className="feature-detail-section-heading">
          <h3>功能疑问</h3>
          {interactive && (
            <PromptButton
              label="补充功能疑问"
              prompt={featureQuestionPrompt(feature)}
            />
          )}
        </div>
        {feature.questions?.map((q) => (
          <div key={q.id} className="feature-question">
            <p>
              <Badge status={q.status} /> {q.question || q.title}
              {q.resolution ? ` · ${q.resolution}` : ""}
            </p>
            {q.status === "resolved" && (q.answer || q.conclusion) ? (
              <div className="feature-question-answer">
                <div className="feature-question-answer-text">
                  {q.answer ? (
                    <p className="feature-question-answer-body">
                      <span className="feature-question-answer-label">
                        {q.answerActor ? `${q.answerActor} · 回答` : "Agent · 回答"}
                      </span>
                      {q.answer}
                    </p>
                  ) : null}
                  {q.conclusion ? (
                    <p className="feature-question-answer-conclusion">
                      <span className="feature-question-answer-label">结论</span>
                      {q.conclusion}
                    </p>
                  ) : null}
                </div>
                {q.dataFlow ? (
                  <aside className="feature-question-answer-diagram" aria-label="数据流转流程图">
                    <DataFlowDiagram
                      spec={q.dataFlow as DataFlowSpec}
                      context={{
                        question: q.question || q.title,
                        answer: q.answer,
                        conclusion: q.conclusion,
                        answerActor: q.answerActor,
                      }}
                    />
                  </aside>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        {feature.blockers?.map((b, i) => (
          <p key={i} className="error">
            {b}
          </p>
        ))}
        {!feature.questions?.length && !feature.blockers?.length && (
          <p>暂无记录</p>
        )}
      </section>
      <section className="feature-detail-section">
        <div className="feature-detail-section-heading">
          <h3>开发要求</h3>
          {interactive && (
            <PromptButton
              label="补充开发要求"
              prompt={developmentRequirementPrompt(feature)}
            />
          )}
        </div>
        <ul>
          {feature.developmentRequirements?.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      </section>
      <FeatureStageCards stages={feature.stages} />
      <FeatureHistory history={feature.history} />
    </>
  );
}
export function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <DetailDialog
      title={feature.title}
      trigger={
        <button className="feature-card" data-feature-id={feature.id}>
          <div className="row">
            <strong>{feature.title}</strong>
            <Badge status={feature.status} />
          </div>
          <code className="planning-feature-id">{feature.id}</code>
          <FeatureLabels feature={feature} />
          <p>{feature.description || feature.outcome}</p>
          <div className="feature-dependencies">
            {feature.dependsOn?.length ? (
              feature.dependsOn.map((id) => <code key={id}>{id}</code>)
            ) : (
              <span className="muted">无前置依赖</span>
            )}
          </div>
          <StageProgressRing stages={feature.stages} />
        </button>
      }
    >
      <FeatureDetail feature={feature} />
    </DetailDialog>
  );
}

function FeatureDocument({ planning }: { planning: Planning }) {
  const groups = order(planning.groups);
  const groupedIds = new Set(groups.map((group) => group.id));
  const sections = [
    ...groups.map((group) => ({
      id: group.id,
      title: group.title,
      features: order(
        planning.features.filter((feature) => feature.parentId === group.id),
      ),
    })),
    {
      id: "ungrouped",
      title: "未分组功能",
      features: order(
        planning.features.filter((feature) => !groupedIds.has(feature.parentId ?? "")),
      ),
    },
  ].filter((section) => section.features.length);
  const outline = [
    { id: "feature-document-overview", title: "文档说明", level: 1 },
    ...sections.flatMap((section, sectionIndex) => [
      {
        id: `feature-document-group-${sectionIndex}`,
        title: section.title,
        level: 2,
      },
      ...section.features.map((feature, featureIndex) => ({
        id: `feature-document-feature-${sectionIndex}-${featureIndex}`,
        title: feature.title,
        level: 3,
      })),
    ]),
  ];
  return (
    <div className="feature-document-layout">
      <main className="feature-document-content">
        <h1 id="feature-document-overview">完整功能点详情</h1>
        <p className="muted">
          共 {planning.features.length} 个功能点。每个功能点按“功能说明 → 原型入口 → 来源截图 → 分析与 P/W → 依赖 → 疑问 → 开发要求 → 交付阶段”展示；此处只读，不会改写地图。
        </p>
        {sections.map((section, sectionIndex) => (
          <section
            className="feature-document-group"
            id={`feature-document-group-${sectionIndex}`}
            key={section.id}
          >
            <h2>{section.title}</h2>
            {section.features.map((feature, featureIndex) => (
              <article
                className="feature-document-item"
                data-feature-id={feature.id}
                id={`feature-document-feature-${sectionIndex}-${featureIndex}`}
                key={feature.id}
              >
                <h3>{feature.title}</h3>
                <FeatureDetail feature={feature} interactive={false} />
              </article>
            ))}
          </section>
        ))}
      </main>
      <nav className="document-toc feature-document-toc" aria-label="功能点详情目录">
        <strong>文档目录</strong>
        {outline.map((entry) => (
          <button
            key={entry.id}
            style={{ paddingLeft: (entry.level - 1) * 10 }}
            onClick={() =>
              document
                .getElementById(entry.id)
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            {entry.title}
          </button>
        ))}
      </nav>
    </div>
  );
}

function PlanningDocumentButton({ planning }: { planning: Planning }) {
  return (
    <DetailDialog
      title={`完整功能点详情 · ${planning.features.length} 个功能点`}
      trigger={<button className="button">查看完整功能点详情</button>}
    >
      <FeatureDocument planning={planning} />
    </DetailDialog>
  );
}

export function FeatureBoardSection({
  planning,
  project,
}: {
  planning?: Planning;
  project: any;
}) {
  return (
    <Section
      title="功能点看板"
      action={
        <div className="actions">
          <PromptButton
            label="打开功能地图继续推进功能"
            prompt="使用 mf-dev-flow 从功能地图继续推进一个功能点。优先续做可继续任务，否则选择一个最小可开发叶子功能，按默认流程完整交付。"
          />
          <PromptButton
            label="扫描事实并更新功能地图"
            prompt="使用 mf-dev-flow 的功能规划流程更新功能演进地图。先执行 feature impact --json，再执行 feature refine --scope auto；默认只读 brief.md 和分页影响摘要。按受影响分组使用 run context --detail prototype|planning --group <ID> 分页核对原型与旧/新功能，代码、系统和开发记录也只按需读取具体分区。禁止整读原型报告、context.json、prototype-impact.json、previous-map.json 或 proposal.json，避免上下文和 token 爆炸。逐组形成有优先级、依赖和初步三类来源分析的功能点，每组用 feature proposal-patch 增量写入，最后执行 feature apply 统一校验。"
          />
        </div>
      }
    >
      {planning ? (
        <FeatureBoard state={{ project, planning }} />
      ) : (
        <p className="empty">尚未建立功能点看板。</p>
      )}
    </Section>
  );
}

export function FeatureGroupListSection({
  planning,
  refreshedAt,
}: {
  planning?: Planning;
  refreshedAt: string;
}) {
  return (
    <Section title="功能点分组列表">
      {planning ? (
        <>
          <FeatureImpactReview planning={planning} />
          <FeatureAcceptanceCases planning={planning} refreshedAt={refreshedAt} />
          <div className="planning-groups">
            {order(planning.groups).map((group) => (
              <section key={group.id}>
                <h3>{group.title}</h3>
                <div className="planning-list">
                  {order(
                    planning.features.filter((f) => f.parentId === group.id),
                  ).map((feature) => (
                    <FeatureCard key={feature.id} feature={feature} />
                  ))}
                </div>
              </section>
            ))}
            {planning.features.some(
              (f) => !planning.groups.some((g) => g.id === f.parentId),
            ) && (
              <section>
                <h3>未分组功能</h3>
                <div className="planning-list">
                  {planning.features
                    .filter(
                      (f) => !planning.groups.some((g) => g.id === f.parentId),
                    )
                    .map((feature) => (
                      <FeatureCard key={feature.id} feature={feature} />
                    ))}
                </div>
              </section>
            )}
          </div>
          <PlanningDocumentButton planning={planning} />
        </>
      ) : (
        <p className="empty">尚未建立功能点分组列表。</p>
      )}
    </Section>
  );
}
