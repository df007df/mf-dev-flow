import { hasPrototypeCatalog, planningPrototype, semanticRows, relatedQuestion } from '../../../modules/prototype/client.mjs';
import { objectRefOrNull } from "../../../modules/kernel/object-ref.mjs";
import fs from "node:fs";
import path from "node:path";
import { json, text, filesUnder, runDirectory } from "./archive.js";
import { prototypeQuestionsFile } from "./questions.js";
import {
  featureHistory,
  featureStageEvidence,
  featureStageMockContracts,
  featureStageVisualPairs,
  featureStageVisualReviews,
  featureStages,
} from "./runs.js";
import { prototypeImpact, readPrototypeRevision, deliveryImpactClosure } from "../prototype-impact.js";
import { DELIVERY_STAGES } from "../delivery-contract.js";

const STAGE_DEFINITIONS = new Map(
  DELIVERY_STAGES.map((stage) => [stage.id, stage]),
);

function stageEvidenceSource(stage, events, stageId) {
  if (stage.evidenceSource) return stage.evidenceSource;
  const event = events.find(
    (item) =>
      item.stage?.id === stageId &&
      ["confirmed", "done"].includes(item.stage?.status),
  );
  return event
    ? {
        runId: event.runId,
        taskId: event.taskId,
        note: "已确认阶段的归档证据。",
      }
    : null;
}

export function rank(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function orderedPlanningGroups(groups = []) {
  return groups
    .map((group, index) => ({
      ...group,
      rank: rank(group.rank, (index + 1) * 10),
    }))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        String(left.id).localeCompare(String(right.id)),
    );
}

export function orderedPlanningFeatures(features = [], groups = []) {
  const groupRanks = new Map(
    orderedPlanningGroups(groups).map((group) => [group.id, group.rank]),
  );
  return features
    .map((feature, index) => ({
      ...feature,
      rank: rank(feature.rank, (index + 1) * 10),
    }))
    .sort(
      (left, right) =>
        (groupRanks.get(left.parentId) ?? Number.MAX_SAFE_INTEGER) -
          (groupRanks.get(right.parentId) ?? Number.MAX_SAFE_INTEGER) ||
        left.rank - right.rank ||
        String(left.id).localeCompare(String(right.id)),
    );
}

export function planningSourceScreenshots(store, feature, prototypeRun, native = null) {
  if (hasPrototypeCatalog(path.dirname(store))) return ((native ?? planningPrototype(path.dirname(store))).coverage).filter(e => (feature.sourceEntries ?? []).includes(e.id)).flatMap(e => e.evidence.map(shot => ({ entryId: e.id, action: shot.action, path: shot.path })));
  const coverage = json(path.join(store, "prototype", "coverage.json"), {
    coverage: [],
  });
  const coverageByEntry = new Map(
    (coverage.coverage ?? []).map((entry) => [entry.id, entry]),
  );
  return (feature.sourceEntries ?? []).flatMap((entryId) =>
    (coverageByEntry.get(entryId)?.evidence ?? [])
      .filter(
        (evidence) =>
          evidence?.level === "observed" &&
          typeof evidence?.path === "string" &&
          evidence.path.startsWith("screenshots/"),
      )
      .map((evidence) => ({
        entryId,
        action: evidence.action ?? "复现动作待补充",
        path: `prototype-runs/${prototypeRun}/${evidence.path}`,
      })),
  );
}

export function planningPrototypeEntries(store, feature, native = null) {
  const ids = [...new Set((feature.sourceEntries ?? []).filter(
    (id) => typeof id === "string" && id.trim(),
  ))];
  if (hasPrototypeCatalog(path.dirname(store))) {
    const snapshot = native ?? planningPrototype(path.dirname(store));
    const entriesById = new Map(
      (snapshot.sourceEntries ?? []).map((entry) => [entry.id, entry]),
    );
    const coverageById = new Map(
      (snapshot.coverage ?? []).map((entry) => [entry.id, entry]),
    );
    return ids.map((id) => {
      const entry = entriesById.get(id);
      const title = [entry?.title, entry?.label, entry?.action].find(
        (value) => typeof value === "string" && value.trim(),
      );
      const groupId = [entry?.feature, entry?.groupId].find(
        (value) => typeof value === "string" && value.trim(),
      );
      return {
        id,
        title: title ?? id,
        groupId: groupId ?? null,
        evidenceCount: (coverageById.get(id)?.evidence ?? []).length,
      };
    });
  }
  const coverageById = new Map(
    (json(path.join(store, "prototype", "coverage.json"), { coverage: [] }).coverage ?? [])
      .map((entry) => [entry.id, entry]),
  );
  return ids.map((id) => ({
    id,
    title: id,
    groupId: null,
    evidenceCount: (coverageById.get(id)?.evidence ?? []).filter(
      (evidence) =>
        evidence?.level === "observed" &&
        typeof evidence?.path === "string" &&
        evidence.path.startsWith("screenshots/"),
    ).length,
  }));
}

export function planningQuestions(store, feature, groups, native = null) {
  if (hasPrototypeCatalog(path.dirname(store))) return (native?.questions ?? semanticRows(path.dirname(store), "questions")).filter(q => relatedQuestion(q, { groups }, feature));
  const questionIndex = json(prototypeQuestionsFile(store), { questions: [] });
  const group = (groups ?? []).find((item) => item.id === feature.parentId);
  const sourceFeatureIds = new Set(group?.sourceFeatureIds ?? []);
  const sourceEntries = new Set(feature.sourceEntries ?? []);
  return (questionIndex.questions ?? []).filter(
    (question) =>
      sourceFeatureIds.has(question.featureId) ||
      (question.evidence ?? []).some((evidence) =>
        sourceEntries.has(evidence.entryId),
      ),
  );
}

export function fallbackDevelopmentRequirements(feature) {
  return [
    "以来源截图和可观察交互为原型对齐依据，不把演示数据当作生产事实。",
    "围绕独立用户结果和已确认的产品边界验收；详细接口、切片与测试只在交付任务阶段维护。",
  ];
}

export function planningSummary(store) {
  const directory = path.join(store, "planning");
  const map = json(path.join(directory, "feature-map.json"));
  if (!map) return null;
  let impact;
  try { impact = prototypeImpact(map, readPrototypeRevision(store)); }
  catch (error) { impact = { status: "unverified", affected: (map.features ?? []).map((feature) => ({ id: feature.id })), problems: [error.message] }; }
  let native = null;
  if (hasPrototypeCatalog(path.dirname(store))) { try { native = planningPrototype(path.dirname(store)); } catch (error) { native = { coverage: [], questions: [] }; impact.problems = [...(impact.problems ?? []), error.message]; } }
  const groups = orderedPlanningGroups(map.groups ?? []).map((group) => ({
    ...group,
    ref: objectRefOrNull("feature-group", group.id),
  }));
  const history = featureHistory(store);
  const prototypeRun =
    map.prototypeRun ??
    json(path.join(store, "prototype", "task.json"))?.source?.prototypeRun;
  // 技术叶子发布可能让依赖它的产品叶子失去复评结论；闭包与 CLI 保持同一真源，
  // 看板只做展示，不另行推导。
  let deliveryClosure;
  try { deliveryClosure = deliveryImpactClosure(map, store); }
  catch (error) { deliveryClosure = { status: "unverified", releasedTechnicalIds: [], affected: [], problems: [error.message] }; }
  const deliveryAffected = new Map(
    (deliveryClosure.affected ?? []).map((item) => [item.id, item.via]),
  );
  const features = orderedPlanningFeatures(map.features ?? [], groups).map(
    (feature) => {
      const events = history.filter((event) => event.featureId === feature.id);
      const stages = featureStages(feature, events);
      const reviewRequired = impact.affected.some((item) => item.id === feature.id);
      const deliveryReviewVia = deliveryAffected.get(feature.id) ?? null;
      return {
        ...feature,
        ref: objectRefOrNull("feature", feature.id),
        kind: feature.kind === "technical" ? "technical" : "product",
        planningStatus:
          reviewRequired || deliveryReviewVia ? "review_required" : "current",
        blockers: [...(feature.blockers ?? []), ...(impact.affected.some((item) => item.id === feature.id)
          ? ["原型变更待复评：需先核对范围、状态、依赖与 P/W，不能继续旧规划开发。"] : []),
          ...(deliveryReviewVia
            ? [`技术发布待复评：依赖的技术叶子 ${deliveryReviewVia} 已交付，需先完成 delivery 复评。`] : [])],
        description: String(
          feature.description ?? feature.outcome ?? "",
        ).trim(),
        developmentRequirements: feature.developmentRequirements?.length
          ? feature.developmentRequirements
          : fallbackDevelopmentRequirements(feature),
        sourceScreenshots: prototypeRun
          ? planningSourceScreenshots(store, feature, prototypeRun, native)
          : [],
        prototypeEntries: planningPrototypeEntries(store, feature, native),
        questions: planningQuestions(store, feature, groups, native),
        stages: Object.fromEntries(
          Object.entries(stages).map(([id, stage]) => {
            const evidenceSource = stageEvidenceSource(stage, events, id);
            const evidenceStage = evidenceSource
              ? { ...stage, evidenceSource }
              : stage;
            return [
              id,
              {
                ...evidenceStage,
                acceptanceCriteria:
                  STAGE_DEFINITIONS.get(id)?.acceptanceCriteria ?? [],
                documentation: STAGE_DEFINITIONS.get(id)?.documentation ?? null,
                evidence: featureStageEvidence(store, id, evidenceStage),
                mockContracts: featureStageMockContracts(
                  store,
                  id,
                  evidenceStage,
                ),
                visualPairs: featureStageVisualPairs(
                  store,
                  id,
                  evidenceStage,
                ),
                visualReviews: featureStageVisualReviews(
                  store,
                  id,
                  evidenceStage,
                ),
              },
            ];
          }),
        ),
        history: events,
        historySummary: {
          eventCount: events.length,
          taskCount: new Set(
            events.map((event) => `${event.runId}/${event.taskId}`),
          ).size,
          blockerCount: events.filter((event) => event.blocker).length,
          latestAt: events[0]?.at ?? null,
        },
      };
    },
  );
  return {
    ...map,
    prototypeImpact: impact,
    groups,
    features,
    actionable: features.filter((feature) =>
      feature.planningStatus === "current" && ["not_started", "in_progress", "blocked"].includes(feature.status),
    ),
    history,
    document: "planning/功能演进地图.md",
    content: text(path.join(directory, "功能演进地图.md")),
  };
}
