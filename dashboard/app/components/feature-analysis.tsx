"use client";
import { Feature } from "../lib/types";

export function FeatureLabels({ feature }: { feature: Feature }) {
  return (
    <div className="feature-labels" aria-label="优先级与开发批次">
      <span
        className={`kind-label ${feature.kind === "technical" ? "technical" : "product"}`}
        title={
          feature.kind === "technical"
            ? "技术功能：非产品需求的重构/调整，按系统卡片与接口契约验收。"
            : "产品功能：对用户可见的独立结果，按原型与产品边界验收。"
        }
      >
        {feature.kind === "technical" ? "技术" : "产品"}
      </span>
      <span
        className="priority-label"
        title={feature.priorityReason || "优先级依据待补充"}
      >
        {feature.priority || "P 未评估"}
      </span>
      <span
        className="wave-label"
        title={feature.waveReason || "开发批次依据待补充"}
      >
        {feature.wave || "W 未评估"}
      </span>
    </div>
  );
}

export function FeatureAnalysis({ feature }: { feature: Feature }) {
  const analysis = feature.analysis;
  return (
    <div className="feature-analysis">
      <section className="feature-analysis-section">
        <h3>功能分析</h3>
        {analysis ? (
          <>
            <h4>原型推导</h4>
            <p>{analysis.prototype}</p>
            <h4>开发项目现状</h4>
            <p>{analysis.code}</p>
            <h4>外部系统依据</h4>
            <p>{analysis.systems}</p>
            <h4>范围与边界</h4>
            <p>{analysis.scope}</p>
            <h4>差距与待核验项</h4>
            <ul>
              {analysis.gaps.map((gap, i) => (
                <li key={i}>{gap}</li>
              ))}
            </ul>
            <details>
              <summary>分析来源（{analysis.sources.length}）</summary>
              <ul>
                {analysis.sources.map((source, i) => (
                  <li key={i}>
                    <code>{source.ref}</code>
                    <p>{source.note}</p>
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <p className="muted">
            尚未完成三类来源分析，请通过功能地图更新流程补充。
          </p>
        )}
      </section>
      <section className="feature-analysis-section feature-label-rationale">
        <h3>P / W 标签依据</h3>
        <p>
          <strong>{feature.priority || "P 未评估"}</strong>：
          {feature.priorityReason || "优先级依据待补充。"}
        </p>
        <p>
          <strong>{feature.wave || "W 未评估"}</strong>：
          {feature.waveReason || "开发批次依据待补充。"}
        </p>
        {!!feature.labelHistory?.length && (
          <details>
            <summary>标签评估记录（{feature.labelHistory.length}）</summary>
            {feature.labelHistory.map((entry, i) => (
              <article key={i}>
                <p>
                  {entry.at} · <code>{entry.runId}</code>
                </p>
                <p>
                  {entry.from.priority || "未设置"} → {entry.to.priority}：
                  {entry.priorityReason}
                </p>
                <p>
                  {entry.from.wave || "未设置"} → {entry.to.wave}：
                  {entry.waveReason}
                </p>
              </article>
            ))}
          </details>
        )}
      </section>
    </div>
  );
}
