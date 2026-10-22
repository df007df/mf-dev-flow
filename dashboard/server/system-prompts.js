import { SKILL_ID, storePath } from "../../modules/skill-identity.mjs";

// Keep the two question collections in one answer template. String questions
// are located by their original text; their displayed number is snapshot-only.
export function systemDocumentPrompt(card) {
  const questions = card.openQuestions ?? [];
  const issues = (card.technicalIssues ?? []).filter((issue) => issue.status !== "resolved");
  const sourceRun = (card.changeLog ?? []).findLast((entry) => entry.runId)?.runId;
  const document = storePath("system", "cards", `${card.id}.md`);
  const index = `${storePath("system", "cards.json")} → cards[id=${card.id}]`;
  return {
    cardId: card.id,
    cardTitle: card.title,
    answer: [
      `使用 ${SKILL_ID} 处理系统卡片问题，统一回答待确认问题与已知技术问题。`,
      `系统卡片：${card.id} · ${card.title}。`,
      `目标文档：${document}。`,
      "文档位置：待确认问题；已知技术问题。",
      `事实索引：${index}。`,
      `最近核验：${card.lastVerifiedAt || "未登记"}。`,
      `来源运行：${sourceRun || "未登记，以卡片变更记录为准"}。`,
      "",
      "待确认问题（按原问题定位，序号仅对应本次快照）：",
      ...(questions.length ? questions.flatMap((question, i) => [
        `${i + 1}. 原问题：${question}`,
        "   Agent 回答：<请填写回答；暂不回答可留空>",
      ]) : ["当前无待确认问题。"]),
      "",
      "已知技术问题（未解决，含 monitoring）：",
      ...(issues.length ? issues.flatMap((issue) => [
        `- 问题 ID：${issue.id} · ${issue.title}（${issue.status}）`,
        `  影响/说明：${issue.summary || "未登记"}`,
        `  证据定位：${index}.technicalIssues[id=${issue.id}].evidence`,
        "  Agent 回答：<请填写处理意见、补充事实或核验证据；暂不回答可留空>",
      ]) : ["当前无未解决技术问题。"]),
    ].join("\n"),
  };
}
