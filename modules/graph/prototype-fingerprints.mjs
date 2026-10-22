// 原型分组/入口内容指纹（M3b）：把 change-impact 的"分组指纹含结论/问答/需求/来源"
// 提炼为对 planningPrototype 视图的纯函数。无法归属的需求/问题按协议口径保守计入全部分组
// （"无法安全归属的改动要求整图复评"），不用标题猜范围。
import { sha256, stableStringify } from "./graph.mjs";

const VOLATILE = new Set(["updatedAt", "createdAt", "revision"]);
const canonRow = row => {
  const out = {};
  for (const key of Object.keys(row ?? {}).sort()) {
    if (VOLATILE.has(key)) continue;
    out[key] = row[key];
  }
  return out;
};
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 归属判断只认结构化字段（groupId/feature/featureId/entryId(s)），与 client 的 relatedQuestion 同口径。 */
function mentionsGroup(row, groupRef, entryGroup, { ownEntry = null } = {}) {
  if (row.groupId === groupRef || row.feature === groupRef || row.featureId === groupRef) return true;
  if (row.entryId && entryGroup.get(row.entryId) === groupRef) return true;
  if ((row.entryIds ?? []).some(id => entryGroup.get(id) === groupRef)) return true;
  if (ownEntry && entryGroup.get(ownEntry) === groupRef) return true;
  return false;
}
const isGlobal = row => !row.groupId && !row.feature && !row.featureId && !row.entryId && !(row.entryIds ?? []).length;

/**
 * @param view planningPrototype 结果（或测试注入的等价对象）
 * @returns {{groups: Map, entries: Map, entryGroup: Map, globalIssues: number}}
 */
export function computePrototypeFingerprints(view) {
  const groups = [...(view?.features ?? [])].sort(byId);
  const entries = [...(view?.sourceEntries ?? [])].sort(byId);
  const questions = [...(view?.questions ?? [])].sort(byId);
  const requirements = [...(view?.requirements ?? [])].sort(byId);
  const entryGroup = new Map(entries.map(entry => [entry.id, entry.feature ?? null]));
  const groupRefs = new Set(groups.map(group => group.id));
  // 归属到已不存在的分组/入口也按全局处理（保守置脏），不静默丢事实
  function mentionsAny(row) {
    const targets = [row.groupId, row.feature, row.featureId, row.entryId, ...(row.entryIds ?? [])].filter(Boolean);
    return targets.some(target => groupRefs.has(target) || entryGroup.has(target));
  }
  const orphan = row => !isGlobal(row) && !mentionsAny(row);
  const scoped = list => ({
    // 通用/孤儿项计入每个分组：协议口径"不可安全归属→保守要求整图复评"
    attributed: gid => list.filter(row => mentionsGroup(row, gid, entryGroup) || orphan(row) || isGlobal(row)),
    globals: list.filter(row => isGlobal(row) || orphan(row)),
  });
  const q = scoped(questions);
  const r = scoped(requirements);
  const globalIssues = q.globals.length + r.globals.length;

  const groupFingerprints = new Map();
  for (const group of groups) {
    const payload = {
      group: canonRow(group),
      entries: entries.filter(entry => entry.feature === group.id).map(canonRow),
      questions: q.attributed(group.id).map(canonRow),
      requirements: r.attributed(group.id).map(canonRow),
    };
    groupFingerprints.set(group.id, sha256(stableStringify(payload)));
  }
  const entryFingerprints = new Map();
  for (const entry of entries) {
    const payload = {
      entry: canonRow(entry),
      questions: questions.filter(question => mentionsGroup(question, entry.feature, entryGroup, { ownEntry: entry.id })).map(canonRow),
      requirements: requirements.filter(row => mentionsGroup(row, entry.feature, entryGroup, { ownEntry: entry.id })).map(canonRow),
    };
    entryFingerprints.set(entry.id, sha256(stableStringify(payload)));
  }
  return { groups: groupFingerprints, entries: entryFingerprints, entryGroup, globalIssues };
}
