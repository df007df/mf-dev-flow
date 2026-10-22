"use client";
import { DashboardState } from "../lib/types";
import { stamp } from "../lib/format";
import { Badge, DetailDialog, PromptButton, Section } from "./ui";
import { DocumentButton } from "./documents";
import { MarkdownContent } from "./markdown-content";
import { PrototypeCatalogSection } from "./prototype-catalog";
import { PrototypeGroups } from "./prototype-groups";
import { PrototypeHistoryCard } from "./prototype-history";
import { PrototypeAnalysisRequirements } from "./prototype-analysis-requirements";

export function ProjectSection({
  cards,
}: {
  cards: DashboardState["projectCards"];
}) {
  return (
    <Section title="项目卡片">
      <div className="card-grid">
        {cards.map((card) => (
          <DetailDialog
            key={card.id}
            title={card.title || card.name || card.id}
            trigger={
              <button className="summary-card">
                <h3>{card.title || card.name || card.id}</h3>
                <code>{card.localPath || card.path || card.root}</code>
                <p>
                  {card.stack?.join?.(" · ") ||
                    card.description ||
                    "本地可开发项目"}
                </p>
                <div className="checks">
                  {Object.entries(card.checks || {}).map(
                    ([name, value]: [string, any]) => (
                      <span key={name}>
                        {name}{" "}
                        <Badge status={value.passed ? "passed" : "failed"} />
                      </span>
                    ),
                  )}
                </div>
                <p className="muted">
                  {card.environment?.node?.version || card.nodeVersion} ·{" "}
                  {card.environment?.packageManager?.name} ·{" "}
                  {stamp(card.checkedAt || card.updatedAt)}
                </p>
              </button>
            }
          >
            <MarkdownContent content={card.content} />
          </DetailDialog>
        ))}
      </div>
      {!cards.length && <p className="empty">尚未登记本地项目。</p>}
    </Section>
  );
}
export function PrototypeSection({ state }: { state: DashboardState }) {
  const p = state.prototype;
  const history = <PrototypeHistoryCard state={state} />;
  const requirements = <PrototypeAnalysisRequirements refreshedAt={state.generatedAt} source={state.project?.prototype?.location || p?.source?.location} />;
  const overview = (
    <div className="prototype-overview-grid">
      {requirements}
      {history}
    </div>
  );
  if (p?.native) return <PrototypeCatalogSection data={p} history={history} requirements={requirements} />;
  const groups = p?.groups || [];
  const archivedScreenshots = p?.task?.latestAudit?.rawScreenshotCount ?? groups.reduce((count: number, group: any) => count + (group.screenshotCount || 0), 0);
  const openQuestions = groups.reduce((count: number, group: any) => count + (group.questions?.open || 0), 0);
  const resolvedQuestions = groups.reduce((count: number, group: any) => count + (group.questions?.resolved || 0), 0);
  const answers = groups.reduce((count: number, group: any) => count + (group.questions?.answers || 0), 0);
  return (
    <>
      <Section title="原型图分析" action={
      <div className="actions">
        <Badge status={p?.task?.status} />
        <PromptButton
          label={p ? "重新分析原型图" : "执行原型分析"}
          prompt="使用 mf-dev-flow 分析当前原型图。先读取当前分析要求，按指定角色和页面范围建立分析批次，核验业务交互并按实际结果取证，生成分组内容与流程报告。保留此前的分析历史。"
        />
      </div>
    }>
      {p ? (
        <section className="prototype-report-card" aria-label="完整原型图流程">
          <div className="prototype-report-head">
            <div>
              <p className="prototype-card-kicker">当前完整报告</p>
              <h3>完整原型图流程</h3>
              <p>每次原型分析都更新这份报告；未受影响的分组、截图、问题和回答继续保留。</p>
            </div>
            <DocumentButton
              title="完整原型图流程"
              label="查看完整分析报告"
              content={p.flowContent}
              assetBase={p.flowAssetBase}
              documentPath={p.flowDocument}
              questions={p.questions?.questions || []}
              prototypePrompts={p.flowPrompts}
            />
          </div>
          <p className="prototype-report-metrics">
            {groups.length} 个分组 · {p.coverage?.total ?? 0} 个登记入口 · {archivedScreenshots} 张归档截图 · {openQuestions} 个待确认问题 · {resolvedQuestions} 个已解决问题 · {answers} 条 Agent 回答
          </p>
          {overview}
          {p.storage === "legacy" && (
            <p className="muted">
              入口观察数量不代表全量分析通过。
              {p.task?.latestAudit?.status === "blocked" && <>
                全量审计未通过
                {Number.isFinite(p.task.latestAudit.remainingSourceCandidates) && `，仍有 ${p.task.latestAudit.remainingSourceCandidates} 个源码候选未验证`}。
              </>}
            </p>
          )}
          <details className="prototype-analysis-info">
          <summary>分析信息与来源</summary>
          <dl className="prototype-baseline">
            <div>
              <dt>基线版本</dt>
              <dd>
                <code>{p.task?.source?.prototypeVersion || "未登记"}</code>
              </dd>
            </div>
            <div>
              <dt>原型路径（相对工作区或来源地址）</dt>
              <dd>
                <code>{state.project?.prototype?.location || "未登记"}</code>
              </dd>
            </div>
            <div>
              <dt>当前展示的分析批次</dt>
              <dd>
                <code>{p.task?.source?.prototypeRun || "未登记"}</code>
              </dd>
            </div>
            <div>
              <dt>已登记入口观察</dt>
              <dd>
                {p.coverage?.covered ?? 0}/{p.coverage?.total ?? 0} 个入口 ·{" "}
                {p.features?.length || 0} 个原型分组
              </dd>
            </div>
            <div>
              <dt>基线更新时间</dt>
              <dd>{stamp(p.task?.updatedAt)}</dd>
            </div>
          </dl>
          </details>
        </section>
      ) : (
        <section className="prototype-report-card" aria-label="完整原型图流程">
          <p className="prototype-card-kicker">当前完整报告</p>
          <h3>完整原型图流程</h3>
          <p className="empty">尚无原型分析结果。执行分析后，这里会显示完整报告及其全部分组。</p>
          {overview}
        </section>
      )}
      </Section>
      <Section title="原型分组">
        {p ? (
          <>
            <p className="muted">以下分组全部来自当前完整报告。</p>
            <PrototypeGroups groups={groups} />
            {p.groupProblems?.length > 0 && (
              <p className="error">{p.groupProblems.join("；")}</p>
            )}
          </>
        ) : (
          <p className="empty">尚无原型分析结果，执行分析后这里会显示原型分组。</p>
        )}
      </Section>
    </>
  );
}
export function SystemSection({
  system,
}: {
  system: DashboardState["system"];
}) {
  return (
    <Section
      title="系统卡片"
      action={
        <PromptButton
          label="更新或添加系统信息"
          prompt="使用 mf-dev-flow 核验并更新或添加当前项目引用的外部系统信息。"
        />
      }
    >
      <div className="card-grid">
        {system?.cards?.map((card: any) => (
          <DetailDialog
            key={card.id}
            title={card.systemName || card.title}
            trigger={
              <button className="summary-card">
                <div className="row">
                  <h3>{card.systemName || card.title}</h3>
                  <Badge status={card.status} />
                </div>
                <code>{card.referenceProjectPath || "未登记代码路径"}</code>
                <p>{card.referencePositioning}</p>
                <p>
                  测试配置 / 地址：{card.referenceTestConfigurationCount} /{" "}
                  {card.referenceTestAddressCount}
                  <br />
                  线上配置 / 地址：{
                    card.referenceOnlineConfigurationCount
                  } / {card.referenceOnlineAddressCount}
                </p>
                <p>
                  API 使用：{card.apiUsages?.length || card.apiUsageCount || 0}{" "}
                  · 未解决问题：
                  {card.technicalIssues?.filter(
                    (i: any) => i.status !== "resolved",
                  ).length ||
                    card.openIssueCount ||
                    0}
                </p>
                <p className="muted">
                  只读参考 · {stamp(card.lastVerifiedAt || card.updatedAt)}
                </p>
              </button>
            }
          >
            <MarkdownContent content={card.content} systemPrompt={card.questionPrompt} />
          </DetailDialog>
        ))}
      </div>
      {!system?.cards?.length && <p className="empty">尚未登记外部系统。</p>}
      <div className="agreements">
        <div className="row">
          <h3>明确约定</h3>
          <PromptButton
            label="登记明确约定"
            prompt="使用 mf-dev-flow 更新系统明确约定。\n用户约定：<请补充>。"
          />
        </div>
        {system?.agreements?.map((a: any, i: number) => (
          <p key={a.id || i}>
            <Badge status={a.status} /> {a.title || a.content || a.statement}
            {a.summary && (
              <span className="agreement-summary">{a.summary}</span>
            )}
          </p>
        ))}
        <DocumentButton
          title="明确约定"
          content={system?.agreementsContent}
        />
      </div>
    </Section>
  );
}
