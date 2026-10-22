import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { boundedPage } from '../prototype/core/paging.js';
import { storePath } from '../skill-identity.mjs';

// Feature-level final acceptance cases deliberately live outside the prototype
// catalog. They are frozen into a delivery task's end_to_end_acceptance stage.
export const acceptanceCasesPath = storePath('planning', 'acceptance-cases.json');
const featureMapPath = root => path.join(path.resolve(root), storePath('planning', 'feature-map.json'));
const registryPath = root => path.join(path.resolve(root), acceptanceCasesPath);
const statuses = new Set(['active', 'superseded', 'withdrawn']);
const MAX_BYTES = 65536;
const MAX_RECORDS = 300;
const MAX_REQUESTS = 200;
const MAX_EVENTS = 300;
const json = JSON.stringify;
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(json(value));
const now = () => new Date().toISOString();

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isObject(value)) return '{' + Object.keys(value).sort().map(key => json(key) + ':' + canonical(value[key])).join(',') + '}';
  return json(value);
}

const digest = value => createHash('sha256').update(canonical(value)).digest('hex');

function text(value, name, { min = 1, max = 4000 } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max)
    throw new Error(name + ' must be text of ' + min + '..' + max + ' characters');
  return value.trim();
}

function optionalText(value, name, max = 800) {
  if (value === undefined || value === null || value === '') return null;
  return text(value, name, { max });
}

function caseId(value) {
  if (typeof value !== 'string' || !/^AC-[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value))
    throw new Error('Acceptance case id must match AC-<identifier>');
  return value;
}

function values(value, name, maxItems = 12, maxLength = 500) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems)
    throw new Error(name + ' must be an array with at most ' + maxItems + ' items');
  return [...new Set(value.map(item => text(item, name + ' item', { max: maxLength })))].sort((left, right) => left.localeCompare(right));
}

function recordVersion(record) {
  return {
    revision: record.revision,
    at: record.updatedAt,
    title: record.title,
    detail: record.detail,
    status: record.status,
    statusReason: record.statusReason ?? null,
    evidenceHints: [...record.evidenceHints],
  };
}

function storedRecord(value) {
  if (!isObject(value)) throw new Error('acceptance case record must be an object');
  const record = {
    id: caseId(value.id),
    featureId: text(value.featureId, 'acceptance case featureId', { max: 200 }),
    title: text(value.title, 'acceptance case title', { max: 200 }),
    detail: text(value.detail, 'acceptance case detail', { max: 4000 }),
    evidenceHints: values(value.evidenceHints, 'acceptance case evidenceHints'),
    status: text(value.status, 'acceptance case status', { max: 20 }),
    origin: value.origin === 'user' ? 'user' : null,
    revision: Number(value.revision),
    createdAt: text(value.createdAt, 'acceptance case createdAt', { max: 80 }),
    updatedAt: text(value.updatedAt, 'acceptance case updatedAt', { max: 80 }),
    history: Array.isArray(value.history) ? clone(value.history) : [],
    statusReason: optionalText(value.statusReason, 'acceptance case statusReason'),
  };
  if (!statuses.has(record.status)) throw new Error('acceptance case status is unsupported');
  if (!record.origin) throw new Error('acceptance case origin is unsupported');
  if (!Number.isInteger(record.revision) || record.revision < 1)
    throw new Error('acceptance case revision must be positive');
  if (record.history.length > 100) throw new Error('acceptance case history is too large');
  return record;
}

function inputRecord(value, { existing = null, at = now() } = {}) {
  if (!isObject(value)) throw new Error('acceptance case input must be an object');
  const allowed = new Set(['id', 'featureId', 'title', 'detail', 'evidenceHints', 'status', 'statusReason']);
  for (const key of Object.keys(value)) if (!allowed.has(key))
    throw new Error('acceptance case input field is unsupported: ' + key);
  if (existing && value.id !== undefined && value.id !== existing.id)
    throw new Error('acceptance case id cannot change');
  if (existing && value.featureId !== undefined && value.featureId !== existing.featureId)
    throw new Error('acceptance case featureId cannot change');
  const record = {
    id: caseId(existing?.id ?? value.id),
    featureId: text(existing?.featureId ?? value.featureId, 'acceptance case featureId', { max: 200 }),
    title: text(value.title ?? existing?.title, 'acceptance case title', { max: 200 }),
    detail: text(value.detail ?? existing?.detail, 'acceptance case detail', { max: 4000 }),
    evidenceHints: value.evidenceHints === undefined
      ? [...(existing?.evidenceHints ?? [])]
      : values(value.evidenceHints, 'acceptance case evidenceHints'),
    status: value.status === undefined ? existing?.status ?? 'active' : text(value.status, 'acceptance case status', { max: 20 }),
    origin: 'user',
    revision: (existing?.revision ?? 0) + 1,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    history: existing ? [...existing.history, recordVersion(existing)] : [],
    statusReason: value.statusReason === undefined
      ? existing?.statusReason ?? null
      : optionalText(value.statusReason, 'acceptance case statusReason'),
  };
  if (!statuses.has(record.status)) throw new Error('acceptance case status is unsupported');
  if (record.history.length > 100) throw new Error('acceptance case history is too large');
  return record;
}

function blankRegistry() {
  return {
    schemaVersion: 1,
    revision: 0,
    records: [],
    requests: [],
    events: [],
    updatedAt: null,
  };
}

function normalizeRegistry(value) {
  if (!isObject(value) || value.schemaVersion !== 1)
    throw new Error('Unsupported acceptance cases registry');
  if (!Number.isInteger(value.revision) || value.revision < 0)
    throw new Error('acceptance cases registry revision is invalid');
  if (!Array.isArray(value.records) || value.records.length > MAX_RECORDS)
    throw new Error('acceptance cases registry records are invalid');
  const records = value.records.map(storedRecord);
  if (new Set(records.map(record => record.id)).size !== records.length)
    throw new Error('acceptance cases registry has duplicate IDs');
  const requests = Array.isArray(value.requests) ? value.requests.map(item => {
    if (!isObject(item)) throw new Error('acceptance cases request log is invalid');
    return {
      id: text(item.id, 'acceptance cases request id', { max: 200 }),
      hash: text(item.hash, 'acceptance cases request hash', { min: 64, max: 64 }),
      result: clone(item.result),
    };
  }) : [];
  if (requests.length > MAX_REQUESTS) throw new Error('acceptance cases request log is too large');
  const events = Array.isArray(value.events) ? value.events.map(item => {
    if (!isObject(item) || !Number.isInteger(item.revision) || item.revision < 1)
      throw new Error('acceptance cases event log is invalid');
    return {
      revision: item.revision,
      at: text(item.at, 'acceptance case event time', { max: 80 }),
      kind: text(item.kind, 'acceptance case event kind', { max: 80 }),
      subject: text(item.subject, 'acceptance case event subject', { max: 200 }),
    };
  }) : [];
  if (events.length > MAX_EVENTS) throw new Error('acceptance cases event log is too large');
  return {
    schemaVersion: 1,
    revision: value.revision,
    records,
    requests,
    events,
    updatedAt: value.updatedAt === null || value.updatedAt === undefined ? null : text(value.updatedAt, 'acceptance cases updatedAt', { max: 80 }),
  };
}

function readRegistry(root) {
  const file = registryPath(root);
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_BYTES)
    throw new Error(acceptanceCasesPath + ' must be a file <=64 KiB');
  try {
    return normalizeRegistry(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    throw new Error(acceptanceCasesPath + ' is invalid: ' + error.message);
  }
}

function registryDescriptor(registry) {
  return {
    schemaVersion: 1,
    path: acceptanceCasesPath,
    revision: registry.revision,
    fingerprint: digest({
      schemaVersion: 1,
      revision: registry.revision,
      records: registry.records.map(record => ({
        id: record.id,
        featureId: record.featureId,
        title: record.title,
        detail: record.detail,
        evidenceHints: record.evidenceHints,
        status: record.status,
        statusReason: record.statusReason,
        revision: record.revision,
      })),
    }),
    records: clone(registry.records),
    updatedAt: registry.updatedAt,
  };
}

export function readFeatureAcceptanceCases(root) {
  const registry = readRegistry(root);
  return registry ? registryDescriptor(registry) : null;
}

function featureExists(root, featureId) {
  const file = featureMapPath(root);
  if (!fs.existsSync(file)) throw new Error('Feature map is missing; create/apply a feature map before recording acceptance cases');
  const map = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!(map.features ?? []).some(feature => feature.id === featureId))
    throw new Error('Acceptance case references unknown feature: ' + featureId);
}

function pageRecord(record) {
  return {
    id: record.id,
    featureId: record.featureId,
    title: record.title,
    detail: record.detail,
    evidenceHints: [...record.evidenceHints],
    status: record.status,
    origin: record.origin,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    statusReason: record.statusReason ?? null,
  };
}

function snapshotRecord(record) {
  return {
    id: record.id,
    title: record.title,
    detail: record.detail,
    evidenceHints: [...record.evidenceHints],
    revision: record.revision,
    origin: record.origin,
  };
}

// Delivery creation freezes a per-feature snapshot. Later AC revisions only
// affect later delivery runs or tasks, never a task already planned.
export function freezeFeatureAcceptanceCases(root, featureIds = []) {
  const registry = readFeatureAcceptanceCases(root);
  const active = registry?.records.filter(record => record.status === 'active') ?? [];
  return Object.fromEntries(
    [...new Set(featureIds)].map(featureId => {
      const cases = active
        .filter(record => record.featureId === featureId)
        .map(snapshotRecord)
        .sort((left, right) => left.id.localeCompare(right.id));
      return [featureId, {
        schemaVersion: 1,
        kind: 'feature-acceptance-snapshot',
        featureId,
        registryRevision: registry?.revision ?? 0,
        cases,
        fingerprint: digest({ featureId, cases }),
      }];
    }),
  );
}

export function applyFeatureAcceptanceCases(stages, snapshot) {
  const cases = snapshot?.cases ?? [];
  return (stages ?? []).map(stage => {
    const copy = clone(stage);
    if (copy.id !== 'end_to_end_acceptance' || !cases.length) return copy;
    const base = copy.acceptanceCriteria ?? [];
    copy.acceptanceCriteria = [
      ...base,
      ...cases.map(item => ({
        id: item.id,
        title: item.title,
        detail: item.detail,
        evidenceHints: item.evidenceHints,
        origin: 'feature-acceptance-case',
        revision: item.revision,
      })),
    ];
    copy.featureAcceptanceSnapshot = {
      featureId: snapshot.featureId,
      registryRevision: snapshot.registryRevision,
      fingerprint: snapshot.fingerprint,
    };
    return copy;
  });
}

export function acceptanceCasesPage(root, options = {}) {
  const cursor = Number(options.cursor ?? 0);
  const limit = Number(options.limit ?? 20);
  if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new Error('Invalid acceptance cases page');
  const registry = readFeatureAcceptanceCases(root);
  if (cursor > 0 && (!registry || options.fingerprint !== registry.fingerprint))
    throw new Error('Acceptance cases changed; restart at cursor 0');
  let records = registry?.records ?? [];
  if (options.id) records = records.filter(record => record.id === options.id);
  if (options.feature) records = records.filter(record => record.featureId === options.feature);
  if (options.status) records = records.filter(record => record.status === options.status);
  return boundedPage(records.slice(cursor, cursor + limit).map(record => ({
    type: 'acceptance-case',
    id: record.id,
    status: record.status,
    record: pageRecord(record),
  })), {
    cursor,
    nextCursor: cursor + limit < records.length ? cursor + limit : null,
    revision: registry?.revision ?? 0,
    maxBytes: options.maxBytes,
    metadata: {
      recorded: Boolean(registry),
      path: acceptanceCasesPath,
      fingerprint: registry?.fingerprint ?? null,
      activeCount: records.filter(record => record.status === 'active').length,
      updatedAt: registry?.updatedAt ?? null,
    },
  });
}

function readOptions(args) {
  const options = {};
  const allowed = new Set(['cursor', 'limit', 'fingerprint', 'id', 'feature', 'status', 'max-bytes']);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--json') continue;
    const name = args[index].startsWith('--') ? args[index].slice(2) : '';
    if (!allowed.has(name) || !args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error('Invalid acceptance cases option');
    options[name.replace(/-([a-z])/g, (_, character) => character.toUpperCase())] = args[++index];
  }
  return options;
}

function mutationOptions(args, allowed) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--json') continue;
    const name = args[index].startsWith('--') ? args[index].slice(2) : '';
    if (!allowed.has(name) || !args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error('Invalid acceptance cases mutation option');
    options[name.replace(/-([a-z])/g, (_, character) => character.toUpperCase())] = args[++index];
  }
  return options;
}

function jsonInput(root, input) {
  if (!input) throw new Error('--input JSON file required');
  const file = path.resolve(root, input);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('--input file <=64 KiB required');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function withLock(root, action) {
  const file = registryPath(root);
  const lock = file + '.lock';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let descriptor;
  try {
    descriptor = fs.openSync(lock, 'wx');
  } catch {
    throw new Error('Acceptance cases registry is busy; retry');
  }
  try {
    return action();
  } finally {
    try { fs.closeSync(descriptor); } catch {}
    fs.rmSync(lock, { force: true });
  }
}

function writeRegistry(root, registry) {
  const file = registryPath(root);
  const content = json(registry, null, 2) + '\n';
  if (Buffer.byteLength(content) > MAX_BYTES)
    throw new Error('acceptance cases registry exceeds 64 KiB');
  const temporary = file + '.' + process.pid + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function mutate(root, kind, options, payload, apply) {
  const requestId = text(options.requestId, 'request-id', { max: 200 });
  if (!Number.isInteger(Number(options.expectedRevision)))
    throw new Error('expected-revision must be an integer');
  return withLock(root, () => {
    const registry = readRegistry(root) ?? blankRegistry();
    const requestHash = digest({ kind, payload });
    const prior = registry.requests.find(item => item.id === requestId);
    if (prior) {
      if (prior.hash !== requestHash) throw new Error('Request ID reused with different payload');
      return prior.result;
    }
    if (Number(options.expectedRevision) !== registry.revision)
      throw new Error('Acceptance cases revision conflict; expected-revision must be ' + registry.revision);
    const at = now();
    const outcome = apply(registry, at);
    registry.revision += 1;
    registry.updatedAt = at;
    const result = {
      ...outcome,
      registryRevision: registry.revision,
      fingerprint: registryDescriptor(registry).fingerprint,
    };
    registry.events = [...registry.events, {
      revision: registry.revision,
      at,
      kind,
      subject: outcome.id,
    }].slice(-MAX_EVENTS);
    registry.requests = [...registry.requests, {
      id: requestId,
      hash: requestHash,
      result: clone(result),
    }].slice(-MAX_REQUESTS);
    writeRegistry(root, registry);
    return result;
  });
}

function add(root, args) {
  const options = mutationOptions(args, new Set(['input', 'request-id', 'expected-revision']));
  const input = jsonInput(root, options.input);
  return mutate(root, 'acceptance_case_added', options, input, (registry, at) => {
    const record = inputRecord(input, { at });
    featureExists(root, record.featureId);
    if (registry.records.some(item => item.id === record.id))
      throw new Error('Acceptance case ID already exists');
    registry.records.push(record);
    registry.records.sort((left, right) => left.id.localeCompare(right.id));
    return { id: record.id, action: 'added', record: pageRecord(record) };
  });
}

function revise(root, args) {
  const options = mutationOptions(args, new Set(['id', 'input', 'request-id', 'expected-revision']));
  const id = caseId(options.id);
  const input = jsonInput(root, options.input);
  return mutate(root, 'acceptance_case_revised', options, { id, input }, (registry, at) => {
    const index = registry.records.findIndex(record => record.id === id);
    if (index < 0) throw new Error('Acceptance case not found');
    const record = inputRecord(input, { existing: registry.records[index], at });
    featureExists(root, record.featureId);
    registry.records[index] = record;
    return { id: record.id, action: 'revised', record: pageRecord(record) };
  });
}

function withdraw(root, args) {
  const options = mutationOptions(args, new Set(['id', 'reason', 'request-id', 'expected-revision']));
  const id = caseId(options.id);
  return mutate(root, 'acceptance_case_withdrawn', options, { id, reason: options.reason ?? null }, (registry, at) => {
    const index = registry.records.findIndex(record => record.id === id);
    if (index < 0) throw new Error('Acceptance case not found');
    const previous = registry.records[index];
    const record = {
      ...previous,
      status: 'withdrawn',
      statusReason: optionalText(options.reason, 'withdraw reason'),
      revision: previous.revision + 1,
      updatedAt: at,
      history: [...previous.history, recordVersion(previous)],
    };
    registry.records[index] = record;
    return { id: record.id, action: 'withdrawn', record: pageRecord(record) };
  });
}

export function acceptanceCaseCommand(root, args) {
  const [action, ...rest] = args;
  if (!action || action === 'list' || action === 'status' || action.startsWith('--'))
    return acceptanceCasesPage(root, readOptions(action && !action.startsWith('--') ? rest : args));
  if (action === 'add') return add(root, rest);
  if (action === 'revise') return revise(root, rest);
  if (action === 'withdraw') return withdraw(root, rest);
  throw new Error('Unknown feature acceptance command');
}

export function featureAcceptance() {
  try {
    const result = acceptanceCaseCommand(process.cwd(), process.argv.slice(4));
    process.stdout.write(json(result) + '\n');
  } catch (error) {
    process.stderr.write(json({ error: String(error.message).slice(0, 700) }) + '\n');
    process.exitCode = 1;
  }
}
