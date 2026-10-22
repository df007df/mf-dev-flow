import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AnalysisStore, initialize, boundedPage } from '../core/store.js';
import { discoverPrototypeSource, digest } from '../core/html-source.js';
import { renderReport } from '../core/report.js';
import { assertPrototypeReportFormat, PROTOTYPE_REPORT_FORMAT_VERSION, reportText } from '../core/report-format.js';
import { createPrototypeMap } from '../../../dashboard/server/prototype-map-audit.js';
import { mfDevFlowIndex } from '../../../scripts/prototype-index.mjs';
const cli = fileURLToPath(new URL('../analysis-cli.mjs', import.meta.url));
const mfDevFlowCli = fileURLToPath(new URL('../../../scripts/mf-dev-flow.mjs', import.meta.url));
import { fixture } from './fixtures.mjs';
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); };

test('standalone CLI creates/resumes without .mf-dev-flow or Next and rejects unsupported adapters', t => {
  const f = fixture(t);
  assert.equal(fs.existsSync(path.join(f.root, '.mf-dev-flow')), false);
  const result = spawnSync(process.execPath, [cli, 'next', '--out', f.output, '--type', 'candidate', '--limit', '2', '--max-bytes', '1024'], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.ok(Buffer.byteLength(result.stdout) <= 1024);
  assert.ok(JSON.parse(result.stdout).items.length > 0);
  assert.throws(() => initialize({ source: { type: 'image' }, output: path.join(f.root, 'image') }), /Only local HTML/);
  assert.throws(() => initialize({ source: { type: 'html', location: path.join(f.root, 'source/index.html') }, scope: { mode: 'full', observableBoundary: 'local' }, output: path.join(f.root, 'source/output') }), /outside source/);
});

test('cache reuses unchanged parsing, invalidates content and extraction version, does not execute JS', t => {
  const f = fixture(t), cacheDirectory = path.join(f.root, 'cache');
  const discover = (cacheVersion = 'test-1') => { const metrics = {}; const map = discoverPrototypeSource({ workspaceRoot: f.root, location: 'source/index.html', cacheDirectory, cacheVersion, metrics }); return { map, metrics }; };
  const first = discover(), second = discover(); assert.equal(first.metrics.parsed, 1); assert.equal(second.metrics.hits, 1); assert.deepEqual(first.map, second.map);
  assert.equal(discover('test-2').metrics.parsed, 1);
  write(path.join(f.root, 'source/other.js'), 'throw new Error("never execute");');
  const third = discover(); assert.equal(third.metrics.hits, 1); assert.equal(third.metrics.parsed, 1);
  fs.appendFileSync(path.join(f.root, 'source/index.html'), '<button hidden>Hidden</button>');
  assert.equal(discover().metrics.parsed, 1);
  assert.equal(f.store.freshness().fresh, false);
  assert.equal(f.store.query({ type: 'candidate', limit: 1 }).items[0].status, 'stale');
  assert.throws(() => f.store.query({ next: true }), /Snapshot stale/);
  assert.throws(() => f.evidence('a'), /Snapshot stale/);
  const newer = initialize({ source: { type: 'html', workspaceRoot: f.root, location: 'source/index.html' }, output: path.join(f.root, 'newer'), priorOutput: f.output, scope: { mode: 'full', observableBoundary: 'local' } });
  assert.equal(newer.counts.evidence.total, 0); assert.equal(newer.counts.node.total, 0);
});

test('bounded filtered pagination including a single enormous nested field, record caps, resume and atomic idempotency', t => {
  const f = fixture(t);
  for (let i = 0; i < 8; i++) f.put('group', { id: `g-${i}`, title: '中'.repeat(6000), details: { nested: ['x'.repeat(8000)] } });
  const first = f.store.query({ type: 'group', detail: true, limit: 3, maxBytes: 1024 });
  assert.equal(first.items.length, 3); assert.equal(first.items[0].oversized, true); assert.ok(Buffer.byteLength(JSON.stringify(first)) + 1 <= 1024); assert.equal(first.bytes, Buffer.byteLength(JSON.stringify(first)) + 1);
  const field = f.store.query({ type: 'group', id: 'g-0', field: 'title', textLimit: 20 }); assert.equal(field.items[0].text.length, 20); assert.equal(field.items[0].nextTextOffset, 20);
  const c = f.store.source().map.candidates.find(c => c.kind === 'control');
  const selected = f.store.query({ type: 'candidate', file: c.file, kind: 'control', id: c.id, status: 'pending' }); assert.equal(selected.items[0].id, c.id);
  const batch = [{ type: 'group', record: { id: 'atomic', title: 'A' } }];
  const a = f.store.put(batch, 'same'); assert.deepEqual(f.store.put(batch, 'same'), a);
  assert.throws(() => f.store.put([{ type: 'group', record: { id: 'different' } }], 'same'), /reused/);
  assert.throws(() => f.store.put([{ type: 'group', record: { id: 'new' } }, { type: 'candidate', record: { id: 'unknown' } }], 'rollback'), /Frozen/); assert.equal(f.store.get('group', 'new'), null);
  assert.throws(() => f.store.put([{ type: 'group', record: { id: 'atomic', title: 'B' } }], 'conflict'), /Revision conflict/);
  assert.throws(() => f.put('group', { id: 'large', details: 'x'.repeat(66000) }), /64 KiB/);
  const reopened = new AnalysisStore(f.output); assert.equal(reopened.get('group', 'atomic').title, 'A'); reopened.close();
  assert.throws(() => f.store.query({ revision: first.revision }), /changed/);
  for (const maxBytes of [1024, 2048, 16384]) { const p = boundedPage(Array.from({ length: 50 }, (_, i) => ({ id: String(i), type: 'x', nested: { value: '汉'.repeat(4000) } })), { maxBytes }); assert.ok(Buffer.byteLength(JSON.stringify(p)) + 1 <= maxBytes); }
});

test('state/control/input/branch identity, deduplication and complete report from structured truth', t => {
  const f = fixture(t); f.complete();
  const audit = f.store.audit(); assert.deepEqual(audit.problems, []);
  assert.equal(f.store.query({ next: true }).items.length, 0);
  assert.equal(f.store.query({ type: 'edge', node: 'b' }).items[0].id, 'go-b');
  assert.equal(f.store.query({ type: 'file' }).items[0].screenshot, true);
  assert.equal([...f.store.rows('control')].length, 1); assert.equal([...f.store.rows('occurrence')].length, 2);
  assert.equal(fs.readdirSync(path.join(f.output, 'screenshots')).length, 1); assert.equal([...f.store.rows('evidence')].length, 2);
  assert.equal(f.evidence('a'), [...f.store.rows('evidence')].find(e => e.action.startsWith('reset a')).id);
  assert.throws(() => f.put('edge', { ...f.store.get('edge', 'go-b'), outcomeKey: 'changed' }), /identity/);
  const copy = { ...f.store.get('edge', 'go-a'), id: 'duplicate' }; assert.throws(() => f.put('edge', copy), /UNIQUE/);
  f.put('edge', { ...f.store.get('edge', 'go-b'), status: 'pending', evidenceIds: [] });
  assert.ok(f.store.query({ next: true, type: 'occurrence' }).items.some(i => i.id === 'button-b'));
  assert.equal(f.store.query({ type: 'occurrence', id: 'button-a' }).items[0].status, 'covered');
  assert.ok(f.store.audit().problems.length > 0);
  const report = renderReport(f.store), markdown = fs.readFileSync(report.report, 'utf8');
  assert.equal(report.complete, false); assert.ok(markdown.includes('go-b'));
  assert.match(markdown, /\| 截图 \| 操作与结果 \| 证据 \|/);
  assert.equal(markdown.match(/^\| !\[/gm)?.length, 3);
  assert.match(markdown, /\| !\[go-a 截图\].*\| go-a：click #go/);
  assert.doesNotMatch(markdown, /^!\[/m);
  assert.doesNotMatch(markdown, /状态空间与排除依据/);
  assert.equal(assertPrototypeReportFormat(markdown).formatVersion, PROTOTYPE_REPORT_FORMAT_VERSION);
  const brief = JSON.parse(fs.readFileSync(report.brief));
  assert.equal(brief.counts.edge.pending, 1);
  assert.equal(brief.reportFormatVersion, PROTOTYPE_REPORT_FORMAT_VERSION);
});

test('report format rejects moved images and dynamic text cannot inject Markdown structure', t => {
  const f = fixture(t); f.complete();
  f.put('group', { ...f.store.get('group', 'home'), title: 'Home\n## injected', purpose: 'Purpose\n![bad](outside.png)' });
  const markdown = fs.readFileSync(renderReport(f.store).report, 'utf8');
  assert.doesNotMatch(markdown, /^## injected$/m);
  assert.doesNotMatch(markdown, /^!\[bad\]/m);
  assert.equal(assertPrototypeReportFormat(markdown).imageCount, 4);
  assert.throws(
    () => assertPrototypeReportFormat(markdown.replace(/^\| (!\[[^\n]+)$/m, '$1')),
    /image must be inside a Markdown table row/,
  );
  assert.equal(reportText('line one\n## line two'), 'line one ## line two');
});

test('missing evidence, branch, source linkage and state vector cannot complete', t => {
  for (const mutation of [
    f => fs.unlinkSync(path.join(f.output, [...f.store.rows('evidence')][0].path)),
    f => { const e = f.store.get('edge', 'go-b'); const c = f.store.source().map.candidates.find(c => c.kind === 'branch'); f.put('edge', { ...e, status: 'pending', evidenceIds: [], candidateOutcomes: { [c.id]: 'true' } }); },
    f => { const v = f.store.get('vector', 'mode-b'); f.put('vector', { ...v, status: 'pending', evidenceIds: [] }); },
    f => f.put('occurrence', { ...f.store.get('occurrence', 'button-b'), edgeIds: ['go-a'] }),
    f => f.store.setMeta('extractorRevision', 'old'),
  ]) { const f = fixture(t); f.complete(); mutation(f); assert.equal(f.store.audit().complete, false); }
  const f = fixture(t);
  assert.throws(() => f.put('node', { id: 'missing', label: 'missing', purpose: 'test', resetAction: 'reset', status: 'covered', evidenceIds: ['missing'] }), /valid snapshot evidence/);
  assert.throws(() => f.store.addEvidence({ snapshotId: 'old' }), /snapshotId/);
});

test('mf-dev-flow opt-in batch path exports compatible files, rejects stale/manual projections and leaves legacy audit intact', t => {
  const f = fixture(t, true); f.complete();
  const invoke = (...args) => spawnSync(process.execPath, [mfDevFlowCli, ...args], { cwd: f.root, encoding: 'utf8' });
  assert.notEqual(invoke('prototype', 'audit', '--run', 'test').status, 0);
  assert.equal(mfDevFlowIndex(['export', '--run', 'test'], f.root).complete, true);
  const audited = invoke('prototype', 'audit', '--run', 'test'); assert.equal(audited.status, 0, audited.stderr);
  assert.equal(fs.existsSync(path.join(f.root, '.mf-dev-flow/prototype')), false);
  const batch = invoke('prototype', 'index', 'query', '--run', 'test', '--type', 'edge', '--limit', '1', '--max-bytes', '1024'); assert.equal(batch.status, 0, batch.stderr); assert.ok(Buffer.byteLength(batch.stdout) <= 1024);
  f.put('group', { ...f.store.get('group', 'home'), purpose: 'updated' });
  assert.match(invoke('prototype', 'audit', '--run', 'test').stderr, /未物化/);
  mfDevFlowIndex(['export', '--run', 'test'], f.root);
  const coverageFile = path.join(path.dirname(f.output), 'coverage.json'); fs.appendFileSync(coverageFile, '\n');
  assert.throws(() => mfDevFlowIndex(['export', '--run', 'test'], f.root), /Concurrent\/manual/);
  assert.match(invoke('prototype', 'audit', '--run', 'test').stderr, /另行修改/);
  assert.throws(() => mfDevFlowIndex(['init', '--run', 'test'], f.root), /pristine/);
});


test('pending queue completion cannot skip work through offset or restart', t => {
  const f = fixture(t), evidenceIds = [f.evidence('a')];
  for (const id of ['one', 'three', 'two']) f.put('entry', { id, status: 'pending', evidenceIds: [] });
  const first = f.store.query({ next: true, type: 'entry', limit: 2 });
  for (const item of first.items) f.put('entry', { ...f.store.get('entry', item.id), status: 'covered', evidenceIds });
  assert.throws(() => f.store.query({ next: true, type: 'entry', cursor: first.nextCursor }), /requires revision/);
  assert.throws(() => f.store.query({ next: true, type: 'entry', cursor: first.nextCursor, revision: first.revision }), /changed/);
  const remaining = f.store.query({ next: true, type: 'entry', limit: 2 });
  assert.equal(remaining.items.length, 1); assert.ok(!first.items.some(i => i.id === remaining.items[0].id));
  const resumed = new AnalysisStore(f.output); assert.deepEqual(resumed.query({ next: true, type: 'entry' }).items.map(i => i.id), remaining.items.map(i => i.id)); resumed.close();
});


test('report preserves unavailable reasons and places groups with their nodes', t => {
  const f = fixture(t);
  for (const id of ['first', 'second']) {
    f.put('group', { id, title: `Group ${id}`, purpose: `Purpose ${id}`, entryNodeIds: [id] });
    f.put('node', { id, groupId: id, label: `Node ${id}`, purpose: 'Test', resetAction: 'Enter', status: 'blocked', reason: `Cannot observe ${id}`, impact: `Impact ${id}` });
  }
  const report = fs.readFileSync(renderReport(f.store).report, 'utf8');
  assert.ok(report.includes('Cannot observe first')); assert.ok(report.includes('Impact second'));
  assert.ok(report.indexOf('Group first') < report.indexOf('Node first')); assert.ok(report.indexOf('Node first') < report.indexOf('Group second'));
});

test('report keeps each group in one ordered section when an interaction crosses groups', t => {
  const f = fixture(t), sourceId = f.store.source().map.candidates[0].id;
  f.put('group', { id: 'first', title: 'Group first', purpose: 'First flow', order: 1, entryNodeIds: ['first-a'] });
  f.put('group', { id: 'second', title: 'Group second', purpose: 'Second flow', order: 2, entryNodeIds: ['second-a'] });
  for (const [id, groupId] of [['first-a', 'first'], ['first-b', 'first'], ['second-a', 'second']])
    f.put('node', { id, groupId, label: `Node ${id}`, purpose: 'Test', resetAction: 'Enter', status: 'blocked', reason: 'Fixture only', impact: 'None' });
  f.put('control', { id: 'cross', locator: '#cross', event: 'click', sourceIds: [sourceId] });
  f.put('edge', { id: 'cross-groups', from: 'first-a', to: 'second-a', controlId: 'cross', inputClass: 'none', outcomeKey: 'open-second', sourceIds: [sourceId], action: { type: 'click', target: '#cross', force: false, script: false }, outcome: 'Second group opens', status: 'pending', evidenceIds: [] });
  const report = fs.readFileSync(renderReport(f.store).report, 'utf8');
  assert.equal(report.match(/^### Group first$/gm)?.length, 1);
  assert.equal(report.match(/^### Group second$/gm)?.length, 1);
  assert.ok(report.indexOf('Node first-a') < report.indexOf('Node first-b'));
  assert.ok(report.indexOf('Node first-b') < report.indexOf('Group second'));
});


test('never-observed mistaken edge can retire with source review, without hiding live references', t => {
  const f = fixture(t); f.complete();
  const planned = { ...f.store.get('edge', 'go-a'), id: 'mistaken-plan', inputClass: 'impossible-input', status: 'pending', evidenceIds: [] }; delete planned.observedOnce;
  f.put('edge', planned);
  assert.equal(f.store.audit().complete, false);
  const source = f.store.source().map.candidates.find(c => c.kind === 'control');
  f.put('candidate', { ...f.store.get('candidate', source.id), edgeIds: ['go-a', 'go-b', 'mistaken-plan'] });
  f.put('edge', { ...f.store.get('edge', 'mistaken-plan'), status: 'retired', reason: 'Source proves this input does not exist', reviewer: 'fixture' });
  assert.equal(f.store.query({ next: true, type: 'edge' }).items.length, 0);
  assert.equal(f.store.audit().complete, false);
  f.put('candidate', { ...f.store.get('candidate', source.id), edgeIds: ['go-a', 'go-b'] });
  assert.equal(f.store.audit().complete, true);
  assert.equal(f.store.summary().counts.edge.retired, 1); assert.equal(f.store.summary().counts.edge.complete, 2);
  assert.throws(() => f.put('edge', { ...f.store.get('edge', 'go-a'), status: 'retired', evidenceIds: [], reason: 'wrong', reviewer: 'fixture' }), /never observed/);
  f.put('edge', { ...f.store.get('edge', 'go-a'), status: 'pending', evidenceIds: [] });
  assert.throws(() => f.put('edge', { ...f.store.get('edge', 'go-a'), status: 'retired', reason: 'wrong', reviewer: 'fixture' }), /never observed/);
});


test('mf-dev-flow interrupted two-file export recovers only its own staged bytes', t => {
  const f = fixture(t, true); f.complete(); mfDevFlowIndex(['export', '--run', 'test'], f.root);
  const run = path.dirname(f.output), markerFile = path.join(f.output, 'mf-dev-flow-export.json');
  const marker = JSON.parse(fs.readFileSync(markerFile));
  const hashes = {};
  for (const name of ['interaction-map.json', 'coverage.json']) {
    const bytes = fs.readFileSync(path.join(run, name), 'utf8') + '\n'; hashes[name] = digest(bytes);
    write(path.join(run, `${name}.index-export.tmp`), bytes);
  }
  write(path.join(f.output, 'mf-dev-flow-export.pending.json'), { before: marker.hashes, after: { ...marker, hashes } });
  fs.renameSync(path.join(run, 'interaction-map.json.index-export.tmp'), path.join(run, 'interaction-map.json'));
  assert.equal(mfDevFlowIndex(['export', '--run', 'test'], f.root).complete, true);
  assert.equal(fs.existsSync(path.join(f.output, 'mf-dev-flow-export.pending.json')), false);
});


test('copied standalone core and CLI initialize without sibling mf-dev-flow or dashboard', t => {
  const f = fixture(t), detached = path.join(f.root, 'detached-skill'); fs.mkdirSync(detached);
  const skill = fileURLToPath(new URL('..', import.meta.url));
  for (const name of ['core', 'analysis-cli.mjs', 'package.json', 'package-lock.json']) fs.cpSync(path.join(skill, name), path.join(detached, name), { recursive: true });
  fs.copyFileSync(path.join(skill, '../skill-identity.mjs'), path.join(f.root, 'skill-identity.mjs'));
  fs.symlinkSync(path.join(skill, 'node_modules'), path.join(detached, 'node_modules'));
  const input = path.join(f.root, 'input.json'); write(input, { schemaVersion: 1, source: { type: 'html', location: path.join(f.root, 'source/index.html') }, scope: { mode: 'full', observableBoundary: 'Detached fixture only' } });
  const result = spawnSync(process.execPath, [path.join(detached, 'analysis-cli.mjs'), 'init', '--input', input, '--out', path.join(f.root, 'detached-output')], { cwd: detached, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.ok(JSON.parse(result.stdout).items[0].snapshotId);
  assert.equal(fs.existsSync(path.join(f.root, '.mf-dev-flow')), false);
});


test('capture commits files and record references together, rejects dimensions/conflicts, and replays idempotently', t => {
  const f = fixture(t);
  const evidence = { snapshotId: f.store.meta('snapshotId'), capturedAt: new Date(Date.parse(f.store.meta('createdAt')) + 1).toISOString(), action: 'SYNTHETIC fixture click', assertion: { expected: 'A', actual: 'A', passed: true }, path: path.join(f.root, 'fixture.png'), trace: path.join(f.root, 'trace.jsonl'), capture: { target: '#fixture', zoom: 1, deviceScaleFactor: 1, sourceUnchanged: true, fullTargetVisible: true, outputSize: { width: 1, height: 1 } } };
  const records = [{ type: 'entry', record: { id: 'capture-entry', feature: 'home', status: 'covered', evidenceIds: ['$evidence'] } }];
  const revision = f.store.meta('revision');
  assert.throws(() => f.store.capture({ evidence: { ...evidence, capture: { ...evidence.capture, outputSize: { width: 390, height: 844 } } }, records }, 'bad-size'), /dimensions/);
  assert.throws(() => f.store.capture({ evidence: { ...evidence, trace: path.join(f.root, 'missing') }, records }, 'missing-trace'), /ENOENT/);
  assert.equal([...f.store.rows('evidence')].length, 0);
  assert.throws(() => f.store.capture({ evidence, records: [...records, { type: 'candidate', record: { id: 'illegal' } }] }, 'rollback'), /Frozen/);
  assert.equal(f.store.get('entry', 'capture-entry'), null);
  assert.equal([...f.store.rows('evidence')].length, 0);
  assert.equal(f.store.meta('revision'), revision);
  const result = f.store.capture({ evidence, records }, 'capture-1');
  assert.equal(result.evidence.verified, true);
  assert.ok(fs.existsSync(result.evidence.files.screenshot));
  assert.ok(fs.existsSync(result.evidence.files.trace));
  assert.deepEqual(f.store.get('entry', 'capture-entry').evidenceIds, [result.evidence.id]);
  assert.deepEqual(f.store.capture({ evidence, records }, 'capture-1'), result);
  assert.equal([...f.store.rows('evidence')].length, 1);
  assert.throws(() => f.store.capture({ evidence: { ...evidence, action: 'different' }, records }, 'capture-1'), /reused/);
  fs.unlinkSync(result.evidence.files.trace);
  assert.throws(() => f.store.capture({ evidence, records }, 'capture-1'), /missing or changed/);
  assert.equal(f.store.effective('entry', f.store.get('entry', 'capture-entry')), 'pending');
});
