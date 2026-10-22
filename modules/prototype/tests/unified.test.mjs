import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AnalysisStore } from '../core/store.js';
import { completeFixtureStore, fixture } from './fixtures.mjs';
import { PrototypeCatalog } from '../catalog.js';
import { prototypeCommand } from '../cli.mjs';
import { callPrototype, planningPrototype, publicPrototypeRevision, semanticRows } from '../client.mjs';
import { prototypeImpact, prototypeDevelopmentProblems, readPrototypeRevision } from '../../planning/impact.mjs';
import { readPrototypePage } from '../../../dashboard/server/prototype-reader.js';
import { prototypeSummary } from '../../../dashboard/server/readers/sources.js';
import { hookContext } from '../../workflow/route.mjs';
import { digest } from '../core/html-source.js';
import { PROTOTYPE_REPORT_FORMAT_VERSION } from '../core/report-format.js';
const cli = fileURLToPath(new URL('../../../scripts/mf-dev-flow.mjs', import.meta.url));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const run = (root, args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
const input = (root, value) => { const file = path.join(root, 'input.json'); write(file, value); return file; };
function accepted(t) {
  const f = fixture(t, false, true); f.complete();
  const result = prototypeCommand(['accept', '--request-id', 'accept', '--expected-revision', '1'], f.root);
  assert.equal(result.semanticRevision, 2);
  assert.equal(result.reportGeneration.status, 'ready');
  return f;
}

function seedLegacyPartialAcceptance(f) {
  const local = {
    id: 'recovery-local', actor: 'fixture-user', origin: 'user',
    text: '只影响首页分组的历史需求。', groupId: 'home',
  };
  const added = prototypeCommand([
    'requirement', 'add', '--input', input(f.root, local), '--request-id', 'recovery-local-add', '--expected-revision', '2',
  ], f.root);
  assert.equal(added.semanticRevision, 3);
  const planningCatalog = new PrototypeCatalog(f.root);
  let expectedPlanningFingerprint;
  try { expectedPlanningFingerprint = planningCatalog.planningRevision().fingerprint; }
  finally { planningCatalog.close(); }

  const partialInput = {
    schemaVersion: 1,
    source: { type: 'html', location: 'source/index.html' },
    scope: { mode: 'partial', observableBoundary: 'SYNTHETIC legacy partial acceptance only' },
  };
  prototypeCommand([
    'init', '--input', input(f.root, partialInput), '--batch', 'legacy-partial',
    '--request-id', 'legacy-partial-init', '--expected-revision', '3',
  ], f.root);

  const catalog = new PrototypeCatalog(f.root);
  try {
    const fullAccepted = catalog.meta('accepted');
    const fullSnapshot = JSON.parse(catalog.db.prepare('SELECT body FROM snapshots WHERE id=?').get(fullAccepted.snapshotId).body);
    const selectedIds = {
      group: new Set(['home']), entry: new Set(['a']), node: new Set(['a']), edge: new Set(['go-a']),
      space: new Set(['home']), vector: new Set(['mode-a']), control: new Set(['go']), occurrence: new Set(['button-a']), sweep: new Set(['a']),
    };
    const partialProjection = Object.fromEntries(Object.entries(fullSnapshot.projection).map(([type, records]) => [
      type,
      records.filter(record => selectedIds[type].has(record.id)),
    ]));
    const partialSnapshotId = 'legacy-partial-snapshot';
    catalog.db.prepare('INSERT INTO snapshots VALUES(?,?)').run(partialSnapshotId, JSON.stringify({
      id: partialSnapshotId, batchId: 'legacy-partial', fingerprint: 'legacy-partial-fingerprint', projection: partialProjection, evidence: [],
    }));
    const runtimeFingerprint = 'runtime-equivalent-fixture';
    const partialAccepted = {
      batchId: 'legacy-partial', snapshotId: partialSnapshotId, fingerprint: 'legacy-partial-fingerprint', sourceFingerprint: runtimeFingerprint,
    };
    const partialRevision = catalog.event('analysis_accepted', 'legacy-partial', fullAccepted, partialAccepted);
    for (const type of Object.keys(partialProjection)) {
      catalog.db.prepare('DELETE FROM semantic WHERE type=?').run(type);
      for (const record of partialProjection[type]) catalog.setRecord(type, { ...record, sourceBatch: 'legacy-partial', origin: 'observed' }, partialRevision);
    }
    catalog.setMeta('accepted', partialAccepted);
    catalog.setMeta('source', { type: 'runtime', adapter: 'web-runtime@1', revision: 'git-fixture', fingerprint: runtimeFingerprint, files: [] });

    const before = catalog.get('requirement', local.id);
    const widened = { ...before, impactScope: 'global' };
    delete widened.groupId;
    delete widened.entryIds;
    const scopeRevision = catalog.event('requirement_update', local.id, before, widened);
    catalog.setRecord('requirement', widened, scopeRevision);
    return { fullSnapshotId: fullAccepted.snapshotId, partialSnapshotId, expectedPlanningFingerprint, revision: scopeRevision };
  } finally { catalog.close(); }
}

test('failed first initialization and read-only CLI/dashboard/hooks cannot create a catalog or shadow old files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-dev-flow-no-init-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const history = path.join(root, '.mf-dev-flow/prototype/history.json'); write(history, 'historical bytes');
  const status = callPrototype(root, ['status']); assert.equal(status.items[0].status, 'not_initialized'); assert.equal(status.items[0].legacyArchivePresent, true);
  readPrototypePage(root, new URLSearchParams());
  assert.ok(Buffer.byteLength(hookContext({ root, session: 'fixture-session' })) <= 2048);
  assert.equal(prototypeSummary(path.join(root, '.mf-dev-flow')), null);
  for (const value of [null, { schemaVersion: 99 }, { schemaVersion: 1, source: { type: 'html', location: 'missing.html' }, scope: { mode: 'full', observableBoundary: 'fixture' } }]) {
    const file = value === null ? path.join(root, 'absent.json') : input(root, value);
    const result = run(root, ['prototype', 'init', '--input', file, '--request-id', 'invalid']);
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(root, '.mf-dev-flow/prototype/catalog.sqlite')), false);
    assert.equal(fs.existsSync(path.join(root, '.mf-dev-flow/prototype/analyses')), false);
  }
  write(path.join(root, 'source/index.html'), '<script>const broken = ;</script>');
  const result = run(root, ['prototype', 'init', '--input', input(root, { schemaVersion: 1, source: { type: 'html', location: 'source/index.html' }, scope: { mode: 'full', observableBoundary: 'fixture' } }), '--request-id', 'parse-failed']);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Source parsing failed/);
  assert.deepEqual(fs.readdirSync(path.dirname(history)), ['history.json']); assert.equal(fs.readFileSync(history, 'utf8'), 'historical bytes');
  assert.equal(fs.existsSync(path.join(root, '.mf-dev-flow/current.json')), false);
});

test('batch progress is not product revision; accepted projection, answer history and user requirements use public bounded CLI', t => {
  const f = fixture(t, false, true);
  const before = publicPrototypeRevision(f.root); f.complete();
  assert.equal(publicPrototypeRevision(f.root).fingerprint, before.fingerprint);
  assert.equal(publicPrototypeRevision(f.root).semanticRevision, 1);
  const acceptedResult = prototypeCommand(['accept', '--request-id', 'accept', '--expected-revision', '1'], f.root);
  assert.equal(acceptedResult.semanticRevision, 2);
  assert.equal(acceptedResult.reportGeneration.status, 'ready');
  assert.equal(prototypeCommand(['status'], f.root).reportStatus.status, 'ready');
  const baseline = publicPrototypeRevision(f.root);
  assert.deepEqual(baseline.sourceProblems, []);
  assert.equal(planningPrototype(f.root).coverage.length, 2);
  assert.ok(planningPrototype(f.root).coverage[0].evidence[0].path.startsWith('prototype/analyses/test/screenshots/'));
  const q = { id: 'question-a', question: 'User decision?', actor: 'fixture-user', origin: 'user', groupId: 'home', entryIds: ['a'] };
  let result = run(f.root, ['prototype', 'question', 'add', '--input', input(f.root, q), '--request-id', 'q-add', '--expected-revision', '2']); assert.equal(result.status, 0, result.stderr);
  result = run(f.root, ['prototype', 'question', 'answer', '--input', input(f.root, { id: q.id, actor: q.actor, answer: 'A', conclusion: 'Use A' }), '--request-id', 'q-answer', '--expected-revision', '3']); assert.equal(result.status, 0, result.stderr);
  assert.throws(() => prototypeCommand(['question', 'update', '--input', input(f.root, { id: q.id, actor: q.actor, status: 'resolved' }), '--request-id', 'bypass', '--expected-revision', '4'], f.root), /Use question answer/);
  const requirement = { id: 'req-a', actor: 'fixture-user', origin: 'user', text: 'Not yet in prototype', status: 'confirmed', groupId: 'home' };
  result = run(f.root, ['prototype', 'requirement', 'add', '--input', input(f.root, requirement), '--request-id', 'req-add', '--expected-revision', '4']); assert.equal(result.status, 0, result.stderr);
  const req = semanticRows(f.root, 'requirements')[0]; assert.equal(req.origin, 'user'); assert.equal(req.evidenceIds, undefined);
  const changes = prototypeCommand(['query', '--collection', 'changes', '--detail'], f.root);
  assert.equal(changes.items.find(i => i.record.kind === 'question_answer').record.before.status, 'open');
  assert.equal(changes.items.find(i => i.record.kind === 'question_answer').record.after.answer, 'A');
  assert.equal(prototypeCommand(['query', '--collection', 'snapshots'], f.root).items.length, 1);
  assert.equal(prototypeCommand(['accept', '--request-id', 'repeat-accept', '--expected-revision', '5'], f.root).semanticChanged, false);
  assert.notEqual(publicPrototypeRevision(f.root).fingerprint, baseline.fingerprint);
  const page = readPrototypePage(f.root, new URLSearchParams('command=document&text-limit=100'));
  assert.ok(page.fingerprint); assert.equal(page.formatVersion, PROTOTYPE_REPORT_FORMAT_VERSION); assert.equal(page.items[0].nextTextOffset, 100); assert.ok(page.bytes <= 16384);
  assert.equal(prototypeCommand(['status'], f.root).reportStatus.status, 'ready');
  assert.match(fs.readFileSync(path.join(f.root, '.mf-dev-flow/prototype/report.md'), 'utf8'), /Not yet in prototype/);
  const reportFile = path.join(f.root, '.mf-dev-flow/prototype/report.md');
  const legacy = fs.readFileSync(reportFile, 'utf8').replace('报告格式：v2', '报告格式：v1'); fs.writeFileSync(reportFile, legacy);
  const catalog = new PrototypeCatalog(f.root); catalog.setMeta('report', { ...catalog.meta('report'), formatVersion: 1, hash: digest(legacy) }); catalog.close();
  assert.equal(readPrototypePage(f.root, new URLSearchParams('command=document&text-limit=100')).formatVersion, 1);
  const invalid = new PrototypeCatalog(f.root); invalid.setMeta('report', { ...invalid.meta('report'), formatVersion: null }); invalid.close();
  assert.throws(() => readPrototypePage(f.root, new URLSearchParams('command=document&text-limit=100')), /format missing or unsupported/);
  prototypeCommand(['report'], f.root);
  assert.throws(() => readPrototypePage(f.root, new URLSearchParams('command=document&cursor=100')), /Document changed/);
  assert.throws(() => readPrototypePage(f.root, new URLSearchParams('command=accept')), /只读/);
  assert.equal(prototypeSummary(path.join(f.root, '.mf-dev-flow')).flowContent, undefined);
});

test('accepted report automatically refreshes after semantic changes and exposes materialization state', t => {
  const f = fixture(t, false, true); f.complete();
  const acceptedResult = prototypeCommand(['accept', '--request-id', 'accept-report', '--expected-revision', '1'], f.root);
  assert.equal(acceptedResult.reportGeneration.status, 'ready');
  assert.ok(readPrototypePage(f.root, new URLSearchParams('command=document&text-limit=1')).fingerprint);

  const requirement = { id: 'report-refresh', actor: 'fixture-user', origin: 'user', text: 'Refresh the materialized report.', status: 'confirmed', groupId: 'home' };
  const changed = prototypeCommand(['requirement', 'add', '--input', input(f.root, requirement), '--request-id', 'refresh-report', '--expected-revision', '2'], f.root);
  assert.equal(changed.reportGeneration.status, 'ready');
  assert.equal(prototypeCommand(['status'], f.root).reportStatus.status, 'ready');
  assert.match(fs.readFileSync(path.join(f.root, '.mf-dev-flow/prototype/report.md'), 'utf8'), /Refresh the materialized report/);

  f.put('group', { ...f.store.get('group', 'home'), purpose: 'Changed after acceptance' });
  const stale = prototypeCommand(['status'], f.root).reportStatus;
  assert.equal(stale.status, 'stale');
  assert.equal(stale.reason, 'traversal_changed');
});

test('semantic changes assess every status, descendants and dependents; commands fail closed on stale source/evidence and open questions', t => {
  const f = accepted(t), store = path.join(f.root, '.mf-dev-flow');
  const map = { prototypeBaseline: publicPrototypeRevision(f.root), groups: [{ id: 'planned', sourceFeatureIds: ['home'] }], features: ['not_started', 'in_progress', 'blocked', 'done', 'park', 'skipped'].map((status, i) => ({ id: `f-${i}`, status, parentId: i === 0 ? 'planned' : `f-${i-1}`, sourceEntries: i === 0 ? ['a'] : [], dependsOn: i === 5 ? ['f-0'] : [] })) };
  prototypeCommand(['question', 'add', '--input', input(f.root, { id: 'open', actor: 'fixture', question: 'Confirm?', origin: 'user', groupId: 'home' }), '--request-id', 'open', '--expected-revision', '2'], f.root);
  const impact = prototypeImpact(map, publicPrototypeRevision(f.root));
  assert.equal(impact.assessedFeatureIds.length, 6); assert.equal(impact.affected.length, 6);
  assert.ok(impact.affected.some(f => f.status === 'done')); assert.ok(impact.affected.some(f => f.status === 'park'));
  assert.ok(prototypeDevelopmentProblems(store, map, ['f-0']).some(p => p.includes('复评')));
  map.prototypeBaseline = publicPrototypeRevision(f.root);
  assert.ok(prototypeDevelopmentProblems(store, map, ['f-0']).some(p => p.includes('尚未回答')));
  prototypeCommand(['question', 'answer', '--input', input(f.root, { id: 'open', actor: 'fixture', answer: 'yes', conclusion: 'proceed' }), '--request-id', 'answer', '--expected-revision', '3'], f.root);
  map.prototypeBaseline = publicPrototypeRevision(f.root); assert.deepEqual(prototypeDevelopmentProblems(store, map, ['f-0']), []);
  const evidence = [...f.store.rows('evidence')][0]; fs.appendFileSync(path.join(f.output, evidence.path), 'corrupted');
  assert.ok(prototypeDevelopmentProblems(store, map, ['f-0']).some(p => p.includes('证据')));
  fs.appendFileSync(path.join(f.root, 'source/index.html'), '<button>New</button>');
  assert.ok(prototypeDevelopmentProblems(store, map, ['f-0']).some(p => p.includes('原型源码变化')));
});

test('semantic optimistic transactions, UTF-8 paging, and large detail consumers preserve records', t => {
  const f = accepted(t), file = input(f.root, { id: 'big', actor: 'fixture', origin: 'user', text: '中'.repeat(21000) });
  const args = ['note', 'add', '--input', file, '--request-id', 'big', '--expected-revision', '2'];
  const first = prototypeCommand(args, f.root); assert.deepEqual(prototypeCommand(args, f.root), first);
  assert.throws(() => prototypeCommand(['note', 'add', '--input', input(f.root, { id: 'other', actor: 'fixture', text: 'x' }), '--request-id', 'other', '--expected-revision', '2'], f.root), /revision conflict/);
  const page = readPrototypePage(f.root, new URLSearchParams('command=query&collection=notes'));
  assert.ok(page.bytes <= 16384); assert.equal(page.items[0].oversized, true);
  assert.equal(semanticRows(f.root, 'notes')[0].text.length, 21000);
  const catalog = new PrototypeCatalog(f.root); t.after(() => catalog.close());
  assert.throws(() => catalog.page('notes', { cursor: 1 }), /current revision/);
});

test('failed subsequent source init leaves semantic revision stable; old batch cannot be accepted as another source', t => {
  const f = accepted(t), before = publicPrototypeRevision(f.root);
  write(path.join(f.root, 'broken/index.html'), '<script>function (</script>');
  const initial = { schemaVersion: 1, source: { type: 'html', location: 'broken/index.html' }, scope: { mode: 'full', observableBoundary: 'SYNTHETIC' } };
  assert.throws(() => prototypeCommand(['init', '--input', input(f.root, initial), '--batch', 'broken', '--request-id', 'broken', '--expected-revision', '2'], f.root), /Source parsing failed/);
  assert.equal(publicPrototypeRevision(f.root).fingerprint, before.fingerprint); assert.equal(publicPrototypeRevision(f.root).semanticRevision, 2);
  assert.equal(fs.existsSync(path.join(f.root, '.mf-dev-flow/prototype/.init-broken.json')), false);
  write(path.join(f.root, 'different/index.html'), '<main><button>Different source</button></main>');
  initial.source.location = 'different/index.html';
  prototypeCommand(['init', '--input', input(f.root, initial), '--batch', 'new', '--request-id', 'new', '--expected-revision', '2'], f.root);
  assert.throws(() => prototypeCommand(['accept', '--batch', 'test', '--request-id', 'old-accept', '--expected-revision', '3'], f.root), /does not match current/);
  assert.ok(publicPrototypeRevision(f.root).sourceProblems.length > 0);
});

test('规划只使用已接受来源；新来源待验收时不把已发布地图扩成全量复评', t => {
  const f = accepted(t);
  const store = path.join(f.root, '.mf-dev-flow');
  write(path.join(store, 'project.json'), { schemaVersion: 1, project: { name: 'planning fixture' }, prototype: { location: 'source/index.html', kind: 'html' }, codeRoots: [] });
  const baseline = readPrototypeRevision(store);
  const map = {
    prototypeBaseline: baseline,
    groups: [{ id: 'planned', sourceFeatureIds: ['home'] }],
    features: [{ id: 'home-leaf', parentId: 'planned', sourceEntries: ['a'], status: 'not_started' }],
    migrations: [{ type: 'unchanged', from: ['home'], to: ['home-leaf'], reason: 'fixture' }],
  };
  const source = fs.readFileSync(path.join(f.root, 'source/index.html'), 'utf8');
  write(path.join(f.root, 'different/index.html'), `${source}<aside>Unaccepted source</aside>`);
  const initial = {
    schemaVersion: 1,
    source: { type: 'html', location: 'different/index.html' },
    scope: { mode: 'full', observableBoundary: 'SYNTHETIC pending source' },
  };
  prototypeCommand(['init', '--input', input(f.root, initial), '--batch', 'pending-source', '--request-id', 'pending-source', '--expected-revision', '2'], f.root);

  assert.ok(publicPrototypeRevision(f.root).sourceProblems.length > 0);
  const planning = readPrototypeRevision(store);
  assert.equal(planning.fingerprint, baseline.fingerprint);
  assert.equal(planning.planningReadiness?.status, 'source_pending');
  assert.equal(prototypeImpact(map, planning).status, 'current');
  const refine = run(f.root, ['feature', 'refine', '--title', 'pending source must not publish']);
  assert.notEqual(refine.status, 0);
  assert.match(refine.stderr, /待验收|source_pending|原型来源/);
});

test('入口范围需求只复评关联入口，不把同分组的其余功能升级为全局', t => {
  const f = accepted(t);
  const store = path.join(f.root, '.mf-dev-flow');
  const baseline = readPrototypeRevision(store);
  const map = {
    prototypeBaseline: baseline,
    groups: [{ id: 'planned', sourceFeatureIds: ['home'] }],
    features: [
      { id: 'entry-a', parentId: 'planned', sourceEntries: ['a'], status: 'not_started' },
      { id: 'entry-b', parentId: 'planned', sourceEntries: ['b'], status: 'not_started' },
    ],
    migrations: [{ type: 'split', from: ['home'], to: ['entry-a', 'entry-b'], reason: 'fixture' }],
  };
  const requirement = {
    id: 'entry-only', actor: 'fixture-user', origin: 'user', text: '只调整入口 a 的本地提示。', entryIds: ['a'],
  };
  const added = prototypeCommand(['requirement', 'add', '--input', input(f.root, requirement), '--request-id', 'entry-only', '--expected-revision', '2'], f.root);
  assert.equal(added.semanticRevision, 3);
  const impact = prototypeImpact(map, readPrototypeRevision(store));
  assert.equal(impact.global, false);
  assert.deepEqual(impact.affected.map(item => item.id), ['entry-a']);
});

test('已接受原型上的需求范围必须绑定现有分组或入口', t => {
  const f = accepted(t);
  const requirement = {
    id: 'missing-scope-target', actor: 'fixture-user', origin: 'user', text: '不能把需求挂到不存在的分组。', groupId: 'missing-group',
  };
  assert.throws(() => prototypeCommand([
    'requirement', 'add', '--input', input(f.root, requirement), '--request-id', 'missing-scope-target', '--expected-revision', '2',
  ], f.root), /not an accepted group/);
});

test('局部分析批次不得替换已接受的全产品基线', t => {
  const f = accepted(t);
  const partialInput = {
    schemaVersion: 1,
    source: { type: 'html', location: 'source/index.html' },
    scope: { mode: 'partial', observableBoundary: '仅核验首页样板' },
  };
  const initialized = prototypeCommand([
    'init', '--input', input(f.root, partialInput), '--batch', 'partial-home',
    '--request-id', 'partial-home-init', '--expected-revision', '2',
  ], f.root);
  assert.equal(initialized.batchId, 'partial-home');
  const partial = new AnalysisStore(path.join(f.root, '.mf-dev-flow/prototype/analyses/partial-home'));
  try { completeFixtureStore(partial, f.root); } finally { partial.close(); }

  assert.throws(() => prototypeCommand([
    'accept', '--batch', 'partial-home', '--request-id', 'partial-home-accept', '--expected-revision', '2',
  ], f.root), /Partial analysis cannot replace the accepted product baseline/);

  const catalog = new PrototypeCatalog(f.root);
  try {
    assert.equal(catalog.meta('accepted').batchId, 'test');
    assert.equal(catalog.rows('group')[0].id, 'home');
  } finally { catalog.close(); }
});

test('局部需求不得通过普通更新扩大为全局需求', t => {
  const f = accepted(t);
  const local = {
    id: 'local-only', actor: 'fixture-user', origin: 'user',
    text: '仅首页入口展示阅读提醒。', groupId: 'home',
  };
  const added = prototypeCommand([
    'requirement', 'add', '--input', input(f.root, local), '--request-id', 'local-only-add', '--expected-revision', '2',
  ], f.root);
  assert.equal(added.semanticRevision, 3);

  assert.throws(() => prototypeCommand([
    'requirement', 'update', '--input', input(f.root, {
      id: local.id, actor: local.actor, text: local.text,
      groupId: null, entryIds: [], impactScope: 'global',
    }), '--request-id', 'local-only-widen', '--expected-revision', '3',
  ], f.root), /Cannot widen a locally scoped requirement to global through update/);

  const stored = semanticRows(f.root, 'requirements').find(record => record.id === local.id);
  assert.equal(stored.groupId, 'home');
  assert.equal(stored.impactScope, undefined);
});

test('入口范围局部需求不得通过普通更新扩大为全局需求', t => {
  const f = accepted(t);
  const local = {
    id: 'entry-local-only', actor: 'fixture-user', origin: 'user',
    text: '仅首页 A 入口展示阅读提醒。', entryIds: ['a'],
  };
  const added = prototypeCommand([
    'requirement', 'add', '--input', input(f.root, local), '--request-id', 'entry-local-only-add', '--expected-revision', '2',
  ], f.root);
  assert.equal(added.semanticRevision, 3);

  assert.throws(() => prototypeCommand([
    'requirement', 'update', '--input', input(f.root, {
      id: local.id, actor: local.actor, text: local.text,
      groupId: null, entryIds: [], impactScope: 'global',
    }), '--request-id', 'entry-local-only-widen', '--expected-revision', '3',
  ], f.root), /Cannot widen a locally scoped requirement to global through update/);

  const stored = semanticRows(f.root, 'requirements').find(record => record.id === local.id);
  assert.deepEqual(stored.entryIds, ['a']);
  assert.equal(stored.impactScope, undefined);
});

test('完整历史快照恢复被 partial 覆盖的目录和局部需求范围', t => {
  const f = accepted(t);
  const legacy = seedLegacyPartialAcceptance(f);

  const result = prototypeCommand([
    'recover', '--from-snapshot', legacy.fullSnapshotId,
    '--source-equivalence', '用户确认同一 git-fixture 原型内容未变。', '--restore-scopes',
    '--request-id', 'recover-full-snapshot', '--expected-revision', String(legacy.revision),
  ], f.root);

  assert.equal(result.recovered, true);
  assert.equal(result.fromSnapshot, legacy.fullSnapshotId);
  assert.deepEqual(result.restored.requirementIds, ['recovery-local']);

  const catalog = new PrototypeCatalog(f.root);
  try {
    assert.equal(catalog.meta('accepted').recoveredFrom, legacy.fullSnapshotId);
    assert.equal(catalog.meta('accepted').batchId, 'test');
    assert.equal(catalog.meta('activeBatch'), 'legacy-partial');
    assert.ok(catalog.db.prepare('SELECT 1 FROM snapshots WHERE id=?').get(legacy.partialSnapshotId));
    assert.equal(catalog.rows('entry').length, 2);
    assert.equal(catalog.get('requirement', 'recovery-local').groupId, 'home');
    assert.equal(catalog.get('requirement', 'recovery-local').impactScope, undefined);
    assert.equal(catalog.planningRevision().planningReadiness.status, 'ready');
    assert.equal(catalog.planningRevision().fingerprint, legacy.expectedPlanningFingerprint);
  } finally { catalog.close(); }
});

test('完整历史快照恢复要求明确的来源等价声明', t => {
  const f = accepted(t);
  const legacy = seedLegacyPartialAcceptance(f);

  assert.throws(() => prototypeCommand([
    'recover', '--from-snapshot', legacy.fullSnapshotId, '--restore-scopes',
    '--request-id', 'recover-without-equivalence', '--expected-revision', String(legacy.revision),
  ], f.root), /source-equivalence required/);

  assert.throws(() => prototypeCommand([
    'recover', '--from-snapshot', legacy.fullSnapshotId,
    '--source-equivalence', '用户确认原型内容未变。',
    '--request-id', 'recover-without-scope-restore', '--expected-revision', String(legacy.revision),
  ], f.root), /restore-scopes required/);

  const catalog = new PrototypeCatalog(f.root);
  try {
    assert.equal(catalog.meta('accepted').snapshotId, legacy.partialSnapshotId);
    assert.equal(catalog.rows('entry').length, 1);
  } finally { catalog.close(); }
});

test('完整历史快照恢复把旧的 group 加入口组合收敛为更窄的入口范围', t => {
  const f = accepted(t);
  const legacy = seedLegacyPartialAcceptance(f);
  let revision;
  const catalog = new PrototypeCatalog(f.root);
  try {
    const before = {
      id: 'recovery-mixed-scope', actor: 'fixture-user', origin: 'user', status: 'confirmed',
      text: '旧记录同时标注父分组和实际入口。', groupId: 'home', entryIds: ['a'],
    };
    const addedRevision = catalog.event('requirement_add', before.id, null, before);
    catalog.setRecord('requirement', before, addedRevision);
    const widened = { ...before, impactScope: 'global' };
    delete widened.groupId; delete widened.entryIds;
    revision = catalog.event('requirement_update', before.id, before, widened);
    catalog.setRecord('requirement', widened, revision);
  } finally { catalog.close(); }

  const result = prototypeCommand([
    'recover', '--from-snapshot', legacy.fullSnapshotId,
    '--source-equivalence', '用户确认同一 git-fixture 原型内容未变。', '--restore-scopes',
    '--request-id', 'recover-mixed-scope', '--expected-revision', String(revision),
  ], f.root);
  assert.ok(result.restored.requirementIds.includes('recovery-mixed-scope'));

  const restored = new PrototypeCatalog(f.root);
  try {
    assert.equal(restored.get('requirement', 'recovery-mixed-scope').groupId, undefined);
    assert.deepEqual(restored.get('requirement', 'recovery-mixed-scope').entryIds, ['a']);
    assert.equal(restored.planningRevision().planningReadiness.status, 'ready');
  } finally { restored.close(); }
});

test('已接受来源切换仍按全局迁移门禁处理', t => {
  const f = accepted(t);
  const store = path.join(f.root, '.mf-dev-flow');
  const baseline = readPrototypeRevision(store);
  const map = {
    prototypeBaseline: baseline,
    groups: [{ id: 'planned', sourceFeatureIds: ['home'] }],
    features: [{ id: 'home-leaf', parentId: 'planned', sourceEntries: ['a'], status: 'not_started' }],
    migrations: [{ type: 'unchanged', from: ['home'], to: ['home-leaf'], reason: 'fixture' }],
  };
  const source = fs.readFileSync(path.join(f.root, 'source/index.html'), 'utf8');
  write(path.join(f.root, 'different/index.html'), `${source}<aside>Accepted source switch</aside>`);
  const initial = {
    schemaVersion: 1,
    source: { type: 'html', location: 'different/index.html' },
    scope: { mode: 'full', observableBoundary: 'SYNTHETIC accepted source switch' },
  };
  prototypeCommand(['init', '--input', input(f.root, initial), '--batch', 'accepted-source', '--request-id', 'accepted-source', '--expected-revision', '2'], f.root);
  const next = new AnalysisStore(path.join(f.root, '.mf-dev-flow/prototype/analyses/accepted-source'));
  try { completeFixtureStore(next, f.root); } finally { next.close(); }
  prototypeCommand(['accept', '--batch', 'accepted-source', '--request-id', 'accepted-source-accept', '--expected-revision', '3'], f.root);

  assert.equal(prototypeImpact(map, readPrototypeRevision(store)).global, true);
});

test('analysis history exposes dated batches and recorded milestones through read-only bounded CLI pages', t => {
  const f = accepted(t);
  prototypeCommand(['report'], f.root);
  const before = fs.readFileSync(path.join(f.output, 'index.sqlite'));
  const history = readPrototypePage(f.root, new URLSearchParams('command=query&collection=batches'));
  assert.ok(history.bytes <= 16384);
  const record = history.items[0].record;
  assert.equal(record.id, 'test');
  assert.equal(record.accepted, true);
  assert.equal(record.status, 'done');
  assert.equal(record.counts.group, 1);
  assert.equal(record.createdAt, f.store.meta('createdAt'));
  assert.ok(record.executionLog.some(event => event.title === '验收分析结论'));
  assert.equal(record.reportPath, 'prototype/analyses/test/report.md');
  assert.deepEqual(fs.readFileSync(path.join(f.output, 'index.sqlite')), before);
  const initial = { schemaVersion: 1, source: { type: 'html', location: 'source/index.html' }, scope: { mode: 'partial', observableBoundary: 'SYNTHETIC second execution' } };
  prototypeCommand(['init', '--input', input(f.root, initial), '--batch', 'later', '--request-id', 'later', '--expected-revision', '2'], f.root);
  const later = readPrototypePage(f.root, new URLSearchParams('command=query&collection=batches')).items;
  assert.equal(later[0].id, 'later');
  assert.equal(later[0].record.accepted, false);
  assert.equal(later[0].record.status, 'pending');
  assert.deepEqual(later[0].record.executionLog.map(event => event.title), ['创建分析批次']);
});


test('public capture rejects development fields and archives a bounded atomic observation', t => {
  const f = fixture(t, false, true);
  const payload = { evidence: { snapshotId: f.store.meta('snapshotId'), capturedAt: new Date(Date.parse(f.store.meta('createdAt')) + 1).toISOString(), action: 'synthetic fixture', assertion: { expected: 'A', actual: 'A', passed: true }, path: path.join(f.root, 'fixture.png'), trace: path.join(f.root, 'trace.jsonl'), capture: { target: '#synthetic', zoom: 1, deviceScaleFactor: 1, fullTargetVisible: true, sourceUnchanged: true, outputSize: { width: 1, height: 1 } } }, records: [{ type: 'entry', record: { id: 'captured', feature: 'home', status: 'covered', evidenceIds: ['$evidence'], implementationStatus: 'done' } }] };
  assert.throws(() => prototypeCommand(['capture', '--input', input(f.root, payload), '--request-id', 'public-capture'], f.root), /Development state/);
  delete payload.records[0].record.implementationStatus;
  const result = run(f.root, ['prototype', 'capture', '--input', input(f.root, payload), '--request-id', 'public-capture']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).items[0].evidence.verified, true);
  assert.equal([...f.store.rows('evidence')].length, 1);
  const capabilities = JSON.parse(run(f.root, ['prototype', 'capabilities']).stdout);
  assert.deepEqual(capabilities.analysisAdapters.map(adapter => adapter.id), ['html']);
  assert.equal(capabilities.analysisAdapters[0].browserExecution, false);
});

test('public runtime discovery exposes bounded manifests without Agent instructions', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-dev-flow-prototype-discovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const processes = prototypeCommand(['process', 'list'], root);
  assert.deepEqual(processes.items.map(item => item.id), ['runtime-analysis']);
  assert.deepEqual(processes.items[0].stageIds, ['scope-snapshot', 'structure-model', 'runtime-observe', 'audit-accept']);
  assert.deepEqual(Object.keys(processes.items[0]).sort(), ['id', 'sha256', 'stageIds', 'title', 'version']);
  assert.match(processes.items[0].sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(processes), /instructions|运行态观察 Agent/);
  const processResult = run(root, ['prototype', 'process', 'list']);
  assert.equal(processResult.status, 0, processResult.stderr);
  assert.deepEqual(JSON.parse(processResult.stdout).items.map(item => item.id), ['runtime-analysis']);

  const adapters = prototypeCommand(['adapter', 'list'], root);
  assert.deepEqual(adapters.items.map(item => item.id), ['web-runtime', 'wechat-miniapp-runtime', 'ios-app-runtime']);
  assert.deepEqual(Object.keys(adapters.items[0]).sort(), ['capabilities', 'id', 'title', 'version']);
  assert.equal(adapters.items[0].capabilities.sourceDiscovery, false);
  assert.doesNotMatch(JSON.stringify(adapters), /instructions|运行态观察 Agent/);

  const web = prototypeCommand(['adapter', 'capabilities', '--adapter', 'web-runtime@1'], root);
  assert.equal(web.capabilities.sourceDiscovery, false);
  assert.deepEqual(web.capabilities.sourceModes, ['url', 'local-preview']);

  const miniapp = prototypeCommand(['adapter', 'capabilities', '--adapter', 'wechat-miniapp-runtime@1'], root);
  assert.deepEqual(miniapp.capabilities.operations, ['pageStack', 'selectorAction', 'simulatorScreenshot', 'traceArchive', 'compileRefresh']);
  assert.deepEqual(miniapp.capabilities.evidence, { screenshot: 'png', trace: true });
  assert.match(miniapp.note, /Agent.*环境契约/);
  assert.match(miniapp.note, /CLI.*不直接操控.*微信开发者工具/);
  assert.doesNotMatch(JSON.stringify(miniapp), /credential|session|token|secret/i);

  const ios = prototypeCommand(['adapter', 'capabilities', '--adapter', 'ios-app-runtime@1'], root);
  assert.deepEqual(ios.capabilities.operations, ['screenState', 'elementAction', 'simulatorScreenshot', 'traceArchive', 'appLaunch']);
  assert.deepEqual(ios.capabilities.evidence, { screenshot: 'png', trace: true });
  assert.match(ios.note, /Agent.*环境契约/);
  assert.match(ios.note, /CLI.*不直接操控.*iOS 模拟器/);
  assert.doesNotMatch(JSON.stringify(ios), /credential|session|token|secret/i);
  assert.equal(fs.existsSync(path.join(root, '.mf-dev-flow/prototype/catalog.sqlite')), false);
});

test('public capabilities distinguish static HTML from runtime web, miniapp, and iOS support', () => {
  const capabilities = prototypeCommand(['capabilities']);
  assert.deepEqual(capabilities.analysisAdapters.map(item => item.id), ['html']);
  assert.deepEqual(capabilities.runtimeAdapters.map(item => item.id), ['web-runtime', 'wechat-miniapp-runtime', 'ios-app-runtime']);
  assert.equal(prototypeCommand(['adapter', 'capabilities', '--adapter', 'web-runtime@1']).capabilities.sourceDiscovery, false);
  assert.match(capabilities.note, /Agent.*环境契约/);
  assert.match(capabilities.note, /CLI.*不直接操控.*网页.*微信开发者工具.*iOS 模拟器/);
  assert.doesNotMatch(JSON.stringify(capabilities), /credential|session|token|secret/i);
});

test('legacy HTML init remains ungated without process flags', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-dev-flow-prototype-legacy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, 'source/index.html'), '<main><button>Legacy</button></main>');
  const before = prototypeCommand(['status'], root);
  const initial = { schemaVersion: 1, source: { type: 'html', location: 'source/index.html' }, scope: { mode: 'full', observableBoundary: 'legacy fixture' } };
  prototypeCommand(['init', '--input', input(root, initial), '--request-id', 'legacy-init'], root);
  const after = prototypeCommand(['status'], root);
  assert.equal(before.status, 'not_initialized');
  assert.equal(after.workflow, undefined);
});
