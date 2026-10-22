import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prototypeCommand } from '../cli.mjs';
import { readAnalysisRequirements, legacyRequirementsPath, requirementsPath } from '../core/analysis-requirements.mjs';
import { AnalysisStore } from '../core/store.js';
import { readPrototypePage } from '../../../dashboard/server/prototype-reader.js';
import { completeFixtureStore, fixture } from './fixtures.mjs';

const cli = fileURLToPath(new URL('../../../scripts/mf-dev-flow.mjs', import.meta.url));

function write(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return file;
}

function input(root, name, value) {
  return write(root, name + '.json', value);
}

function add(root, name, record, expectedRevision) {
  return prototypeCommand([
    'analysis-requirements',
    'add',
    '--input', input(root, name, record),
    '--request-id', name,
    '--expected-revision', String(expectedRevision),
  ], root);
}

function initialize(root, batch, requestId, scope = {}) {
  const payload = {
    schemaVersion: 1,
    source: { type: 'html', location: 'source/index.html' },
    scope: {
      mode: 'partial',
      observableBoundary: 'SYNTHETIC fixture only',
      ...scope,
    },
  };
  return prototypeCommand([
    'init',
    '--input', input(root, 'init-' + batch, payload),
    '--batch', batch,
    '--request-id', requestId,
    '--expected-revision', String(prototypeCommand(['status'], root).semanticRevision ?? 0),
  ], root);
}

function rootFor(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'source/index.html', '<main><button id="demo">Demo</button></main>');
  return root;
}

test('AR is an independent, paged registry with idempotent writes; dashboard reader remains read-only', t => {
  const root = rootFor(t, 'mf-dev-flow-ar-registry-');
  const empty = readPrototypePage(root, new URLSearchParams('command=analysis-requirements'));
  assert.equal(empty.recorded, false);
  assert.equal(fs.existsSync(path.join(root, '.mf-dev-flow')), false);

  const record = {
    id: 'AR-HOME-001',
    title: '首页入口分析',
    instruction: '逐一核对首页入口、点击后状态和返回路径。',
    scope: { sourceTypes: ['html'], modes: ['partial'] },
    evidenceHints: ['记录入口和返回动作'],
  };
  const added = add(root, 'add-home', record, 0);
  assert.equal(added.action, 'added');
  assert.equal(added.registryRevision, 1);
  assert.deepEqual(add(root, 'add-home', record, 0), added);

  const page = readPrototypePage(root, new URLSearchParams('command=analysis-requirements&limit=10'));
  assert.equal(page.origin, 'registry');
  assert.equal(page.registryRevision, 1);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].record.id, 'AR-HOME-001');
  assert.equal(page.items[0].record.instruction, record.instruction);
  assert.throws(
    () => readPrototypePage(root, new URLSearchParams('command=analysis-requirements&input=write.json')),
    /无效查询参数/,
  );

  const status = spawnSync(process.execPath, [cli, 'prototype', 'status', '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(status.status, 0, status.stderr);
  const summary = JSON.parse(status.stdout).items[0];
  assert.equal(summary.status, 'not_initialized');
  assert.equal(summary.analysisRequirements.activeCount, 1);
  assert.equal(summary.analysisRequirements.recordIds[0], 'AR-HOME-001');
  assert.equal(fs.existsSync(path.join(root, requirementsPath)), true);
});

test('AR changes affect only newly created or explicitly selected analysis batches, never old freshness or the global revision', t => {
  const root = rootFor(t, 'mf-dev-flow-ar-snapshot-');
  add(root, 'add-html', {
    id: 'AR-HTML-001',
    title: 'HTML 页面核对',
    instruction: '检查首页所有可见入口。',
    scope: { sourceTypes: ['html'], modes: ['partial'] },
  }, 0);
  add(root, 'add-runtime', {
    id: 'AR-RUNTIME-001',
    title: '运行态核对',
    instruction: '仅适用于运行态批次。',
    scope: { sourceTypes: ['runtime'] },
  }, 1);

  initialize(root, 'first', 'init-first');
  const first = new AnalysisStore(path.join(root, '.mf-dev-flow/prototype/analyses/first'));
  t.after(() => first.close());
  assert.deepEqual(
    first.meta('scope').analysisRequirements.records.map(record => record.id),
    ['AR-HTML-001'],
  );
  assert.equal(first.meta('scope').analysisRequirements.selection.mode, 'default-active');
  const revisionBefore = prototypeCommand(['revision'], root).fingerprint;

  const revised = prototypeCommand([
    'analysis-requirements',
    'revise',
    '--id', 'AR-HTML-001',
    '--input', input(root, 'revise-html', {
      instruction: '逐一检查首页所有可见入口、点击状态和返回路径。',
    }),
    '--request-id', 'revise-html',
    '--expected-revision', '2',
  ], root);
  assert.equal(revised.record.revision, 2);
  add(root, 'add-future', {
    id: 'AR-FUTURE-001',
    title: '新增范围',
    instruction: '未来批次需要补充这个检查。',
  }, 3);
  const withdrawn = prototypeCommand([
    'analysis-requirements',
    'withdraw',
    '--id', 'AR-HTML-001',
    '--reason', '改由最终验收用例表达',
    '--request-id', 'withdraw-html',
    '--expected-revision', '4',
  ], root);
  assert.equal(withdrawn.record.status, 'withdrawn');

  assert.equal(first.freshness().fresh, true);
  assert.equal(first.freshness().analysisRequirementsChanged, false);
  assert.doesNotThrow(() => prototypeCommand(['next', '--limit', '1'], root));
  assert.equal(prototypeCommand(['revision'], root).fingerprint, revisionBefore);

  initialize(root, 'second', 'init-second');
  const second = new AnalysisStore(path.join(root, '.mf-dev-flow/prototype/analyses/second'));
  t.after(() => second.close());
  assert.deepEqual(
    second.meta('scope').analysisRequirements.records.map(record => record.id),
    ['AR-FUTURE-001'],
  );

  initialize(root, 'explicit', 'init-explicit', {
    analysisRequirementIds: ['AR-FUTURE-001'],
  });
  const explicit = new AnalysisStore(path.join(root, '.mf-dev-flow/prototype/analyses/explicit'));
  t.after(() => explicit.close());
  assert.equal(explicit.meta('scope').analysisRequirements.selection.mode, 'explicit');
  assert.deepEqual(
    explicit.meta('scope').analysisRequirements.records.map(record => record.id),
    ['AR-FUTURE-001'],
  );
});

test('a later AR version is audit evidence, not a change to otherwise identical prototype facts', t => {
  const record = {
    id: 'AR-FACTS-001',
    title: '首页分析约束',
    instruction: '检查首页状态、入口和返回路径。',
    scope: { sourceTypes: ['html'], modes: ['full'] },
  };
  const f = fixture(t, false, true, {
    beforeInitialize(root) {
      add(root, 'add-facts', record, 0);
    },
  });
  f.complete();
  const firstAccepted = prototypeCommand(['accept', '--request-id', 'accept-first', '--expected-revision', '1'], f.root);
  assert.equal(firstAccepted.semanticChanged, true);
  assert.equal(firstAccepted.semanticRevision, 2);

  prototypeCommand([
    'analysis-requirements',
    'revise',
    '--id', record.id,
    '--input', input(f.root, 'revise-facts', {
      instruction: '逐一检查首页状态、入口、点击后状态和返回路径。',
    }),
    '--request-id', 'revise-facts',
    '--expected-revision', '1',
  ], f.root);
  initialize(f.root, 'second', 'init-second', { mode: 'full' });
  const second = new AnalysisStore(path.join(f.root, '.mf-dev-flow/prototype/analyses/second'));
  try {
    completeFixtureStore(second, f.root);
  } finally {
    second.close();
  }

  const secondAccepted = prototypeCommand([
    'accept',
    '--batch', 'second',
    '--request-id', 'accept-second',
    '--expected-revision', '2',
  ], f.root);
  assert.equal(secondAccepted.semanticChanged, false);
  assert.equal(secondAccepted.semanticRevision, 2);
  const status = prototypeCommand(['status'], f.root);
  assert.equal(status.acceptedAnalysisRequirements.recordIds[0], record.id);
  assert.equal(status.acceptedAnalysisRequirements.registryRevision, 2);
});

test('legacy Markdown is unclassified material and can only be explicitly classified or excluded', t => {
  const root = rootFor(t, 'mf-dev-flow-ar-legacy-');
  write(root, legacyRequirementsPath, '# 2026-09-10 首页验收样板\n这是最终验收草稿，不是分析要求。\n');
  const legacy = readAnalysisRequirements(root);
  assert.equal(legacy.origin, 'legacy-markdown');
  assert.equal(legacy.records.length, 0);
  assert.equal(legacy.legacy.disposition, 'unclassified');
  const legacyPage = readPrototypePage(root, new URLSearchParams('command=analysis-requirements'));
  assert.equal(legacyPage.recorded, false);
  assert.equal(legacyPage.activeCount, 0);

  initialize(root, 'legacy-batch', 'init-legacy');
  const batch = new AnalysisStore(path.join(root, '.mf-dev-flow/prototype/analyses/legacy-batch'));
  t.after(() => batch.close());
  assert.deepEqual(batch.meta('scope').analysisRequirements.records, []);
  assert.equal(batch.meta('scope').analysisRequirements.legacyUnclassified.path, legacyRequirementsPath);

  const exclusion = {
    schemaVersion: 1,
    legacyFingerprint: legacy.fingerprint,
    disposition: 'excluded',
    records: [],
    note: '首页验收样板属于最终验收阶段',
  };
  const result = prototypeCommand([
    'analysis-requirements',
    'migrate-legacy',
    '--input', input(root, 'exclude-legacy', exclusion),
    '--request-id', 'exclude-legacy',
    '--expected-revision', '0',
  ], root);
  assert.equal(result.action, 'legacy_excluded');
  assert.equal(fs.readFileSync(path.join(root, legacyRequirementsPath), 'utf8').includes('首页验收样板'), true);
  const registry = readAnalysisRequirements(root);
  assert.equal(registry.origin, 'registry');
  assert.equal(registry.records.length, 0);
  assert.equal(registry.legacy.disposition, 'excluded');
});

test('AR validation rejects injected snapshots, invalid IDs, and stale registry writes', t => {
  const root = rootFor(t, 'mf-dev-flow-ar-validation-');
  assert.throws(
    () => add(root, 'bad-id', {
      id: 'homepage',
      title: 'Bad',
      instruction: 'Bad',
    }, 0),
    /AR-/,
  );
  add(root, 'good', {
    id: 'AR-GOOD-001',
    title: 'Good',
    instruction: '有效的独立分析要求。',
  }, 0);
  assert.throws(
    () => add(root, 'stale', {
      id: 'AR-STALE-001',
      title: 'Stale',
      instruction: '不会写入。',
    }, 0),
    /revision conflict/,
  );
  const injected = {
    schemaVersion: 1,
    source: { type: 'html', location: 'source/index.html' },
    scope: {
      mode: 'partial',
      observableBoundary: 'SYNTHETIC fixture only',
      analysisRequirements: { records: [] },
    },
  };
  assert.throws(
    () => prototypeCommand([
      'init',
      '--input', input(root, 'injected', injected),
      '--batch', 'injected',
      '--request-id', 'init-injected',
    ], root),
    /reserved/,
  );
});
