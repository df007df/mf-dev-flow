import fs from 'node:fs';
import path from 'node:path';

import { digest } from '../modules/prototype/core/html-source.js';
import { execute, parseArgs, printResult } from '../modules/prototype/analysis-cli.mjs';
import { exportFileName, STORE_DIRECTORY } from '../modules/skill-identity.mjs';
const { AnalysisStore, initialize } = await import('../modules/prototype/core/store.js');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = file => digest(fs.readFileSync(file));
const names = ['interaction-map.json', 'coverage.json'];
function recoverExport(runDirectory, output) {
  const journalFile = path.join(output, exportFileName({ pending: true }));
  if (!fs.existsSync(journalFile)) return;
  const journal = read(journalFile);
  // Check every file before finishing a partially replaced projection. Never accept other writers' bytes.
  for (const name of names) {
    const actual = hash(path.join(runDirectory, name));
    if (![journal.before[name], journal.after.hashes[name]].includes(actual)) throw new Error(`Concurrent/manual legacy edit during export recovery: ${name}`);
    if (actual !== journal.after.hashes[name] && hash(path.join(runDirectory, `${name}.index-export.tmp`)) !== journal.after.hashes[name]) throw new Error(`Interrupted export staging missing or changed: ${name}`);
  }
  for (const name of names) if (hash(path.join(runDirectory, name)) !== journal.after.hashes[name]) fs.renameSync(path.join(runDirectory, `${name}.index-export.tmp`), path.join(runDirectory, name));
  const markerFile = path.join(output, exportFileName());
  fs.writeFileSync(`${markerFile}.tmp`, JSON.stringify(journal.after)); fs.renameSync(`${markerFile}.tmp`, markerFile);
  fs.unlinkSync(journalFile);
}


export function mfDevFlowIndex(args, workspaceRoot = process.cwd()) {
  const { command, options } = parseArgs(args);
  if (!options.run || !/^[\w\p{L}.-]+$/u.test(options.run)) throw new Error('--run valid prototype run ID required');
  const runDirectory = path.join(workspaceRoot, STORE_DIRECTORY, 'prototype-runs', options.run);
  const run = read(path.join(runDirectory, 'run.json'));
  if (run.type !== 'prototype') throw new Error('Prototype run required');
  const output = path.join(runDirectory, 'analysis-index');
  if (['init', 'put', 'evidence', 'export', 'report'].includes(command) && !['pending', 'in_progress'].includes(run.status)) throw new Error('Only active prototype runs may be updated');
  if (command === 'init') {
    const graph = read(path.join(runDirectory, 'interaction-map.json'));
    const coverage = read(path.join(runDirectory, 'coverage.json'));
    if (['candidateReviews', 'nodes', 'edges', 'stateSpaces', 'runtimeDiscoveries', 'runtimeSweeps'].some(k => graph[k]?.length) || JSON.stringify(coverage).includes('"observed"') || fs.readdirSync(path.join(runDirectory, 'screenshots')).length) throw new Error('Only pristine maps may opt in; active/legacy observations are never imported or verified');
    const project = read(path.join(workspaceRoot, STORE_DIRECTORY, 'project.json'));
    const frozenSource = read(path.join(runDirectory, 'source-map.json'));
    if (run.sourceMap?.sha256 !== hash(path.join(runDirectory, 'source-map.json'))) throw new Error('MfDevFlow frozen source fingerprint mismatch');
    const result = initialize({ source: { type: 'html', workspaceRoot, location: project.prototype.location }, output, frozenSource, scope: { mode: run.scope === 'full' ? 'full' : 'partial', observableBoundary: options.boundary ?? 'Registered local prototype; remote resources and unbounded dynamic domains require explicit unresolved boundaries.' } });
    fs.writeFileSync(path.join(output, exportFileName()), JSON.stringify({ revision: 0, hashes: Object.fromEntries(names.map(n => [n, hash(path.join(runDirectory, n))])) }));
    return result;
  }
  if (command === 'export') {
    const store = new AnalysisStore(output);
    store.db.exec('BEGIN IMMEDIATE');
    try {
      recoverExport(runDirectory, output);
      const markerFile = path.join(output, exportFileName()), marker = read(markerFile);
      const snapshotFile = path.join(runDirectory, 'source-map.json');
      if (run.sourceMap?.sha256 !== hash(snapshotFile)) throw new Error('MfDevFlow frozen source changed');
      for (const n of names) if (marker.hashes[n] !== hash(path.join(runDirectory, n))) throw new Error(`Concurrent/manual legacy edit in ${n}; refusing to overwrite`);
      const fresh = store.freshness(); if (!fresh.fresh) throw new Error('Source or extractor changed; create a new run');
      const audit = store.audit();
      const { graph, coverage } = store.materialize();
      graph.sourceMapHash = hash(snapshotFile);
      if (!audit.complete) {
        graph.status = 'in_progress';
        coverage.sourceInventory.completeness = 'unverified';
        coverage.sourceInteractionInventory.completeness = 'unverified';
        coverage.sourceInteractionInventory.status = 'in_progress';
        coverage.traversal.status = 'in_progress';
      }
      coverage.sourceInteractionInventory.controls = [...store.rows('control')].map(c => {
        const occurrences = [...store.rows('occurrence')].filter(o => o.controlId === c.id);
        const evidenceIds = [...new Set(occurrences.flatMap(o => (o.edgeIds ?? []).flatMap(id => store.get('edge', id)?.evidenceIds ?? [])))];
        return { ...c, source: (c.sourceIds ?? []).join(', '), states: occurrences.map(o => o.nodeId), status: occurrences.length && occurrences.every(o => store.effective('occurrence', o) === 'covered') ? 'covered' : 'pending', evidence: evidenceIds.map(id => store.get('evidence', id)).filter(Boolean) };
      });
      for (const e of store.rows('evidence')) for (const key of ['path', 'trace']) {
        const from = path.join(output, e[key]), to = path.join(runDirectory, e[key]);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        if (fs.existsSync(to)) { if (hash(from) !== hash(to)) throw new Error('Evidence export path collision'); }
        else fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      }
      const previousCoverage = read(path.join(runDirectory, 'coverage.json'));
      const values = { 'interaction-map.json': graph, 'coverage.json': { ...previousCoverage, ...coverage } };
      const hashes = {};
      for (const n of names) {
        const bytes = JSON.stringify(values[n], null, 2) + '\n';
        fs.writeFileSync(path.join(runDirectory, `${n}.index-export.tmp`), bytes); hashes[n] = digest(bytes);
      }
      const nextMarker = { revision: store.meta('revision'), hashes, auditComplete: audit.complete };
      // Durable intent allows a subsequent export to finish a interrupted pair without overwriting other writers.
      const journalFile = path.join(output, exportFileName({ pending: true }));
      fs.writeFileSync(`${journalFile}.tmp`, JSON.stringify({ before: marker.hashes, after: nextMarker })); fs.renameSync(`${journalFile}.tmp`, journalFile);
      for (const n of names) fs.renameSync(path.join(runDirectory, `${n}.index-export.tmp`), path.join(runDirectory, n));
      fs.writeFileSync(`${markerFile}.tmp`, JSON.stringify(nextMarker)); fs.renameSync(`${markerFile}.tmp`, markerFile);
      fs.unlinkSync(journalFile);
      store.db.exec('COMMIT');
      return { exported: names, revision: nextMarker.revision, complete: audit.complete, problemCount: audit.problems.length, note: 'Run existing prototype audit; report/group publication and user answers remain mf-dev-flow-owned.' };
    } catch (error) { store.db.exec('ROLLBACK'); throw error; } finally { store.close(); }
  }
  // All batching commands use the same standalone core and hard output limits.
  const forward = args.filter((_, i) => args[i] !== '--run' && args[i - 1] !== '--run');
  if (options.out) throw new Error('mf-dev-flow index output is fixed by --run');
  return execute([...forward, '--out', output]);
}
export function main(args) {
  try { const { options } = parseArgs(args); printResult(mfDevFlowIndex(args), options.maxBytes); }
  catch (error) { process.stderr.write(JSON.stringify({ error: error.message.slice(0, 700) }) + '\n'); process.exitCode = 1; }
}
