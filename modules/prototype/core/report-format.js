export const PROTOTYPE_REPORT_FORMAT_VERSION = 2;
export const SUPPORTED_PROTOTYPE_REPORT_FORMAT_VERSIONS = Object.freeze([1, PROTOTYPE_REPORT_FORMAT_VERSION]);
export const RUNTIME_ONLY_COVERAGE_LIMITATION = '证据等级：运行态覆盖。本报告只描述已实际观察并归档证据的行为；不声明源码、隐藏分支或未观察状态的完整性。';

export const PROTOTYPE_REPORT_SECTIONS = Object.freeze([
  '覆盖与未覆盖',
  '用户流程、页面与状态',
  '截图与证据索引',
  '待确认问题',
  '未完成与无法观察',
  '文件遍历索引',
  '更新记录',
]);

export const PROTOTYPE_CANONICAL_REPORT_SECTIONS = Object.freeze([
  ...PROTOTYPE_REPORT_SECTIONS,
  '用户问题、回答与需求',
  '语义变更与回答历史',
]);

export function reportText(value) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/[<>]/g, character => character === '<' ? '&lt;' : '&gt;')
    .replace(/([`*_[\]|])/g, '\\$1');
}

export function reportCell(value) {
  return reportText(value);
}

function equalList(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

// This validator protects the generated-document boundary. It deliberately
// validates the Markdown contract instead of trying to infer product truth.
export function assertPrototypeReportFormat(markdown, { canonical = false, formatVersion = PROTOTYPE_REPORT_FORMAT_VERSION, evidenceProfile = null } = {}) {
  const source = String(markdown ?? '');
  const lines = source.split(/\r?\n/);
  const problems = [];
  const version = Number(formatVersion);
  if (!SUPPORTED_PROTOTYPE_REPORT_FORMAT_VERSIONS.includes(version)) problems.push(`unsupported report format version: ${formatVersion}`);
  if (lines[0] !== '# 原型分析报告') problems.push('document must start with the canonical H1');
  if (!source.includes(`报告格式：v${version}`)) problems.push('report format version is missing');
  if (evidenceProfile === 'runtime-only' && !source.includes(RUNTIME_ONLY_COVERAGE_LIMITATION))
    problems.push('runtime-only coverage limitation is missing');

  const sections = lines.flatMap(line => line.startsWith('## ') ? [line.slice(3)] : []);
  const expected = canonical ? PROTOTYPE_CANONICAL_REPORT_SECTIONS : PROTOTYPE_REPORT_SECTIONS;
  if (!equalList(sections, expected)) problems.push(`H2 section order must be: ${expected.join(' > ')}`);

  const requiredTables = [
    '| 类型 | 登记 | 完成 | 待办 | 阻塞 | 已撤回计划 |',
    '| ID | 时间 | 动作 | 实际结果 | 截图 | 追踪 |',
    '| 路径 | SHA-256 | 分析状态 | 用途 |',
  ];
  for (const header of requiredTables) {
    const index = lines.indexOf(header);
    if (index < 0 || !/^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[index + 1] ?? ''))
      problems.push(`required table is missing or malformed: ${header}`);
  }

  for (const [index, line] of lines.entries()) {
    if (!line.includes('![')) continue;
    if (!line.startsWith('| ') || !line.endsWith(' |')) problems.push(`image must be inside a Markdown table row at line ${index + 1}`);
    if (!/\]\((?:[^)\n]*\/)?screenshots\/[^)\n]+\)/.test(line)) problems.push(`image must reference an archived screenshot at line ${index + 1}`);
  }

  const flowStart = lines.indexOf('## 用户流程、页面与状态');
  const flowEnd = lines.indexOf('## 截图与证据索引');
  let activeGroup = false;
  for (const line of lines.slice(flowStart + 1, flowEnd)) {
    if (line.startsWith('### ')) activeGroup = true;
    if (line.startsWith('#### ') && !activeGroup) problems.push('page/state H4 must belong to a group H3');
  }

  if (source.includes('状态空间与排除依据')) problems.push('audit-only state-space section must not be user-facing');
  if (problems.length) throw new Error(`Prototype report format v${PROTOTYPE_REPORT_FORMAT_VERSION} invalid: ${problems.join('; ')}`);
  return { formatVersion: version, canonical, sections, imageCount: lines.filter(line => line.includes('![')).length };
}
