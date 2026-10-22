// Synthetic scale proxy only; this does not analyze any real prototype or measure tokens.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AnalysisStore, initialize } from '../core/store.js';
import { discoverPrototypeSource } from '../core/html-source.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-index-benchmark-'));
const started = performance.now();
try {
  fs.mkdirSync(path.join(root, 'source'));
  for (let f = 0; f < 7; f++) {
    const count = f === 0 ? 382 : 377;
    fs.writeFileSync(path.join(root, 'source', f === 0 ? 'index.html' : `page-${f}.html`), Array.from({ length: count }, (_, i) => `<button id="button-${f}-${i}">Synthetic button ${i}</button>`).join('\n'));
  }
  const params = { workspaceRoot: root, location: 'source/index.html', cacheDirectory: path.join(root, 'cache') };
  const cold = {}, warm = {}, versionChange = {};
  discoverPrototypeSource({ ...params, metrics: cold, cacheVersion: 'benchmark-1' });
  discoverPrototypeSource({ ...params, metrics: warm, cacheVersion: 'benchmark-1' });
  discoverPrototypeSource({ ...params, metrics: versionChange, cacheVersion: 'benchmark-2' });
  const output = path.join(root, 'analysis');
  initialize({ source: { type: 'html', workspaceRoot: root, location: 'source/index.html' }, output, scope: { mode: 'full', observableBoundary: 'Synthetic benchmark; no observations asserted' } });
  const store = new AnalysisStore(output);
  let expandedOccurrenceBytes = 2;
  const control = i => ({ id: `control-${i}`, locator: `#synthetic-${i}`, event: 'click', description: 'Definition only. '.repeat(40), sourceIds: [] });
  let request = 0, batch = [];
  const add = (type, record) => { batch.push({ type, record }); if (batch.length === 50) { store.put(batch, `bench-${++request}`); batch = []; } };
  for (let i = 0; i < 36; i++) add('control', control(i));
  for (let i = 0; i < 808; i++) add('node', { id: `node-${i}`, label: `Page ${i}`, purpose: 'Synthetic page', resetAction: 'Reset', status: 'pending', evidenceIds: [] });
  for (let i = 0; i < 1654; i++) add('edge', { id: `edge-${i}`, from: `node-${i % 808}`, to: `node-${(i + 1) % 808}`, controlId: `control-${i % 36}`, action: { type: 'click', target: '#synthetic', force: false, script: false }, inputClass: `input-${i}`, outcomeKey: 'result', outcome: 'Unverified synthetic result', status: 'pending', evidenceIds: [] });
  for (let i = 0; i < 28406; i++) {
    const record = { id: `occurrence-${String(i).padStart(5, '0')}`, nodeId: `node-${Math.floor(i / 36)}`, controlId: `control-${i % 36}`, edgeIds: [] };
    add('occurrence', record); expandedOccurrenceBytes += Buffer.byteLength(JSON.stringify({ ...record, observedControl: control(i % 36) })) + 1;
  }
  if (batch.length) store.put(batch, `bench-${++request}`);
  const begin = performance.now();
  const page = store.query({ next: true, type: 'occurrence', limit: 20, maxBytes: 16384 });
  const queryMs = performance.now() - begin;
  const tight = store.query({ type: 'occurrence', node: 'node-10', limit: 50, maxBytes: 2048 });
  assert.equal(page.items.length, 20); assert.ok(page.bytes <= 16384); assert.ok(tight.bytes <= 2048);
  const candidates = store.db.prepare("SELECT COUNT(*) AS n FROM records WHERE type='candidate'").get().n;
  const normalizedOccurrenceBytes = store.db.prepare("SELECT SUM(length(CAST(body AS BLOB))) AS n FROM records WHERE type='occurrence'").get().n;
  const result = { schemaVersion: 1, fixture: { sourceFiles: 7, candidates, nodes: 808, edges: 1654, occurrences: 28406, controlDefinitions: 36 }, staticCache: { cold, warm, versionChange }, context: { defaultRows: page.items.length, defaultUtf8Bytes: page.bytes, maxBytes: 16384, filteredRows: tight.items.length, filteredUtf8Bytes: tight.bytes, filteredMaxBytes: 2048, fullExpandedSyntheticOccurrenceBytes: expandedOccurrenceBytes, normalizedOccurrenceBodyBytes: normalizedOccurrenceBytes }, queryMilliseconds: Number(queryMs.toFixed(2)), databaseBytes: fs.statSync(path.join(output, 'index.sqlite')).size, elapsedMilliseconds: Number((performance.now() - started).toFixed(2)), limitation: 'UTF-8 output size and synthetic repeated definitions are proxies, not measured token savings or a migrated real history.' };
  store.close();
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
