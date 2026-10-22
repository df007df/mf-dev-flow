const text = (value) => typeof value === "string" && value.trim().length > 0;

export function featureAnalysisProblems(feature) {
  // Historical maps remain readable; once assessed, all three source classes are required.
  if (feature?.analysis == null) return [];
  const problems = [];
  const analysis = feature.analysis;
  for (const field of ["prototype", "code", "systems", "scope"])
    if (!text(analysis[field]))
      problems.push(`analysis.${field} 必须说明依据与边界`);
  if (
    !Array.isArray(analysis.gaps) ||
    !analysis.gaps.length ||
    analysis.gaps.some((gap) => !text(gap))
  )
    problems.push("analysis.gaps 必须列出差距或明确无待核验项");
  const sources = Array.isArray(analysis.sources) ? analysis.sources : [];
  for (const kind of ["prototype", "code", "system"])
    if (
      !sources.some(
        (source) =>
          source?.kind === kind && text(source.ref) && text(source.note),
      )
    )
      problems.push(`analysis.sources 缺少 ${kind} 来源定位与说明`);
  if (!text(feature.priorityReason))
    problems.push("priorityReason 必须说明 P 标签维持或调整原因");
  if (!/^W\d+(?:-W\d+)?$/.test(feature.wave || ""))
    problems.push("wave 必须是 W0 或 W0-W1 形式");
  if (!text(feature.waveReason))
    problems.push("waveReason 必须说明 W 标签补充或调整原因");
  return problems.map((problem) => `叶子功能 ${feature.id}：${problem}`);
}

export function labelAssessmentHistory(feature, previous, { at, runId }) {
  const history = previous?.labelHistory ?? [];
  if (!feature.priorityReason || !feature.waveReason) return history;
  const last = history.at(-1);
  if (last?.runId === runId) return history;
  if (
    previous?.priority === feature.priority &&
    previous?.wave === feature.wave &&
    previous?.priorityReason === feature.priorityReason &&
    previous?.waveReason === feature.waveReason &&
    last
  )
    return history;
  return [
    ...history,
    {
      at,
      runId,
      from: {
        priority: previous?.priority ?? null,
        wave: previous?.wave ?? null,
      },
      to: { priority: feature.priority, wave: feature.wave },
      priorityReason: feature.priorityReason,
      waveReason: feature.waveReason,
    },
  ];
}
