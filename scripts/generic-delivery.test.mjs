import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Import the runtime only in the child, after selecting its isolated cwd.
function isolated(source) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-generic-"));
  try {
    const imports = `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import path from 'node:path';
      import * as shared from ${JSON.stringify(new URL("../modules/runtime/shared.mjs", import.meta.url).href)};
      import { DELIVERY_STAGES } from ${JSON.stringify(new URL("./delivery-contract.mjs", import.meta.url).href)};
      const put = (rel, value) => {
        const file = path.join('.mf-dev-flow', rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(value));
      };
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", imports + source], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test("通用任务与历史检查点共存时不提前完成叶子，也不丢旧阶段证据", () => {
  isolated(`
    const legacy = { id: 'old', title: 'old', scope: 'product', phase: 'delivery', leafFeatureIds: ['leaf'], writes: ['src'], featureRevision: 'r1' };
    const generic = { ...legacy, id: 'new', stageDefinitions: [] };
    const runs = {};
    for (const [id, task] of [['legacy', legacy], ['generic', generic]]) {
      put('delivery-runs/' + id + '/run.json', { id, type: 'delivery', title: id, status: 'in_progress' });
      put('delivery-runs/' + id + '/work-plan.json', { tasks: [task] });
      put('delivery-runs/' + id + '/executions/' + task.id + '.json', { status: 'done', stages: { prototype_alignment: { status: 'confirmed' }, api_mock: { status: 'confirmed' } } });
      runs[id] = { id, type: 'delivery', dir: path.resolve('.mf-dev-flow/delivery-runs', id) };
    }
    put('planning/feature-map.json', { groups: [], features: [{ id: 'leaf', title: 'Leaf', status: 'in_progress', planningRevision: 'r1', stages: shared.defaultFeatureStages() }] });
    const feature = () => JSON.parse(fs.readFileSync('.mf-dev-flow/planning/feature-map.json')).features[0];
    shared.projectTaskStateToFeatureMap(runs.generic, generic);
    assert.equal(feature().status, 'in_progress');
    for (const stage of DELIVERY_STAGES.slice(0, 2)) {
      shared.projectTaskStateToFeatureMap(runs.legacy, legacy, { stage: { id: stage.id, status: 'confirmed', summary: 'historical evidence' } });
    }
    shared.projectTaskStateToFeatureMap(runs.generic, generic);
    assert.equal(feature().stages.prototype_alignment.status, 'confirmed');
    assert.deepEqual(feature().stageDefinitions, []);
    shared.projectTaskStateToFeatureMap(runs.legacy, legacy, { stage: { id: 'technical_implementation', status: 'confirmed', summary: 'implemented' } });
    assert.equal(feature().stageDefinitions, undefined);
    assert.equal(feature().stages.api_mock.summary, 'historical evidence');
    put('delivery-runs/legacy/executions/old.json', { status: 'done', stages: Object.fromEntries(DELIVERY_STAGES.map(stage => [stage.id, { status: 'confirmed' }])) });
    shared.projectTaskStateToFeatureMap(runs.legacy, legacy, { stage: { id: 'end_to_end_acceptance', status: 'confirmed', summary: 'accepted' } });
    assert.equal(feature().status, 'done');
  `);
});

test("通用报告只更新声明的同步区块，不追加固定格式", () => {
  isolated(`
    put('project.json', { project: { name: 'fixture' } });
    const id = shared.createDeliveryRun({ title: '通用 fixture', prototypeRun: null, input: { source: 'manual', intensity: 'focused', taskDescription: '记录结果', features: [] } });
    const run = { id, type: 'delivery', dir: path.resolve('.mf-dev-flow/delivery-runs', id) };
    const implementation = path.join(run.dir, 'implementation.md');
    const verification = path.join(run.dir, 'verification.md');
    const markers = shared.DELIVERY_REPORT_MARKERS.outcomes;
    fs.writeFileSync(implementation, '# 实时记录\\n\\n自由格式结果。\\n' + markers[0] + '\\n旧占位\\n' + markers[1] + '\\n');
    const freeVerification = '# 测试与回归\\n\\n验证通过。\\n';
    fs.writeFileSync(verification, freeVerification);
    shared.syncDeliveryReports(run);
    assert.match(fs.readFileSync(implementation, 'utf8'), /自由格式结果/);
    assert.doesNotMatch(fs.readFileSync(implementation, 'utf8'), /旧占位/);
    assert.equal(fs.readFileSync(verification, 'utf8'), freeVerification);
    assert.doesNotMatch(fs.readFileSync(path.join(run.dir, 'plan.md'), 'utf8'), /stage-todo/);
    assert.deepEqual(shared.deliveryReportProblems(run), []);
  `);
});

test("功能地图启动的小程序产品运行冻结四阶段，手工运行仍保持通用结构", () => {
  isolated(`
    const feature = { id: 'account-trial-entry', title: '登录承接与体验书领取' };
    const id = shared.createDeliveryRun({ title: '小程序 fixture', prototypeRun: 'p1', input: { source: 'feature-map', intensity: 'focused', taskDescription: '沿用既有接口', features: [feature] } });
    const input = JSON.parse(fs.readFileSync(path.join('.mf-dev-flow', 'delivery-runs', id, 'delivery-input.json')));
    assert.equal(input.deliveryContract.id, 'miniapp-product-delivery');
    assert.deepEqual(input.stages.map(stage => stage.id), ['prototype_alignment', 'technical_solution', 'development', 'end_to_end_acceptance']);
    assert.ok(!input.stages.some(stage => stage.id === 'api_mock'));
  `);
});

test("功能地图可显式选择 Web 连续交付契约", () => {
  isolated(`
    const feature = { id: 'trip-list-filter', title: '按状态筛选行前事项' };
    const id = shared.createDeliveryRun({ title: 'Web fixture', prototypeRun: 'p1', input: { source: 'feature-map', intensity: 'focused', deliveryProcess: 'web-product@1', taskDescription: '实现筛选闭环', features: [feature] } });
    const input = JSON.parse(fs.readFileSync(path.join('.mf-dev-flow', 'delivery-runs', id, 'delivery-input.json')));
    assert.equal(input.deliveryContract.id, 'web-product-delivery');
    assert.equal(input.deliveryProcess.id, 'web-product');
    assert.equal(input.deliveryProcess.version, 1);
    assert.deepEqual(input.stages.map(stage => stage.id), ['solution_design', 'development', 'end_to_end_acceptance']);
    assert.equal(input.stages.some(stage => stage.evidenceGates.includes('miniapp_ui_evidence')), false);
    assert.deepEqual(input.stages.at(-1).evidenceGates, ['e2e_screenshot_evidence', 'risk_ledger']);
  `);
});

test("总控验证接受最终阶段登记的 e2e_screenshot 作为归档截图", () => {
  isolated(`
    put('project.json', { project: { name: 'fixture' }, codeRoots: [{ path: 'app', role: 'primary' }] });
    const feature = { id: 'trip-list-filter', title: '按状态筛选行前事项' };
    const id = shared.createDeliveryRun({ title: 'Web fixture', prototypeRun: 'p1', input: { source: 'feature-map', intensity: 'focused', deliveryProcess: 'web-product@1', taskDescription: '实现筛选闭环', features: [feature] } });
    const dir = path.join('.mf-dev-flow', 'delivery-runs', id);
    const inputFile = path.join(dir, 'delivery-input.json');
    const input = JSON.parse(fs.readFileSync(inputFile));
    const final = input.stages.find(stage => stage.id === 'end_to_end_acceptance');
    final.status = 'confirmed';
    final.artifacts = [{ kind: 'e2e_screenshot', file: 'evidence/stage-artifacts/task/end_to_end_acceptance/result.png' }];
    fs.mkdirSync(path.join(dir, 'evidence/stage-artifacts/task/end_to_end_acceptance'), { recursive: true });
    fs.writeFileSync(path.join(dir, final.artifacts[0].file), 'png-fixture');
    fs.writeFileSync(inputFile, JSON.stringify(input));
    fs.writeFileSync(path.join(dir, 'plan.md'), '# 开发计划\\n\\n## 实施切片\\n真实切片。\\n\\n## 技术方案与实施决策\\n真实方案。\\n');
    fs.writeFileSync(path.join(dir, 'implementation.md'), '# 实现记录\\n\\n## 关键技术方案\\n状态推导。\\n\\n## 实际改动与行为\\n功能完成。\\n\\n## 未完成项和风险\\n无。\\n');
    fs.writeFileSync(path.join(dir, 'verification.md'), '# 测试与回归\\n\\n## 测试执行记录\\n命令通过。\\n\\n## 逻辑复核与原型对照\\n三态一致。\\n\\n## 截图证据与偏差处理\\n' + final.artifacts[0].file + '\\n');
    const run = { id, type: 'delivery', dir: path.resolve(dir) };
    const problems = shared.deliveryReportProblems(run);
    assert.equal(problems.some(problem => /归档的 E2E 截图|未引用归档/.test(problem)), false, problems.join('\\n'));
  `);
});
