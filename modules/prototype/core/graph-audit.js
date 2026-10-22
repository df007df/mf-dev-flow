import fs from "node:fs";
import path from "node:path";
import { digest } from "./html-source.js";
const nonempty = value => typeof value === "string" && value.trim().length > 0;
const array = value => Array.isArray(value) ? value : [];
const contained = (root, file) => file.startsWith(`${root}${path.sep}`);
const stamp = value => typeof value === "string" ? Date.parse(value) : NaN;
function runtimeOnlyGraphProblems({ coverage, source, graph }) {
  const problems = [];
  const records = (items, label) => {
    if (!Array.isArray(items) || !items.length) problems.push(`runtime-only analysis requires at least one ${label}`);
    return Array.isArray(items) ? items : [];
  };
  if (source?.sourceFiles?.length || source?.candidates?.length || source?.problems?.length) problems.push('runtime-only analysis cannot claim source inventory coverage');
  if (coverage?.sourceInventory?.completeness !== 'runtime-only' || coverage?.sourceInteractionInventory?.completeness !== 'runtime-only') problems.push('runtime-only evidence profile is inconsistent with coverage inventory');
  if (graph?.status !== 'runtime-observed' || coverage?.traversal?.status !== 'runtime-observed') problems.push('runtime-only analysis has not completed runtime observation');
  const groups = records(graph?.groups, 'group');
  const entries = records(coverage?.sourceInventory?.entries, 'entry');
  const nodes = records(graph?.nodes, 'node');
  const edges = records(graph?.edges, 'edge');
  const controls = records(coverage?.sourceInteractionInventory?.controls, 'control');
  const occurrences = records(graph?.runtimeDiscoveries, 'occurrence');
  const sweeps = records(graph?.runtimeSweeps, 'sweep');
  if (!groups.length || !entries.length || !nodes.length || !edges.length || !controls.length || !occurrences.length || !sweeps.length) return [...new Set(problems)];
  const groupIds = new Set(groups.map(group => group.id).filter(nonempty));
  if (!groupIds.size) problems.push('runtime-only analysis requires at least one group');
  for (const entry of entries) if (!groupIds.has(entry.feature) || entry.status !== 'covered') problems.push(`entry/${entry.id}: runtime evidence is incomplete`);
  for (const node of nodes) if (!groupIds.has(node.groupId) || !Array.isArray(node.evidence) || !node.evidence.length) problems.push(`node/${node.id}: runtime evidence is incomplete`);
  for (const edge of edges) if (edge.status !== 'covered' || !Array.isArray(edge.evidence) || !edge.evidence.length) problems.push(`edge/${edge.id}: runtime evidence is incomplete`);
  for (const occurrence of occurrences) if (!Array.isArray(occurrence.edgeIds) || !occurrence.edgeIds.length) problems.push(`occurrence/${occurrence.id}: state/control/action coverage incomplete`);
  for (const sweep of sweeps) if (!Array.isArray(sweep.evidence) || !sweep.evidence.length) problems.push(`sweep/${sweep.id}: runtime evidence is incomplete`);
  return [...new Set(problems)];
}

export function graphProblems({ runDirectory, run, coverage, sourceBytes, source, graph, current, workflow }) {
  if (workflow?.evidenceProfile === 'runtime-only') return runtimeOnlyGraphProblems({ coverage, source, graph });
  if (workflow?.evidenceProfile && workflow.evidenceProfile !== 'source-and-runtime') return ['Unsupported workflow evidence profile'];
  try {
    const problems = [];
    const bad = (message) => problems.push(message);
    const hash = digest(sourceBytes);
    if (source.schemaVersion !== 1 || source.extractorVersion !== 1 || graph.schemaVersion !== 1) bad("原型地图版本不支持");
    if (run.sourceMap?.sha256 !== hash || graph.sourceMapHash !== hash || run.sourceMap?.createdAt !== source.createdAt || !Number.isFinite(stamp(source.createdAt))) bad("源码地图快照指纹/创建时间不一致，不能事后覆盖分母");
    for (const key of ["origin", "sourceFiles", "candidates", "problems"]) {
      if (JSON.stringify(source[key]) !== JSON.stringify(current[key])) bad(`源码地图 ${key} 与当前登记原型不一致；请新建分析运行`);
    }
    for (const problem of current.problems) bad(`源码发现未完成：${problem}`);
    if (JSON.stringify(coverage.sourceInventory?.sourceFiles) !== JSON.stringify(source.sourceFiles)) bad("coverage 源文件必须使用源码地图的项目根相对路径与完整指纹，不能另选来源");
    if (graph.status !== "converged") bad("页面与交互地图尚未收敛");
    for (const field of ["remainingCandidateIds", "remainingEdgeIds"]) if (!Array.isArray(graph[field]) || graph[field].length) bad(`${field} 尚未清空或未登记`);

    function index(items, label, allowEmpty = false) {
      if (!Array.isArray(items) || (!items.length && !allowEmpty)) bad(`${label} 必须是${allowEmpty ? "" : "非空"}数组`);
      const result = new Map();
      for (const item of array(items)) {
        if (!nonempty(item?.id) || result.has(item.id)) bad(`${label} 存在重复或空 ID`);
        else result.set(item.id, item);
      }
      return result;
    }
    const candidates = index(source.candidates, "源码候选");
    const nodes = index(graph.nodes, "页面/状态节点");
    const edges = index(graph.edges, "交互边");
    const reviews = index(graph.candidateReviews, "源码候选核对");
    const spaces = index(graph.stateSpaces, "状态空间");
    const entries = index(coverage.sourceInventory?.entries, "覆盖入口");
    const records = index(coverage.coverage, "入口证据");
    function refs(ids, table, label, allowEmpty = false) {
      if (!Array.isArray(ids) || (!ids.length && !allowEmpty) || new Set(ids).size !== ids.length) { bad(`${label} 引用必须${allowEmpty ? "" : "非空且"}唯一`); return []; }
      for (const id of ids) if (!table.has(id)) bad(`${label} 引用不存在：${id}`);
      return ids.map((id) => table.get(id)).filter(Boolean);
    }
    function archive(file, screenshot = false) {
      if (!nonempty(file)) return false;
      const absolute = path.resolve(runDirectory, file);
      if (!contained(runDirectory, absolute) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return false;
      const real = fs.realpathSync(absolute);
      if (!contained(fs.realpathSync(runDirectory), real)) return false;
      return !screenshot || (contained(path.join(fs.realpathSync(runDirectory), "screenshots"), real) && /\.(png|jpe?g|webp|gif|avif)$/i.test(real) && fs.statSync(real).size > 0);
    }
    function evidence(items, label) {
      if (!Array.isArray(items) || !items.length) bad(`${label} 缺少逐项截图/断言/追踪证据`);
      for (const item of array(items)) {
        if (item.level !== "observed" || !archive(item.path, true) || !nonempty(item.action)) bad(`${label} observed 截图或复现动作无效`);
        if (!archive(item.trace)) bad(`${label} 缺少可回放的操作追踪文件`);
        for (const key of ["path", "trace"]) if (item[`${key}Hash`] && archive(item[key]) && digest(fs.readFileSync(path.resolve(runDirectory, item[key]))) !== item[`${key}Hash`]) bad(`${label} 内容寻址证据已变化：${key}`);
        if (!Number.isFinite(stamp(item.capturedAt)) || stamp(item.capturedAt) < stamp(source.createdAt)) bad(`${label} 证据时间必须晚于源码地图`);
        if (item.assertion?.passed !== true || !nonempty(item.assertion.expected) || !nonempty(item.assertion.actual)) bad(`${label} 缺少预期/实际结果与通过断言`);
      }
    }
    function exclusion(item, label) {
      if (!nonempty(item?.reason) || !nonempty(item?.reviewer)) bad(`${label} 排除/约简缺少原因和复核人`);
      refs(item?.sourceIds, candidates, `${label} 排除/约简源码依据`);
    }
    for (const node of nodes.values()) {
      if (!nonempty(node.label) || !nonempty(node.resetAction)) bad(`节点 ${node.id} 缺少标题或独立复现/重置动作`);
      const linked = refs(node.entryIds, entries, `节点 ${node.id} 入口`);
      for (const entry of linked) if (records.get(entry.id)?.status !== "covered") bad(`节点 ${node.id} 入口未真实覆盖：${entry.id}`);
      evidence(node.evidence, `节点 ${node.id}`);
    }
    for (const id of entries.keys()) if (![...nodes.values()].some((node) => array(node.entryIds).includes(id))) bad(`入口未挂到页面/状态地图：${id}`);
    for (const edge of edges.values()) {
      if (!nodes.has(edge.from) || !nodes.has(edge.to)) bad(`交互 ${edge.id} 起止节点不存在`);
      refs(edge.sourceIds, candidates, `交互 ${edge.id} 源码`);
      if (edge.status !== "covered") bad(`交互未验证：${edge.id}`);
      if (!["click", "fill", "select", "check", "press", "scroll", "drag", "hover", "long-press", "back", "navigate", "wait"].includes(edge.action?.type) || !nonempty(edge.action?.target)) bad(`交互 ${edge.id} 缺少真实动作类型/目标`);
      if (edge.action?.force !== false || edge.action?.script !== false) bad(`交互 ${edge.id} 强制点击/脚本触发不能充当用户可操作证据`);
      if (!nonempty(edge.outcome)) bad(`交互 ${edge.id} 缺少可观察结果`);
      evidence(edge.evidence, `交互 ${edge.id}`);
    }
    for (const candidate of candidates.values()) {
      const review = reviews.get(candidate.id);
      if (!review) { bad(`源码候选未核对：${candidate.id}`); continue; }
      if (review.status === "excluded") { exclusion(review, candidate.id); continue; }
      if (candidate.kind === "reference" && review.status === "reviewed") { exclusion(review, candidate.id); continue; }
      if (review.status !== "mapped") { bad(`源码候选未闭环：${candidate.id}`); continue; }
      if (candidate.kind === "page") refs(review.nodeIds, nodes, `${candidate.id} 页面`);
      else if (candidate.kind === "state") refs(review.stateSpaceIds, spaces, `${candidate.id} 状态空间`);
      else {
        const linked = refs(review.edgeIds, edges, `${candidate.id} 交互`);
        for (const edge of linked) if (!array(edge.sourceIds).includes(candidate.id)) bad(`交互 ${edge.id} 未反向关联源码候选 ${candidate.id}`);
        for (const outcome of candidate.outcomes) {
          if (candidate.kind === "branch" && !linked.some((edge) => edge.candidateOutcomes?.[candidate.id] === outcome)) {
            const omitted = review.outcomeExclusions?.[outcome];
            if (omitted) exclusion(omitted, `${candidate.id}/${outcome}`);
            else bad(`源码分支未验证：${candidate.id}/${outcome}`);
          }
        }
      }
    }
    for (const id of reviews.keys()) if (!candidates.has(id)) bad(`存在未登记的源码候选核对：${id}`);

    const vectors = index(coverage.sourceInteractionInventory?.stateVectors, "实际状态向量");
    for (const vector of vectors.values()) {
      if (!spaces.has(vector.spaceId) || !nonempty(vector.resetAction)) bad(`状态向量 ${vector.id} 缺少有效状态空间/独立重置动作`);
      evidence(vector.evidence, `状态向量 ${vector.id}`);
    }
    for (const space of spaces.values()) {
      refs(space.sourceIds, candidates, `状态空间 ${space.id} 源码`);
      if (!space.dimensions || Array.isArray(space.dimensions) || typeof space.dimensions !== "object") { bad(`状态空间 ${space.id} 缺少 dimensions`); continue; }
      const dimensions = Object.entries(space.dimensions);
      let combinations = [{}];
      let invalid = false;
      for (const [key, values] of dimensions) {
        if (!Array.isArray(values) || !values.length || values.some((v) => !["string", "number", "boolean"].includes(typeof v)) || new Set(values).size !== values.length) { bad(`状态维度 ${space.id}/${key} 必须列出唯一有限值`); invalid = true; break; }
        if (combinations.length * values.length > 10000) { bad(`状态空间 ${space.id} 过大，需按有源码依据的独立上下文拆分，不能截断`); invalid = true; break; }
        combinations = combinations.flatMap((previous) => values.map((value) => ({ ...previous, [key]: value })));
      }
      if (invalid) continue;
      const keyOf = (values) => JSON.stringify(dimensions.map(([key]) => values?.[key]));
      const allowed = new Set(combinations.map(keyOf));
      const seen = new Set();
      for (const vector of vectors.values()) if (vector.spaceId === space.id) {
        const key = keyOf(vector.values);
        if (!allowed.has(key) || Object.keys(vector.values ?? {}).length !== dimensions.length || seen.has(key)) bad(`状态向量 ${vector.id} 重复或不属于计划组合`);
        seen.add(key);
      }
      for (const reduction of array(space.reductions)) {
        const key = keyOf(reduction.values);
        exclusion(reduction, `状态空间 ${space.id}`);
        if (!allowed.has(key) || Object.keys(reduction.values ?? {}).length !== dimensions.length || seen.has(key)) bad(`状态空间 ${space.id} 约简重复或不属于计划组合`);
        seen.add(key);
      }
      for (const values of combinations) if (!seen.has(keyOf(values))) bad(`状态组合未验证：${space.id} ${JSON.stringify(values)}`);
    }

    const discoveries = index(graph.runtimeDiscoveries, "运行态发现", true);
    const swept = new Set();
    for (const sweep of array(graph.runtimeSweeps)) {
      if (!nodes.has(sweep.nodeId) || swept.has(sweep.nodeId)) bad(`运行态盘点节点无效/重复：${sweep.nodeId}`);
      swept.add(sweep.nodeId);
      const listed = refs(sweep.discoveryIds, discoveries, `运行态盘点 ${sweep.nodeId}`, true);
      for (const discovery of listed) if (discovery.nodeId !== sweep.nodeId) bad(`运行态发现 ${discovery.id} 归属错误`);
      evidence(sweep.evidence, `运行态盘点 ${sweep.nodeId}`);
    }
    for (const id of nodes.keys()) if (!swept.has(id)) bad(`页面/状态未重新枚举动态控件：${id}`);
    for (const discovery of discoveries.values()) {
      if (!nodes.has(discovery.nodeId) || !nonempty(discovery.locator) || !nonempty(discovery.event)) bad(`运行态发现 ${discovery.id} 缺少节点/定位/事件`);
      if (!array(graph.runtimeSweeps).some((sweep) => sweep.nodeId === discovery.nodeId && array(sweep.discoveryIds).includes(discovery.id))) bad(`运行态发现 ${discovery.id} 未进入盘点记录`);
      const linked = refs(discovery.edgeIds, edges, `运行态发现 ${discovery.id} 交互`);
      for (const edge of linked) if (edge.from !== discovery.nodeId) bad(`运行态发现 ${discovery.id} 的操作起点不一致`);
    }
    const visited = coverage.traversal?.visitedEntryIds;
    refs(visited, entries, "遍历已访问入口");
    if (array(visited).length !== entries.size) bad("遍历已访问入口与独立登记入口不一致");
    if (!Array.isArray(coverage.traversal?.remainingEntryIds) || coverage.traversal.remainingEntryIds.length) bad("遍历剩余入口未清空或未登记");
    return [...new Set(problems)];
  } catch (error) {
    return [`原型地图无法核验：${error.message}`];
  }
}
