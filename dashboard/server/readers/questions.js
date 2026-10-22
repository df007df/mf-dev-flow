import fs from "node:fs";
import { hasPrototypeCatalog, semanticRows, prototypeResult } from "../../../modules/prototype/client.mjs";
import path from "node:path";
import { json, text, filesUnder, runDirectory } from "./archive.js";
const PROTOTYPE_QUESTION_SCHEMA_VERSION = 1;

export function prototypeQuestionsFile(store) {
  return path.join(store, "prototype", "open-questions.json");
}

export function questionPrompt(question) {
  return [
    `使用 mf-dev-flow 处理原型待确认问题：${question.id} · ${question.title}。`,
    `定位：${question.location?.document || "prototype/原型图流程.md"} · ${question.location?.heading || "待确认问题"}。`,
    `证据入口：${(question.evidence ?? []).map((item) => `${item.entryId}（${item.path}）`).join("、") || "无"}。`,
    "Agent 回答：<请在此填写>。",
  ].join("\n");
}

export function prototypeQuestionProblems(
  store,
  task = json(path.join(store, "prototype", "task.json")),
) {
  if (hasPrototypeCatalog(path.dirname(store))) {
    const status = prototypeResult(path.dirname(store), ['status']);
    return status.sourceProblems ?? [];
  }
  const index = json(prototypeQuestionsFile(store));
  if (!index) return ["长期原型真源缺少 prototype/open-questions.json。"];
  const problems = [];
  if (index.schemaVersion !== PROTOTYPE_QUESTION_SCHEMA_VERSION)
    problems.push("待确认问题索引 schemaVersion 不兼容。");
  if (!Array.isArray(index.questions))
    problems.push("待确认问题索引缺少 questions 数组。");
  const sourceRun = task?.source?.prototypeRun;
  if (!sourceRun || index.sourceRun !== sourceRun)
    problems.push("待确认问题索引必须对应当前长期原型真源的来源运行。");
  const sourceScreenshots = sourceRun
    ? path.resolve(store, "prototype-runs", sourceRun, "screenshots")
    : null;
  const coverageIds = new Set(
    (
      json(path.join(store, "prototype", "coverage.json"), { coverage: [] })
        .coverage ?? []
    ).map((entry) => entry.id),
  );
  const ids = new Set();
  for (const question of index.questions ?? []) {
    if (!question?.id || ids.has(question.id)) {
      problems.push(`待确认问题缺少唯一 ID：${question?.id || "—"}`);
      continue;
    }
    ids.add(question.id);
    if (
      !question.question ||
      !question.featureId ||
      !question.location?.heading
    )
      problems.push(`待确认问题 ${question.id} 缺少问题、功能块或文档位置。`);
    if (!Array.isArray(question.evidence) || !question.evidence.length) {
      problems.push(`待确认问题 ${question.id} 未关联截图与证据。`);
      continue;
    }
    for (const evidence of question.evidence) {
      if (!coverageIds.has(evidence?.entryId))
        problems.push(
          `待确认问题 ${question.id} 关联了不存在的覆盖入口：${evidence?.entryId || "—"}`,
        );
      const file = path.resolve(store, evidence?.path || "");
      if (
        !sourceScreenshots ||
        !file.startsWith(`${sourceScreenshots}${path.sep}`) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      )
        problems.push(
          `待确认问题 ${question.id} 关联的截图不存在或不属于当前原型运行：${evidence?.path || "—"}`,
        );
    }
  }
  return problems;
}

export function prototypeQuestions(store) {
  if (hasPrototypeCatalog(path.dirname(store))) {
    const questions = semanticRows(path.dirname(store), 'questions');
    return { schemaVersion: 2, problems: prototypeQuestionProblems(store), questions: questions.filter(q => q.status === 'open').map(q => ({ ...q, featureId: q.groupId, agentPrompt: `使用 mf-dev-flow 处理原型问题 ${q.id}；Agent 回答：<填写答案>。` })) };
  }
  const task = json(path.join(store, "prototype", "task.json"));
  const index = json(prototypeQuestionsFile(store), {
    schemaVersion: PROTOTYPE_QUESTION_SCHEMA_VERSION,
    questions: [],
  });
  const problems = prototypeQuestionProblems(store, task);
  return {
    ...index,
    problems,
    questions: (problems.length ? [] : (index.questions ?? []))
      .filter((question) => question.status === "open")
      .map((question) => ({
        ...question,
        agentPrompt: questionPrompt(question),
      })),
  };
}
