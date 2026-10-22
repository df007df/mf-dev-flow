import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AnalysisStore, initialize } from '../core/store.js';
import { transitionWorkflow, workflowState } from '../core/workflow.mjs';
import { renderReport } from '../core/report.js';
import { assertPrototypeReportFormat, RUNTIME_ONLY_COVERAGE_LIMITATION } from '../core/report-format.js';
import { normalizeRuntimeSource, runtimeSourceMap } from '../core/runtime-source.mjs';
import { execute } from '../analysis-cli.mjs';
import { prototypeCommand } from '../cli.mjs';
import { loadPrototypeAdapter } from '../processes.mjs';
import { prototypeImpact, readPrototypeRevision } from '../../planning/impact.mjs';

const PROTOTYPE_FLOW_DOCUMENTS = [
  'entry.md',
  'workflow.md',
  'contract.md',
  'capture.md',
  'report-format.md',
].map(file => fileURLToPath(new URL(`../../../flows/prototype/${file}`, import.meta.url)));

const PROTOTYPE_SCOPE_POLICY_DOCUMENTS = [
  'entry.md',
  'semantics.md',
].map(file => fileURLToPath(new URL(`../../../flows/prototype/${file}`, import.meta.url)));

const PROTOTYPE_SCOPE_POLICY_CLAIMS = [
  ['partial baseline publication', '局部分析批次不得通过 accept 替换全产品基线；必须另行完成 full 范围分析后才能发布。'],
  ['local-to-global repair', '普通 requirement update 不得将已有 groupId 或非空 entryIds 的局部需求改为 impactScope: "global"。'],
];

const MINIAPP_DOCUMENT_CLAIMS = [
  ['adapter choice', '小程序运行态适配器唯一选择：wechat-miniapp-runtime@1。'],
  ['runtime-only limitation', '小程序 runtime-only 限制：结论仅覆盖已实际观察并归档的行为，不覆盖源码、隐藏分支或未观察状态。'],
  ['project path boundary', '小程序 projectPath：只接受经过净化的工作区相对路径，不允许任何绝对路径。'],
  ['page-stack selector trace', '小程序交互取证必须核对操作前后页面栈，使用 selector-action，并归档 trace 证据。'],
  ['no direct CLI operation', '小程序自动化边界：CLI 不直接操控微信开发者工具。'],
  ['stage checkpoint', '小程序阶段门禁：只能在 runtime-observe 阶段完成 capture，并在每次转换时提交 checkpoint。'],
  ['scenario preparation', '小程序场景准备：compile/refresh 与角色或数据准备只是 scenario preparation，不是已观察的业务交互。'],
  ['trace fields', '小程序 trace 字段：route、preconditions、selector/action、expected 和 observed result。'],
  ['unknown branches', '小程序未知分支：不可观察页面或分支保持未完成，不得计入覆盖。'],
  ['report boundary', '小程序报告边界：runtime-only 报告不代表源代码审查。'],
];

const IOS_DOCUMENT_CLAIMS = [
  ['adapter choice', 'iOS 运行态适配器唯一选择：ios-app-runtime@1。'],
  ['runtime-only limitation', 'iOS runtime-only 限制：结论仅覆盖已实际观察并归档的行为，不覆盖源码、隐藏分支或未观察状态。'],
  ['bundle identifier boundary', 'iOS bundleId：只接受反向 DNS bundle identifier，device 只接受模拟器名称或 UDID，不允许绝对路径、家目录展开或凭据。'],
  ['screen-state element trace', 'iOS 交互取证必须核对操作前后屏幕状态，使用 element-action，并归档 trace 证据。'],
  ['no direct CLI operation', 'iOS 自动化边界：CLI 不直接操控 iOS 模拟器。'],
  ['stage checkpoint', 'iOS 阶段门禁：只能在 runtime-observe 阶段完成 capture，并在每次转换时提交 checkpoint。'],
  ['scenario preparation', 'iOS 场景准备：build/install/launch 与角色或数据准备只是 scenario preparation，不是已观察的业务交互。'],
  ['trace fields', 'iOS trace 字段：bundleId、screen、preconditions、element/action、expected 和 observed result。'],
  ['unknown branches', 'iOS 未知分支：不可观察界面或分支保持未完成，不得计入覆盖。'],
  ['report boundary', 'iOS 报告边界：runtime-only 报告不代表源代码审查。'],
];

function countOccurrences(text, value) {
  return text.split(value).length - 1;
}

function writeInput(root, name, value) {
  const file = path.join(root, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

function runtimeInitArgs(root, source, requestId = 'runtime-init') {
  return [
    'init', '--process', 'runtime-analysis@1', '--adapter', 'web-runtime@1',
    '--evidence-profile', 'runtime-only', '--agent', 'scope-snapshot',
    '--input', writeInput(root, `${requestId}.json`, {
      schemaVersion: 1, source,
      scope: { mode: 'full', observableBoundary: 'Synthetic runtime fixture only' },
    }),
    '--request-id', requestId, '--batch', requestId,
  ];
}

function runtimeSource(revision = 'preview-build-42') {
  return {
    type: 'runtime', adapter: 'web-runtime@1',
    locator: { url: 'https://preview.example.test/app' }, revision,
  };
}

function miniappRuntimeSource(revision = 'compile-20260907-01') {
  return {
    type: 'runtime', adapter: 'wechat-miniapp-runtime@1',
    locator: {
      mode: 'wechat-devtools-simulator',
      projectPath: 'miniapp',
      entryRoute: 'pages/home/index',
    },
    revision,
  };
}

function miniappRuntimeInitArgs(root, source, requestId = 'miniapp-runtime-init', evidenceProfile = 'runtime-only') {
  return [
    'init', '--process', 'runtime-analysis@1', '--adapter', 'wechat-miniapp-runtime@1',
    '--evidence-profile', evidenceProfile, '--agent', 'scope-snapshot',
    '--input', writeInput(root, `${requestId}.json`, {
      schemaVersion: 1, source,
      scope: { mode: 'full', observableBoundary: 'Synthetic Mini Program simulator fixture only' },
    }),
    '--request-id', requestId, '--batch', requestId,
  ];
}

function iosRuntimeSource(revision = 'build-20260908-01') {
  return {
    type: 'runtime', adapter: 'ios-app-runtime@1',
    locator: {
      mode: 'ios-simulator',
      bundleId: 'com.example.consumerapp',
      device: 'iPhone 16 Pro',
    },
    revision,
  };
}

function iosRuntimeInitArgs(root, source, requestId = 'ios-runtime-init', evidenceProfile = 'runtime-only') {
  return [
    'init', '--process', 'runtime-analysis@1', '--adapter', 'ios-app-runtime@1',
    '--evidence-profile', evidenceProfile, '--agent', 'scope-snapshot',
    '--input', writeInput(root, `${requestId}.json`, {
      schemaVersion: 1, source,
      scope: { mode: 'full', observableBoundary: 'Synthetic iOS simulator fixture only' },
    }),
    '--request-id', requestId, '--batch', requestId,
  ];
}

function workflowStatus(root) { return prototypeCommand(['status'], root); }
function workflowBrief(root) { return prototypeCommand(['brief'], root); }
function checkpoint(root, stage, agent, to, outcome, reason, requestId) {
  return prototypeCommand([
    'checkpoint', '--stage', stage, '--agent', agent, '--to', to,
    '--outcome', outcome, '--reason', reason, '--request-id', requestId,
    '--expected-revision', String(workflowBrief(root).workflow.indexRevision),
  ], root);
}
function validCaptureArgs(root, snapshotId, agent, requestId) {
  const file = writeInput(root, `${requestId}.json`, runtimeCapturePayload(root, snapshotId));
  return ['capture', '--agent', agent, '--input', file, '--request-id', requestId];
}
function runtimeObservationCaptureArgs(root, store, agent, requestId) {
  const file = writeInput(root, `${requestId}.json`, runtimeObservationPayload(root, store));
  return ['capture', '--agent', agent, '--input', file, '--request-id', requestId];
}
function acceptArgs(root, agent, requestId) {
  return ['accept', '--agent', agent, '--request-id', requestId,
    '--expected-revision', String(workflowStatus(root).semanticRevision)];
}

function runtimeCapturePayload(root, snapshotId) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const screenshot = path.join(root, 'runtime.png');
  const trace = path.join(root, 'runtime.trace.jsonl');
  fs.writeFileSync(screenshot, png);
  fs.writeFileSync(trace, '{"route":"/app","selector":"#go","action":"click","expected":"Done","actual":"Done"}\n');
  return {
    evidence: {
      snapshotId, path: screenshot, trace, capturedAt: new Date().toISOString(),
      action: 'Open the fixture page and click Go',
      assertion: { expected: 'Done', actual: 'Done', passed: true },
      capture: { target: '#app', zoom: 1, deviceScaleFactor: 1, sourceUnchanged: true, fullTargetVisible: true, outputSize: { width: 1, height: 1 } },
    },
    records: [
      { type: 'group', record: { id: 'home', title: 'Home', purpose: 'Synthetic runtime fixture' } },
      { type: 'entry', record: { id: 'home', feature: 'home', status: 'covered', evidenceIds: ['$evidence'] } },
      { type: 'node', record: { id: 'home', label: 'Home', purpose: 'Fixture screen', groupId: 'home', values: {}, resetAction: 'Open fixture', entryIds: ['home'], status: 'covered', evidenceIds: ['$evidence'] } },
      { type: 'control', record: { id: 'go', locator: '#go', event: 'click' } },
      { type: 'edge', record: { id: 'go', from: 'home', to: 'home', controlId: 'go', action: { type: 'click', target: '#go', force: false, script: false }, inputClass: 'none', outcomeKey: 'done', outcome: 'Done', status: 'covered', evidenceIds: ['$evidence'] } },
      { type: 'occurrence', record: { id: 'home-go', nodeId: 'home', controlId: 'go', edgeIds: ['go'], status: 'covered' } },
      { type: 'sweep', record: { id: 'home', nodeId: 'home', complete: true, discoveryIds: ['home-go'], status: 'covered', evidenceIds: ['$evidence'] } },
    ],
  };
}

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-dev-flow-runtime-workflow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function legacyOutput(root) {
  const source = path.join(root, 'legacy-source', 'index.html');
  const output = path.join(root, 'legacy-output');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, '<button id="go">Go</button>');
  initialize({
    source: { type: 'html', workspaceRoot: root, location: 'legacy-source/index.html' },
    scope: { mode: 'full', observableBoundary: 'Synthetic legacy fixture' },
    output,
  });
  return output;
}

function structureModelPayload(snapshotId) {
  return [
    { type: 'group', record: { id: 'home', title: 'Home', purpose: 'Synthetic runtime fixture' } },
    { type: 'entry', record: { id: 'home', feature: 'home', status: 'pending' } },
    { type: 'node', record: { id: 'home', label: 'Home', purpose: 'Fixture screen', groupId: 'home', values: {}, resetAction: 'Open fixture', entryIds: ['home'], status: 'pending' } },
    { type: 'control', record: { id: 'go', locator: '#go', event: 'click' } },
    { type: 'edge', record: { id: 'go', from: 'home', to: 'home', controlId: 'go', action: { type: 'click', target: '#go', force: false, script: false }, inputClass: 'none', outcomeKey: 'done', outcome: 'Done', status: 'pending' } },
  ];
}

function runtimeObservationPayload(root, store) {
  const payload = runtimeCapturePayload(root, store.meta('snapshotId'));
  payload.records = payload.records
    .filter(item => ['entry', 'node', 'edge', 'occurrence', 'sweep'].includes(item.type))
    .map(item => {
      const current = store.get(item.type, item.record.id);
      return current ? { ...item, expectedRevision: current.revision } : item;
    });
  return payload;
}

test('runtime-only init freezes a revisioned web locator without HTML discovery', (t) => {
  const root = temporaryRoot(t);
  const result = prototypeCommand(runtimeInitArgs(root, runtimeSource(), 'runtime-web'), root);
  const store = new AnalysisStore(path.join(root, '.mf-dev-flow/prototype/analyses/runtime-web'));
  t.after(() => store.close());

  assert.equal(result.workflow.activeStageId, 'structure-model');
  assert.equal(result.evidenceProfile, 'runtime-only');
  assert.deepEqual(store.source().map.sourceFiles, []);
  assert.deepEqual(store.source().map.candidates, []);
  assert.equal(store.freshness().sourceFreshness, 'declared-revision');
  assert.equal(store.materialize().graph.status, 'runtime-observed');
  assert.equal(store.materialize().coverage.sourceInventory.completeness, 'runtime-only');
  assert.equal(store.materialize().coverage.sourceInteractionInventory.completeness, 'runtime-only');
});

test('runtime-only init persists a sanitized locator rather than URL query or fragment data', (t) => {
  const root = temporaryRoot(t);
  const source = { ...runtimeSource(), locator: { url: 'https://preview.example.test/app?token=opaque-value#session' } };
  prototypeCommand(runtimeInitArgs(root, source, 'sanitized-runtime'), root);
  const store = new AnalysisStore(path.join(root, '.mf-dev-flow/prototype/analyses/sanitized-runtime'));
  t.after(() => store.close());

  assert.deepEqual(store.meta('runtimeSource').locator, { url: 'https://preview.example.test/app' });
  assert.deepEqual(store.source().map.origin.locator, { url: 'https://preview.example.test/app' });
});

test('runtime-only init sanitizes a file localPreview while catalog status keeps locators private', (t) => {
  const root = temporaryRoot(t);
  const source = { ...runtimeSource(), locator: { localPreview: 'file:///tmp/mf-dev-flow-preview/index.html?token=opaque-value#session' } };
  prototypeCommand(runtimeInitArgs(root, source, 'sanitized-local-preview'), root);
  const store = new AnalysisStore(path.join(root, '.mf-dev-flow/prototype/analyses/sanitized-local-preview'));
  t.after(() => store.close());

  const expected = { localPreview: 'file:///tmp/mf-dev-flow-preview/index.html' };
  assert.deepEqual(store.meta('runtimeSource').locator, expected);
  assert.deepEqual(store.source().map.origin.locator, expected);
  const status = prototypeCommand(['status'], root);
  assert.deepEqual(status.source, { type: 'runtime', adapter: 'web-runtime@1', revision: 'preview-build-42' });
  assert.equal(Object.hasOwn(status.source, 'locator'), false);
});

test('runtime-only source rejects credential-bearing localPreview locators', (t) => {
  const root = temporaryRoot(t);
  const source = { ...runtimeSource(), locator: { localPreview: 'http://user:secret@127.0.0.1:5173/app' } };

  assert.throws(() => prototypeCommand(runtimeInitArgs(root, source, 'credentialed-local-preview'), root), /credential/i);
});

test('runtime-only source rejects absent revision, HTML candidates, source-complete claims, and credentialed URLs', (t) => {
  const root = temporaryRoot(t);
  assert.throws(() => prototypeCommand(runtimeInitArgs(root, runtimeSource(''), 'missing-revision'), root), /revision/);
  assert.throws(() => prototypeCommand(runtimeInitArgs(root, { ...runtimeSource(), locator: { url: 'https://user:secret@preview.example.test/app' } }, 'credentialed-url'), root), /credential/i);
  assert.throws(() => prototypeCommand(runtimeInitArgs(root, { ...runtimeSource(), candidates: [{ id: 'not-allowed' }] }, 'html-candidates'), root), /candidate/i);
  assert.throws(() => prototypeCommand(runtimeInitArgs(root, { ...runtimeSource(), sourceComplete: true }, 'source-complete'), root), /source.*complete/i);
});

test('wechat runtime source requires a resolved adapter snapshot with its declared simulator mode', () => {
  const miniAdapter = loadPrototypeAdapter({ id: 'wechat-miniapp-runtime', version: 1 });
  const webAdapter = loadPrototypeAdapter({ id: 'web-runtime', version: 1 });
  const source = miniappRuntimeSource();

  assert.deepEqual(normalizeRuntimeSource(source, miniAdapter), {
    type: 'runtime',
    adapter: 'wechat-miniapp-runtime@1',
    locator: {
      mode: 'wechat-devtools-simulator',
      projectPath: 'miniapp',
      entryRoute: 'pages/home/index',
    },
    revision: 'compile-20260907-01',
  });
  assert.equal(normalizeRuntimeSource({ ...source, locator: { ...source.locator, projectPath: 'miniapp/./preview' } }, miniAdapter).locator.projectPath, 'miniapp/preview');
  assert.throws(() => normalizeRuntimeSource(source, source.adapter), /resolved runtime adapter/i);
  assert.throws(() => runtimeSourceMap(source), /resolved runtime adapter/i);
  assert.throws(() => runtimeSourceMap(source, webAdapter), /web-runtime@1|source mode/i);
  assert.throws(() => normalizeRuntimeSource(source, { ...miniAdapter, sourceModes: ['url'] }), /sourceModes/i);
  assert.throws(() => normalizeRuntimeSource({ ...source, revision: '' }, miniAdapter), /revision/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, mode: 'url' } }, miniAdapter), /source mode/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, projectPath: '' } }, miniAdapter), /projectPath/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, projectPath: '~/miniapp' } }, miniAdapter), /projectPath/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, projectPath: '../outside' } }, miniAdapter), /projectPath|\.\./i);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, projectPath: '/tmp/miniapp' } }, miniAdapter), /workspace-relative/i);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, projectPath: 'miniapp?token=opaque' } }, miniAdapter), /projectPath/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, projectPath: 'file:///tmp/miniapp' } }, miniAdapter), /projectPath/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, projectPath: 'file:/tmp/miniapp' } }, miniAdapter), /projectPath/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, projectPath: 'file:miniapp' } }, miniAdapter), /projectPath/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, projectPath: 'C:miniapp' } }, miniAdapter), /projectPath/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, session: 'secret' } }, miniAdapter), /only mode, projectPath, and entryRoute/i);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, entryRoute: '../secret' } }, miniAdapter), /entryRoute/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, entryRoute: 'pages/home/index?token=opaque' } }, miniAdapter), /entryRoute/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, entryRoute: 'pages//home/index' } }, miniAdapter), /entryRoute/);
});

test('runtime revisions use a bounded opaque build identifier and never persist prohibited text', (t) => {
  const miniAdapter = loadPrototypeAdapter({ id: 'wechat-miniapp-runtime', version: 1 });
  const prohibited = [
    'token=opaque-value',
    'compile-42?token=opaque-value',
    'compile-42#session',
    'compile-42\nsecret',
    'a'.repeat(129),
  ];
  for (const revision of prohibited) {
    assert.throws(() => normalizeRuntimeSource(miniappRuntimeSource(revision), miniAdapter), /revision/i);
  }

  const root = temporaryRoot(t);
  const invalid = miniappRuntimeSource('token=opaque-value');
  assert.throws(() => prototypeCommand(miniappRuntimeInitArgs(root, invalid, 'miniapp-prohibited-revision'), root), /revision/i);
  assert.equal(fs.existsSync(path.join(root, '.mf-dev-flow/prototype/analyses/miniapp-prohibited-revision')), false);
});

test('wechat runtime init freezes the common workflow snapshot and rejects source-and-runtime coverage', (t) => {
  const root = temporaryRoot(t);
  const initialized = prototypeCommand(miniappRuntimeInitArgs(root, miniappRuntimeSource(), 'miniapp-runtime'), root);
  const store = new AnalysisStore(path.join(root, '.mf-dev-flow/prototype/analyses/miniapp-runtime'));
  t.after(() => store.close());

  assert.equal(initialized.workflow.adapter.id, 'wechat-miniapp-runtime');
  assert.equal(initialized.workflow.activeStageId, 'structure-model');
  assert.equal(initialized.evidenceProfile, 'runtime-only');
  assert.deepEqual(store.meta('runtimeSource').locator, {
    mode: 'wechat-devtools-simulator', projectPath: 'miniapp', entryRoute: 'pages/home/index',
  });
  assert.throws(
    () => prototypeCommand(miniappRuntimeInitArgs(root, miniappRuntimeSource(), 'miniapp-source-coverage', 'source-and-runtime'), root),
    /source-and-runtime/,
  );
});

test('miniapp runtime batch uses the common stage gate and archives synthetic evidence after runtime-observe begins', (t) => {
  const root = temporaryRoot(t);
  const initialized = prototypeCommand(miniappRuntimeInitArgs(root, miniappRuntimeSource(), 'miniapp-capture'), root);
  const directory = path.join(root, '.mf-dev-flow/prototype/analyses/miniapp-capture');
  const tooEarlyStore = new AnalysisStore(directory);
  const tooEarlyCapture = runtimeObservationCaptureArgs(root, tooEarlyStore, 'runtime-observe', 'miniapp-too-early-capture');
  tooEarlyStore.close();
  assert.throws(() => prototypeCommand(tooEarlyCapture, root), /当前应先执行 structure-model/);

  const model = writeInput(root, 'miniapp-model.json', structureModelPayload(initialized.snapshotId));
  prototypeCommand(['put', '--agent', 'structure-model', '--input', model, '--request-id', 'miniapp-model'], root);
  checkpoint(root, 'structure-model', 'structure-model', 'runtime-observe', 'validated', 'simulator structure modeled', 'miniapp-to-observe');

  const beforeCapture = new AnalysisStore(directory);
  const captureArgs = runtimeObservationCaptureArgs(root, beforeCapture, 'runtime-observe', 'miniapp-capture-evidence');
  beforeCapture.close();
  const captured = prototypeCommand(captureArgs, root);
  const store = new AnalysisStore(directory);
  t.after(() => store.close());
  const evidence = store.get('evidence', captured.evidence.id);

  assert.deepEqual(Object.keys(evidence).sort(), [
    'action', 'assertion', 'capture', 'capturedAt', 'id', 'level', 'path', 'pathHash', 'revision', 'snapshotId', 'trace', 'traceHash',
  ]);
  assert.equal(evidence.path.endsWith('.png'), true);
  assert.equal(evidence.trace.endsWith('.trace'), true);
  assert.equal(captured.evidence.verified, true);
  assert.equal(workflowStatus(root).workflow.adapter.id, 'wechat-miniapp-runtime');
});

test('ios runtime source requires a resolved adapter snapshot with its declared simulator mode', () => {
  const iosAdapter = loadPrototypeAdapter({ id: 'ios-app-runtime', version: 1 });
  const webAdapter = loadPrototypeAdapter({ id: 'web-runtime', version: 1 });
  const miniAdapter = loadPrototypeAdapter({ id: 'wechat-miniapp-runtime', version: 1 });
  const source = iosRuntimeSource();

  assert.deepEqual(normalizeRuntimeSource(source, iosAdapter), {
    type: 'runtime',
    adapter: 'ios-app-runtime@1',
    locator: { mode: 'ios-simulator', bundleId: 'com.example.consumerapp', device: 'iPhone 16 Pro' },
    revision: 'build-20260908-01',
  });
  assert.throws(() => normalizeRuntimeSource(source, source.adapter), /resolved runtime adapter/i);
  assert.throws(() => runtimeSourceMap(source), /resolved runtime adapter/i);
  assert.throws(() => runtimeSourceMap(source, webAdapter), /web-runtime@1|source mode/i);
  assert.throws(() => runtimeSourceMap(source, miniAdapter), /wechat-miniapp-runtime@1|source mode/i);
  assert.throws(() => normalizeRuntimeSource(source, { ...iosAdapter, sourceModes: ['url'] }), /sourceModes/i);
  assert.throws(() => normalizeRuntimeSource({ ...source, revision: '' }, iosAdapter), /revision/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, mode: 'url' } }, iosAdapter), /source mode/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, bundleId: '' } }, iosAdapter), /bundleId/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, bundleId: 'consumerapp' } }, iosAdapter), /bundleId/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, bundleId: 'com..example' } }, iosAdapter), /bundleId/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, bundleId: 'com.example/app' } }, iosAdapter), /bundleId/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, bundleId: 'com.example?token=opaque' } }, iosAdapter), /bundleId/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, bundleId: 'session=secret.example' } }, iosAdapter), /bundleId/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, device: '' } }, iosAdapter), /device/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, device: '~/iPhone' } }, iosAdapter), /device/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, device: 'iPhone/tmp' } }, iosAdapter), /device/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, device: 'iPhone..Pro' } }, iosAdapter), /device/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, device: 'a'.repeat(129) } }, iosAdapter), /device/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, device: 'iPhone\nsecret' } }, iosAdapter), /device/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, session: 'secret' } }, iosAdapter), /only mode, bundleId, and device/i);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, url: 'https://preview.example.test' } }, iosAdapter), /only mode, bundleId, and device/i);
});

test('ios runtime revisions use a bounded opaque build identifier and never persist prohibited text', (t) => {
  const iosAdapter = loadPrototypeAdapter({ id: 'ios-app-runtime', version: 1 });
  const prohibited = [
    'token=opaque-value',
    'build-42?token=opaque-value',
    'build-42#session',
    'build-42\nsecret',
    'a'.repeat(129),
  ];
  for (const revision of prohibited) {
    assert.throws(() => normalizeRuntimeSource(iosRuntimeSource(revision), iosAdapter), /revision/i);
  }

  const root = temporaryRoot(t);
  const invalid = iosRuntimeSource('token=opaque-value');
  assert.throws(() => prototypeCommand(iosRuntimeInitArgs(root, invalid, 'ios-prohibited-revision'), root), /revision/i);
  assert.equal(fs.existsSync(path.join(root, '.mf-dev-flow/prototype/analyses/ios-prohibited-revision')), false);
});

test('ios runtime init freezes the common workflow snapshot and rejects source-and-runtime coverage', (t) => {
  const root = temporaryRoot(t);
  const initialized = prototypeCommand(iosRuntimeInitArgs(root, iosRuntimeSource(), 'ios-runtime'), root);
  const store = new AnalysisStore(path.join(root, '.mf-dev-flow/prototype/analyses/ios-runtime'));
  t.after(() => store.close());

  assert.equal(initialized.workflow.adapter.id, 'ios-app-runtime');
  assert.equal(initialized.workflow.activeStageId, 'structure-model');
  assert.equal(initialized.evidenceProfile, 'runtime-only');
  assert.deepEqual(store.meta('runtimeSource').locator, {
    mode: 'ios-simulator', bundleId: 'com.example.consumerapp', device: 'iPhone 16 Pro',
  });
  assert.throws(
    () => prototypeCommand(iosRuntimeInitArgs(root, iosRuntimeSource(), 'ios-source-coverage', 'source-and-runtime'), root),
    /source-and-runtime/,
  );
});

test('ios runtime batch uses the common stage gate and archives synthetic evidence after runtime-observe begins', (t) => {
  const root = temporaryRoot(t);
  const initialized = prototypeCommand(iosRuntimeInitArgs(root, iosRuntimeSource(), 'ios-capture'), root);
  const directory = path.join(root, '.mf-dev-flow/prototype/analyses/ios-capture');
  const tooEarlyStore = new AnalysisStore(directory);
  const tooEarlyCapture = runtimeObservationCaptureArgs(root, tooEarlyStore, 'runtime-observe', 'ios-too-early-capture');
  tooEarlyStore.close();
  assert.throws(() => prototypeCommand(tooEarlyCapture, root), /当前应先执行 structure-model/);

  const model = writeInput(root, 'ios-model.json', structureModelPayload(initialized.snapshotId));
  prototypeCommand(['put', '--agent', 'structure-model', '--input', model, '--request-id', 'ios-model'], root);
  checkpoint(root, 'structure-model', 'structure-model', 'runtime-observe', 'validated', 'simulator structure modeled', 'ios-to-observe');

  const beforeCapture = new AnalysisStore(directory);
  const captureArgs = runtimeObservationCaptureArgs(root, beforeCapture, 'runtime-observe', 'ios-capture-evidence');
  beforeCapture.close();
  const captured = prototypeCommand(captureArgs, root);
  const store = new AnalysisStore(directory);
  t.after(() => store.close());
  const evidence = store.get('evidence', captured.evidence.id);

  assert.equal(evidence.path.endsWith('.png'), true);
  assert.equal(evidence.trace.endsWith('.trace'), true);
  assert.equal(captured.evidence.verified, true);
  assert.equal(workflowStatus(root).workflow.adapter.id, 'ios-app-runtime');
});

test('only the active stage Agent can mutate a workflow batch', (t) => {
  const root = temporaryRoot(t);
  const initialized = prototypeCommand(runtimeInitArgs(root, runtimeSource()), root);
  assert.throws(() => prototypeCommand(validCaptureArgs(root, initialized.snapshotId, 'runtime-observe', 'too-early'), root), /当前应先执行 structure-model/);
  assert.throws(() => execute([
    'capture', '--out', path.join(root, '.mf-dev-flow/prototype/analyses/runtime-init'),
    '--input', writeInput(root, 'direct-too-early.json', runtimeCapturePayload(root, initialized.snapshotId)),
    '--request-id', 'direct-too-early',
  ]), /当前应先执行 structure-model/);
  const model = writeInput(root, 'model.json', [{
    type: 'group', record: { id: 'home', title: 'Home', purpose: 'Fixture', order: 0, entryNodeIds: [] },
  }]);
  assert.throws(() => prototypeCommand(['put', '--agent', 'audit-accept', '--input', model, '--request-id', 'wrong-owner'], root), /structure-model/);
});

test('workflow readers disclose only the active Agent at their contracted detail level', (t) => {
  const root = temporaryRoot(t);
  prototypeCommand(runtimeInitArgs(root, runtimeSource(), 'workflow-readers'), root);

  const status = workflowStatus(root);
  assert.equal(status.workflow.activeStageId, 'structure-model');
  assert.equal(status.workflow.activeAgentId, 'structure-model');
  assert.equal(Object.hasOwn(status.workflow, 'activeAgent'), false);
  assert.equal(JSON.stringify(status).includes('locator'), false);
  assert.equal(JSON.stringify(status).includes('instructions'), false);
  assert.equal(JSON.stringify(status).includes('sha256'), false);

  const brief = prototypeCommand(['brief', '--max-bytes', '16'], root).workflow;
  assert.deepEqual(Object.keys(brief.activeAgent).sort(), ['id', 'instructions', 'sha256']);
  assert.equal(brief.activeAgent.id, 'structure-model');
  assert.ok(Buffer.byteLength(brief.activeAgent.instructions) <= 16);

  for (const result of [
    prototypeCommand(['query', '--batch', 'workflow-readers', '--limit', '1'], root),
    prototypeCommand(['next', '--batch', 'workflow-readers', '--limit', '1'], root),
  ]) {
    assert.equal(result.workflow.activeAgent.id, 'structure-model');
    assert.deepEqual(Object.keys(result.workflow.activeAgent).sort(), ['id', 'instructions', 'sha256']);
    assert.deepEqual(Object.keys(result.workflow).sort(), ['activeAgent', 'activeAgentId', 'activeStageId', 'adapter', 'evidenceProfile', 'indexRevision', 'lastCheckpoint', 'process', 'status']);
    assert.equal(Object.hasOwn(result.workflow, 'stages'), false);
  }
});

test('validated checkpoints allow only declared transitions and audit gaps loop back', (t) => {
  const root = temporaryRoot(t);
  prototypeCommand(runtimeInitArgs(root, runtimeSource()), root);
  checkpoint(root, 'structure-model', 'structure-model', 'runtime-observe', 'validated', 'model ready', 'to-observe');
  assert.throws(() => checkpoint(root, 'runtime-observe', 'runtime-observe', 'audit-accept', 'gap', 'invalid direction', 'bad-gap'), /不允许/);
  checkpoint(root, 'runtime-observe', 'runtime-observe', 'audit-accept', 'validated', 'evidence ready', 'to-audit');
  checkpoint(root, 'audit-accept', 'audit-accept', 'runtime-observe', 'gap', 'missing trace', 'back-to-observe');
  assert.equal(workflowStatus(root).workflow.activeStageId, 'runtime-observe');
});

test('checkpoint requires a non-empty reason for every outcome', (t) => {
  const root = temporaryRoot(t);
  prototypeCommand(runtimeInitArgs(root, runtimeSource(), 'checkpoint-reason'), root);

  assert.throws(
    () => checkpoint(root, 'structure-model', 'structure-model', 'runtime-observe', 'validated', '   ', 'empty-validated-reason'),
    /checkpoint reason required/,
  );
  const advanced = checkpoint(root, 'structure-model', 'structure-model', 'runtime-observe', 'validated', '  model ready  ', 'trimmed-validated-reason');
  assert.equal(advanced.checkpoint.reason, 'model ready');
  assert.equal(workflowStatus(root).workflow.activeStageId, 'runtime-observe');
});

test('checkpoint revalidates a stale state and index revision after its write lock begins', (t) => {
  const root = temporaryRoot(t);
  prototypeCommand(runtimeInitArgs(root, runtimeSource(), 'checkpoint-interleave'), root);
  const directory = path.join(root, '.mf-dev-flow/prototype/analyses/checkpoint-interleave');
  const staleCaller = new AnalysisStore(directory);
  const advancingCaller = new AnalysisStore(directory);
  t.after(() => staleCaller.close());
  t.after(() => advancingCaller.close());

  const expectedIndexRevision = staleCaller.meta('revision');
  const exec = staleCaller.db.exec.bind(staleCaller.db);
  let interleaved = false;
  staleCaller.db.exec = statement => {
    if (statement === 'BEGIN IMMEDIATE' && !interleaved) {
      interleaved = true;
      advancingCaller.put([{
        type: 'group',
        record: { id: 'interleaved-group', title: 'Interleaved', purpose: 'Advance the native index only' },
      }], 'advancing-write', {
        command: 'put', agent: 'structure-model', recordTypes: ['group'],
      });
    }
    return exec(statement);
  };

  assert.throws(() => transitionWorkflow(staleCaller, {
    stageId: 'structure-model', agent: 'structure-model', toStageId: 'runtime-observe',
    outcome: 'validated', reason: 'stale caller checkpoint', requestId: 'stale-checkpoint',
    expectedIndexRevision,
  }), /Index revision conflict/);
  assert.equal(interleaved, true);
  assert.equal(staleCaller.meta('revision'), expectedIndexRevision + 1);
  assert.equal(staleCaller.get('group', 'interleaved-group').title, 'Interleaved');
  assert.deepEqual(workflowState(staleCaller).history.map(entry => entry.reason), [
    'init snapshot verified',
  ]);
});

test('checkpoint replays an identical request before revalidating its stale state', (t) => {
  const root = temporaryRoot(t);
  prototypeCommand(runtimeInitArgs(root, runtimeSource(), 'checkpoint-replay'), root);
  const store = new AnalysisStore(path.join(root, '.mf-dev-flow/prototype/analyses/checkpoint-replay'));
  t.after(() => store.close());
  const input = {
    stageId: 'structure-model', agent: 'structure-model', toStageId: 'runtime-observe',
    outcome: 'validated', reason: 'model ready', requestId: 'replay-checkpoint',
    expectedIndexRevision: store.meta('revision'),
  };

  const first = transitionWorkflow(store, input);
  const replay = transitionWorkflow(store, input);
  assert.deepEqual(replay, first);
  assert.equal(store.meta('revision'), input.expectedIndexRevision + 1);
  assert.equal(workflowState(store).history.length, 2);
});

test('runtime-only evidence can complete audit, accept its declared revision, and remain status-compatible', (t) => {
  const root = temporaryRoot(t);
  prototypeCommand(runtimeInitArgs(root, runtimeSource('preview-build-99'), 'runtime-accept'), root);

  const store = new AnalysisStore(path.join(root, '.mf-dev-flow/prototype/analyses/runtime-accept'));
  t.after(() => store.close());
  prototypeCommand([
    'put', '--batch', 'runtime-accept', '--agent', 'structure-model', '--request-id', 'runtime-model',
    '--input', writeInput(root, 'runtime-model.json', structureModelPayload(store.meta('snapshotId'))),
  ], root);
  checkpoint(root, 'structure-model', 'structure-model', 'runtime-observe', 'validated', 'model ready', 'accept-to-observe');
  const captured = prototypeCommand([
    'capture', '--batch', 'runtime-accept', '--agent', 'runtime-observe', '--request-id', 'runtime-capture',
    '--input', writeInput(root, 'runtime-capture.json', runtimeObservationPayload(root, store)),
  ], root);
  assert.ok(captured.evidence.id);

  checkpoint(root, 'runtime-observe', 'runtime-observe', 'audit-accept', 'validated', 'evidence ready', 'accept-to-audit');
  const audit = prototypeCommand(['audit', '--batch', 'runtime-accept', '--agent', 'audit-accept'], root);
  assert.equal(audit.complete, true);
  const accepted = prototypeCommand(acceptArgs(root, 'audit-accept', 'runtime-acceptance'), root);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.sourceRevision, 'preview-build-99');

  const status = prototypeCommand(['status'], root);
  assert.equal(status.status, 'ready');
  assert.equal(status.source.type, 'runtime');
  assert.equal(status.source.revision, 'preview-build-99');
  assert.equal(Object.hasOwn(status.source, 'locator'), false);

  fs.writeFileSync(path.join(store.directory, captured.evidence.path), 'tampered runtime evidence');
  const stale = prototypeCommand(['status'], root);
  assert.equal(stale.status, 'stale');
  assert.match(stale.sourceProblems.join('\n'), /证据损坏|证据不可核验/);
});

test('accepted runtime revision switch remains a global planning migration even without source files', (t) => {
  const root = temporaryRoot(t);
  const acceptRuntimeBatch = (batch, revision, expectedRevision = null) => {
    const init = runtimeInitArgs(root, runtimeSource(revision), batch);
    if (expectedRevision !== null) init.push('--expected-revision', String(expectedRevision));
    const initialized = prototypeCommand(init, root);
    const store = new AnalysisStore(path.join(root, '.mf-dev-flow/prototype/analyses', batch));
    try {
      prototypeCommand([
        'put', '--batch', batch, '--agent', 'structure-model', '--request-id', `${batch}-model`,
        '--input', writeInput(root, `${batch}-model.json`, structureModelPayload(initialized.snapshotId)),
      ], root);
      checkpoint(root, 'structure-model', 'structure-model', 'runtime-observe', 'validated', 'model ready', `${batch}-observe`);
      prototypeCommand([
        'capture', '--batch', batch, '--agent', 'runtime-observe', '--request-id', `${batch}-capture`,
        '--input', writeInput(root, `${batch}-capture.json`, runtimeObservationPayload(root, store)),
      ], root);
      checkpoint(root, 'runtime-observe', 'runtime-observe', 'audit-accept', 'validated', 'evidence ready', `${batch}-audit`);
      prototypeCommand(acceptArgs(root, 'audit-accept', `${batch}-accept`), root);
    } finally { store.close(); }
  };

  acceptRuntimeBatch('runtime-v1', 'preview-build-101');
  const mfDevFlowStore = path.join(root, '.mf-dev-flow');
  const map = {
    prototypeBaseline: readPrototypeRevision(mfDevFlowStore),
    groups: [{ id: 'planned', sourceFeatureIds: ['home'] }],
    features: [{ id: 'runtime-home', parentId: 'planned', sourceEntries: ['home-default'], status: 'not_started' }],
    migrations: [{ type: 'unchanged', from: ['home'], to: ['runtime-home'], reason: 'fixture' }],
  };
  const previousRevision = prototypeCommand(['status'], root).semanticRevision;
  acceptRuntimeBatch('runtime-v2', 'preview-build-102', previousRevision);

  assert.equal(prototypeImpact(map, readPrototypeRevision(mfDevFlowStore)).global, true);
});

test('legacy non-workflow capture still accepts no --agent', (t) => {
  const root = temporaryRoot(t);
  const output = legacyOutput(root);
  const store = new AnalysisStore(output);
  t.after(() => store.close());

  const captured = execute([
    'capture', '--out', output,
    '--input', writeInput(root, 'legacy-capture.json', runtimeCapturePayload(root, store.meta('snapshotId'))),
    '--request-id', 'legacy-capture',
  ]);
  assert.ok(captured.evidence.id);
});

function completedRuntimeWorkflow(t) {
  const root = temporaryRoot(t);
  const initialized = prototypeCommand(runtimeInitArgs(root, runtimeSource(), 'complete-runtime'), root);
  const store = new AnalysisStore(path.join(root, '.mf-dev-flow/prototype/analyses/complete-runtime'));
  t.after(() => store.close());
  prototypeCommand([
    'put', '--batch', 'complete-runtime', '--agent', 'structure-model', '--request-id', 'runtime-model',
    '--input', writeInput(root, 'complete-runtime-model.json', structureModelPayload(initialized.snapshotId)),
  ], root);
  checkpoint(root, 'structure-model', 'structure-model', 'runtime-observe', 'validated', 'model ready', 'model-checkpoint');
  prototypeCommand([
    'capture', '--batch', 'complete-runtime', '--agent', 'runtime-observe', '--request-id', 'runtime-capture',
    '--input', writeInput(root, 'complete-runtime-capture.json', runtimeObservationPayload(root, store)),
  ], root);
  checkpoint(root, 'runtime-observe', 'runtime-observe', 'audit-accept', 'validated', 'evidence ready', 'evidence-checkpoint');
  return { root };
}

test('runtime-only acceptance refuses source-coverage claims and writes its limit into the report', (t) => {
  const fixture = completedRuntimeWorkflow(t);
  assert.throws(() => prototypeCommand(acceptArgs(fixture.root, 'runtime-observe', 'wrong-accept-agent'), fixture.root), /audit-accept/);
  const accepted = prototypeCommand(acceptArgs(fixture.root, 'audit-accept', 'accept-runtime'), fixture.root);
  assert.equal(accepted.evidenceProfile, 'runtime-only');
  const report = fs.readFileSync(path.join(fixture.root, '.mf-dev-flow/prototype/report.md'), 'utf8');
  assert.match(report, /运行态覆盖/);
  assert.match(report, /不声明源码、隐藏分支或未观察状态的完整性/);
  assert.doesNotMatch(report, /源码候选已全部覆盖/);
});

test('runtime-only audit blocks acceptance when its snapshot claims a source inventory', (t) => {
  const fixture = completedRuntimeWorkflow(t);
  const store = new AnalysisStore(path.join(fixture.root, '.mf-dev-flow/prototype/analyses/complete-runtime'));
  t.after(() => store.close());
  const sourceMapPath = path.join(store.directory, 'source-map.json');
  const sourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
  sourceMap.sourceFiles = [{ path: 'unobserved.html', sha256: 'unverified' }];
  const sourceBytes = `${JSON.stringify(sourceMap)}\n`;
  fs.writeFileSync(sourceMapPath, sourceBytes);
  store.setMeta('sourceMapHash', crypto.createHash('sha256').update(sourceBytes).digest('hex'));

  const audit = prototypeCommand(['audit', '--batch', 'complete-runtime', '--agent', 'audit-accept'], fixture.root);
  assert.equal(audit.complete, false);
  assert.match(audit.items.map(item => item.problem).join('\n'), /runtime-only analysis cannot claim source inventory coverage/);
  assert.throws(() => prototypeCommand(acceptArgs(fixture.root, 'audit-accept', 'source-inventory-accept'), fixture.root), /Analysis incomplete/);
});

test('runtime-only audit blocks acceptance without a recorded group', (t) => {
  const fixture = completedRuntimeWorkflow(t);
  const store = new AnalysisStore(path.join(fixture.root, '.mf-dev-flow/prototype/analyses/complete-runtime'));
  t.after(() => store.close());
  store.db.prepare('DELETE FROM records WHERE type=? AND id=?').run('group', 'home');

  const audit = prototypeCommand(['audit', '--batch', 'complete-runtime', '--agent', 'audit-accept'], fixture.root);
  assert.equal(audit.complete, false);
  assert.match(audit.items.map(item => item.problem).join('\n'), /runtime-only analysis requires at least one group/);
  assert.throws(() => prototypeCommand(acceptArgs(fixture.root, 'audit-accept', 'missing-group-accept'), fixture.root), /Analysis incomplete/);
});

test('runtime-only acceptance rejects archived evidence that changed before acceptance', (t) => {
  const fixture = completedRuntimeWorkflow(t);
  const store = new AnalysisStore(path.join(fixture.root, '.mf-dev-flow/prototype/analyses/complete-runtime'));
  t.after(() => store.close());
  const evidence = [...store.rows('evidence')][0];
  fs.writeFileSync(path.join(store.directory, evidence.path), 'changed after capture');

  const audit = prototypeCommand(['audit', '--batch', 'complete-runtime', '--agent', 'audit-accept'], fixture.root);
  assert.equal(audit.complete, false);
  assert.match(audit.items.map(item => item.problem).join('\n'), /evidence missing, changed, or from another snapshot/);
  assert.throws(() => prototypeCommand(acceptArgs(fixture.root, 'audit-accept', 'changed-evidence-accept'), fixture.root), /Analysis incomplete/);
});

test('report format requires the runtime limitation only for runtime-only reports', (t) => {
  const fixture = completedRuntimeWorkflow(t);
  prototypeCommand(acceptArgs(fixture.root, 'audit-accept', 'report-format-runtime-accept'), fixture.root);
  const runtimeReport = fs.readFileSync(path.join(fixture.root, '.mf-dev-flow/prototype/report.md'), 'utf8');
  assert.throws(
    () => assertPrototypeReportFormat(runtimeReport.replace(RUNTIME_ONLY_COVERAGE_LIMITATION, ''), { evidenceProfile: 'runtime-only' }),
    /runtime-only coverage limitation is missing/,
  );

  const sourceStore = new AnalysisStore(legacyOutput(fixture.root));
  t.after(() => sourceStore.close());
  renderReport(sourceStore);
  const sourceReport = fs.readFileSync(path.join(sourceStore.directory, 'report.md'), 'utf8');
  assert.doesNotMatch(sourceReport, /证据等级：运行态覆盖/);
  assert.doesNotThrow(() => assertPrototypeReportFormat(sourceReport, { evidenceProfile: 'source-and-runtime' }));
});

test('Mini Program flow documents declare each runtime contract exactly once', () => {
  assert.equal(PROTOTYPE_FLOW_DOCUMENTS.length, 5);
  const documents = PROTOTYPE_FLOW_DOCUMENTS.map(file => fs.readFileSync(file, 'utf8')).join('\n');

  for (const [name, claim] of MINIAPP_DOCUMENT_CLAIMS) {
    assert.equal(countOccurrences(documents, claim), 1, `${name} must appear exactly once`);
  }
});

test('iOS flow documents declare each runtime contract exactly once', () => {
  assert.equal(PROTOTYPE_FLOW_DOCUMENTS.length, 5);
  const documents = PROTOTYPE_FLOW_DOCUMENTS.map(file => fs.readFileSync(file, 'utf8')).join('\n');

  for (const [name, claim] of IOS_DOCUMENT_CLAIMS) {
    assert.equal(countOccurrences(documents, claim), 1, `${name} must appear exactly once`);
  }
});

test('prototype scope policy forbids partial baseline replacement and local-to-global repair', () => {
  const documents = PROTOTYPE_SCOPE_POLICY_DOCUMENTS.map(file => fs.readFileSync(file, 'utf8')).join('\n');

  for (const [name, claim] of PROTOTYPE_SCOPE_POLICY_CLAIMS) {
    assert.equal(countOccurrences(documents, claim), 1, `${name} must appear exactly once`);
  }
});
