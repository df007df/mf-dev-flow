import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Each scenario runs in a fresh temp cwd; fail() exits the process, so
// negative cases assert on the child's stderr instead of thrown errors.
function runChild(cwd, source, expectSuccess) {
  const imports = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    import * as shared from ${JSON.stringify(new URL("../modules/runtime/shared.mjs", import.meta.url).href)};
    import * as delivery from ${JSON.stringify(new URL("../modules/runtime/delivery.mjs", import.meta.url).href)};
    import * as planning from ${JSON.stringify(new URL("../modules/runtime/planning.mjs", import.meta.url).href)};
    import { loadDeliveryProcess } from ${JSON.stringify(new URL("../modules/delivery/processes.mjs", import.meta.url).href)};
    import { readPrototypeRevision } from ${JSON.stringify(new URL("../dashboard/server/prototype-impact.js", import.meta.url).href)};
    const put = (rel, value) => {
      const file = path.join('.mf-dev-flow', rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    };
    const argv = (list) => { process.argv = ['node', 'mf-dev-flow.mjs', ...list]; };
    const SUMMARY = '结论：完成；证据：见运行记录；变更：仅本任务范围；验证：fixture 校验通过；风险/下一步：';
  `;
  // Fixture: v2 delivery run for one leaf feature, execution claimed and at
  // technical_solution, plus a seeded open risk to exercise carry-over.
  const bootstrap = `
    put('project.json', { schemaVersion: 1, project: { name: 'v2-fixture' }, codeRoots: [{ path: 'src', roles: ['api-provider'] }] });
    put('prototype/task.json', { status: 'accepted' });
    put('prototype/feature-index.json', { features: [] });
    put('prototype/coverage.json', {});
    put('prototype/open-questions.json', { questions: [] });
    const baseline = readPrototypeRevision(path.resolve('.mf-dev-flow'));
    put('planning/feature-map.json', {
      schemaVersion: 3, sourceRun: 'r1', prototypeRun: null, evidenceCursor: 'c1',
      refinementEvidenceCursor: 'c1', prototypeBaseline: baseline,
      groups: [{ id: 'g1', rank: 1, title: '域' }],
      features: [{ id: 'reader-leaf', title: '阅读器正文、播放与学习设置', parentId: 'g1', rank: 1,
        outcome: '可阅读', description: 'fixture', priority: 'P0', wave: 'W1',
        status: 'in_progress', planningRevision: 'rev-1',
        risks: [{ id: 'risk-seed', text: '音频同步与词卡标注因实测数据缺失未接', status: 'open',
          source: { runId: 'old-run', taskId: 'old-task', stageId: 'development' },
          createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z' }] }],
    });
    const runId = shared.createDeliveryRun({ title: 'v2 功能点 fixture', prototypeRun: null, input: {
      source: 'feature-map', intensity: 'focused', taskDescription: '按 v2 流程交付',
      features: [{ id: 'reader-leaf', title: '阅读器正文、播放与学习设置', planningRevision: 'rev-1' }],
      extraction: null,
    } });
    const run = { type: 'delivery', id: runId, dir: path.resolve('.mf-dev-flow', 'delivery-runs', runId) };
    const input = shared.deliveryInput(run);
    const task = {
      id: 'reader-task', title: '阅读器 v2', kind: 'miniapp-product', phase: 'delivery',
      stageDefinitions: input.stages.map(({ status, summary, updatedAt, ...rest }) => rest),
      scope: 'product', leafFeatureIds: ['reader-leaf'], featureRevision: 'rev-1',
      deliveryTargets: [{ path: 'src', deliveryRoles: ['api-provider'] }],
      deliveryTarget: { path: 'src', deliveryRoles: ['api-provider'] },
      writes: ['src'], reads: [], dependsOn: [], coupling: '无', verification: 'fixture', createdAt: '2026-09-08T00:00:00.000Z',
    };
    put('delivery-runs/' + runId + '/work-plan.json', { schemaVersion: 1, runId, runType: 'delivery', tasks: [task] });
    // prototype_alignment closed in input + execution so technical_solution is active.
    input.stages[0].status = 'confirmed';
    input.stages[0].summary = SUMMARY + '无';
    fs.writeFileSync(path.join('.mf-dev-flow', 'delivery-runs', runId, 'delivery-input.json'), JSON.stringify(input));
    put('delivery-runs/' + runId + '/executions/reader-task.json', {
      status: 'in_progress', agent: 'technical_solution', sessionId: 'sess-fixture',
      targetPhase: 'end_to_end_acceptance',
      stages: { prototype_alignment: { status: 'confirmed', summary: SUMMARY + '无' } },
    });
    run.run = JSON.parse(fs.readFileSync(path.join(run.dir, 'run.json')));
  `;
  const childSource = imports + bootstrap + source;
  if (process.env.MF_DEV_FLOW_DEBUG_CHILD)
    fs.writeFileSync(path.join(cwd, "child-src.mjs"), childSource);
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", childSource], { cwd, encoding: "utf8" });
  if (result.status !== 0 && process.env.MF_DEV_FLOW_DEBUG_CHILD)
    console.log(`child line map:\n${childSource.split("\n").map((l, i) => `${i + 1}: ${l}`).slice(55, 75).join("\n")}\nstderr:\n${result.stderr}`);
  if (expectSuccess && result.status !== 0)
    assert.fail(`fixture child failed:\n${result.stderr}\n${result.stdout}`);
  if (!expectSuccess && result.status === 0)
    assert.fail(`expected gate failure but child succeeded:\n${result.stdout}`);
  return result;
}

function isolated(source, expectSuccess = true) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-v2-"));
  try {
    return runChild(cwd, source, expectSuccess);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

const v2Process = () => loadDeliveryProcess({ id: "miniapp-product", version: 2 });

test("v2 流程冻结新门禁仍可显式取回；feature-map 默认注入开放风险", () => {
  isolated(`
    const process2 = loadDeliveryProcess({ id: 'miniapp-product', version: 2 });
    const gates = Object.fromEntries(process2.stages.map(s => [s.id, s.evidenceGates]));
    assert.ok(gates.technical_solution.includes('dataflow_svg_evidence'));
    assert.ok(gates.development.includes('risk_ledger'));
    assert.ok(gates.end_to_end_acceptance.includes('e2e_screenshot_evidence'));
    assert.ok(gates.end_to_end_acceptance.includes('visual_validation_pair'));
    const frozen = shared.deliveryInput(run);
    assert.equal(frozen.deliveryProcess.version, 3);
    assert.deepEqual(frozen.carriedRisks.map(r => r.id), ['risk-seed']);
    assert.equal(frozen.carriedRisks[0].featureId, 'reader-leaf');
  `);
});

test("delivery-brief 展示继承风险并为各阶段给出新门禁指令", () => {
  isolated(`
    argv(['work', 'delivery-brief', '--run', runId, '--task', 'reader-task']);
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    delivery.workDeliveryBrief();
    console.log = origLog;
    const brief = logs.join('\\n');
    assert.ok(brief.includes('功能点携带的开放风险/下一步（本次运行输入）'), 'brief missing carried-risk section');
    assert.match(brief, /\`risk-seed\` · reader-leaf：音频同步与词卡标注因实测数据缺失未接/);
    assert.match(brief, /数据流转门禁/);
    assert.match(brief, /风险台账门禁/);
  `);
});

test("技术方案缺少数据流转 SVG 时不得确认，登记后通过", () => {
  // negative: no artifact registered yet
  const negative = isolated(`
    argv(['delivery', 'stage', '--run', runId, '--task', 'reader-task',
      '--stage', 'technical_solution', '--status', 'confirmed',
      '--summary', SUMMARY + '无']);
    delivery.deliveryStage();
  `, false);
  assert.match(negative.stderr, /数据系统流转图未登记/);

  // positive: register SVG + writing-plans dev_plan via stage-artifact, then confirm
  isolated(`
    fs.mkdirSync('evidence-tmp', { recursive: true });
    fs.writeFileSync('evidence-tmp/dataflow.svg',
      '<svg xmlns="http://www.w3.org/2000/svg"><text>小程序→内容服务 GET /api/v1/reader/content→localStorage session</text></svg>');
    fs.writeFileSync('plan.md', '# 开发计划\\n切片 1：本地书签存储。\\n');
    argv(['delivery', 'stage-artifact', '--run', runId, '--task', 'reader-task',
      '--stage', 'technical_solution', '--kind', 'dataflow_svg',
      '--file', 'evidence-tmp/dataflow.svg', '--caption', '系统+数据+接口：阅读正文流转']);
    delivery.deliveryStageArtifact();
    argv(['delivery', 'stage-artifact', '--run', runId, '--task', 'reader-task',
      '--stage', 'technical_solution', '--kind', 'dev_plan',
      '--file', 'plan.md', '--caption', 'writing-plans 计划']);
    delivery.deliveryStageArtifact();
    argv(['delivery', 'stage', '--run', runId, '--task', 'reader-task',
      '--stage', 'technical_solution', '--status', 'confirmed',
      '--summary', SUMMARY + '无']);
    delivery.deliveryStage();
    const stored = shared.deliveryInput(run);
    const tech = stored.stages.find(s => s.id === 'technical_solution');
    assert.equal(tech.status, 'confirmed');
    assert.equal(tech.artifacts.filter(a => a.kind === 'dataflow_svg').length, 1);
    assert.equal(tech.artifacts.filter(a => a.kind === 'dev_plan').length, 1);
    assert.match(tech.artifacts[0].file, /technical_solution\\/.*dataflow\\.svg$/);
    assert.ok(fs.existsSync(path.join(run.dir, tech.artifacts[0].file)));
    const verification = fs.readFileSync(path.join(run.dir, 'verification.md'), 'utf8');
    assert.match(verification, /dataflow_svg/);
  `);
});

// Confirms technical_solution through the real gates so development becomes active.
// The fixture runs the default v3 process, whose technical_solution evidenceGates
// include dev_plan_evidence (not catalog-guarded), so plan.md must be registered too.
const PASS_TECH = `
  fs.writeFileSync('ev.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  argv(['delivery', 'stage-artifact', '--run', runId, '--task', 'reader-task',
    '--stage', 'technical_solution', '--kind', 'dataflow_svg',
    '--file', 'ev.svg', '--caption', '系统+数据+接口流转图']);
  delivery.deliveryStageArtifact();
  fs.writeFileSync('plan.md', '# 开发计划\\n切片 1：按 v2 流程实施。\\n');
  argv(['delivery', 'stage-artifact', '--run', runId, '--task', 'reader-task',
    '--stage', 'technical_solution', '--kind', 'dev_plan',
    '--file', 'plan.md', '--caption', 'writing-plans 计划']);
  delivery.deliveryStageArtifact();
  argv(['delivery', 'stage', '--run', runId, '--task', 'reader-task',
    '--stage', 'technical_solution', '--status', 'confirmed', '--summary', SUMMARY + '无']);
  delivery.deliveryStage();
  const techExecFile = shared.executionFile(run, 'reader-task');
  const techExec = shared.readJson(techExecFile);
  techExec.agent = 'development';
  shared.writeJson(techExecFile, techExec);
`;

test("开发阶段留项风险必须 --risk 登记到功能点，否则不得确认", () => {
  const negative = isolated(`
    ${PASS_TECH}
    argv(['delivery', 'stage', '--run', runId, '--task', 'reader-task',
      '--stage', 'development', '--status', 'confirmed',
      '--summary', SUMMARY + '音频同步与词卡标注因实测数据缺失未接（如实留项）']);
    delivery.deliveryStage();
  `, false);
  assert.match(negative.stderr, /留有挂账项，但未登记到功能点/);

  isolated(`
    ${PASS_TECH}
    argv(['delivery', 'stage', '--run', runId, '--task', 'reader-task',
      '--stage', 'development', '--status', 'confirmed',
      '--summary', SUMMARY + '两条留项已逐条登记为功能点风险台账（feature risks 可查）。',
      '--risk', '音频同步与词卡标注待有样本书后回归',
      '--risk', 'toc/book 页 opusUid 串联归 reading-progress 叶子']);
    delivery.deliveryStage();
    const map = shared.readJson(shared.featureMapFile());
    const risks = map.features.find(f => f.id === 'reader-leaf').risks;
    const fresh = risks.filter(r => r.source?.runId === runId && r.source?.stageId === 'development');
    assert.equal(fresh.length, 2);
    assert.equal(fresh[0].status, 'open');
    assert.match(fresh[0].text, /音频同步/);
    const verification = fs.readFileSync(path.join(run.dir, 'verification.md'), 'utf8');
    assert.ok(
      verification.includes('音频同步与词卡标注待有样本书后回归'),
      'verification.md missing ledger block',
    );
    // 同阶段重试无需重复登记：本次运行该阶段已有台账即可放行
    const retryExecFile = shared.executionFile(run, 'reader-task');
    const retryExec = shared.readJson(retryExecFile);
    retryExec.stages.development = null;
    delete retryExec.stages.development;
    shared.writeJson(retryExecFile, retryExec);
    const stored = shared.deliveryInput(run);
    stored.stages.find(s => s.id === 'development').status = 'in_progress';
    fs.writeFileSync(path.join('.mf-dev-flow', 'delivery-runs', runId, 'delivery-input.json'), JSON.stringify(stored));
    argv(['delivery', 'stage', '--run', runId, '--task', 'reader-task',
      '--stage', 'development', '--status', 'confirmed',
      '--summary', SUMMARY + '沿用本阶段已登记的两条风险台账。']);
    delivery.deliveryStage();
  `);
});

test("端到端验收必须在本阶段登记真实截图", () => {
  const negative = isolated(`
    const execFile = shared.executionFile(run, 'reader-task');
    const exec = shared.readJson(execFile);
    exec.agent = 'end_to_end_acceptance';
    exec.stages.technical_solution = { status: 'confirmed' };
    exec.stages.development = { status: 'confirmed' };
    shared.writeJson(execFile, exec);
    const stored = shared.deliveryInput(run);
    for (const id of ['technical_solution', 'development']) {
      const stage = stored.stages.find(s => s.id === id);
      stage.status = 'confirmed';
      stage.summary = SUMMARY + '无';
    }
    fs.writeFileSync(path.join('.mf-dev-flow', 'delivery-runs', runId, 'delivery-input.json'), JSON.stringify(stored));
    argv(['delivery', 'stage', '--run', runId, '--task', 'reader-task',
      '--stage', 'end_to_end_acceptance', '--status', 'confirmed', '--summary', SUMMARY + '无']);
    delivery.deliveryStage();
  `, false);
  // 早期阶段的运行级证据（本 fixture 未绑定 ui-client 角色，visual pair 等被合法跳过）
  // 不能替代本阶段截图：本阶段缺登记必须被拒绝。
  assert.match(negative.stderr, /本阶段尚未登记 E2E 截图证据/);

  isolated(`
    const execFile = shared.executionFile(run, 'reader-task');
    const exec = shared.readJson(execFile);
    exec.agent = 'end_to_end_acceptance';
    exec.stages.technical_solution = { status: 'confirmed' };
    exec.stages.development = { status: 'confirmed' };
    shared.writeJson(execFile, exec);
    const stored = shared.deliveryInput(run);
    for (const id of ['technical_solution', 'development']) {
      const stage = stored.stages.find(s => s.id === id);
      stage.status = 'confirmed';
      stage.summary = SUMMARY + '无';
    }
    fs.writeFileSync(path.join('.mf-dev-flow', 'delivery-runs', runId, 'delivery-input.json'), JSON.stringify(stored));
    fs.mkdirSync('shot-tmp', { recursive: true });
    fs.writeFileSync('shot-tmp/e2e-reader.png', 'PNGFIXTURE');
    argv(['delivery', 'stage-artifact', '--run', runId, '--task', 'reader-task',
      '--stage', 'end_to_end_acceptance', '--kind', 'e2e_screenshot',
      '--file', 'shot-tmp/e2e-reader.png', '--caption', '真实小程序正文渲染结果图']);
    delivery.deliveryStageArtifact();
    argv(['delivery', 'stage', '--run', runId, '--task', 'reader-task',
      '--stage', 'end_to_end_acceptance', '--status', 'confirmed', '--summary', SUMMARY + '无']);
    delivery.deliveryStage();
    const stored2 = shared.deliveryInput(run);
    const acceptance = stored2.stages.find(s => s.id === 'end_to_end_acceptance');
    assert.equal(acceptance.status, 'confirmed');
    assert.equal(acceptance.artifacts.filter(a => a.kind === 'e2e_screenshot').length, 1);
  `);
});

test("冻结的功能级最终验收用例必须逐条记录并关联本阶段截图", () => {
  const negative = isolated(`
    const execFile = shared.executionFile(run, 'reader-task');
    const exec = shared.readJson(execFile);
    exec.agent = 'end_to_end_acceptance';
    exec.stages.technical_solution = { status: 'confirmed' };
    exec.stages.development = { status: 'confirmed' };
    shared.writeJson(execFile, exec);
    const planFile = shared.workPlanFile(run);
    const plan = shared.readJson(planFile);
    const plannedTask = plan.tasks.find(item => item.id === 'reader-task');
    plannedTask.stageDefinitions.find(stage => stage.id === 'end_to_end_acceptance').acceptanceCriteria = [{
      id: 'AC-READER-001',
      title: '完整阅读闭环',
      detail: '进入正文、完成阅读并返回。',
      origin: 'feature-acceptance-case',
    }];
    shared.writeJson(planFile, plan);
    const stored = shared.deliveryInput(run);
    for (const id of ['technical_solution', 'development']) {
      const stage = stored.stages.find(item => item.id === id);
      stage.status = 'confirmed';
      stage.summary = SUMMARY + '无';
    }
    fs.writeFileSync(path.join('.mf-dev-flow', 'delivery-runs', runId, 'delivery-input.json'), JSON.stringify(stored));
    fs.mkdirSync('shot-tmp', { recursive: true });
    fs.writeFileSync('shot-tmp/e2e-reader.png', 'PNGFIXTURE');
    argv(['delivery', 'stage-artifact', '--run', runId, '--task', 'reader-task',
      '--stage', 'end_to_end_acceptance', '--kind', 'e2e_screenshot',
      '--file', 'shot-tmp/e2e-reader.png', '--caption', '真实小程序正文渲染结果图']);
    delivery.deliveryStageArtifact();
    argv(['delivery', 'stage', '--run', runId, '--task', 'reader-task',
      '--stage', 'end_to_end_acceptance', '--status', 'confirmed', '--summary', SUMMARY + '无']);
    delivery.deliveryStage();
  `, false);
  assert.match(negative.stderr, /AC-READER-001 尚未记录结果/);

  isolated(`
    const execFile = shared.executionFile(run, 'reader-task');
    const exec = shared.readJson(execFile);
    exec.agent = 'end_to_end_acceptance';
    exec.stages.technical_solution = { status: 'confirmed' };
    exec.stages.development = { status: 'confirmed' };
    shared.writeJson(execFile, exec);
    const planFile = shared.workPlanFile(run);
    const plan = shared.readJson(planFile);
    const plannedTask = plan.tasks.find(item => item.id === 'reader-task');
    plannedTask.stageDefinitions.find(stage => stage.id === 'end_to_end_acceptance').acceptanceCriteria = [{
      id: 'AC-READER-001',
      title: '完整阅读闭环',
      detail: '进入正文、完成阅读并返回。',
      origin: 'feature-acceptance-case',
    }];
    shared.writeJson(planFile, plan);
    const stored = shared.deliveryInput(run);
    for (const id of ['technical_solution', 'development']) {
      const stage = stored.stages.find(item => item.id === id);
      stage.status = 'confirmed';
      stage.summary = SUMMARY + '无';
    }
    fs.writeFileSync(path.join('.mf-dev-flow', 'delivery-runs', runId, 'delivery-input.json'), JSON.stringify(stored));
    fs.mkdirSync('shot-tmp', { recursive: true });
    fs.writeFileSync('shot-tmp/e2e-reader.png', 'PNGFIXTURE');
    argv(['delivery', 'stage-artifact', '--run', runId, '--task', 'reader-task',
      '--stage', 'end_to_end_acceptance', '--kind', 'e2e_screenshot',
      '--file', 'shot-tmp/e2e-reader.png', '--caption', '真实小程序正文渲染结果图']);
    delivery.deliveryStageArtifact();
    const withArtifact = shared.deliveryInput(run);
    const screenshot = withArtifact.stages
      .find(stage => stage.id === 'end_to_end_acceptance')
      .artifacts.find(item => item.kind === 'e2e_screenshot');
    argv(['delivery', 'acceptance', '--run', runId, '--task', 'reader-task',
      '--case', 'AC-READER-001', '--status', 'passed',
      '--summary', '完整阅读闭环已经通过。',
      '--evidence', screenshot.file]);
    delivery.deliveryAcceptance();
    argv(['delivery', 'stage', '--run', runId, '--task', 'reader-task',
      '--stage', 'end_to_end_acceptance', '--status', 'confirmed', '--summary', SUMMARY + '无']);
    delivery.deliveryStage();
    const finalInput = shared.deliveryInput(run);
    assert.equal(finalInput.stages.find(stage => stage.id === 'end_to_end_acceptance').status, 'confirmed');
    const finalExecution = shared.readJson(shared.executionFile(run, 'reader-task'));
    assert.equal(finalExecution.acceptanceCases['AC-READER-001'].status, 'passed');
  `);
});

test("feature risks / risk-resolve 命令维护功能点独立风险台账", () => {
  isolated(`
    argv(['feature', 'risk-add', '--id', 'reader-leaf', '--text', '手工登记的回归项：多语言环境朗读']);
    planning.featureRiskAdd();
    const afterAdd = shared.readJson(shared.featureMapFile()).features.find(f => f.id === 'reader-leaf').risks;
    assert.equal(afterAdd.length, 2);
    const added = afterAdd[1];
    assert.equal(added.status, 'open');
    assert.equal(added.source.stageId, 'manual');
    argv(['feature', 'risk-resolve', '--id', 'reader-leaf', '--risk', 'risk-seed', '--note', 'v2 首跑已接音频同步']);
    planning.featureRiskResolve();
    const resolved = shared.readJson(shared.featureMapFile()).features.find(f => f.id === 'reader-leaf').risks.find(r => r.id === 'risk-seed');
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.resolution, 'v2 首跑已接音频同步');
    assert.deepEqual(shared.openFeatureRisks(['reader-leaf']).map(r => r.id), [added.id]);
    argv(['feature', 'risks', '--id', 'reader-leaf']);
    const risksOut = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { risksOut.push(String(chunk)); return true; };
    planning.featureRisks();
    process.stdout.write = origWrite;
    assert.equal(JSON.parse(risksOut.join('')).risks.find(r => r.id === 'risk-seed').status, 'resolved');
    // 功能演进地图 markdown 单独展示开放风险列
    const markdown = fs.readFileSync('.mf-dev-flow/planning/功能演进地图.md', 'utf8');
    assert.match(markdown, /开放风险（独立台账，二次运行输入）/);
    assert.match(markdown, /手工登记的回归项：多语言环境朗读/);
    assert.doesNotMatch(markdown, /音频同步与词卡标注因实测数据缺失未接 \\|/);
    // 下一次运行只继承未关闭条目
    const nextRunId = shared.createDeliveryRun({ title: '二次运行 fixture', prototypeRun: null, input: {
      source: 'feature-map', intensity: 'focused', taskDescription: '续跑风险',
      features: [{ id: 'reader-leaf', title: '阅读器正文、播放与学习设置', planningRevision: 'rev-1' }],
      extraction: null,
    } });
    const nextInput = JSON.parse(fs.readFileSync(path.join('.mf-dev-flow', 'delivery-runs', nextRunId, 'delivery-input.json')));
    assert.deepEqual(nextInput.carriedRisks.map(r => r.text), ['手工登记的回归项：多语言环境朗读']);
  `);
});
