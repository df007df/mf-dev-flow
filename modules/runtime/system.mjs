// Flow module extracted from the existing runtime; shared gates retain one implementation.

import path from "node:path";
import crypto from "node:crypto";
import { boundedPage } from "../prototype/core/paging.js";

import fs from "node:fs";

import { SYSTEM_ISSUE_SEVERITIES, SYSTEM_ISSUE_STATES, csv, ensureProject, fail, now, readJson, required, resolveRun, slug, systemCardProblems, systemCardsFile, systemDir, valueFor, writeJson } from './shared.mjs';
import { STORE_DIRECTORY } from "../skill-identity.mjs";

export const systemAgreementsFile = () => path.join(systemDir(), "agreements.json");

export const SYSTEM_AGREEMENT_STATES = new Set(["confirmed", "superseded"]);

export function referenceProfile(card) {
  if (card.referenceProfile) return card.referenceProfile;
  const sources = card.sources ?? [];
  const codebase = sources.find((source) => source.kind === "codebase");
  const configurations = sources.filter(
    (source) => source.kind === "configuration",
  );
  const addressSources = sources.filter((source) =>
    /https?:\/\//.test(source.location ?? ""),
  );
  const urls = (items) => [
    ...new Set(
      items.flatMap((source) =>
        [...String(source.location).matchAll(/https?:\/\/[^\s、；,]+/g)].map(
          (match) => match[0],
        ),
      ),
    ),
  ];
  const isTest = (value) => /测试|test|development|dev/i.test(value);
  const isOnline = (value) => /线上|生产|production|prod/i.test(value);
  return {
    projectPath: codebase?.location ?? null,
    positioning: card.relationship,
    test: {
      configurationPaths: configurations
        .filter((source) => isTest(`${source.title} ${source.location}`))
        .map((source) => source.location),
      addresses: urls(
        addressSources.filter((source) =>
          isTest(`${source.title} ${source.location}`),
        ),
      ),
    },
    online: {
      configurationPaths: configurations
        .filter((source) => isOnline(`${source.title} ${source.location}`))
        .map((source) => source.location),
      addresses: urls(
        addressSources.filter((source) =>
          isOnline(`${source.title} ${source.location}`),
        ),
      ),
    },
  };
}

export function cardDocument(card) {
  const profile = referenceProfile(card);
  const bullets = (values, fallback = "无。") =>
    values?.length
      ? values.map((value) => `- ${value}`).join("\n")
      : `- ${fallback}`;
  const sourceRows = card.sources.map(
    (source) =>
      `| ${source.title} | ${source.kind} | \`${source.location}\` | ${source.status} | ${source.accessPolicy} |`,
  );
  const apiRows = (card.knownApis ?? []).map(
    (api) =>
      `| \`${api.id}\` | ${api.method} | \`${api.path}\` | ${api.purpose} | ${api.status} | ${(api.currentConsumers ?? []).join("、") || "—"} |`,
  );
  const usageRows = (card.apiUsages ?? []).map(
    (usage) =>
      `| \`${usage.id}\` | \`${usage.apiId}\` | ${usage.consumer} | ${usage.purpose} | \`${usage.decisionRef}\` | ${usage.registeredAt} | ${usage.lastConfirmedAt} |`,
  );
  const issueRows = (card.technicalIssues ?? []).map(
    (issue) =>
      `| \`${issue.id}\` | ${issue.severity} | ${issue.status} | ${issue.title} | ${issue.summary} | ${issue.lastConfirmedAt} |`,
  );
  const sourceDetails = card.sources.flatMap((source) => [
    `### ${source.title}`,
    "",
    `- 权威范围：${source.authority}`,
    `- 版本/指纹：${source.version ?? "待核验"}`,
    `- 密钥处理：${source.secretHandling}`,
    `- 证据：${(source.evidence ?? []).join("；") || "待补充"}`,
    ...(source.notes ?? []).map((note) => `- 备注：${note}`),
    "",
  ]);
  return [
    `# ${card.title}`,
    "",
    `> 系统卡片 ID：\`${card.id}\` · 状态：${card.status} · 最近核验：${card.lastVerifiedAt}`,
    "",
    "## 项目关系与权威边界",
    "",
    `- 项目关系：${card.relationship}`,
    `- 权威范围：${card.authority}`,
    `- 使用边界：${card.usageBoundary ?? "以各来源访问策略为准。"}`,
    "",
    "## 参考项目概览",
    "",
    `- 项目路径：${profile.projectPath ?? "未登记"}`,
    `- 项目定位：${profile.positioning ?? card.relationship}`,
    `- 测试配置：${profile.test?.configurationPaths?.join("；") || "未登记（不要求运行或测试）"}`,
    `- 测试地址：${profile.test?.addresses?.join("；") || "未登记"}`,
    `- 线上配置：${profile.online?.configurationPaths?.join("；") || "未登记"}`,
    `- 线上地址：${profile.online?.addresses?.join("；") || "未登记"}`,
    "- 运行与测试：外部参考系统不要求执行；只保留可复核的代码、配置、接口或数据证据。",
    "",
    "## 当前系统事实",
    "",
    bullets(card.facts, "暂无已登记事实。"),
    "",
    "## 来源与访问约束",
    "",
    "| 来源 | 类型 | 位置 | 状态 | 访问约束 |",
    "| --- | --- | --- | --- | --- |",
    ...sourceRows,
    "",
    ...sourceDetails,
    "## 已知 API 能力",
    "",
    "| API ID | 方法 | 路径 | 能力 | 状态 | 已知调用方 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(apiRows.length
      ? apiRows
      : ["| — | — | — | 当前未登记可复用 API | — | — |"]),
    "",
    "## 本项目当前 API 使用登记",
    "",
    "> 这里只保留当前确认仍需使用的 API。方案不再使用时删除对应登记，删除动作保留在卡片变更记录和运行历史中。",
    "",
    "| 使用 ID | API ID | 使用方 | 用途 | 方案依据 | 登记时间 | 最近确认 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...(usageRows.length
      ? usageRows
      : ["| — | — | — | 当前没有确认复用的 API | — | — | — |"]),
    "",
    "## 已知技术问题",
    "",
    "| 问题 ID | 严重度 | 状态 | 标题 | 影响/说明 | 最近确认 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(issueRows.length
      ? issueRows
      : ["| — | — | — | 当前未登记明显技术问题 | — | — |"]),
    "",
    "## 方案设计使用提示",
    "",
    bullets(card.designGuidance, "按权威边界和访问策略评估。"),
    "",
    "## 待确认问题",
    "",
    bullets(card.openQuestions, "无。"),
    "",
    "## 卡片变更记录",
    "",
    ...(card.changeLog ?? []).map(
      (entry) =>
        `- ${entry.at} · ${entry.action ?? "updated"} · ${entry.summary}${entry.runId ? ` · \`${entry.runId}\`` : ""}`,
    ),
    "",
  ].join("\n");
}

export const systemFingerprint = document => crypto.createHash('sha256').update(JSON.stringify(document)).digest('hex');
const currentSystemDocument = () => fs.existsSync(systemCardsFile()) ? readJson(systemCardsFile()) : null;

export function writeSystemCards(document, taskOverrides = {}) {
  fs.mkdirSync(systemDir(), { recursive: true });
  const lock = path.join(systemDir(), '.cards-write.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx'); } catch { fail('系统卡片正在更新；稍后重新 query 核对版本。'); }
  try {
    if (taskOverrides.expectedFingerprint && taskOverrides.expectedFingerprint !== systemFingerprint(currentSystemDocument())) throw new Error('系统卡片版本冲突；重新 query/预览并合并当前结论。');
    return writeSystemCardsUnlocked(document, taskOverrides);
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

function writeSystemCardsUnlocked(document, taskOverrides = {}) {
  const target = systemDir();
  const updatedAt = taskOverrides.updatedAt ?? now();
  const cards = (document.cards ?? []).map((card) => ({
    ...card,
    referenceProfile: referenceProfile(card),
  }));
  fs.mkdirSync(path.join(target, "cards"), { recursive: true });
  const temporary = `${systemCardsFile()}.${process.pid}.tmp`;
  try {
    writeJson(temporary, { ...document, cards, schemaVersion: 2, updatedAt });
    fs.renameSync(temporary, systemCardsFile());
  } finally { fs.rmSync(temporary, { force: true }); }
  for (const card of cards) {
    fs.writeFileSync(
      path.join(target, "cards", `${card.id}.md`),
      cardDocument(card),
    );
  }
  const activeFiles = new Set(cards.map((card) => `${card.id}.md`));
  for (const file of fs.readdirSync(path.join(target, "cards"))) {
    if (file.endsWith(".md") && !activeFiles.has(file))
      fs.unlinkSync(path.join(target, "cards", file));
  }
  writeJson(path.join(target, "task.json"), {
    schemaVersion: 2,
    id: "system-main",
    type: "system-cards",
    title: "系统卡片",
    status: "fresh",
    sourceRun: taskOverrides.sourceRun ?? null,
    cardCount: cards.length,
    apiUsageCount: cards.reduce(
      (count, card) => count + (card.apiUsages?.length ?? 0),
      0,
    ),
    openIssueCount: cards.reduce(
      (count, card) =>
        count +
        (card.technicalIssues ?? []).filter(
          (issue) => issue.status !== "resolved",
        ).length,
      0,
    ),
    updatedAt,
  });
  const indexRows = cards.map(
    (card) =>
      `| [${card.title}](cards/${card.id}.md) | ${card.relationship} | ${card.status} | ${card.apiUsages?.length ?? 0} | ${(card.technicalIssues ?? []).filter((issue) => issue.status !== "resolved").length} | ${card.lastVerifiedAt} |`,
  );
  const history = document.history ?? [];
  fs.writeFileSync(
    path.join(target, "系统卡片.md"),
    [
      "# 系统卡片",
      "",
      `> 本文是项目所依赖外部系统的长期索引。每张卡片按系统聚合代码、配置、数据库、文档、API、当前使用登记和技术问题；只保留当前有效关系，历史由运行与变更记录追溯。密钥值不得写入 \`${STORE_DIRECTORY}/\`。`,
      "",
      "## 当前依赖系统",
      "",
      "| 系统 | 项目关系 | 状态 | 当前 API 使用 | 未解决技术问题 | 最近核验 |",
      "| --- | --- | --- | --- | --- | --- |",
      ...indexRows,
      "",
      `- 更新时间：${updatedAt}`,
      taskOverrides.sourceRun
        ? `- 最近更新运行：\`system-runs/${taskOverrides.sourceRun}\``
        : "- 最近更新运行：—",
      "",
      "## 维护规则",
      "",
      "- 方案设计确认前先读取相关系统卡片，优先判断现有 API 是否满足权威边界、稳定性与访问约束。",
      "- 确认复用 API 后登记使用方、用途、方案依据、登记时间和最近确认时间；不再需要时从当前使用登记删除。",
      "- 调用或联调时发现明显技术问题，登记证据、影响、严重度与状态，供依赖系统后续优化。",
      "- 外部代码与配置只读参考；数据库仅允许只读连接和 SELECT，禁止 INSERT、UPDATE、DELETE、DDL。",
      "",
      "## 更新历史",
      "",
      ...history.map(
        (entry) =>
          `- ${entry.at ?? entry.importedAt} · ${entry.action ?? "system_update"} · ${entry.summary ?? entry.title}${entry.runId ? ` · \`${entry.runId}\`` : ""}`,
      ),
      "",
    ].join("\n"),
  );
}

export function systemCardIdentity(card) {
  const codebases = (card.sources ?? [])
    .filter((source) => source.kind === "codebase" && source.location)
    .map((source) => path.resolve(process.cwd(), source.location))
    .sort();
  return codebases.length ? codebases.join("|") : `id:${card.id}`;
}

export function distinctBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function mergeSystemCards(cards) {
  const groups = new Map();
  for (const card of cards) {
    const identity = systemCardIdentity(card);
    groups.set(identity, [...(groups.get(identity) ?? []), card]);
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const primary = [...group].sort((left, right) => {
      const leftReference = /-reference$/.test(left.id);
      const rightReference = /-reference$/.test(right.id);
      return (
        Number(leftReference) - Number(rightReference) ||
        left.id.localeCompare(right.id)
      );
    })[0];
    const merged = {
      ...primary,
      relationship: distinctBy(
        group.map((card) => card.relationship).filter(Boolean),
        (value) => value,
      ).join("；"),
      authority: distinctBy(
        group.map((card) => card.authority).filter(Boolean),
        (value) => value,
      ).join("；"),
      usageBoundary: distinctBy(
        group.map((card) => card.usageBoundary).filter(Boolean),
        (value) => value,
      ).join("；"),
      facts: distinctBy(
        group.flatMap((card) => card.facts ?? []),
        (value) => value,
      ),
      sources: distinctBy(
        group.flatMap((card) => card.sources ?? []),
        (source) =>
          `${source.kind}:${path.resolve(process.cwd(), source.location ?? source.id)}`,
      ),
      knownApis: distinctBy(
        group.flatMap((card) => card.knownApis ?? []),
        (api) => api.id,
      ),
      apiUsages: distinctBy(
        group.flatMap((card) => card.apiUsages ?? []),
        (usage) => usage.id,
      ),
      technicalIssues: distinctBy(
        group.flatMap((card) => card.technicalIssues ?? []),
        (issue) => issue.id,
      ),
      designGuidance: distinctBy(
        group.flatMap((card) => card.designGuidance ?? []),
        (value) => value,
      ),
      openQuestions: distinctBy(
        group.flatMap((card) => card.openQuestions ?? []),
        (value) => value,
      ),
      changeLog: distinctBy(
        group.flatMap((card) => card.changeLog ?? []),
        (entry) => `${entry.at}:${entry.action}:${entry.summary}`,
      ).sort((left, right) => String(left.at).localeCompare(String(right.at))),
      lastVerifiedAt:
        group
          .map((card) => card.lastVerifiedAt)
          .filter(Boolean)
          .sort()
          .at(-1) ?? primary.lastVerifiedAt,
    };
    merged.changeLog.push({
      at: now(),
      action: "card_merged",
      summary: `按代码库身份合并重复系统卡片：${group.map((card) => card.id).join("、")}`,
    });
    return merged;
  });
}

export function systemQuery() {
  ensureProject();
  const document = currentSystemDocument();
  const fingerprint = systemFingerprint(document);
  const cursor = Number(valueFor('--cursor') ?? 0), limit = Number(valueFor('--limit') ?? 10);
  const offset = Number(valueFor('--text-offset') ?? 0), length = Number(valueFor('--text-limit') ?? 2048);
  if (![cursor, offset].every(n => Number.isInteger(n) && n >= 0) || !Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(length) || length < 1 || length > 8192) fail('无效分页参数');
  if ((cursor > 0 || offset > 0 || valueFor('--fingerprint')) && valueFor('--fingerprint') !== fingerprint) fail('系统卡片版本已变化；从第一页重新读取。');
  const cardId = valueFor('--card'), field = valueFor('--field');
  const cards = (document?.cards ?? []).filter(card => !cardId || card.id === cardId).sort((a, b) => a.id.localeCompare(b.id));
  if (cardId && !cards.length) fail('系统卡片不存在');
  if (field && !cardId) fail('--field 必须指定 --card');
  const items = cards.slice(cursor, cursor + limit).map(card => {
    if (field) {
      if (field !== 'record' && !Object.hasOwn(card, field)) fail('卡片字段不存在');
      const text = JSON.stringify(field === 'record' ? card : card[field]);
      return { type: 'system-card', id: card.id, field, text: text.slice(offset, offset + length), nextTextOffset: offset + length < text.length ? offset + length : null };
    }
    return { type: 'system-card', id: card.id, title: card.title, status: card.status, lastVerifiedAt: card.lastVerifiedAt, sourceRun: card.sourceRun, openQuestionCount: card.openQuestions?.length ?? 0, openIssueCount: card.technicalIssues?.filter(issue => issue.status !== 'resolved').length ?? 0 };
  });
  console.log(JSON.stringify(boundedPage(items, { cursor, nextCursor: cursor + limit < cards.length ? cursor + limit : null, maxBytes: valueFor('--max-bytes') ?? 16384, metadata: { fingerprint, count: cards.length } })));
}

export function systemStatus() {
  ensureProject();
  const target = systemDir();
  const taskFile = path.join(target, "task.json");
  const agreements = fs.existsSync(systemAgreementsFile())
    ? (readJson(systemAgreementsFile()).agreements ?? [])
    : [];
  if (!fs.existsSync(taskFile)) {
    console.log(
      `系统信息真源尚未建立；当前约定：${agreements.filter((item) => item.status === "confirmed").length}。`,
    );
    return;
  }
  const task = readJson(taskFile);
  const cards = readJson(systemCardsFile());
  console.log(`系统卡片：${task.title}（${task.status}）`);
  console.log(
    `卡片：${cards.cards?.length ?? 0}；API 使用：${task.apiUsageCount ?? 0}；未解决技术问题：${task.openIssueCount ?? 0}；当前约定：${agreements.filter((item) => item.status === "confirmed").length}；最近运行：${task.sourceRun ?? "—"}`,
  );
  console.log(`索引：${path.join(target, "系统卡片.md")}`);
}

export function writeSystemAgreements(document) {
  const updatedAt = now();
  const agreements = [...(document.agreements ?? [])].sort((left, right) =>
    String(right.updatedAt).localeCompare(String(left.updatedAt)),
  );
  writeJson(systemAgreementsFile(), {
    schemaVersion: 1,
    agreements,
    updatedAt,
  });
  const rows = agreements.map(
    (agreement) =>
      `| \`${agreement.id}\` | ${agreement.title} | ${agreement.scope} | ${agreement.status} | ${agreement.decidedAt} | ${agreement.decisionRef} |`,
  );
  fs.writeFileSync(
    path.join(systemDir(), "系统约定.md"),
    [
      "# 系统约定",
      "",
      "> 这里记录已经明确、会影响后续原型、方案或开发判断的当前约定。它不替代系统卡片的外部事实，也不记录密钥或配置明文。系统事实变化仍应走完整 system 运行。",
      "",
      "| 约定 ID | 标题 | 适用范围 | 状态 | 明确时间 | 决策依据 |",
      "| --- | --- | --- | --- | --- | --- |",
      ...(rows.length ? rows : ["| — | 当前没有明确约定 | — | — | — | — |"]),
      "",
      "## 维护规则",
      "",
      "- 新增已明确的产品、架构或协作约定：`system agreement-add`，必须留下决策依据与可复核证据。",
      "- 被新决定替代时：`system agreement-set --status superseded`，保留历史，不删除旧约定。",
      "- 新的外部系统、代码、数据库、配置、文档或 API 事实，不要直接写约定；创建 system 运行、核验后再刷新系统卡片。",
      "",
    ].join("\n"),
  );
}

export function readSystemAgreements() {
  if (!fs.existsSync(systemAgreementsFile()))
    return { schemaVersion: 1, agreements: [] };
  const document = readJson(systemAgreementsFile());
  if (!Array.isArray(document.agreements))
    fail("系统约定文件缺少 agreements 数组。");
  return document;
}

export function systemAgreementAdd() {
  ensureProject();
  const id = slug(required("--id"));
  const title = required("--title");
  const summary = required("--summary");
  const scope = required("--scope");
  const decisionRef = required("--decision-ref");
  const evidence = csv("--evidence");
  if (!evidence.length) fail("--evidence 至少提供一项可复核证据。");
  const document = readSystemAgreements();
  if (document.agreements.some((agreement) => agreement.id === id))
    fail(`系统约定已存在：${id}；请用 system agreement-set 更新或标记替代。`);
  const timestamp = now();
  document.agreements.push({
    id,
    title,
    summary,
    scope,
    status: "confirmed",
    decisionRef,
    evidence,
    decidedAt: timestamp,
    updatedAt: timestamp,
  });
  writeSystemAgreements(document);
  console.log(`已登记系统约定：${id}`);
}

export function systemAgreementSet() {
  ensureProject();
  const id = required("--id");
  const status = required("--status");
  const note = required("--note");
  if (!SYSTEM_AGREEMENT_STATES.has(status))
    fail("--status 只能是 confirmed 或 superseded");
  const document = readSystemAgreements();
  const agreement = document.agreements.find((item) => item.id === id);
  if (!agreement) fail(`找不到系统约定：${id}`);
  agreement.status = status;
  agreement.statusNote = note;
  agreement.updatedAt = now();
  if (valueFor("--decision-ref"))
    agreement.decisionRef = required("--decision-ref");
  const evidence = csv("--evidence");
  if (evidence.length) agreement.evidence = evidence;
  writeSystemAgreements(document);
  console.log(`已更新系统约定：${id} → ${status}`);
}

export function systemUpdate() {
  ensureProject();
  const run = resolveRun(required("--from-run"));
  if (run.type !== "system") fail("system update 只能从 system 运行刷新。");
  if (run.run.status !== "done")
    fail("system update 只接受已完成的 system 运行。");
  const problems = systemCardProblems(run);
  if (problems.length)
    fail(`不能刷新系统信息真源：\n- ${problems.join("\n- ")}`);
  const integration = fs.existsSync(path.join(run.dir, "integration.json"))
    ? readJson(path.join(run.dir, "integration.json"))
    : null;
  if (integration?.status !== "passed")
    fail("system update 前必须完成 work verify --status passed。");

  const target = systemDir();
  const incomingFile = path.join(run.dir, "cards.json");
  if (!fs.existsSync(incomingFile))
    fail(
      "旧版 sources.json 运行不能刷新系统卡片；请新建 system 运行并按 cards.json 迁移。历史运行仍保持可读。",
    );
  const legacySourceFile = path.join(target, "sources.json");
  const legacyHistory = fs.existsSync(legacySourceFile)
    ? (readJson(legacySourceFile).history ?? []).map((entry) => ({
        runId: entry.runId,
        action: "legacy_system_update",
        summary: entry.title,
        at: entry.importedAt,
      }))
    : [];
  const existingSnapshot = currentSystemDocument();
  const existing = existingSnapshot ?? { schemaVersion: 2, cards: [], history: legacyHistory };
  const incoming = readJson(incomingFile);
  const expectedFingerprint = valueFor('--expected-fingerprint') || systemFingerprint(existingSnapshot);
  if (expectedFingerprint !== systemFingerprint(currentSystemDocument())) fail('系统卡片版本冲突；重新 query/预览。');
  const merged = new Map((existing.cards ?? []).map((card) => [card.id, card]));
  for (const id of incoming.removeCardIds ?? []) merged.delete(id);
  for (const card of incoming.cards) {
    merged.set(card.id, { ...card, sourceRun: run.id, updatedAt: now() });
  }
  const nextCards = mergeSystemCards([...merged.values()]).map(card => ({ ...card, referenceProfile: referenceProfile(card) })).sort((left, right) => left.id.localeCompare(right.id));
  if (process.argv.includes('--dry-run')) {
    const changes = [...new Set([...(existing.cards ?? []).map(card => card.id), ...nextCards.map(card => card.id)])].map(id => {
      const before = existing.cards?.find(card => card.id === id), after = nextCards.find(card => card.id === id);
      const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
      const changedFields = fields.filter(key => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
      const removedItems = Object.fromEntries(['knownApis', 'apiUsages', 'technicalIssues', 'openQuestions'].map(key => {
        const identity = item => typeof item === 'string' ? item : item.id;
        const retained = new Set((after?.[key] ?? []).map(identity));
        return [key, (before?.[key] ?? []).map(identity).filter(id => !retained.has(id))];
      }).filter(([, items]) => items.length));
      return { type: 'system-change', id, action: !after ? 'remove_or_merge' : !before ? 'add' : 'replace', changedFields, removedFields: Object.keys(before ?? {}).filter(key => !Object.hasOwn(after ?? {}, key)), removedItems };
    }).filter(change => change.changedFields.length);
    const cursor = Number(valueFor('--cursor') ?? 0), limit = Number(valueFor('--limit') ?? 10);
    if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) fail('无效预览分页');
    return console.log(JSON.stringify(boundedPage(changes.slice(cursor, cursor + limit), { cursor, nextCursor: cursor + limit < changes.length ? cursor + limit : null, maxBytes: valueFor('--max-bytes') ?? 16384, metadata: { fingerprint: expectedFingerprint, dryRun: true } })));
  }
  const updatedAt = now();
  const history = [
    ...(existing.history ?? []),
    {
      runId: run.id,
      action: "system_update",
      summary: run.run.title,
      at: updatedAt,
    },
  ].filter(
    (entry, index, entries) =>
      entries.findIndex((item) => item.runId === entry.runId) === index,
  );
  fs.mkdirSync(path.join(target, "executions"), { recursive: true });
  writeSystemCards(
    {
      schemaVersion: 2,
      cards: nextCards,
      history,
    },
    { sourceRun: run.id, updatedAt, expectedFingerprint },
  );
  writeJson(path.join(target, "executions", `${run.id}.json`), {
    schemaVersion: 1,
    id: run.id,
    kind: "system-information-update",
    sourceRun: `system-runs/${run.id}`,
    status: run.run.status,
    importedAt: updatedAt,
  });

  console.log(path.join(target, "系统卡片.md"));
}

export function updateCanonicalCards(mutator, historyEntry) {
  ensureProject();
  if (!fs.existsSync(systemCardsFile()))
    fail("系统卡片尚未建立；先完成一次 system update。");
  const document = readJson(systemCardsFile());
  const expectedFingerprint = systemFingerprint(document);
  const changed = mutator(document.cards ?? []);
  if (!changed) return;
  const updatedAt = now();
  const history = [
    ...(document.history ?? []),
    { ...historyEntry, at: updatedAt },
  ];
  const task = fs.existsSync(path.join(systemDir(), "task.json"))
    ? readJson(path.join(systemDir(), "task.json"))
    : {};
  writeSystemCards(
    { ...document, cards: document.cards, history },
    { updatedAt, sourceRun: task.sourceRun ?? null, expectedFingerprint },
  );
}

function publicReferenceOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("--address 必须是有效的 HTTP(S) 公开 origin");
  }
  if (!['http:', 'https:'].includes(url.protocol))
    fail("--address 只能使用 http 或 https");
  if (url.username || url.password)
    fail("--address 不得包含用户名或密码");
  if (url.search || url.hash)
    fail("--address 不得包含查询参数或片段");
  if (url.pathname && url.pathname !== '/')
    fail("--address 只能登记 origin；接口路径请走完整 system 运行");
  return url.origin;
}

function publicReferenceEvidence(value) {
  const evidence = value.trim();
  if (!evidence) fail("--evidence 必须提供可复核的脱敏证据");
  if (evidence.length > 500) fail("--evidence 不能超过 500 个字符");
  if (
    /(?:credential|credentials|password|passwd|secret|token|api[-_]?key|authorization|cookie)\s*[:=]\s*\S+/i.test(
      evidence,
    ) || /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/i.test(evidence)
  )
    fail("--evidence 不能包含密钥或认证值");
  return evidence;
}

export function systemProfileAddress() {
  const cardId = required("--card");
  const environment = required("--environment");
  const address = publicReferenceOrigin(required("--address"));
  const evidence = publicReferenceEvidence(required("--evidence"));
  if (!['test', 'online'].includes(environment))
    fail("--environment 只能是 test 或 online");
  let action = "reference_address_registered";
  updateCanonicalCards(
    (cards) => {
      const card = cards.find((item) => item.id === cardId);
      if (!card) fail(`找不到系统卡片：${cardId}`);
      const profile = referenceProfile(card);
      card.referenceProfile = profile;
      profile[environment] ??= { configurationPaths: [], addresses: [] };
      profile[environment].addresses ??= [];
      const existing = profile[environment].addresses.includes(address);
      if (!existing) profile[environment].addresses.push(address);
      action = existing
        ? "reference_address_reconfirmed"
        : "reference_address_registered";
      const timestamp = now();
      card.changeLog ??= [];
      card.changeLog.push({
        at: timestamp,
        action,
        summary: `${environment} 公开地址 ${address}（${evidence}）`,
      });
      return true;
    },
    {
      action: "reference_address_updated",
      cardId,
      environment,
      address,
      summary: `${environment} 公开地址 ${address}（${evidence}）`,
    },
  );
  console.log(`已${action === "reference_address_registered" ? "登记" : "复核"} ${cardId} / ${environment}：${address}`);
}

export function systemApiUse() {
  const cardId = required("--card");
  const apiId = required("--api");
  const consumer = required("--consumer");
  const purpose = required("--purpose");
  const decisionRef = required("--decision-ref");
  const usageId = valueFor("--usage") || slug(`${consumer}-${apiId}`);
  updateCanonicalCards(
    (cards) => {
      const card = cards.find((item) => item.id === cardId);
      if (!card) fail(`找不到系统卡片：${cardId}`);
      if (!(card.knownApis ?? []).some((api) => api.id === apiId))
        fail(`系统卡片 ${cardId} 没有 API：${apiId}`);
      card.apiUsages ??= [];
      const existing = card.apiUsages.find((usage) => usage.id === usageId);
      const timestamp = now();
      if (existing) {
        Object.assign(existing, {
          apiId,
          consumer,
          purpose,
          decisionRef,
          lastConfirmedAt: timestamp,
        });
      } else {
        card.apiUsages.push({
          id: usageId,
          apiId,
          consumer,
          purpose,
          decisionRef,
          registeredAt: timestamp,
          lastConfirmedAt: timestamp,
        });
      }
      card.changeLog ??= [];
      card.changeLog.push({
        at: timestamp,
        action: existing ? "api_usage_reconfirmed" : "api_usage_registered",
        summary: `${consumer} 使用 ${apiId}：${purpose}（${decisionRef}）`,
      });
      return true;
    },
    {
      action: "api_usage_registered",
      cardId,
      usageId,
      summary: `${consumer} 使用 ${apiId}`,
    },
  );
  console.log(`已登记 ${cardId} / ${usageId}`);
}

export function systemApiRemove() {
  const cardId = required("--card");
  const usageId = required("--usage");
  const reason = required("--reason");
  updateCanonicalCards(
    (cards) => {
      const card = cards.find((item) => item.id === cardId);
      if (!card) fail(`找不到系统卡片：${cardId}`);
      const index = (card.apiUsages ?? []).findIndex(
        (usage) => usage.id === usageId,
      );
      if (index === -1)
        fail(`系统卡片 ${cardId} 没有 API 使用登记：${usageId}`);
      card.apiUsages.splice(index, 1);
      card.changeLog ??= [];
      card.changeLog.push({
        at: now(),
        action: "api_usage_removed",
        summary: `${usageId}：${reason}`,
      });
      return true;
    },
    { action: "api_usage_removed", cardId, usageId, summary: reason },
  );
  console.log(`已删除 ${cardId} / ${usageId}`);
}

export function systemIssueAdd() {
  const cardId = required("--card");
  const issueId = slug(required("--id"));
  const title = required("--title");
  const severity = required("--severity");
  const summary = required("--summary");
  const evidence = csv("--evidence");
  if (!SYSTEM_ISSUE_SEVERITIES.has(severity))
    fail("--severity 只能是 low、medium、high 或 critical");
  if (!evidence.length) fail("--evidence 至少提供一项可复核证据");
  updateCanonicalCards(
    (cards) => {
      const card = cards.find((item) => item.id === cardId);
      if (!card) fail(`找不到系统卡片：${cardId}`);
      card.technicalIssues ??= [];
      if (card.technicalIssues.some((issue) => issue.id === issueId))
        fail(`技术问题已存在：${issueId}`);
      const timestamp = now();
      card.technicalIssues.push({
        id: issueId,
        title,
        severity,
        status: "open",
        summary,
        apiIds: csv("--apis"),
        observedAt: timestamp,
        lastConfirmedAt: timestamp,
        evidence,
      });
      card.changeLog ??= [];
      card.changeLog.push({
        at: timestamp,
        action: "technical_issue_added",
        summary: `${issueId}：${title}`,
      });
      return true;
    },
    { action: "technical_issue_added", cardId, issueId, summary: title },
  );
  console.log(`已登记 ${cardId} / ${issueId}`);
}

export function systemIssueSet() {
  const cardId = required("--card");
  const issueId = required("--id");
  const status = required("--status");
  const note = required("--note");
  if (!SYSTEM_ISSUE_STATES.has(status))
    fail("--status 只能是 open、monitoring 或 resolved");
  updateCanonicalCards(
    (cards) => {
      const card = cards.find((item) => item.id === cardId);
      if (!card) fail(`找不到系统卡片：${cardId}`);
      const issue = (card.technicalIssues ?? []).find(
        (item) => item.id === issueId,
      );
      if (!issue) fail(`系统卡片 ${cardId} 没有技术问题：${issueId}`);
      const timestamp = now();
      issue.status = status;
      issue.lastConfirmedAt = timestamp;
      issue.statusNote = note;
      card.changeLog ??= [];
      card.changeLog.push({
        at: timestamp,
        action: "technical_issue_status_changed",
        summary: `${issueId} → ${status}：${note}`,
      });
      return true;
    },
    {
      action: "technical_issue_status_changed",
      cardId,
      issueId,
      summary: `${status}：${note}`,
    },
  );
  console.log(`已更新 ${cardId} / ${issueId}：${status}`);
}

export function systemDedupe() {
  ensureProject();
  if (!fs.existsSync(systemCardsFile())) fail("系统卡片尚未建立；无需去重。");
  const document = readJson(systemCardsFile());
  const expectedFingerprint = systemFingerprint(document);
  const cards = mergeSystemCards(document.cards ?? []);
  if (cards.length === (document.cards ?? []).length)
    return console.log("系统卡片没有按代码库重复的系统。");
  writeSystemCards(
    {
      ...document,
      cards,
      history: [
        ...(document.history ?? []),
        {
          at: now(),
          action: "system_cards_deduplicated",
          summary: "按代码库路径合并重复系统卡片",
        },
      ],
    },
    { updatedAt: now(), sourceRun: document.sourceRun ?? null, expectedFingerprint },
  );
  console.log(`已合并重复系统卡片：${document.cards.length} → ${cards.length}`);
}
