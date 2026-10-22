// graph 命令组（M2/M4/M6）：build/node/impact/render 只读或重建索引；
// flag/clear 是复评环的显式状态写回（真源 feature-map.reassessment，写后重建 graph.json）。
// impact/render 只输出闭包与建议（清单/SVG），不创建运行（分派授权仍在 flow route/claim）。
import fs from "node:fs";
import path from "node:path";
import { writeGraph, loadGraph, flagFeatureTrigger, clearFeatureTriggers, syncDriftTriggers } from "../graph/graph.mjs";
import { closure } from "../graph/closure.mjs";
import { suggestDispatch } from "../graph/dispatch.mjs";
import { renderFocusSvg } from "../graph/render.mjs";
import { readPrototypeRevision, prototypeImpact } from "../planning/impact.mjs";
import { currentFeatureMap, writeFeatureMap, now } from "./shared.mjs";
import { STORE_DIRECTORY } from "../skill-identity.mjs";

const VALUE_FLAGS = ["--ref", "--direction", "--limit", "--from", "--focus", "--depth", "--out", "--feature", "--trigger", "--kind", "--fingerprint", "--source", "--by-task"];

function parseArgs(rest) {
  const out = { from: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--json" || token === "--check" || token === "--dry-run") out[token.slice(2)] = true;
    else if (VALUE_FLAGS.includes(token)) {
      const value = rest[++i];
      if (token === "--from") out.from = String(value ?? "").split(",").map(item => item.trim()).filter(Boolean);
      else out[token.slice(2)] = value;
    }
  }
  return out;
}

function fail(message) {
  process.stderr.write(JSON.stringify({ error: String(message).slice(0, 700) }) + "\n");
  process.exitCode = 1;
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function graphBuild() {
  const args = parseArgs(process.argv.slice(4));
  try {
    const result = writeGraph(process.cwd(), { check: Boolean(args.check) });
    emit({ schemaVersion: 1, mode: args.check ? "check" : "build", ...result });
  } catch (error) { fail(error); }
}

// 漂移 → 显式 open 触发（M6 闭环的写侧）。只读复用 prototypeImpact 判定（不重造 diff），
// 再把受影响功能的来源写成 feature-map 的 open 触发并重建索引。feature impact 保持只读诊断，
// 本命令是唯一把漂移落成持久状态的入口；--dry-run 只报告不写。
export function graphSync() {
  const args = parseArgs(process.argv.slice(4));
  try {
    const map = currentFeatureMap();
    if (!map) return fail("feature-map 不存在；先 feature refine/apply");
    const revision = readPrototypeRevision(path.join(process.cwd(), STORE_DIRECTORY));
    const impact = prototypeImpact(map, revision);
    const result = syncDriftTriggers(map, impact, { at: now() });
    if (args["dry-run"])
      return emit({ schemaVersion: 1, mode: "sync", dryRun: true, status: impact.status, affected: (impact.affected ?? []).length, changed: result.changed, plannedFlags: result.flagged, skipped: result.skipped });
    if (!result.changed)
      return emit({ schemaVersion: 1, mode: "sync", changed: false, status: impact.status, note: impact.status === "current" ? "原型与功能地图基线一致，无漂移置脏" : "受影响功能点均已带相同指纹的 open 触发（幂等）" });
    writeFeatureMap(map);
    const rebuild = writeGraph(process.cwd(), { check: false });
    emit({
      schemaVersion: 1, mode: "sync", changed: true, status: "review_required",
      features: [...new Set(result.flagged.map(entry => entry.feature))], flagged: result.flagged.length, skipped: result.skipped,
      rebuild: { counts: rebuild.counts, drift: rebuild.drift ? "changed" : "stable", problems: rebuild.problems },
    });
  } catch (error) { fail(error); }
}

export function graphNode() {
  const args = parseArgs(process.argv.slice(4));
  if (!args.ref) return fail("用法：graph node --ref <前缀:标识> --json");
  const graph = loadGraph(process.cwd());
  if (!graph) return fail("graph.json 不存在或 schema 不符；先 graph build");
  const node = graph.nodes.find(item => item.ref === args.ref);
  if (!node) return fail(`节点不在图中：${args.ref}（可 graph build 重建）`);
  const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
  const incident = graph.edges.filter(edge => edge.from === args.ref || edge.to === args.ref).slice(0, limit);
  emit({ schemaVersion: 1, node, incidentEdges: incident, neighborRefs: [...new Set(incident.map(edge => (edge.from === args.ref ? edge.to : edge.from)))].sort() });
}

export function graphImpact() {
  const args = parseArgs(process.argv.slice(4));
  if (!args.from.length) return fail("用法：graph impact --from <ref,ref…> [--direction dependents|sources] [--limit 1-200] --json");
  const graph = loadGraph(process.cwd());
  if (!graph) return fail("graph.json 不存在或 schema 不符；先 graph build");
  const direction = args.direction === "sources" ? "sources" : "dependents";
  const maxNodes = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
  const result = closure(graph, args.from, { direction, maxNodes });
  if (result.problems.length) return fail(result.problems.join("；"));
  const dispatchSuggestions = direction === "dependents" ? suggestDispatch(graph, args.from, result.affected) : [];
  emit({
    schemaVersion: 1,
    seeds: args.from,
    direction,
    affected: result.affected,
    truncated: result.truncated,
    dispatchSuggestions,
    note: "只读闭包与建议清单；开启复评任务须走 flow route/claim 授权。",
  });
}

export function graphFlag() {
  const args = parseArgs(process.argv.slice(4));
  if (!args.feature || !args.trigger) return fail("用法：graph flag --feature <feature:ref> --trigger <ref> [--kind <节点类型>] [--fingerprint <fp>] [--source <run/task>] --json");
  try {
    const map = currentFeatureMap();
    if (!map) return fail("feature-map 不存在；先 feature refine/apply");
    const result = flagFeatureTrigger(map, {
      featureRef: args.feature,
      triggerRef: args.trigger,
      triggerKind: args.kind ?? null,
      triggerFingerprint: args.fingerprint ?? null,
      source: args.source ?? null,
      at: now(),
    });
    if (!result.changed) return emit({ schemaVersion: 1, mode: "flag", changed: false, reason: result.reason, feature: args.feature, trigger: args.trigger });
    writeFeatureMap(map);
    const rebuild = writeGraph(process.cwd(), { check: false });
    emit({ schemaVersion: 1, mode: "flag", changed: true, feature: args.feature, trigger: args.trigger, rebuild: { counts: rebuild.counts, drift: rebuild.drift ? "changed" : "stable", problems: rebuild.problems } });
  } catch (error) { fail(error); }
}

// 清脏授权来自内核任务记录：--by-task <runId/taskLeaf> 必须存在、kind=task、状态为终态（completed/superseded），
// 清除范围严格限定为该任务 sourceRefs 里的 feature:（不越权清别的触发）。
export function graphClear() {
  const args = parseArgs(process.argv.slice(4));
  if (!args["by-task"]) return fail("用法：graph clear --by-task <runId/taskLeaf> --json");
  try {
    const taskRef = String(args["by-task"]);
    const slash = taskRef.indexOf("/");
    if (slash === -1) return fail("--by-task 需为 <runId/taskLeafId>");
    const runId = taskRef.slice(0, slash);
    const leaf = taskRef.slice(slash + 1);
    const taskFile = path.join(process.cwd(), STORE_DIRECTORY, "tasks", runId, `${leaf}.json`);
    if (!fs.existsSync(taskFile)) return fail(`内核任务记录不存在：tasks/${runId}/${leaf}.json（历史运行先 kernel backfill）`);
    const task = JSON.parse(fs.readFileSync(taskFile, "utf8"));
    if (task.kind !== "task") return fail(`${taskRef} 不是任务记录`);
    if (!["completed", "superseded"].includes(task.status)) return fail(`任务 ${taskRef} 状态 ${task.status} 非终态，不能清脏（先 work finish/terminal）`);
    const features = (task.sourceRefs ?? []).filter(ref => String(ref).startsWith("feature:"));
    if (!features.length) return fail(`任务 ${taskRef} 无 feature: 来源，无可清脏对象`);
    const map = currentFeatureMap();
    if (!map) return fail("feature-map 不存在；先 feature refine/apply");
    const cleared = [], unchanged = [], missing = [];
    for (const ref of features) {
      const result = clearFeatureTriggers(map, { featureRef: ref, clearedByTask: taskRef, at: now() });
      if (result.reason) missing.push(ref);
      else if (result.changed) cleared.push({ feature: ref, triggers: result.cleared });
      else unchanged.push(ref);
    }
    if (!cleared.length) return emit({ schemaVersion: 1, mode: "clear", byTask: taskRef, changed: false, cleared, unchanged, missing, note: "无 open 触发需要清除（可能已清或从未置脏）" });
    writeFeatureMap(map);
    const rebuild = writeGraph(process.cwd(), { check: false });
    emit({ schemaVersion: 1, mode: "clear", byTask: taskRef, changed: true, cleared, unchanged, missing, rebuild: { counts: rebuild.counts, drift: rebuild.drift ? "changed" : "stable", problems: rebuild.problems } });
  } catch (error) { fail(error); }
}

export function graphRender() {
  const args = parseArgs(process.argv.slice(4));
  if (!args.focus) return fail("用法：graph render --focus <ref> [--depth 1-5] [--out <文件>]");
  const graph = loadGraph(process.cwd());
  if (!graph) return fail("graph.json 不存在或 schema 不符；先 graph build");
  try {
    const depth = Math.min(Math.max(Number(args.depth) || 3, 1), 5);
    const svg = renderFocusSvg(graph, args.focus, { depth });
    if (args.out) {
      fs.writeFileSync(args.out, svg);
      emit({ schemaVersion: 1, written: args.out, focus: args.focus, depth, bytes: Buffer.byteLength(svg) });
    } else emit({ schemaVersion: 1, focus: args.focus, depth, svg });
  } catch (error) { fail(error); }
}
