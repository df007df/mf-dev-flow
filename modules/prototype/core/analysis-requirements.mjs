import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { boundedPage } from './paging.js';
import { storePath } from '../../skill-identity.mjs';

// Analysis requirements are durable records. The former Markdown file remains
// readable as an unclassified legacy source only; it is never auto-applied to a
// new analysis batch.
export const requirementsPath = storePath('prototype', 'analysis-requirements.json');
export const legacyRequirementsPath = storePath('prototype', 'analysis-requirements.md');
export const analysisRequirementsSchemaVersion = 1;

const MAX_REGISTRY_BYTES = 65536;
const MAX_LEGACY_BYTES = 16384;
const MAX_RECORDS = 200;
const MAX_HISTORY = 100;
const MAX_REQUESTS = 200;
const MAX_EVENTS = 300;
const statuses = new Set(['active', 'superseded', 'withdrawn']);
const sourceTypes = new Set(['html', 'runtime']);
const modes = new Set(['full', 'partial']);
const json = JSON.stringify;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(json(value));
const registryFile = root => path.join(path.resolve(root), requirementsPath);
const legacyFile = root => path.join(path.resolve(root), legacyRequirementsPath);
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isObject(value)) return '{' + Object.keys(value).sort().map(key => json(key) + ':' + canonical(value[key])).join(',') + '}';
  return json(value);
}

const fingerprint = value => hashBytes(Buffer.from(canonical(value)));
const now = () => new Date().toISOString();

function text(value, name, { min = 1, max = 4000 } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max)
    throw new Error(name + ' must be text of ' + min + '..' + max + ' characters');
  return value.trim();
}

function optionalText(value, name, max = 800) {
  if (value === undefined || value === null || value === '') return null;
  return text(value, name, { max });
}

function id(value) {
  if (typeof value !== 'string' || !/^AR-[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value))
    throw new Error('Analysis requirement id must match AR-<identifier>');
  return value;
}

function uniqueTextList(value, name, { maxItems = 20, maxLength = 200, allowed = null } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems)
    throw new Error(name + ' must be an array with at most ' + maxItems + ' items');
  const values = value.map(item => text(item, name + ' item', { max: maxLength }));
  if (allowed && values.some(item => !allowed.has(item)))
    throw new Error(name + ' contains an unsupported value');
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function normalizeScope(value) {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new Error('analysis requirement scope must be an object');
  const allowed = new Set(['sourceTypes', 'modes', 'labels']);
  for (const key of Object.keys(value)) if (!allowed.has(key))
    throw new Error('analysis requirement scope field is unsupported: ' + key);
  const scope = {};
  const scopedSourceTypes = uniqueTextList(value.sourceTypes, 'scope.sourceTypes', { maxItems: 2, maxLength: 20, allowed: sourceTypes });
  const scopedModes = uniqueTextList(value.modes, 'scope.modes', { maxItems: 2, maxLength: 20, allowed: modes });
  const labels = uniqueTextList(value.labels, 'scope.labels', { maxItems: 20, maxLength: 120 });
  if (scopedSourceTypes.length) scope.sourceTypes = scopedSourceTypes;
  if (scopedModes.length) scope.modes = scopedModes;
  if (labels.length) scope.labels = labels;
  return scope;
}

function recordVersion(record) {
  return {
    revision: record.revision,
    at: record.updatedAt,
    title: record.title,
    instruction: record.instruction,
    scope: clone(record.scope),
    evidenceHints: [...record.evidenceHints],
    status: record.status,
    statusReason: record.statusReason ?? null,
  };
}

function storedRecord(value) {
  if (!isObject(value)) throw new Error('analysis requirement record must be an object');
  const record = {
    id: id(value.id),
    title: text(value.title, 'analysis requirement title', { max: 200 }),
    instruction: text(value.instruction, 'analysis requirement instruction', { max: 4000 }),
    scope: normalizeScope(value.scope),
    evidenceHints: uniqueTextList(value.evidenceHints, 'analysis requirement evidenceHints', { maxItems: 12, maxLength: 500 }),
    status: text(value.status, 'analysis requirement status', { max: 20 }),
    origin: value.origin === 'legacy-classified' ? 'legacy-classified' : value.origin === 'user' ? 'user' : null,
    revision: Number(value.revision),
    createdAt: text(value.createdAt, 'analysis requirement createdAt', { max: 80 }),
    updatedAt: text(value.updatedAt, 'analysis requirement updatedAt', { max: 80 }),
    history: Array.isArray(value.history) ? clone(value.history) : [],
    statusReason: optionalText(value.statusReason, 'analysis requirement statusReason', 800),
  };
  if (!statuses.has(record.status)) throw new Error('analysis requirement status is unsupported');
  if (!record.origin) throw new Error('analysis requirement origin is unsupported');
  if (!Number.isInteger(record.revision) || record.revision < 1) throw new Error('analysis requirement revision must be positive');
  if (record.history.length > MAX_HISTORY) throw new Error('analysis requirement history is too large');
  return record;
}

function inputRecord(value, { existing = null, at = now(), origin = null } = {}) {
  if (!isObject(value)) throw new Error('analysis requirement input must be an object');
  const allowed = new Set(['id', 'title', 'instruction', 'scope', 'evidenceHints', 'status', 'statusReason']);
  for (const key of Object.keys(value)) if (!allowed.has(key))
    throw new Error('analysis requirement input field is unsupported: ' + key);
  if (existing && value.id !== undefined && value.id !== existing.id)
    throw new Error('analysis requirement id cannot change');
  const next = {
    id: id(existing?.id ?? value.id),
    title: text(value.title ?? existing?.title, 'analysis requirement title', { max: 200 }),
    instruction: text(value.instruction ?? existing?.instruction, 'analysis requirement instruction', { max: 4000 }),
    scope: value.scope === undefined ? clone(existing?.scope ?? {}) : normalizeScope(value.scope),
    evidenceHints: value.evidenceHints === undefined
      ? [...(existing?.evidenceHints ?? [])]
      : uniqueTextList(value.evidenceHints, 'analysis requirement evidenceHints', { maxItems: 12, maxLength: 500 }),
    status: value.status === undefined ? existing?.status ?? 'active' : text(value.status, 'analysis requirement status', { max: 20 }),
    origin: origin ?? existing?.origin ?? 'user',
    revision: (existing?.revision ?? 0) + 1,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    history: existing ? [...existing.history, recordVersion(existing)] : [],
    statusReason: value.statusReason === undefined
      ? existing?.statusReason ?? null
      : optionalText(value.statusReason, 'analysis requirement statusReason', 800),
  };
  if (!statuses.has(next.status)) throw new Error('analysis requirement status is unsupported');
  if (next.history.length > MAX_HISTORY) throw new Error('analysis requirement history is too large');
  return next;
}

function normalizeLegacy(value) {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) throw new Error('analysis requirements legacy metadata must be an object');
  const disposition = text(value.disposition, 'legacy disposition', { max: 30 });
  if (!['unclassified', 'classified', 'excluded'].includes(disposition))
    throw new Error('legacy disposition is unsupported');
  return {
    path: legacyRequirementsPath,
    fingerprint: text(value.fingerprint, 'legacy fingerprint', { min: 64, max: 64 }),
    disposition,
    classifiedAt: optionalText(value.classifiedAt, 'legacy classifiedAt', 80),
    note: optionalText(value.note, 'legacy note', 800),
  };
}

function blankRegistry(legacy = null) {
  return {
    schemaVersion: analysisRequirementsSchemaVersion,
    revision: 0,
    records: [],
    requests: [],
    events: [],
    legacy,
    updatedAt: null,
  };
}

function normalizeRegistry(value) {
  if (!isObject(value) || value.schemaVersion !== analysisRequirementsSchemaVersion)
    throw new Error('Unsupported analysis requirements registry');
  if (!Number.isInteger(value.revision) || value.revision < 0)
    throw new Error('analysis requirements registry revision is invalid');
  if (!Array.isArray(value.records) || value.records.length > MAX_RECORDS)
    throw new Error('analysis requirements registry records are invalid');
  const records = value.records.map(storedRecord);
  if (new Set(records.map(record => record.id)).size !== records.length)
    throw new Error('analysis requirements registry has duplicate IDs');
  const requests = Array.isArray(value.requests) ? value.requests.map(item => {
    if (!isObject(item)) throw new Error('analysis requirements request log is invalid');
    return {
      id: text(item.id, 'analysis requirements request id', { max: 200 }),
      hash: text(item.hash, 'analysis requirements request hash', { min: 64, max: 64 }),
      result: clone(item.result),
    };
  }) : [];
  if (requests.length > MAX_REQUESTS) throw new Error('analysis requirements request log is too large');
  const events = Array.isArray(value.events) ? value.events.map(item => {
    if (!isObject(item) || !Number.isInteger(item.revision) || item.revision < 1)
      throw new Error('analysis requirements event log is invalid');
    return {
      revision: item.revision,
      at: text(item.at, 'analysis requirements event time', { max: 80 }),
      kind: text(item.kind, 'analysis requirements event kind', { max: 80 }),
      subject: text(item.subject, 'analysis requirements event subject', { max: 200 }),
    };
  }) : [];
  if (events.length > MAX_EVENTS) throw new Error('analysis requirements event log is too large');
  return {
    schemaVersion: analysisRequirementsSchemaVersion,
    revision: value.revision,
    records,
    requests,
    events,
    legacy: normalizeLegacy(value.legacy),
    updatedAt: value.updatedAt === null || value.updatedAt === undefined ? null : text(value.updatedAt, 'analysis requirements updatedAt', { max: 80 }),
  };
}

function readRegistry(root) {
  const file = registryFile(root);
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_REGISTRY_BYTES)
    throw new Error(requirementsPath + ' must be a file <=64 KiB');
  try {
    return normalizeRegistry(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    throw new Error(requirementsPath + ' is invalid: ' + error.message);
  }
}

function readLegacy(root) {
  const file = legacyFile(root);
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_LEGACY_BYTES)
    throw new Error(legacyRequirementsPath + ' must be a file <=16 KiB');
  const bytes = fs.readFileSync(file);
  const content = bytes.toString('utf8');
  if (!content.trim())
    throw new Error(legacyRequirementsPath + ' must not be empty; remove it to clear legacy material');
  return {
    path: legacyRequirementsPath,
    fingerprint: hashBytes(bytes),
    text: content,
    updatedAt: stat.mtime.toISOString(),
  };
}

function registryDescriptor(registry, legacy) {
  const pendingLegacy = registry.legacy ?? (legacy ? {
    path: legacyRequirementsPath,
    fingerprint: legacy.fingerprint,
    disposition: 'unclassified',
    classifiedAt: null,
    note: null,
  } : null);
  return {
    schemaVersion: analysisRequirementsSchemaVersion,
    path: requirementsPath,
    origin: 'registry',
    revision: registry.revision,
    fingerprint: fingerprint({
      schemaVersion: analysisRequirementsSchemaVersion,
      revision: registry.revision,
      records: registry.records.map(record => ({
        id: record.id,
        title: record.title,
        instruction: record.instruction,
        scope: record.scope,
        evidenceHints: record.evidenceHints,
        status: record.status,
        statusReason: record.statusReason,
        revision: record.revision,
      })),
    }),
    records: clone(registry.records),
    legacy: pendingLegacy,
    updatedAt: registry.updatedAt,
  };
}

// This read is safe before a catalog exists and never creates the registry.
export function readAnalysisRequirements(root) {
  const registry = readRegistry(root);
  const legacy = readLegacy(root);
  if (registry) return registryDescriptor(registry, legacy);
  if (!legacy) return null;
  return {
    schemaVersion: 0,
    path: legacyRequirementsPath,
    origin: 'legacy-markdown',
    fingerprint: legacy.fingerprint,
    revision: null,
    records: [],
    legacy: {
      path: legacyRequirementsPath,
      fingerprint: legacy.fingerprint,
      disposition: 'unclassified',
      classifiedAt: null,
      note: null,
    },
    updatedAt: legacy.updatedAt,
  };
}

function recordSnapshot(record) {
  return {
    id: record.id,
    title: record.title,
    instruction: record.instruction,
    scope: clone(record.scope),
    evidenceHints: [...record.evidenceHints],
    revision: record.revision,
    origin: record.origin,
  };
}

function applies(record, { sourceType, mode, labels = [] }) {
  const scope = record.scope ?? {};
  if (scope.sourceTypes?.length && !scope.sourceTypes.includes(sourceType)) return false;
  if (scope.modes?.length && !scope.modes.includes(mode)) return false;
  if (scope.labels?.length && !scope.labels.every(label => labels.includes(label))) return false;
  return true;
}

// New batches freeze selected active records. Registry changes are intentionally
// not a freshness condition for existing snapshots.
export function resolveAnalysisRequirements(root, { sourceType, mode, ids = null, labels = [] } = {}) {
  if (!sourceTypes.has(sourceType)) throw new Error('analysis requirement source type is unsupported');
  if (!modes.has(mode)) throw new Error('analysis requirement mode is unsupported');
  const selectedIds = ids === null || ids === undefined ? null : uniqueTextList(ids, 'analysis requirement IDs', { maxItems: MAX_RECORDS, maxLength: 84 });
  if (selectedIds?.some(value => !/^AR-[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value)))
    throw new Error('analysis requirement IDs must use AR- identifiers');
  const selectedLabels = uniqueTextList(labels, 'analysis requirement labels', { maxItems: 20, maxLength: 120 });
  const descriptor = readAnalysisRequirements(root);
  const active = descriptor?.origin === 'registry'
    ? descriptor.records.filter(record => record.status === 'active')
    : [];
  const byId = new Map(active.map(record => [record.id, record]));
  const candidates = selectedIds === null ? active : selectedIds.map(value => {
    const record = byId.get(value);
    if (!record) throw new Error('Selected analysis requirement is not active: ' + value);
    return record;
  });
  const rejected = selectedIds === null
    ? []
    : candidates.filter(record => !applies(record, { sourceType, mode, labels: selectedLabels }));
  if (rejected.length)
    throw new Error('Selected analysis requirement does not apply to this batch: ' + rejected.map(record => record.id).join(', '));
  const records = candidates
    .filter(record => applies(record, { sourceType, mode, labels: selectedLabels }))
    .map(recordSnapshot)
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: analysisRequirementsSchemaVersion,
    kind: 'analysis-requirements-snapshot',
    origin: 'frozen-registry',
    registryRevision: descriptor?.origin === 'registry' ? descriptor.revision : null,
    selection: {
      mode: selectedIds === null ? 'default-active' : 'explicit',
      ids: selectedIds,
      labels: selectedLabels,
    },
    records,
    fingerprint: fingerprint({ schemaVersion: analysisRequirementsSchemaVersion, records }),
    legacyUnclassified: descriptor?.legacy?.disposition === 'unclassified'
      ? { path: descriptor.legacy.path, fingerprint: descriptor.legacy.fingerprint }
      : null,
  };
}

export function requirementsBrief(requirements) {
  if (!requirements) return null;
  if (requirements.kind === 'analysis-requirements-snapshot') {
    return {
      schemaVersion: requirements.schemaVersion,
      kind: requirements.kind,
      origin: requirements.origin,
      fingerprint: requirements.fingerprint,
      registryRevision: requirements.registryRevision,
      selection: requirements.selection,
      recordCount: requirements.records?.length ?? 0,
      recordIds: (requirements.records ?? []).map(record => record.id),
      legacyUnclassified: requirements.legacyUnclassified ?? null,
      readBeforeTraversal: true,
    };
  }
  if (requirements.origin === 'legacy-markdown') {
    return {
      schemaVersion: 0,
      path: requirements.path,
      origin: requirements.origin,
      fingerprint: requirements.fingerprint,
      recordCount: 0,
      activeCount: 0,
      legacy: requirements.legacy,
      readBeforeTraversal: false,
    };
  }
  const records = requirements.records ?? [];
  return {
    schemaVersion: requirements.schemaVersion,
    path: requirements.path,
    origin: requirements.origin,
    revision: requirements.revision,
    fingerprint: requirements.fingerprint,
    recordCount: records.length,
    activeCount: records.filter(record => record.status === 'active').length,
    recordIds: records.map(record => record.id),
    legacy: requirements.legacy ?? null,
    updatedAt: requirements.updatedAt ?? null,
    readBeforeTraversal: true,
  };
}

// Kept for compatibility with older callers. A registry revision is not a
// source-freshness signal; every batch has its own frozen requirement snapshot.
export function requirementsChanged() {
  return false;
}

function pageRecord(record) {
  return {
    id: record.id,
    title: record.title,
    instruction: record.instruction,
    scope: clone(record.scope),
    evidenceHints: [...record.evidenceHints],
    status: record.status,
    origin: record.origin,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    statusReason: record.statusReason ?? null,
  };
}

export function analysisRequirementsPage(root, options = {}) {
  const cursor = Number(options.cursor ?? 0);
  const limit = Number(options.limit ?? 20);
  if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new Error('Invalid analysis requirements page');
  const requirements = readAnalysisRequirements(root);
  if (cursor > 0 && (!requirements || options.fingerprint !== requirements.fingerprint))
    throw new Error('Analysis requirements changed; restart at cursor 0');
  let records = requirements?.records ?? [];
  if (options.id) records = records.filter(record => record.id === options.id);
  const metadata = {
    // A legacy Markdown file is visible only as unclassified compatibility
    // material. It is not an AR registry and must not look like one in the
    // dashboard or API status.
    recorded: requirements?.origin === 'registry',
    path: requirements?.path ?? requirementsPath,
    fingerprint: requirements?.fingerprint ?? null,
    origin: requirements?.origin ?? 'none',
    registryRevision: requirements?.revision ?? null,
    activeCount: records.filter(record => record.status === 'active').length,
    legacy: requirements?.legacy ?? null,
    updatedAt: requirements?.updatedAt ?? null,
  };
  const items = records.slice(cursor, cursor + limit).map(record => ({
    type: 'analysis-requirement',
    id: record.id,
    status: record.status,
    record: pageRecord(record),
  }));
  return boundedPage(items, {
    cursor,
    nextCursor: cursor + limit < records.length ? cursor + limit : null,
    revision: requirements?.revision ?? 0,
    maxBytes: options.maxBytes,
    metadata,
  });
}

export function analysisRequirementsArgs(args) {
  const options = {};
  const allowed = new Set(['cursor', 'fingerprint', 'limit', 'max-bytes', 'id']);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--json') continue;
    const name = args[index].startsWith('--') ? args[index].slice(2) : '';
    if (!allowed.has(name) || !args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error('Invalid analysis requirements option');
    options[name.replace(/-([a-z])/g, (_, character) => character.toUpperCase())] = args[++index];
  }
  return options;
}

function mutationArgs(args, allowed) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--json') continue;
    const name = args[index].startsWith('--') ? args[index].slice(2) : '';
    if (!allowed.has(name) || !args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error('Invalid analysis requirements mutation option');
    options[name.replace(/-([a-z])/g, (_, character) => character.toUpperCase())] = args[++index];
  }
  return options;
}

function jsonInput(root, input) {
  if (!input) throw new Error('--input JSON file required');
  const file = path.resolve(root, input);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_REGISTRY_BYTES)
    throw new Error('--input file <=64 KiB required');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function withRegistryLock(root, action) {
  const file = registryFile(root);
  const lock = file + '.lock';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let descriptor;
  try {
    descriptor = fs.openSync(lock, 'wx');
  } catch {
    throw new Error('Analysis requirements registry is busy; retry');
  }
  try {
    return action();
  } finally {
    try { fs.closeSync(descriptor); } catch {}
    fs.rmSync(lock, { force: true });
  }
}

function writeRegistry(root, registry) {
  const file = registryFile(root);
  const content = json(registry, null, 2) + '\n';
  if (Buffer.byteLength(content) > MAX_REGISTRY_BYTES)
    throw new Error('analysis requirements registry exceeds 64 KiB');
  const temporary = file + '.' + process.pid + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function mutation(root, kind, options, payload, apply) {
  const requestId = text(options.requestId, 'request-id', { max: 200 });
  if (!Number.isInteger(Number(options.expectedRevision)))
    throw new Error('expected-revision must be an integer');
  return withRegistryLock(root, () => {
    const legacy = readLegacy(root);
    const registry = readRegistry(root) ?? blankRegistry(legacy ? {
      path: legacyRequirementsPath,
      fingerprint: legacy.fingerprint,
      disposition: 'unclassified',
      classifiedAt: null,
      note: null,
    } : null);
    const requestHash = fingerprint({ kind, payload });
    const prior = registry.requests.find(item => item.id === requestId);
    if (prior) {
      if (prior.hash !== requestHash) throw new Error('Request ID reused with different payload');
      return prior.result;
    }
    if (Number(options.expectedRevision) !== registry.revision)
      throw new Error('Analysis requirements revision conflict; expected-revision must be ' + registry.revision);
    const at = now();
    const outcome = apply(registry, at);
    registry.revision += 1;
    registry.updatedAt = at;
    const result = {
      ...outcome,
      registryRevision: registry.revision,
      fingerprint: registryDescriptor(registry, legacy).fingerprint,
    };
    registry.events = [...registry.events, {
      revision: registry.revision,
      at,
      kind,
      subject: outcome.id ?? 'legacy',
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

function addRequirement(root, args) {
  const options = mutationArgs(args, new Set(['input', 'request-id', 'expected-revision']));
  const input = jsonInput(root, options.input);
  return mutation(root, 'analysis_requirement_added', options, input, (registry, at) => {
    const record = inputRecord(input, { at });
    if (registry.records.some(item => item.id === record.id))
      throw new Error('Analysis requirement ID already exists');
    registry.records.push(record);
    registry.records.sort((left, right) => left.id.localeCompare(right.id));
    return { id: record.id, action: 'added', record: pageRecord(record) };
  });
}

function reviseRequirement(root, args) {
  const options = mutationArgs(args, new Set(['id', 'input', 'request-id', 'expected-revision']));
  const recordId = id(options.id);
  const input = jsonInput(root, options.input);
  return mutation(root, 'analysis_requirement_revised', options, { id: recordId, input }, (registry, at) => {
    const index = registry.records.findIndex(item => item.id === recordId);
    if (index < 0) throw new Error('Analysis requirement not found');
    const record = inputRecord(input, { existing: registry.records[index], at });
    registry.records[index] = record;
    return { id: record.id, action: 'revised', record: pageRecord(record) };
  });
}

function withdrawRequirement(root, args) {
  const options = mutationArgs(args, new Set(['id', 'reason', 'request-id', 'expected-revision']));
  const recordId = id(options.id);
  return mutation(root, 'analysis_requirement_withdrawn', options, { id: recordId, reason: options.reason ?? null }, (registry, at) => {
    const index = registry.records.findIndex(item => item.id === recordId);
    if (index < 0) throw new Error('Analysis requirement not found');
    const previous = registry.records[index];
    const record = {
      ...previous,
      status: 'withdrawn',
      statusReason: optionalText(options.reason, 'withdraw reason', 800),
      revision: previous.revision + 1,
      updatedAt: at,
      history: [...previous.history, recordVersion(previous)],
    };
    if (record.history.length > MAX_HISTORY) throw new Error('analysis requirement history is too large');
    registry.records[index] = record;
    return { id: record.id, action: 'withdrawn', record: pageRecord(record) };
  });
}

function migrateLegacy(root, args) {
  const options = mutationArgs(args, new Set(['input', 'request-id', 'expected-revision']));
  const manifest = jsonInput(root, options.input);
  if (!isObject(manifest) || manifest.schemaVersion !== 1 || !['classified', 'excluded'].includes(manifest.disposition))
    throw new Error('Legacy classification manifest requires schemaVersion 1 and disposition classified or excluded');
  const legacy = readLegacy(root);
  if (!legacy) throw new Error('No legacy analysis requirements Markdown exists');
  if (manifest.legacyFingerprint !== legacy.fingerprint)
    throw new Error('Legacy analysis requirements changed; refresh the explicit classification manifest');
  if (!Array.isArray(manifest.records) || manifest.records.length > MAX_RECORDS)
    throw new Error('Legacy classification manifest records are invalid');
  if (manifest.disposition === 'classified' && manifest.records.length === 0)
    throw new Error('Classified legacy material requires one or more explicit AR records');
  if (manifest.disposition === 'excluded' && manifest.records.length)
    throw new Error('Excluded legacy material cannot create AR records');
  const note = optionalText(manifest.note, 'legacy classification note', 800);
  return mutation(root, 'legacy_analysis_requirements_classified', options, manifest, (registry, at) => {
    if (registry.legacy?.disposition && registry.legacy.disposition !== 'unclassified')
      throw new Error('Legacy analysis requirements were already classified');
    const records = manifest.records.map(record => inputRecord(record, { at, origin: 'legacy-classified' }));
    const IDs = new Set([...registry.records.map(record => record.id), ...records.map(record => record.id)]);
    if (IDs.size !== registry.records.length + records.length)
      throw new Error('Legacy classification has duplicate AR IDs');
    registry.records.push(...records);
    registry.records.sort((left, right) => left.id.localeCompare(right.id));
    registry.legacy = {
      path: legacyRequirementsPath,
      fingerprint: legacy.fingerprint,
      disposition: manifest.disposition,
      classifiedAt: at,
      note,
    };
    return {
      id: 'legacy',
      action: 'legacy_' + manifest.disposition,
      importedIds: records.map(record => record.id),
      legacy: clone(registry.legacy),
    };
  });
}

export function analysisRequirementsCommand(root, args) {
  const [action, ...rest] = args;
  if (!action || action === 'list' || action === 'status' || action.startsWith('--'))
    return analysisRequirementsPage(root, analysisRequirementsArgs(action && !action.startsWith('--') ? rest : args));
  if (action === 'add') return addRequirement(root, rest);
  if (action === 'revise') return reviseRequirement(root, rest);
  if (action === 'withdraw') return withdrawRequirement(root, rest);
  if (action === 'migrate-legacy') return migrateLegacy(root, rest);
  throw new Error('Unknown analysis requirements command');
}
