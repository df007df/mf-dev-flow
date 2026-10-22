#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || nodeMajor === 22 && nodeMinor < 18) {
  process.stderr.write('mf-dev-flow prototype requires Node >=22.18.\n');
  process.exit(1);
}
const { AnalysisStore, initialize, boundedPage } = await import('./core/store.js');
import { renderReport } from './core/report.js';

export function parseArgs(args) {
  const [command, ...rest] = args, options = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) throw new Error(`Unexpected argument ${rest[i]}`);
    const key = rest[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    options[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  }
  return { command, options };
}
export function execute(args) {
  const { command, options } = parseArgs(args);
  const loadInput = () => {
    if (!options.input) throw new Error('--input JSON file required');
    if (fs.statSync(options.input).size > 1048576) throw new Error('Input exceeds 1 MiB');
    return JSON.parse(fs.readFileSync(options.input, 'utf8'));
  };
  if (command === 'help' || !command) return { commands: ['init --input input.json --out DIR', 'query|next --out DIR [--type TYPE --file PATH --node ID --status STATUS --id ID --kind KIND --limit 20 --cursor 0 --revision N --max-bytes 16384 --detail --field FIELD --text-offset 0 --text-limit 2048]', 'put --out DIR --input batch.json --request-id UNIQUE', 'evidence --out DIR --input evidence.json', 'summary|freshness|audit|report --out DIR'], note: 'No browser or prototype execution. Inspect bounded next/query and submit real observations. Node >=22.18 and npm ci in modules/prototype.' };
  if (!options.out) throw new Error('--out required');
  if (command === 'init') { const input = loadInput(); if (input.schemaVersion !== 1) throw new Error('Input schemaVersion must be 1'); return initialize({ source: input.source, scope: input.scope, priorOutput: input.priorOutput, output: options.out }); }
  const store = new AnalysisStore(options.out);
  try {
    const context = { command, agent: options.agent };
    if (command === 'query' || command === 'next') return store.query({ ...options, command, next: command === 'next' });
    if (command === 'put') { const batch = loadInput(); return store.put(batch, options.requestId, { ...context, recordTypes: batch.map(item => item.type) }); }
    if (command === 'capture') { const payload = loadInput(); return store.capture(payload, options.requestId, { ...context, recordTypes: payload.records?.map(item => item.type) ?? [] }); }
    if (command === 'evidence') return store.addEvidence(loadInput(), context);
    if (command === 'summary') return store.summary();
    if (command === 'freshness') { const result = store.freshness(); delete result.current; return result; }
    if (command === 'audit') {
      const audit = store.audit(context);
      const cursor = Number(options.cursor ?? 0), limit = Number(options.limit ?? 20);
      if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid audit pagination');
      if (cursor > 0 && options.revision === undefined || options.revision !== undefined && Number(options.revision) !== audit.revision) throw new Error('Audit cursor requires current revision; restart at cursor 0');
      return boundedPage(audit.problems.slice(cursor, cursor + limit).map((problem, i) => ({ type: 'audit', id: String(cursor + i), problem, complete: audit.complete, problemCount: audit.problems.length })), { maxBytes: options.maxBytes, cursor, nextCursor: cursor + limit < audit.problems.length ? cursor + limit : null, revision: audit.revision, metadata: { complete: audit.complete, problemCount: audit.problems.length } });
    }
    if (command === 'report') return renderReport(store);
    throw new Error(`Unknown command ${command}`);
  } finally { store.close(); }
}
export function printResult(result, maxBytes = 16384) {
  if (result?.items && result.bytes) { process.stdout.write(JSON.stringify(result) + '\n'); return; }
  const page = boundedPage([{ type: 'result', id: 'result', ...result }], { maxBytes });
  process.stdout.write(JSON.stringify(page) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { const { options } = parseArgs(process.argv.slice(2)); printResult(execute(process.argv.slice(2)), options.maxBytes); }
  catch (e) { process.stderr.write(JSON.stringify({ error: String(e.message).slice(0, 700) }) + '\n'); process.exitCode = 1; }
}
