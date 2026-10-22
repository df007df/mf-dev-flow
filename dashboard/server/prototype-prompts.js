import { SKILL_ID, storePath } from "../../modules/skill-identity.mjs";

export function prototypeDocumentPrompts({ features = [], task, location, questions = [], questionsVerified = false }) {
  return features.map((group) => {
    const known = questionsVerified
      ? questions.filter((question) => question.featureId === group.id)
      : [];
    const locate = [
      `原型路径：${location || "未登记，请先核对项目基线"}。`,
      `原型版本：${task?.source?.prototypeVersion || "未登记"}。`,
      `来源原型运行：${task?.source?.prototypeRun || "未登记"}。`,
      `原型分组：${group.id} · ${group.title || group.id}。`,
      `目标文档：${storePath("prototype", "原型图流程.md")}。`,
      `证据索引：${storePath("prototype", "feature-index.json")} → ${group.id} → sourceEntries；截图及复现动作见本组“截图与证据”。`,
    ];
    return {
      groupId: group.id,
      groupTitle: group.title || group.id,
      answer: [
        `使用 ${SKILL_ID} 处理原型待确认问题，更新长期原型真源。`,
        ...locate,
        `文档位置：${group.title || group.id} > 待确认问题（含已解决记录）。`,
        known.length
          ? `已有问题：${known.map((question) => `${question.id}（${question.status === "resolved" ? "已解决" : "待确认"}）`).join("、")}。`
          : questionsVerified
            ? "当前分组未登记问题；主动补充原型说明请使用“信息补充”模板。"
            : "问题索引尚未通过校验，请先核对问题及截图定位。",
        "问题回答内容：<请填写问题 ID 或原问题，以及对应的 Agent 回答>。",
      ].join("\n"),
      supplement: [
        `使用 ${SKILL_ID} 补充原型信息，更新长期原型真源。`,
        ...locate,
        `文档位置：${group.title || group.id} > 待确认问题 > 信息补充。`,
        "信息补充内容：<请填写需要新增或补充的原型说明、交互规则、业务信息，以及关联页面、入口 ID 或证据>。",
      ].join("\n"),
    };
  });
}
