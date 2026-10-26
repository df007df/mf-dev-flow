export function toggleFilter(completedOnly) {
  return !completedOnly;
}

export function deriveFilterView(items, completedOnly) {
  const visible = completedOnly ? items.filter((item) => item.done) : items;
  const groups = [...new Set(items.map((item) => item.group))].map((id) => ({
    id,
    visibleIds: visible.filter((item) => item.group === id).map((item) => item.id),
  }));
  return {
    completedOnly,
    visibleIds: visible.map((item) => item.id),
    groups,
    summary: {
      visibleCount: visible.length,
      completedCount: visible.filter((item) => item.done).length,
      totalCount: items.length,
    },
    resultText: `显示 ${visible.length} / ${items.length} 项`,
    buttonText: completedOnly ? "显示全部项目" : "仅看已完成",
  };
}
