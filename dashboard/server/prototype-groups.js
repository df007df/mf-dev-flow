import fs from "node:fs";
import path from "node:path";

export const PROTOTYPE_SUPPLEMENT_SECTION = "### 信息补充\n\n- 用户可在此主动补充本组原型说明、交互规则或业务信息；补充内容经核对后合入相关说明，不自动记为待确认问题。";

// Canonical field names remain features[].id / questions[].featureId for
// compatibility. They identify prototype groups, not development features.
export function prototypeGroupDocument(source, id) {
  const line = `- 分组 ID：\`${id}\``;
  const existing = source.match(/^- 分组 ID：`([^`]+)`\s*$/m);
  if (existing) {
    if (existing[1] !== id) throw new Error(`原型分组 ID 与报告文件名不一致：${id}`);
  } else {
    source = /^# .+$/m.test(source)
      ? source.replace(/^(# .+)$/m, `$1\n\n${line}`)
      : `# ${id}\n\n${line}\n\n${source}`;
  }
  return source.replace(
    /^## 待确认问题(?:[（(].*[）)])?\r?\n[\s\S]*?(?=^#{1,2} |$(?![\s\S]))/gm,
    (section) => /^### 信息补充\s*$/m.test(section)
      ? section
      : `${section.trimEnd()}\n\n${PROTOTYPE_SUPPLEMENT_SECTION}\n\n`,
  );
}

export function prototypeGroupSummaries({
  features = [], coverage = {}, sourceDirectory, questionIndex,
  questionProblems = [],
}) {
  const groupIds = new Set(features.map((group) => group.id));
  const questions = Array.isArray(questionIndex?.questions) ? questionIndex.questions : [];
  const problems = [...questionProblems];
  for (const question of questions) {
    if (!groupIds.has(question.featureId))
      problems.push(`原型问题 ${question.id} 引用了不存在的分组：${question.featureId || "—"}`);
    if (!["open", "resolved"].includes(question.status))
      problems.push(`原型问题 ${question.id} 状态未识别：${question.status || "—"}`);
  }
  if (!Array.isArray(questionIndex?.questions))
    problems.push("原型问题索引不可用，无法确认分组问题状态。");

  const groups = features.map((group) => {
    const entryIds = new Set(group.sourceEntries ?? []);
    const screenshots = new Set();
    const unavailable = new Set();
    const screenshotRoot = sourceDirectory && path.resolve(sourceDirectory, "screenshots");
    for (const entry of coverage.coverage ?? []) {
      if (!entryIds.has(entry.id)) continue;
      for (const evidence of entry.evidence ?? []) {
        if (evidence.level !== "observed") continue;
        const ref = evidence.path;
        try {
          if (!sourceDirectory || typeof ref !== "string" || !/\.(png|jpe?g|webp|gif|avif)$/i.test(ref))
            throw new Error("not an archived screenshot");
          const file = path.resolve(sourceDirectory, ref);
          const realSource = fs.realpathSync(sourceDirectory);
          // The archive is runtime workspace data, not part of the Next bundle.
          const realRoot = fs.realpathSync(/* turbopackIgnore: true */ screenshotRoot);
          const realFile = fs.realpathSync(file);
          if (!file.startsWith(`${screenshotRoot}${path.sep}`) ||
              !realRoot.startsWith(`${realSource}${path.sep}`) ||
              !realFile.startsWith(`${realRoot}${path.sep}`) ||
              !fs.statSync(realFile).isFile()) throw new Error("outside screenshot archive");
          screenshots.add(realFile);
        } catch {
          unavailable.add(ref || entry.id);
        }
      }
    }
    const owned = questions.filter((question) => question.featureId === group.id);
    const open = owned.filter((question) => question.status === "open").length;
    const resolved = owned.filter((question) => question.status === "resolved").length;
    const answers = owned.reduce(
      (count, question) => count + (Array.isArray(question.answers) ? question.answers.length : question.answer ? 1 : 0),
      0,
    );
    return {
      id: group.id,
      title: group.title || group.id,
      screenshotCount: screenshots.size,
      unavailableScreenshotCount: unavailable.size,
      questions: {
        total: owned.length, open, resolved, answers,
        status: problems.length ? "unverified" : open ? "open" : resolved ? "resolved" : "none",
      },
    };
  });
  return { groups, problems: [...new Set(problems)] };
}
