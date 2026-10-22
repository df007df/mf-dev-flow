import { Images } from "lucide-react";
import type { PrototypeGroup } from "../lib/types";

export function PrototypeGroups({ groups = [] }: { groups?: PrototypeGroup[] }) {
  return (
    <div className="prototype-groups" aria-label="原型分组概览">
      {groups.map((group) => {
        const q = group.questions;
        const tone = q.status === "open" || q.status === "unverified"
          ? "blocked" : q.status === "resolved" ? "done" : "pending";
        const label = q.status === "unverified" ? "问题状态待核验"
          : q.status === "open" ? `${q.open} 项待确认`
          : q.status === "resolved" ? "问题与回答已确认" : "无待确认问题";
        return (
          <article className="prototype-group-card" key={group.id} data-group-id={group.id}>
            <h3>{group.title}</h3>
            <code className="prototype-group-id">{group.id}</code>
            <div className="prototype-group-metrics">
              <span className="prototype-screenshot-count" title="关联入口下实际存在的 observed 截图，按文件去重">
                <Images size={15} aria-hidden="true" />截图 {group.screenshotCount} 张
              </span>
              <span className={`badge ${tone}`}>{label}</span>
            </div>
            <p className="muted prototype-question-counts">
              待确认 {q.open} · 已解决 {q.resolved} · Agent 回答 {q.answers ?? 0}
            </p>
            {group.unavailableScreenshotCount > 0 && (
              <p className="error">另有 {group.unavailableScreenshotCount} 条截图证据待补齐</p>
            )}
          </article>
        );
      })}
      {!groups.length && <p className="empty">尚未登记原型分组。</p>}
    </div>
  );
}
