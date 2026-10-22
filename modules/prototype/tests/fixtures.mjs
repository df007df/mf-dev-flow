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
import { createPrototypeMap } from '../../../dashboard/server/prototype-map-audit.js';
import { mfDevFlowIndex } from '../../../scripts/prototype-index.mjs';


const mfDevFlowCli = fileURLToPath(new URL('../../../scripts/mf-dev-flow.mjs', import.meta.url));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
const html = '<main class="page"><button id="go">Go</button></main><script>let mode="a";document.querySelector("#go").addEventListener("click",()=>{if(mode==="a")document.title="A";else document.title="B";});</script>';
export function fixture(t, mfDevFlow = false, unified = false, { beforeInitialize } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-analysis-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, 'source/index.html'), html);
  let output = path.join(root, 'analysis');
  if (unified) {
    beforeInitialize?.(root);
    write(path.join(root, 'init.json'), { schemaVersion: 1, source: { type: 'html', location: 'source/index.html' }, scope: { mode: 'full', observableBoundary: 'SYNTHETIC FIXTURE ONLY; no browser observation' } });
    const result = spawnSync(process.execPath, [mfDevFlowCli, 'prototype', 'init', '--input', path.join(root, 'init.json'), '--batch', 'test', '--request-id', 'init'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    output = path.join(root, '.mf-dev-flow/prototype/analyses/test');
  } else if (mfDevFlow) {
    output = path.join(root, '.mf-dev-flow/prototype-runs/test/analysis-index');
    const runDirectory = path.dirname(output);
    write(path.join(root, '.mf-dev-flow/project.json'), { schemaVersion: 1, project: { name: 'test' }, prototype: { location: 'source/index.html', kind: 'html' }, codeRoots: [] });
    write(path.join(runDirectory, 'run.json'), { id: 'test', type: 'prototype', scope: 'full', status: 'in_progress' });
    write(path.join(runDirectory, 'coverage.json'), { coverage: [] }); fs.mkdirSync(path.join(runDirectory, 'screenshots'));
    createPrototypeMap({ workspaceRoot: root, runDirectory });
    mfDevFlowIndex(['init', '--run', 'test'], root);
  } else initialize({ source: { type: 'html', workspaceRoot: root, location: 'source/index.html' }, output, scope: { mode: 'full', observableBoundary: 'Synthetic local browser behavior only' } });
  const store = new AnalysisStore(output); t.after(() => store.close());
  let request = 0;
  const put = (type, record) => store.put([{ type, record, expectedRevision: store.get(type, record.id)?.revision }], `request-${++request}`);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  write(path.join(root, 'fixture.png'), png); write(path.join(root, 'trace.jsonl'), '{"fixture":true,"action":"click Go","assertion":"title A/B"}\n');
  const evidence = id => store.addEvidence({ snapshotId: store.meta('snapshotId'), capturedAt: new Date(Date.parse(store.meta('createdAt')) + 1).toISOString(), action: `reset ${id}, click Go`, assertion: { expected: id.toUpperCase(), actual: id.toUpperCase(), passed: true }, path: path.join(root, 'fixture.png'), trace: path.join(root, 'trace.jsonl') }).id;
  function complete() {
    const source = store.source().map, sourceIds = source.candidates.map(c => c.id);
    put('group', { id: 'home', title: 'Home', purpose: 'Choose mode', order: 0, entryNodeIds: ['a', 'b'] });
    put('control', { id: 'go', locator: '#go', event: 'click', sourceIds });
    for (const id of ['a', 'b']) {
      const evidenceIds = [evidence(id)];
      put('entry', { id, feature: 'home', status: 'covered', evidenceIds });
      put('node', { id, label: `Home ${id}`, purpose: `Test mode ${id}`, groupId: 'home', values: { mode: id }, resetAction: `Reset mode ${id}`, entryIds: [id], status: 'covered', evidenceIds });
      put('edge', { id: `go-${id}`, from: id, to: id, controlId: 'go', inputClass: 'none', outcomeKey: id, sourceIds, candidateOutcomes: Object.fromEntries(source.candidates.filter(c => c.kind === 'branch').map(c => [c.id, id === 'a' ? 'true' : 'false'])), action: { type: 'click', target: '#go', force: false, script: false }, outcome: `Title ${id.toUpperCase()}`, status: 'covered', evidenceIds });
      put('occurrence', { id: `button-${id}`, nodeId: id, controlId: 'go', edgeIds: [`go-${id}`] });
      put('sweep', { id, nodeId: id, complete: true, discoveryIds: [`button-${id}`], status: 'covered', evidenceIds });
      put('vector', { id: `mode-${id}`, spaceId: 'home', values: { mode: id }, resetAction: `Reset ${id}`, status: 'covered', evidenceIds });
    }
    put('space', { id: 'home', sourceIds, dimensions: { mode: ['a', 'b'] }, reductions: [] });
    for (const c of source.candidates) put('candidate', { ...c, status: 'mapped', ...(c.kind === 'page' ? { nodeIds: ['a', 'b'] } : c.kind === 'state' ? { stateSpaceIds: ['home'] } : { edgeIds: ['go-a', 'go-b'] }) });
  }
  return { root, output, store, put, complete, evidence };
}

export function completeFixtureStore(store, root) {
  let request = 0;
  const put = (type, record) => store.put([{ type, record, expectedRevision: store.get(type, record.id)?.revision }], `request-${++request}`);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  write(path.join(root, 'fixture.png'), png); write(path.join(root, 'trace.jsonl'), '{"fixture":true,"action":"click Go","assertion":"title A/B"}\\n');
  const evidence = id => store.addEvidence({ snapshotId: store.meta('snapshotId'), capturedAt: new Date(Date.parse(store.meta('createdAt')) + 1).toISOString(), action: `reset ${id}, click Go`, assertion: { expected: id.toUpperCase(), actual: id.toUpperCase(), passed: true }, path: path.join(root, 'fixture.png'), trace: path.join(root, 'trace.jsonl') }).id;
  const source = store.source().map, sourceIds = source.candidates.map(c => c.id);
  put('group', { id: 'home', title: 'Home', purpose: 'Choose mode', order: 0, entryNodeIds: ['a', 'b'] });
  put('control', { id: 'go', locator: '#go', event: 'click', sourceIds });
  for (const id of ['a', 'b']) {
    const evidenceIds = [evidence(id)];
    put('entry', { id, feature: 'home', status: 'covered', evidenceIds });
    put('node', { id, label: `Home ${id}`, purpose: `Test mode ${id}`, groupId: 'home', values: { mode: id }, resetAction: `Reset mode ${id}`, entryIds: [id], status: 'covered', evidenceIds });
    put('edge', { id: `go-${id}`, from: id, to: id, controlId: 'go', inputClass: 'none', outcomeKey: id, sourceIds, candidateOutcomes: Object.fromEntries(source.candidates.filter(c => c.kind === 'branch').map(c => [c.id, id === 'a' ? 'true' : 'false'])), action: { type: 'click', target: '#go', force: false, script: false }, outcome: `Title ${id.toUpperCase()}`, status: 'covered', evidenceIds });
    put('occurrence', { id: `button-${id}`, nodeId: id, controlId: 'go', edgeIds: [`go-${id}`] });
    put('sweep', { id, nodeId: id, complete: true, discoveryIds: [`button-${id}`], status: 'covered', evidenceIds });
    put('vector', { id: `mode-${id}`, spaceId: 'home', values: { mode: id }, resetAction: `Reset ${id}`, status: 'covered', evidenceIds });
  }
  put('space', { id: 'home', sourceIds, dimensions: { mode: ['a', 'b'] }, reductions: [] });
  for (const c of source.candidates) put('candidate', { ...c, status: 'mapped', ...(c.kind === 'page' ? { nodeIds: ['a', 'b'] } : c.kind === 'state' ? { stateSpaceIds: ['home'] } : { edgeIds: ['go-a', 'go-b'] }) });
}
