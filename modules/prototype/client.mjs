// Public CLI transport for consumers. No SQLite tables or parser imports here.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLI_FILE_NAME, ENVIRONMENT, STORE_DIRECTORY } from '../skill-identity.mjs';
const cli = process.env[ENVIRONMENT.CLI_PATH] || fileURLToPath(new URL(`../../scripts/${CLI_FILE_NAME}`, import.meta.url));
export const hasPrototypeCatalog = root => fs.existsSync(path.join(root, STORE_DIRECTORY, 'prototype', 'catalog.sqlite'));
export function callPrototype(root, args, maxBytes = 16384) {
  const result = spawnSync(process.execPath, [cli, 'prototype', ...args, '--json', '--max-bytes', String(maxBytes)], { cwd: root, encoding: 'utf8', maxBuffer: maxBytes + 4096, timeout: 15000 });
  if (result.error || result.status !== 0) throw new Error(`Prototype CLI failed: ${(result.error?.message ?? result.stderr).slice(0, 500)}`);
  if (Buffer.byteLength(result.stdout) > maxBytes) throw new Error('Prototype CLI exceeded output contract');
  const page = JSON.parse(result.stdout);
  if (!Array.isArray(page.items)) throw new Error('Prototype CLI detail needs smaller field/page');
  return page;
}
export function prototypeResult(root, args) {
  const page = callPrototype(root, args, 65536); if (page.items.length !== 1 || page.items[0].oversized) throw new Error('Expected one CLI result'); return page.items[0];
}
function fullRecord(root, selectors, item, revision) {
  if (!item.oversized) return item.record;
  let offset = 0, serialized = '';
  do {
    const page = callPrototype(root, ['query', ...selectors, '--id', item.id, '--revision', String(revision), '--field', 'record', '--text-offset', String(offset), '--text-limit', '2000'], 16384);
    const part = page.items[0];
    if (!part || part.oversized || typeof part.text !== 'string') throw new Error('Record cannot be paged');
    serialized += part.text; offset = part.nextTextOffset;
    if (Buffer.byteLength(serialized) > 1048576) throw new Error('Consumer record exceeds 1 MiB');
  } while (offset !== null);
  return JSON.parse(serialized);
}
export function semanticRows(root, collection) {
  const result = []; let cursor = 0, revision;
  do {
    const page = callPrototype(root, ['query', '--collection', collection, '--detail', '--limit', '20', '--cursor', String(cursor), ...(revision === undefined ? [] : ['--revision', String(revision)])], 65536);
    revision = page.revision; result.push(...page.items.map(i => fullRecord(root, ['--collection', collection], i, revision))); cursor = page.nextCursor;
  } while (cursor !== null);
  return result;
}
export function publicPrototypeRevision(root, { planning = false } = {}) {
  const planningArgs = planning ? ['--planning'] : [];
  const header = prototypeResult(root, ['revision', ...planningArgs]);
  const result = { ...header }; delete result.type; delete result.id; delete result.counts;
  for (const collection of ['groups', 'entries', 'requirements', 'questions', 'sourceFiles']) {
    result[collection] = []; let cursor = 0;
    do {
      const page = callPrototype(root, ['revision', ...planningArgs, '--collection', collection, '--cursor', String(cursor), '--fingerprint', header.fingerprint, '--limit', '50'], 65536);
      if (page.fingerprint !== header.fingerprint) throw new Error('Prototype changed during revision read; retry');
      result[collection].push(...page.items.map(({ type, ...record }) => record)); cursor = page.nextCursor;
    } while (cursor !== null);
  }
  return result;
}
export function analysisRows(root, batch, type) {
  const result = []; let cursor = 0, revision;
  do {
    const page = callPrototype(root, ['query', '--batch', batch, '--type', type, '--detail', '--limit', '20', '--cursor', String(cursor), ...(revision === undefined ? [] : ['--revision', String(revision)])], 65536);
    revision = page.revision; result.push(...page.items.map(i => fullRecord(root, ['--batch', batch, '--type', type], i, revision))); cursor = page.nextCursor;
  } while (cursor !== null);
  return result;
}
export function prototypeArchiveDirectory(store, id) {
  const modern = path.join(store, 'prototype/analyses', String(id ?? ''));
  return fs.existsSync(path.join(modern, 'index.sqlite')) ? modern : path.join(store, 'prototype-runs', String(id ?? ''));
}
export function prototypeArchiveExists(store, id) {
  const directory = prototypeArchiveDirectory(store, id);
  return Boolean(id) && (fs.existsSync(path.join(directory, 'index.sqlite')) || fs.existsSync(path.join(directory, 'run.json')));
}
export function planningPrototype(root) {
  const status = prototypeResult(root, ['status']);
  const groups = semanticRows(root, 'groups'), entries = semanticRows(root, 'entries');
  const requirements = semanticRows(root, 'requirements').filter(r => r.status !== 'withdrawn');
  const questions = semanticRows(root, 'questions');
  const evidence = new Map();
  for (const batch of new Set(entries.map(e => e.sourceBatch))) for (const record of analysisRows(root, batch, 'evidence')) evidence.set(`${batch}:${record.id}`, { ...record, path: `prototype/analyses/${batch}/${record.path}`, trace: `prototype/analyses/${batch}/${record.trace}` });
  const revision = publicPrototypeRevision(root, { planning: true });
  if (status.semanticRevision !== revision.semanticRevision) throw new Error('Prototype semantic revision changed during planning context');
  // These are in-memory consumer views, never exported as a second disk truth.
  return {
    task: { id: 'prototype-main', status: status.status, source: { prototypeRun: status.acceptedBatch, prototypeVersion: status.semanticRevision, storage: 'catalog' }, updatedAt: null },
    features: groups.map(g => ({ ...g, sourceEntries: entries.filter(e => e.feature === g.id).map(e => e.id) })),
    sourceEntries: entries, requirements, questions, revision,
    coverage: entries.map(e => ({ id: e.id, status: 'covered', evidence: (e.evidenceIds ?? []).map(id => { const found = evidence.get(`${e.sourceBatch}:${id}`); if (!found) throw new Error('Accepted entry evidence missing'); return found; }) })),
  };
}

export function relatedQuestion(question, map, feature) {
  const group = (map.groups ?? []).find(g => g.id === feature.parentId);
  return (feature.sourceQuestionIds ?? []).includes(question.id) || (group?.sourceFeatureIds ?? []).includes(question.groupId ?? question.featureId) || (question.entryIds ?? []).some(id => (feature.sourceEntries ?? []).includes(id)) || (question.evidence ?? []).some(e => (feature.sourceEntries ?? []).includes(e.entryId)) || (!question.groupId && !question.featureId && !(question.entryIds ?? []).length);
}
