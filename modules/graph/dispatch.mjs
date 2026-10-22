// 分派建议的单一实现：CLI graph impact 与看板 reader 共用（M4 起）。
// 只产建议不建运行；注册表异常不阻断只读查询（返回空建议）。
import { loadRegistry, listSummary, resolveType } from "../types/registry.mjs";

export function suggestDispatch(graph, seeds, affected) {
  const seedKinds = new Set(
    seeds.map(ref => graph.nodes.find(node => node.ref === ref)?.kind).filter(Boolean),
  );
  const suggestions = [];
  try {
    const registry = loadRegistry();
    for (const summary of listSummary(registry.entries)) {
      const entry = resolveType(registry.entries, summary.id);
      for (const rule of entry?.process?.dispatch ?? []) {
        const triggers = Array.isArray(rule.whenDirty) ? rule.whenDirty : [rule.whenDirty];
        if (!triggers.some(kind => seedKinds.has(kind))) continue;
        const targets = affected.filter(item => item.kind === rule.affects).map(item => item.ref);
        if (targets.length)
          suggestions.push({ openTaskType: rule.openTaskType, batching: rule.batching, autoCreate: false, targets });
      }
    }
  } catch { /* 注册表不可用时建议为空，闭包结果仍有效 */ }
  return suggestions;
}
