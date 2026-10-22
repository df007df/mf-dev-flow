// Compatibility projection for old canonical records. Never edits run archives.
export function prototypeEvidenceFeature(feature) {
  const {
    implementationStatus,
    testStatus,
    leafFeatureIds,
    dependsOn,
    stages,
    developmentRecords,
    deliveryCandidates,
    ...evidence
  } = feature;
  return evidence;
}

export function prototypeEvidenceDocument(source = "") {
  let document = source;
  for (const name of [
    "associated-development-records",
    "development-overview",
    "leaf-feature-status",
  ]) {
    const start = `<!-- mf-dev-flow:${name}:start -->`;
    const end = `<!-- mf-dev-flow:${name}:end -->`;
    let from = document.indexOf(start);
    while (from !== -1) {
      const to = document.indexOf(end, from + start.length);
      if (to === -1) break; // Do not discard text after an incomplete marker.
      document = document.slice(0, from) + document.slice(to + end.length);
      from = document.indexOf(start);
    }
  }
  document = document.replace(
    /^## (?:开发与测试回写规则|开发记录状态枚举与说明)\r?\n[\s\S]*?(?=^#{1,2} |$(?![\s\S]))/gm,
    "",
  );
  return document
    .replace(
      "> 本文是项目唯一长期原型真源。原型分析、开发和测试回归均由主 agent 在此回写；一次执行的过程与截图仍保留在对应历史目录。",
      "> 本文只维护原型页面、交互流程、截图证据、覆盖情况与已确认说明。功能点引用这些证据；开发依赖、阶段和验收结果由功能地图与开发运行维护。",
    )
    .replace(/^- 实现状态：原型已覆盖；产品实现见长期子叶功能点。\r?\n/gm, "")
    .replace(/\n{4,}/g, "\n\n\n");
}
