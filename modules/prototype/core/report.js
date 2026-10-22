import fs from 'node:fs';
import path from 'node:path';
import { assertPrototypeReportFormat, PROTOTYPE_REPORT_FORMAT_VERSION, RUNTIME_ONLY_COVERAGE_LIMITATION, reportCell, reportText } from './report-format.js';
const text = reportText;
const cell = reportCell;
const link = value => encodeURI(value).replace(/[()]/g, c => `%${c.charCodeAt(0).toString(16)}`);

// Full documents are disk artifacts, never CLI context. Every section is derived.
export function renderReport(store) {
  const evidenceProfile = store.meta('workflow')?.evidenceProfile ?? null;
  const audit = store.audit(evidenceProfile ? { command: 'accept', agent: 'audit-accept' } : {}), brief = { ...store.summary(), complete: audit.complete, problemCount: audit.problems.length, freshness: audit.freshness };
  brief.evidenceProfile = evidenceProfile;
  brief.reportFormatVersion = PROTOTYPE_REPORT_FORMAT_VERSION;
  const destination = path.join(store.directory, 'report.md');
  const temporary = `${destination}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, 'w');
  const line = value => fs.writeSync(fd, `${value}\n`);
  try {
    line('# 原型分析报告\n');
    line(`来源：${text(brief.source.location)}\n\n报告格式：v${PROTOTYPE_REPORT_FORMAT_VERSION}；快照：${text(brief.snapshotId)}；范围：${text(brief.scope.mode)}；索引版本：${brief.revision}`);
    line(`\n可观察边界：${text(brief.scope.observableBoundary)}\n\n结论：${audit.complete ? '相对固定来源的结构与证据对账通过；仍需人工复核追踪真实性与业务语义。' : `尚未完成，${audit.problems.length} 项待处理。`}\n`);
    line('## 覆盖与未覆盖\n\n| 类型 | 登记 | 完成 | 待办 | 阻塞 | 已撤回计划 |\n| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const [kind, counts] of Object.entries(brief.counts)) line(`| ${kind} | ${counts.total} | ${counts.complete} | ${counts.pending} | ${counts.blocked} | ${counts.retired} |`);
    if (evidenceProfile === 'runtime-only') line(`\n${RUNTIME_ONLY_COVERAGE_LIMITATION}\n`);
    line('\n截图数量不等于交互覆盖；相同控件在不同前置状态、输入类别与结果分支分别对账。\n');
    line('## 用户流程、页面与状态\n');
    const groups = [...store.rows('group')].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
    const nodes = [...store.rows('node')], edges = [...store.rows('edge')], visited = new Set();
    const sortedEdges = id => edges.filter(e => e.from === id && e.status !== 'retired').sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
    const collect = (groupId, entryNodeIds = []) => {
      const ordered = [];
      function visit(id) {
        if (visited.has(id)) return;
        const node = nodes.find(n => n.id === id && (n.groupId ?? 'ungrouped') === groupId);
        if (!node) return;
        visited.add(id); ordered.push(node);
        for (const edge of sortedEdges(id)) visit(edge.to);
      }
      for (const id of entryNodeIds) visit(id);
      for (const node of nodes.filter(n => (n.groupId ?? 'ungrouped') === groupId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))) visit(node.id);
      return ordered;
    };
    const sections = groups.map(group => ({ group, nodes: collect(group.id, group.entryNodeIds ?? []) }));
    const ungrouped = collect('ungrouped');
    if (ungrouped.length) sections.push({ group: { id: 'ungrouped', title: '未归组页面', purpose: '' }, nodes: ungrouped });
    let nodeNumber = 0;
    for (const section of sections) {
      line(`### ${text(section.group.title)}\n\n分组 ID：${text(section.group.id)}\n\n分组用途：${text(section.group.purpose)}\n`);
      for (const node of section.nodes) {
      line(`#### ${++nodeNumber}. ${text(node.label)}\n\n节点 ID：${text(node.id)}；分组：${text(node.groupId)}；状态：${text(store.effective('node', node))}\n\n用途：${text(node.purpose)}\n\n前置与复现：${text(node.resetAction)}\n\n状态取值：${text(JSON.stringify(node.values ?? {}))}\n`);
      if (node.reason) line(`无法观察/未完成原因：${text(node.reason)}；影响：${text(node.impact)}\n`);
      const nodeEvidence = (node.evidenceIds ?? []).map(id => store.get('evidence', id)).filter(Boolean);
      const nodeEdges = edges.filter(e => e.from === node.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
      const edgeEvidence = nodeEdges.flatMap(edge =>
        (edge.evidenceIds ?? [])
          .map(id => ({ edge, evidence: store.get('evidence', id) }))
          .filter(({ evidence }) => Boolean(evidence)),
      );
      if (nodeEvidence.length || edgeEvidence.length) {
        line('| 截图 | 操作与结果 | 证据 |\n| --- | --- | --- |');
        for (const e of nodeEvidence)
          line(`| ![${cell(node.label)}](${link(e.path)}) | 操作：${cell(e.action)}；结果：${cell(e.assertion?.actual)} | ${cell(e.id)} · [查看追踪](${link(e.trace)}) |`);
        for (const { edge, evidence } of edgeEvidence) {
          const operation = `${edge.id}：${edge.action?.type} ${edge.action?.target}，输入类别 ${edge.inputClass} → ${edge.to}；结果 ${edge.outcomeKey}：${edge.outcome}；${store.effective('edge', edge)}；复现：${evidence.action}；实际结果：${evidence.assertion?.actual}`;
          line(`| ![${cell(`${edge.id} 截图`)}](${link(evidence.path)}) | ${cell(operation)} | ${cell(evidence.id)} · [查看追踪](${link(evidence.trace)}) |`);
        }
        line('');
      }
      for (const edge of nodeEdges) {
        if ((edge.evidenceIds ?? []).length) continue;
        line(`- ${text(edge.id)}：${text(edge.action?.type)} ${text(edge.action?.target)}，输入类别 ${text(edge.inputClass)} → ${text(edge.to)}；结果 ${text(edge.outcomeKey)}：${text(edge.outcome)}；${store.effective('edge', edge)}；证据 ${(edge.evidenceIds ?? []).join(', ')}`);
        if (edge.reason) line(`\n  原因：${text(edge.reason)}；影响：${text(edge.impact)}\n`);
      }
      }
    }
    line('\n## 截图与证据索引\n\n| ID | 时间 | 动作 | 实际结果 | 截图 | 追踪 |\n| --- | --- | --- | --- | --- | --- |');
    const activeEvidenceIds = new Set();
    for (const type of ['node', 'edge', 'vector', 'entry', 'sweep', 'occurrence'])
      for (const record of store.rows(type)) for (const id of record.evidenceIds ?? []) activeEvidenceIds.add(id);
    for (const e of store.rows('evidence')) if (activeEvidenceIds.has(e.id))
      line(`| ${e.id} | ${cell(e.capturedAt)} | ${cell(e.action)} | ${cell(e.assertion.actual)} | [截图](${link(e.path)}) | [追踪](${link(e.trace)}) |`);
    line('\n## 待确认问题\n');
    const questions = [...store.rows('question')]; if (!questions.length) line('无已登记问题；不代表已核验全部范围。');
    for (const q of questions) line(`### ${text(q.id)} · ${text(q.status)}\n\n问题：${text(q.question)}\n\n影响：${text(q.impact)}\n\n建议：${text(q.suggestedDefault)}；确认人：${text(q.owner)}\n\n分组：${text(q.groupId)}；入口：${text((q.entryIds ?? []).join(', '))}；证据：${text((q.evidenceIds ?? []).join(', '))}\n\nAgent 回答：${text(q.answer)}\n\n结论：${text(q.conclusion)}\n`);
    line('\n## 未完成与无法观察\n');
    for (const type of ['file', 'candidate', 'node', 'edge', 'space', 'vector', 'occurrence', 'sweep', 'entry']) for (const r of store.rows(type)) if (r.reason && ['blocked', 'unavailable', 'pending'].includes(store.effective(type, r))) line(`- ${text(type)}/${text(r.id)}：${text(r.reason)}；影响：${text(r.impact)}`);
    for (const p of audit.problems) line(`- ${text(p)}`);
    line('\n## 文件遍历索引\n\n| 路径 | SHA-256 | 分析状态 | 用途 |\n| --- | --- | --- | --- |');
    for (const f of store.rows('file')) line(`| ${cell(f.path)} | ${f.sha256} | ${store.effective('file', f)} | ${cell(f.purpose)} |`);
    line('\n## 更新记录\n');
    line(`- ${brief.createdAt}：固定来源快照。报告由索引修订 ${brief.revision} 派生；来源变动或抽取器变化需要新快照。`);
  } finally { fs.closeSync(fd); }
  try {
    assertPrototypeReportFormat(fs.readFileSync(temporary, 'utf8'), { evidenceProfile });
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  for (const [name, value] of [['brief.json', brief], ['audit.json', audit]]) {
    const file = path.join(store.directory, name); fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(`${file}.tmp`, file);
  }
  return { report: destination, brief: path.join(store.directory, 'brief.json'), audit: path.join(store.directory, 'audit.json'), complete: audit.complete, problemCount: audit.problems.length, revision: brief.revision, formatVersion: PROTOTYPE_REPORT_FORMAT_VERSION, evidenceProfile };
}
