import fs from 'node:fs';
import path from 'node:path';

// New tasks freeze this declaration. Existing tasks never resolve their kind
// against a later registry, so adding a type cannot change an old task's gate.
const types = [
  { id: 'generic', title: '通用任务', version: 1, criteria: [] },
  { id: 'api', title: '接口交付', version: 1, criteria: [
    { id: 'contract', title: '实际请求、响应字段与状态符合约定' },
    { id: 'failure-path', title: '验证输入错误、权限或依赖失败等适用分支' },
    { id: 'regression', title: '相关接口测试与调用方回归通过' },
  ] },
  { id: 'ui', title: '界面交付', version: 1, criteria: [
    { id: 'user-path', title: '真实界面的目标用户路径可完成' },
    { id: 'state-review', title: '按任务约定核对同状态布局、文案与交互' },
    { id: 'regression', title: '适用异常状态和界面回归通过' },
  ] },
  { id: 'fix', title: '问题修复', version: 1, criteria: [
    { id: 'reproduction', title: '记录原问题触发条件与修复前结果' },
    { id: 'resolution', title: '相同触发条件下验证修复结果' },
    { id: 'regression', title: '验证受影响的相邻行为' },
  ] },
];

const validationProfiles = [
  { id: 'auto', title: '自动判定', version: 1 },
  { id: 'standard', title: '标准验证', version: 1 },
  { id: 'style-token', title: '样式令牌调整', version: 1 },
  { id: 'local-ui-structural', title: '页面局部结构调整', version: 1 },
];

const VALIDATION_PROFILE_SCHEMA_VERSION = 1;
// 规则集按版本保留。未来新增或收紧规则时必须添加 v2 resolver，不能修改 v1，
// 否则已 plan 的任务会在 finish 时被追溯改判。
const validationRulesets = new Map([
  [1, {
    version: 1,
    profileIds: new Set(['auto', 'standard', 'style-token', 'local-ui-structural']),
    fastProfileKinds: new Set(['fix', 'ui']),
    styleEntry: /^src\/pages\/(.+)\/index\.(?:scss|css|less|wxss)$/,
    uiEntry: /^src\/pages\/(.+)\/index\.(?:tsx|jsx|scss|css|less|wxss)$/,
    targetedCheck: /^(?:tests|e2e)\/.+\.(?:[cm]?[jt]sx?)$/,
  }],
]);
const VISUAL_STATUSES = new Set(['not_required', 'passed', 'pending_user_review', 'unavailable']);

export function taskTypes() { return structuredClone(types); }
export function validationProfileCatalog() { return structuredClone(validationProfiles); }
export function freezeTaskType(kind) {
  const definition = types.find(type => type.id === kind) ?? types[0];
  return { ...structuredClone(definition), requestedKind: kind, fallback: definition.id !== kind, stages: [] };
}

export function freezeValidationProfile(requested = 'auto') {
  const id = typeof requested === 'string' && requested.trim() ? requested.trim() : 'auto';
  const profile = validationProfiles.find(item => item.id === id);
  if (!profile || !validationRulesets.get(profile.version)?.profileIds.has(profile.id))
    throw new Error(`--validation-profile 只能是 ${validationProfiles.map(item => item.id).join('、')}`);
  return {
    schemaVersion: VALIDATION_PROFILE_SCHEMA_VERSION,
    version: profile.version,
    requested: profile.id,
    risk: 'unclassified',
    classificationConfidence: 'unclassified',
  };
}

function normalizedFiles(files) {
  return [...new Set((files ?? [])
    .filter(file => typeof file === 'string' && file && file !== 'none')
    .map(file => file.replaceAll('\\', '/')))].sort();
}

function frozenValidationProfile(task) {
  const frozen = task?.validationProfile;
  if (!frozen) {
    return {
      valid: false,
      requestedProfile: 'standard',
      reason: '历史任务没有冻结验证档位',
    };
  }
  const requestedProfile = typeof frozen.requested === 'string' && frozen.requested.trim()
    ? frozen.requested.trim()
    : 'unknown';
  if (frozen.schemaVersion !== VALIDATION_PROFILE_SCHEMA_VERSION) {
    return {
      valid: false,
      requestedProfile,
      reason: `schemaVersion=${String(frozen.schemaVersion)} 不受支持`,
    };
  }
  const ruleset = validationRulesets.get(frozen.version);
  if (!ruleset) {
    return {
      valid: false,
      requestedProfile,
      reason: `version=${String(frozen.version)} 没有冻结 resolver`,
    };
  }
  if (!ruleset.profileIds.has(requestedProfile)) {
    return {
      valid: false,
      requestedProfile,
      reason: `requested=${requestedProfile} 不在 v${ruleset.version} 规则集内`,
    };
  }
  if (frozen.risk !== 'unclassified' || frozen.classificationConfidence !== 'unclassified') {
    return {
      valid: false,
      requestedProfile,
      reason: '计划期风险或置信度字段已被改写',
    };
  }
  return { valid: true, requestedProfile, ruleset };
}

function localEntryEligibility(task, files, ruleset, pattern, label) {
  const kind = task?.taskType?.id ?? task?.kind;
  if (!ruleset.fastProfileKinds.has(kind))
    return { eligible: false, reason: `任务类型 ${kind ?? '未声明'} 不属于 fix 或 ui` };
  const roots = new Set();
  let sourceCount = 0;
  for (const file of files) {
    if (ruleset.targetedCheck.test(file)) continue;
    const match = file.match(pattern);
    if (!match)
      return {
        eligible: false,
        reason: `实际改动不满足 ${label}：仅允许 src/pages/<page>/index.${label === 'style-token' ? '(scss|css|less|wxss)' : '(tsx|jsx|scss|css|less|wxss)'} 与 tests/、e2e/ 定向验证文件`,
      };
    roots.add(match[1]);
    sourceCount += 1;
  }
  if (!sourceCount) return { eligible: false, reason: '没有可判定的生产改动文件' };
  if (roots.size !== 1) return { eligible: false, reason: '生产改动跨越多个页面入口' };
  return {
    eligible: true,
    basis: [
      `任务类型为 ${kind}`,
      label === 'style-token'
        ? '生产改动仅限同一页面入口的样式文件'
        : '生产改动仅限同一页面入口的 TSX/样式文件',
      '附加文件仅限 tests/ 或 e2e/ 定向验证',
    ],
  };
}

function standardDecision({ requestedProfile, confidence, basis, visual }) {
  return {
    schemaVersion: 1,
    requestedProfile,
    profile: 'standard',
    risk: 'medium',
    classificationConfidence: confidence,
    basis,
    required: ['task-type-acceptance', 'task-appropriate-regression'],
    skipped: [],
    visual,
  };
}

function fastDecision({ requestedProfile, profile, rulesetVersion, basis, visual }) {
  const structural = profile === 'local-ui-structural';
  return {
    schemaVersion: 1,
    requestedProfile,
    profile,
    risk: 'low',
    classificationConfidence: 'high',
    basis: [...basis, '任务级 Git 基线与声明文件已精确对账'],
    required: structural
      ? ['task-type-acceptance', 'targeted-runtime-check', 'typecheck']
      : ['task-type-acceptance', 'targeted-runtime-check'],
    skipped: [{
      gate: 'full-test-suite',
      reason: `${profile}@${rulesetVersion} 已限定为页面本地展示改动`,
    }],
    visual,
  };
}

export function validationVisualReview(acceptance) {
  const visual = acceptance?.validation?.visual;
  if (!visual || typeof visual !== 'object' || Array.isArray(visual))
    return { status: 'not_required' };
  const result = { status: visual.status };
  if (typeof visual.reason === 'string' && visual.reason.trim()) result.reason = visual.reason.trim();
  if (Array.isArray(visual.evidence) && visual.evidence.length) result.evidence = [...visual.evidence];
  return result;
}

function validationChecksShapeProblems(checks, readableEvidence) {
  if (checks === undefined) return [];
  if (!Array.isArray(checks)) return ['validation.checks 必须是数组'];
  const problems = [];
  const seen = new Set();
  for (const check of checks) {
    if (!check || typeof check !== 'object' || Array.isArray(check) || typeof check.id !== 'string' || !check.id.trim()) {
      problems.push('validation.checks 的每项必须有非空 id');
      continue;
    }
    if (seen.has(check.id)) problems.push(`validation.checks 含重复项：${check.id}`);
    seen.add(check.id);
    if (check.status !== 'passed') problems.push(`validation.checks.${check.id} 尚未通过`);
    if (!Array.isArray(check.evidence) || !check.evidence.length
      || check.evidence.some(file => typeof file !== 'string' || !readableEvidence(file)))
      problems.push(`validation.checks.${check.id} 缺少本运行内可读取的非空 evidence`);
  }
  return problems;
}

export function validationMetadataProblems(acceptance, readableEvidence = () => false) {
  if (acceptance?.validation === undefined) return [];
  const validation = acceptance.validation;
  if (!validation || typeof validation !== 'object' || Array.isArray(validation))
    return ['validation 必须是对象'];
  if (!Object.hasOwn(validation, 'visual')) return ['validation 必须包含 visual'];
  const visual = validation.visual;
  if (!visual || typeof visual !== 'object' || Array.isArray(visual))
    return ['validation.visual 必须是对象'];
  if (!VISUAL_STATUSES.has(visual.status))
    return [`validation.visual.status 只能是 ${[...VISUAL_STATUSES].join('、')}`];
  if (['pending_user_review', 'unavailable'].includes(visual.status)
    && (typeof visual.reason !== 'string' || !visual.reason.trim()))
    return ['validation.visual.reason 必须说明待确认或不可用的原因'];
  if (visual.status === 'passed'
    && (!Array.isArray(visual.evidence) || !visual.evidence.length
      || visual.evidence.some(file => typeof file !== 'string' || !readableEvidence(file))))
    return ['validation.visual.status=passed 需要本运行内可读取的 evidence'];
  return validationChecksShapeProblems(validation.checks, readableEvidence);
}

export function validationDecisionProblems(decision, acceptance, readableEvidence = () => false) {
  if (decision?.profile === 'standard') return [];
  const required = (decision?.required ?? []).filter(id => id !== 'task-type-acceptance');
  if (!required.length) return [];
  const checks = acceptance?.validation?.checks;
  if (!Array.isArray(checks))
    return [`快速验证档位需要 validation.checks：${required.join('、')}`];
  const byId = new Map(checks.map(check => [check?.id, check]));
  const problems = [];
  for (const id of required) {
    const check = byId.get(id);
    if (!check) {
      problems.push(`validation.checks 缺少 ${id}`);
      continue;
    }
    if (check.status !== 'passed') problems.push(`validation.checks.${id} 尚未通过`);
    if (!Array.isArray(check.evidence) || !check.evidence.length
      || check.evidence.some(file => typeof file !== 'string' || !readableEvidence(file)))
      problems.push(`validation.checks.${id} 缺少本运行内可读取的非空 evidence`);
  }
  for (const check of checks)
    if (check?.id && !required.includes(check.id))
      problems.push(`validation.checks 含不适用于 ${decision.profile} 的项：${check.id}`);
  return problems;
}

export function resolveValidationDecision({ task, changedFiles, gitReconciled, acceptance } = {}) {
  const frozen = frozenValidationProfile(task);
  const requestedProfile = frozen.requestedProfile;
  const visual = validationVisualReview(acceptance);
  const files = normalizedFiles(changedFiles);
  if (!frozen.valid) {
    return standardDecision({
      requestedProfile,
      confidence: 'low',
      basis: [`冻结的验证档位无法校验（${frozen.reason}），已回退标准验证`],
      visual,
    });
  }
  const { ruleset } = frozen;
  if (requestedProfile === 'standard') {
    return standardDecision({
      requestedProfile,
      confidence: 'high',
      basis: ['任务计划要求标准验证'],
      visual,
    });
  }
  if (!gitReconciled) {
    return standardDecision({
      requestedProfile,
      confidence: 'medium',
      basis: ['任务级 Git 基线或声明文件尚未完成精确对账，不能授权快速路径'],
      visual,
    });
  }
  const style = localEntryEligibility(task, files, ruleset, ruleset.styleEntry, 'style-token');
  const structural = localEntryEligibility(task, files, ruleset, ruleset.uiEntry, 'local-ui-structural');
  const candidate = requestedProfile === 'auto'
    ? (style.eligible ? { id: 'style-token', result: style } : structural.eligible ? { id: 'local-ui-structural', result: structural } : null)
    : requestedProfile === 'style-token'
      ? { id: 'style-token', result: style }
      : requestedProfile === 'local-ui-structural'
        ? { id: 'local-ui-structural', result: structural }
        : null;
  if (candidate?.result?.eligible)
    return fastDecision({
      requestedProfile,
      profile: candidate.id,
      rulesetVersion: ruleset.version,
      basis: candidate.result.basis,
      visual,
    });
  const reason = candidate?.result?.reason ?? structural.reason ?? style.reason ?? '无法确认实际改动范围';
  return standardDecision({
    requestedProfile,
    confidence: requestedProfile === 'auto' ? 'high' : 'low',
    basis: [
      requestedProfile === 'auto'
        ? `自动判定未命中快速路径：${reason}`
        : `实际改动不满足 ${requestedProfile}：${reason}，已回退标准验证`,
    ],
    visual,
  });
}

export function readableRunEvidence(directory, reference) {
  try {
    const file = fs.realpathSync(path.resolve(directory, reference));
    const root = fs.realpathSync(directory);
    return file.startsWith(root + path.sep) && fs.statSync(file).isFile() && fs.statSync(file).size > 0;
  } catch { return false; }
}

export function taskTypeProblems(task, acceptance, readableEvidence = () => false) {
  const contract = task.taskType;
  if (!contract || !contract.criteria.length) return [];
  if (!acceptance || acceptance.type !== contract.id || acceptance.version !== contract.version || !Array.isArray(acceptance.checks))
    return ['验收清单必须匹配任务创建时的类型与版本，并提供 checks'];
  const problems = [], seen = new Set();
  for (const check of acceptance.checks) {
    if (!contract.criteria.some(item => item.id === check.id) || seen.has(check.id)) problems.push(`未知或重复验收项：${check.id}`);
    seen.add(check.id);
    if (check.status !== 'passed') problems.push(`验收项 ${check.id} 尚未通过`);
    if (!Array.isArray(check.evidence) || !check.evidence.length || check.evidence.some(file => typeof file !== 'string' || !readableEvidence(file)))
      problems.push(`验收项 ${check.id} 缺少本运行内可读取的非空证据文件`);
  }
  for (const criterion of contract.criteria) if (!seen.has(criterion.id)) problems.push(`缺少验收项：${criterion.id}`);
  problems.push(...validationMetadataProblems(acceptance, readableEvidence));
  return problems;
}
