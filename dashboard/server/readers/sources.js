import { hasPrototypeCatalog, prototypeResult } from '../../../modules/prototype/client.mjs';
import { objectRefOrNull } from "../../../modules/kernel/object-ref.mjs";
import fs from "node:fs";
import path from "node:path";
import { json, text, filesUnder, runDirectory } from "./archive.js";
import { prototypeQuestions } from "./questions.js";
import { prototypeGroupSummaries } from "../prototype-groups.js";
import { prototypeDocumentPrompts } from "../prototype-prompts.js";
import { systemDocumentPrompt } from "../system-prompts.js";
import {
  prototypeEvidenceDocument,
  prototypeEvidenceFeature,
} from "../prototype-evidence.js";

export function prototypeSummary(store) {
  if (hasPrototypeCatalog(path.dirname(store))) {
    try { return { native: true, ...prototypeResult(path.dirname(store), ["status"]) }; }
    catch (error) { return { native: true, status: "unverified", sourceProblems: [error.message] }; }
  }
  const directory = path.join(store, "prototype");
  const task = json(path.join(directory, "task.json"));
  if (!task) return null;
  const sourceDirectory = task.source?.prototypeRun
    ? runDirectory(store, "prototype", task.source.prototypeRun)
    : null;
  const coverage = json(path.join(directory, "coverage.json"), {
    coverage: [],
  });
  const featureIndex = json(path.join(directory, "feature-index.json"), {
    features: [],
  });
  const questions = prototypeQuestions(store);
  const counts = (coverage.coverage ?? []).reduce(
    (summary, entry) => {
      summary[entry.status] = (summary[entry.status] ?? 0) + 1;
      summary.total += 1;
      return summary;
    },
    { total: 0, covered: 0, unavailable: 0, inferred: 0, out_of_scope: 0 },
  );
  const features = (featureIndex.features ?? []).map(prototypeEvidenceFeature);
  const questionIndex = json(path.join(directory, "open-questions.json"));
  const groupSummary = prototypeGroupSummaries({
    features, coverage, sourceDirectory,
    questionIndex,
    questionProblems: questions.problems,
  });
  return {
    task,
    storage: "legacy",
    initialized: false,
    coverage: counts,
    features,
    groups: groupSummary.groups.map((group) => ({
      ...group,
      ref: objectRefOrNull("prototype-group", group.id),
    })),
    groupProblems: groupSummary.problems,
    flowPrompts: prototypeDocumentPrompts({
      features, task,
      location: json(path.join(store, "project.json"))?.prototype?.location,
      questions: questionIndex?.questions ?? [],
      questionsVerified: !groupSummary.problems.length,
    }),
    questions: groupSummary.problems.length
      ? { ...questions, questions: [] }
      : questions,
    flowDocument: "prototype/原型图流程.md",
    flowContent: prototypeEvidenceDocument(
      text(path.join(directory, "原型图流程.md")),
    ),
    flowAssetBase:
      sourceDirectory && fs.existsSync(sourceDirectory)
        ? path.relative(store, sourceDirectory)
        : null,
  };
}

export function systemSummary(store) {
  const directory = path.join(store, "system");
  const task = json(path.join(directory, "task.json"));
  const cards = json(path.join(directory, "cards.json"), {
    cards: [],
    history: [],
  });
  const agreements = json(path.join(directory, "agreements.json"), {
    agreements: [],
  });
  return {
    task: task ?? {
      title: "系统卡片",
      status: "未建立",
      sourceRun: null,
      updatedAt: null,
      apiUsageCount: 0,
      openIssueCount: 0,
    },
    cards: (cards.cards ?? []).map((card) => {
      const codebase = (card.sources ?? []).find(
        (source) => source.kind === "codebase",
      );
      const codebaseLocation = codebase?.location?.split(" 与 ")[0];
      const reference = card.referenceProfile ?? {};
      return {
        ...card,
        ref: objectRefOrNull("system-card", card.id),
        systemName: card.systemName ?? card.title,
        directoryName: codebaseLocation
          ? path.basename(codebaseLocation)
          : null,
        referenceProjectPath: reference.projectPath ?? codebaseLocation ?? null,
        referencePositioning: reference.positioning ?? card.relationship,
        referenceTestConfigurationCount:
          reference.test?.configurationPaths?.length ?? 0,
        referenceTestAddressCount: reference.test?.addresses?.length ?? 0,
        referenceOnlineConfigurationCount:
          reference.online?.configurationPaths?.length ?? 0,
        referenceOnlineAddressCount: reference.online?.addresses?.length ?? 0,
        document: `system/cards/${card.id}.md`,
        content: text(path.join(directory, "cards", `${card.id}.md`)),
        questionPrompt: systemDocumentPrompt(card),
      };
    }),
    history: cards.history ?? [],
    document: "system/系统卡片.md",
    content: text(path.join(directory, "系统卡片.md")),
    agreements: agreements.agreements ?? [],
    agreementsDocument: "system/系统约定.md",
    agreementsContent: text(path.join(directory, "系统约定.md")),
  };
}

export function projectCardsSummary(store) {
  const directory = path.join(store, "projects");
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => json(path.join(directory, file)))
    .filter(Boolean)
    .filter((card) => card.referenceOnly !== true)
    .map((card) => ({
      ...card,
      ref: objectRefOrNull("project-card", card.id),
      document: `projects/${card.id}.md`,
      content: text(path.join(directory, `${card.id}.md`)),
    }));
}
