import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { digest, discoverPrototypeSource, EXTRACTOR_REVISION } from './html-source.js';
import { graphProblems } from './graph-audit.js';
import { requirementsBrief } from './analysis-requirements.mjs';
import { normalizeRuntimeSource, runtimeSourceMap } from './runtime-source.mjs';
import { assertWorkflowCommand, initialWorkflowState, workflowBrief, workflowSummary } from './workflow.mjs';

export const CONTRACT_VERSION = 1;
export const TYPES = ['file', 'candidate', 'node', 'edge', 'space', 'vector', 'control', 'occurrence', 'sweep', 'entry', 'group', 'question', 'evidence'];
export const MAX_RECORD_BYTES = 65536;
const now = () => new Date().toISOString();
const json = value => JSON.stringify(value);
export const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${json(k)}:${canonical(value[k])}`).join(',')}}` : json(value);
const needed = (value, label) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} required`); return value; };
const inside = (root, file) => file.startsWith(root + path.sep);
const realDestination = destination => fs.existsSync(destination) ? fs.realpathSync(destination) : path.join(realDestination(path.dirname(destination)), path.basename(destination));
const short = value => String(value ?? '').slice(0, 200);
const doneStates = new Set(['covered', 'mapped', 'reviewed', 'excluded', 'resolved', 'complete', 'retired']);
const workTypes = new Set(['file', 'candidate', 'node', 'edge', 'space', 'vector', 'occurrence', 'sweep', 'entry']);
const identityOf = (type, item) => {
  if (type === 'control') return digest(canonical([item.locator, item.event, [...(item.sourceIds ?? [])].sort()]));
  if (type === 'occurrence') return digest(canonical([item.nodeId, item.controlId]));
  if (type === 'edge') return digest(canonical([item.from, item.controlId, item.action?.type, item.inputClass, item.outcomeKey]));
  return null;
};

export { boundedPage } from './paging.js';
import { boundedPage } from './paging.js';

export class AnalysisStore {
  constructor(directory, { readOnly = false } = {}) {
    this.directory = path.resolve(directory);
    if (!fs.existsSync(path.join(this.directory, 'index.sqlite'))) throw new Error('Analysis index missing; init first');
    this.db = new DatabaseSync(path.join(this.directory, 'index.sqlite'), { readOnly });
    this.db.exec('PRAGMA busy_timeout=5000');
    if (this.meta('schemaVersion') !== CONTRACT_VERSION) throw new Error('Unsupported analysis contract');
  }
  close() { this.db.close(); }
  meta(key) { const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key); return row && JSON.parse(row.value); }
  setMeta(key, value) { this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key, json(value)); }
  runtimeOnly() { return this.meta('evidenceProfile') === 'runtime-only'; }
  get(type, id) { const row = this.db.prepare('SELECT body,revision FROM records WHERE type=? AND id=?').get(type, id); return row ? { ...JSON.parse(row.body), revision: row.revision } : null; }
  *rows(type) { for (const row of this.db.prepare('SELECT type,id,body,revision FROM records WHERE type=? ORDER BY id').iterate(type)) yield { ...JSON.parse(row.body), revision: row.revision }; }
  rawPut(type, item, revision) {
    const body = { ...item }; delete body.revision; delete body.expectedRevision;
    this.db.prepare('INSERT INTO records(type,id,status,file,node,identity,body,revision) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET status=excluded.status,file=excluded.file,node=excluded.node,identity=excluded.identity,body=excluded.body,revision=excluded.revision').run(type, item.id, body.status ?? 'pending', body.file ?? '', body.nodeId ?? body.from ?? '', identityOf(type, body), json(body), revision);
  }
  source() { const bytes = fs.readFileSync(path.join(this.directory, 'source-map.json')); if (digest(bytes) !== this.meta('sourceMapHash')) throw new Error('Frozen source map changed'); return { bytes, map: JSON.parse(bytes) }; }
  freshness() {
    const { map } = this.source();
    const source = this.meta('source');
    if (source?.type === 'runtime') {
      const corruptedEvidence = [...this.rows('evidence')].some(evidence => !this.evidenceValid([evidence.id]));
      const changed = corruptedEvidence;
      return {
        fresh: !changed,
        changedFiles: [],
        extractorChanged: false,
        analysisRequirementsChanged: false,
        corruptedEvidence,
        sourceFreshness: 'declared-revision',
        invalidation: corruptedEvidence ? 'archived evidence changed; initialize a new batch' : 'none',
        metrics: {},
        current: map,
      };
    }
    const metrics = {};
    const current = discoverPrototypeSource({ ...this.meta('source'), metrics });
    const changedFiles = [];
    const before = new Map(map.sourceFiles.map(f => [f.path, f.sha256]));
    const after = new Map(current.sourceFiles.map(f => [f.path, f.sha256]));
    for (const f of new Set([...before.keys(), ...after.keys()])) if (before.get(f) !== after.get(f)) changedFiles.push(f);
    const extractorChanged = this.meta('extractorRevision') !== EXTRACTOR_REVISION;
    const changed = extractorChanged || ['origin', 'candidates', 'problems'].some(k => json(map[k]) !== json(current[k])) || changedFiles.length > 0;
    return { fresh: !changed, changedFiles, extractorChanged, analysisRequirementsChanged: false, invalidation: changed ? 'all-runtime: dependency graph is unknown; create a new snapshot/output' : 'none', metrics, current };
  }
  evidenceValid(ids) {
    return Array.isArray(ids) && ids.length > 0 && ids.every(id => {
      const e = this.get('evidence', id);
      if (!e || e.level !== 'observed' || e.snapshotId !== this.meta('snapshotId') || Date.parse(e.capturedAt) < Date.parse(this.meta('createdAt')) || e.assertion?.passed !== true) return false;
      return ['path', 'trace'].every(k => {
        const file = path.resolve(this.directory, e[k] ?? '');
        return inside(this.directory, file) && fs.existsSync(file) && fs.statSync(file).isFile() && inside(fs.realpathSync(this.directory), fs.realpathSync(file)) && digest(fs.readFileSync(file)) === e[`${k}Hash`];
      });
    });
  }
  effective(type, item, seen = new Set()) {
    const key = `${type}:${item.id}`;
    if (seen.has(key)) return 'pending';
    seen = new Set([...seen, key]);
    const all = (target, ids) => Array.isArray(ids) && ids.length > 0 && ids.every(id => { const r = this.get(target, id); return r && r.status !== 'retired' && doneStates.has(this.effective(target, r, seen)); });
    const status = item.status ?? 'pending';
    if (type === 'edge' && status === 'retired') return item.reason && item.reviewer && item.sourceIds?.length && item.sourceIds.every(id => this.get('candidate', id)) && !item.observedOnce && !item.evidenceIds?.length ? 'retired' : 'pending';
    if (['blocked', 'unavailable'].includes(status)) return status;
    if (type === 'file') {
      const candidates = this.db.prepare("SELECT body,revision FROM records WHERE type='candidate' AND file=?").all(item.path).map(r => ({ ...JSON.parse(r.body), revision: r.revision }));
      return candidates.length && candidates.every(c => doneStates.has(this.effective('candidate', c, seen))) ? 'complete' : status === 'reviewed' && !candidates.length ? 'reviewed' : 'pending';
    }
    if (type === 'candidate') {
      if (status === 'excluded' || item.kind === 'reference' && status === 'reviewed') return item.reason && item.reviewer && item.sourceIds?.length && item.sourceIds.every(id => this.get('candidate', id)) ? status : 'pending';
      if (status !== 'mapped') return status;
      if (item.kind === 'page') return all('node', item.nodeIds) ? 'mapped' : 'pending';
      if (item.kind === 'state') return all('space', item.stateSpaceIds) ? 'mapped' : 'pending';
      if (!all('edge', item.edgeIds)) return 'pending';
      if (item.kind === 'branch' && !item.outcomes.every(outcome => item.edgeIds.some(id => this.get('edge', id)?.candidateOutcomes?.[item.id] === outcome) || item.outcomeExclusions?.[outcome]?.reason && item.outcomeExclusions?.[outcome]?.reviewer && item.outcomeExclusions?.[outcome]?.sourceIds?.length)) return 'pending';
      return 'mapped';
    }
    if (['node', 'edge', 'vector', 'entry', 'sweep'].includes(type)) {
      if (!this.evidenceValid(item.evidenceIds)) return 'pending';
      if (type === 'node' && (!all('sweep', [item.id]) || !all('entry', item.entryIds))) return 'pending';
      if (type === 'edge' && (!this.get('node', item.from) || !this.get('node', item.to) || !this.get('control', item.controlId) || (!this.runtimeOnly() && (!item.sourceIds?.length || item.sourceIds.some(id => !this.get('candidate', id)))) || !['click', 'fill', 'select', 'check', 'press', 'scroll', 'drag', 'hover', 'long-press', 'back', 'navigate', 'wait'].includes(item.action?.type) || !item.action.target)) return 'pending';
      if (type === 'vector') {
        const space = this.get('space', item.spaceId), dims = Object.entries(space?.dimensions ?? {});
        if (!space || !item.resetAction || Object.keys(item.values ?? {}).length !== dims.length || dims.some(([key, values]) => !Array.isArray(values) || !values.includes(item.values[key]))) return 'pending';
      }
      if (type === 'sweep') {
        const occurrences = [...this.rows('occurrence')].filter(o => o.nodeId === item.nodeId);
        if (!item.complete || !Array.isArray(item.discoveryIds) || item.discoveryIds.some(id => this.get('occurrence', id)?.nodeId !== item.nodeId) || occurrences.some(o => !item.discoveryIds?.includes(o.id) || this.effective('occurrence', o, seen) !== 'covered')) return 'pending';
      }
      return status;
    }
    if (type === 'occurrence') return all('edge', item.edgeIds) && item.edgeIds.every(id => this.get('edge', id)?.from === item.nodeId && this.get('edge', id)?.controlId === item.controlId) ? 'covered' : 'pending';
    if (type === 'space') {
      const vectors = [...this.rows('vector')].filter(v => v.spaceId === item.id);
      const dimensions = Object.entries(item.dimensions ?? {});
      if (dimensions.some(([, values]) => !Array.isArray(values) || !values.length || new Set(values).size !== values.length || values.some(v => !['string', 'number', 'boolean'].includes(typeof v)))) return 'pending';
      const expected = dimensions.reduce((a, [, values]) => a * values.length, 1);
      const keys = new Set(vectors.filter(v => this.effective('vector', v, seen) === 'covered').map(v => canonical(v.values)));
      for (const r of item.reductions ?? []) if (r.reason && r.reviewer && r.sourceIds?.length && r.sourceIds.every(id => this.get('candidate', id)) && Object.keys(r.values ?? {}).length === dimensions.length && dimensions.every(([key, values]) => values.includes(r.values[key]))) keys.add(canonical(r.values));
      return keys.size === expected ? 'complete' : 'pending';
    }
    return status;
  }
  query(options = {}) {
    assertWorkflowCommand(this, { command: options.command ?? (options.next ? 'next' : 'query'), agent: options.agent });
    const freshness = this.freshness();
    if (options.next && !freshness.fresh) throw new Error('Snapshot stale: create a new output; prior runtime evidence is historical only');
    const { type, file, node, status, id, kind, detail = false, field, next = false } = options;
    const limit = Number(options.limit ?? 20), cursor = Number(options.cursor ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(cursor) || cursor < 0) throw new Error('limit 1..50 and nonnegative cursor required');
    if (cursor > 0 && options.revision === undefined) throw new Error('Nonzero cursor requires revision; next after completion should restart at cursor 0');
    if (type && !TYPES.includes(type)) throw new Error('Unknown type');
    const revision = this.meta('revision');
    if (options.revision !== undefined && Number(options.revision) !== revision) throw new Error('Index changed; restart pagination at cursor 0');
    const where = [], args = [];
    for (const [column, value] of Object.entries({ type, file, node, id })) if (value !== undefined) { where.push(`${column}=?`); args.push(value); }
    const stmt = this.db.prepare(`SELECT type,id,body,revision FROM records ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY type,id`);
    const items = []; let matched = 0, more = false;
    for (const row of stmt.iterate(...args)) {
      const r = { ...JSON.parse(row.body), revision: row.revision };
      if (kind && r.kind !== kind || next && !workTypes.has(row.type)) continue;
      const effective = this.effective(row.type, r);
      if (status && effective !== status || next && doneStates.has(effective)) continue;
      if (matched++ < cursor) continue;
      if (items.length === limit) { more = true; break; }
      let result = { type: row.type, id: r.id, revision: r.revision, status: freshness.fresh ? effective : 'stale', recordedStatus: r.status ?? 'pending' };
      if (field) {
        const text = json(field === 'record' ? r : r[field]) ?? 'null'; const offset = Number(options.textOffset ?? 0), length = Number(options.textLimit ?? 2048);
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 1 || length > 8192) throw new Error('text-offset >=0; text-limit 1..8192');
        result = { ...result, field, text: text.slice(offset, offset + length), nextTextOffset: offset + length < text.length ? offset + length : null, totalCharacters: text.length };
      } else if (detail) result.record = r;
      else {
        let evidenceIds = r.evidenceIds ?? [];
        if (row.type === 'file') {
          const pageCandidates = this.db.prepare("SELECT body FROM records WHERE type='candidate' AND file=?").all(r.path).map(c => JSON.parse(c.body));
          evidenceIds = [...new Set(pageCandidates.flatMap(c => (c.nodeIds ?? []).flatMap(id => this.get('node', id)?.evidenceIds ?? [])))];
        }
        result = { ...result, kind: r.kind, file: r.file ?? r.path, nodeId: r.nodeId ?? r.from, purpose: short(r.purpose ?? r.label ?? r.title ?? r.snippet ?? r.reason), evidenceIds: evidenceIds.slice(0, 3), evidenceCount: evidenceIds.length, analyzed: freshness.fresh && doneStates.has(effective), screenshot: freshness.fresh && this.evidenceValid(evidenceIds), ref: `index.sqlite#${row.type}/${r.id}` };
      }
      items.push(result);
    }
    return boundedPage(items, { maxBytes: options.maxBytes, cursor, nextCursor: more ? cursor + items.length : null, revision, metadata: { analysisRequirements: requirementsBrief(this.meta('scope')?.analysisRequirements), workflow: workflowBrief(this, { maxBytes: 2048 }).workflow } });
  }
  put(batch, requestId, context = {}) {
    needed(requestId, 'requestId'); if (requestId.length > 240) throw new Error('requestId too long');
    if (!Array.isArray(batch) || !batch.length || batch.length > 50 || Buffer.byteLength(json(batch)) > 1048576) throw new Error('Batch must contain 1..50 items, <=1 MiB');
    assertWorkflowCommand(this, { command: context.command ?? 'put', agent: context.agent, recordTypes: context.recordTypes ?? batch.map(item => item.type) });
    const hash = digest(canonical(batch));
    this.db.exec('SAVEPOINT put_records');
    try {
      const previous = this.db.prepare('SELECT hash,result FROM requests WHERE id=?').get(requestId);
      if (previous) { if (previous.hash !== hash) throw new Error('requestId reused with different payload'); this.db.exec('RELEASE put_records'); return JSON.parse(previous.result); }
      if (!this.freshness().fresh) throw new Error('Snapshot stale; create a new output');
      const revision = this.meta('revision') + 1, results = [];
      for (const { type, record, expectedRevision } of batch) {
        if (!TYPES.includes(type) || ['evidence'].includes(type)) throw new Error('Invalid type for put; use evidence command for evidence');
        const item = { ...record };
        const identity = identityOf(type, item);
        item.id ??= identity ? `${type}-${identity.slice(0, 24)}` : undefined;
        needed(item.id, 'record.id'); if (item.id.length > 240) throw new Error('ID too long');
        if (Buffer.byteLength(json(item)) > MAX_RECORD_BYTES) throw new Error('Record exceeds 64 KiB; split into referenced records');
        if ('evidence' in item || 'observedControl' in item) throw new Error('Heavy evidence/control definitions must use references');
        if (['blocked', 'unavailable'].includes(item.status)) needed(item.reason, 'blocked/unavailable reason');
        const old = this.get(type, item.id);
        if (item.status === 'retired') {
          if (type !== 'edge' || !old || old.observedOnce || old.evidenceIds?.length || item.evidenceIds?.length) throw new Error('Only a previously planned, never observed edge can be retired');
          needed(item.reason, 'retirement reason'); needed(item.reviewer, 'retirement reviewer');
          if (!item.sourceIds?.length || item.sourceIds.some(id => !this.get('candidate', id))) throw new Error('Retirement needs valid sourceIds');
        }
        if (type === 'edge' && (old?.observedOnce || item.status === 'covered')) item.observedOnce = true;
        else delete item.observedOnce;
        if (old) {
          const unchanged = { ...old }; delete unchanged.revision;
          if (canonical(unchanged) === canonical(item)) { results.push({ type, id: item.id, revision: old.revision, unchanged: true }); continue; }
          if (expectedRevision !== old.revision) throw new Error(`Revision conflict ${type}/${item.id}; provide expectedRevision ${old.revision}`);
          if (identity && identity !== identityOf(type, old)) throw new Error('Interaction identity is immutable; create a separate state/action/branch record');
        }
        if (['file', 'candidate'].includes(type)) {
          if (!old) throw new Error('Frozen file/candidate inventory cannot be extended; dynamic findings belong in occurrence with sourceIds');
          const keys = type === 'file' ? ['path', 'sha256'] : ['kind', 'file', 'line', 'column', 'snippet', 'outcomes'];
          if (keys.some(k => canonical(item[k]) !== canonical(old[k]))) throw new Error('Frozen source inventory cannot change');
        }
        if (type === 'node') { needed(item.label, 'label'); needed(item.resetAction, 'resetAction'); needed(item.purpose, 'purpose'); }
        if (type === 'edge') {
          for (const key of ['from', 'to', 'controlId', 'inputClass', 'outcomeKey', 'outcome']) needed(item[key], key);
          if (!item.action || item.action.force !== false || item.action.script !== false) throw new Error('Edge requires normal user action: force:false, script:false');
          if (old?.status === 'covered' && canonical(old.evidenceIds) === canonical(item.evidenceIds) && ['to', 'outcome', 'candidateOutcomes', 'action'].some(k => canonical(old[k]) !== canonical(item[k]))) throw new Error('Changed observed result requires new evidence');
        }
        if (type === 'control') { needed(item.locator, 'locator'); needed(item.event, 'event'); }
        if (type === 'occurrence') { needed(item.nodeId, 'nodeId'); needed(item.controlId, 'controlId'); }
        if (type === 'sweep' && item.id !== item.nodeId) throw new Error('Sweep id must equal nodeId');
        if (item.status === 'covered' && ['node', 'edge', 'vector', 'entry', 'sweep'].includes(type) && !this.evidenceValid(item.evidenceIds)) throw new Error('Covered record requires existing valid snapshot evidence');
        this.rawPut(type, item, revision); results.push({ type, id: item.id, revision });
      }
      this.setMeta('revision', revision);
      const result = { revision, records: results };
      this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId, hash, json(result));
      this.db.exec('RELEASE put_records'); return result;
    } catch (e) { this.db.exec('ROLLBACK TO put_records; RELEASE put_records'); throw e; }
  }
  addEvidence(input, context = {}) {
    assertWorkflowCommand(this, { command: context.command ?? 'evidence', agent: context.agent, recordTypes: context.recordTypes ?? [] });
    if (!this.freshness().fresh) throw new Error('Snapshot stale; create a new output');
    const { capturedAt, action, assertion, snapshotId } = input;
    if (snapshotId !== this.meta('snapshotId')) throw new Error('Evidence snapshotId must match this analysis');
    if (!Number.isFinite(Date.parse(capturedAt)) || Date.parse(capturedAt) < Date.parse(this.meta('createdAt')) || Date.parse(capturedAt) > Date.now() + 300000) throw new Error('Evidence must be captured during this snapshot');
    needed(action, 'action'); needed(assertion?.expected, 'assertion.expected'); needed(assertion?.actual, 'assertion.actual');
    if (assertion.passed !== true) throw new Error('Observed evidence requires a passed assertion; record failures as pending/blocked findings');
    const assets = {}, pending = [];
    for (const [key, folder] of [['path', 'screenshots'], ['trace', 'traces']]) {
      const source = fs.realpathSync(needed(input[key], key));
      if (!fs.statSync(source).isFile() || !fs.statSync(source).size) throw new Error('Evidence must be a nonempty file');
      const bytes = fs.readFileSync(source), hash = digest(bytes);
      const ext = key === 'path' ? path.extname(source).toLowerCase() : '.trace';
      if (key === 'path') {
        const header = bytes.subarray(0, 32);
        const valid = ext === '.png' ? header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : ['.jpg', '.jpeg'].includes(ext) ? header[0] === 255 && header[1] === 216 && header[2] === 255 : ext === '.webp' ? header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP' : ext === '.gif' ? /^GIF8[79]a/.test(header.toString('ascii')) : ext === '.avif' ? header.includes(Buffer.from('ftypavif')) || header.includes(Buffer.from('ftypavis')) : false;
        if (!valid) throw new Error('Screenshot format/signature unsupported');
      }
      const relative = `${folder}/${hash}${ext}`, target = path.join(this.directory, relative);
      pending.push({ target, bytes, hash });
      assets[key] = relative; assets[`${key}Hash`] = hash;
    }
    if (input.capture) {
      const capture = input.capture;
      if (capture.sourceUnchanged !== true || capture.fullTargetVisible !== true || typeof capture.target !== 'string' || !capture.target.trim()) throw new Error('Capture requires unchanged source and fully visible target');
      if (!Number.isFinite(capture.zoom) || capture.zoom <= 0 || !Number.isFinite(capture.deviceScaleFactor) || capture.deviceScaleFactor <= 0) throw new Error('Capture requires zoom and deviceScaleFactor');
      const bytes = pending[0].bytes;
      if (path.extname(input.path).toLowerCase() !== '.png' || bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Capture dimension verification currently requires PNG');
      const actual = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
      if (!actual.width || !actual.height || actual.width !== capture.outputSize?.width || actual.height !== capture.outputSize?.height) throw new Error('Screenshot dimensions do not match capture.outputSize');
      assets.capture = { ...capture, actualSize: actual };
    }
    const evidence = { level: 'observed', snapshotId, capturedAt, action, assertion, ...assets };
    evidence.id = `evidence-${digest(canonical(evidence)).slice(0, 24)}`;
    if (Buffer.byteLength(json(evidence)) > MAX_RECORD_BYTES) throw new Error('Evidence metadata too large');
    this.db.exec('SAVEPOINT evidence_record');
    try {
      for (const { target, bytes, hash } of pending) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        try { fs.writeFileSync(target, bytes, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        if (digest(fs.readFileSync(target)) !== hash) throw new Error('Archived evidence hash mismatch');
      }
      if (!this.get('evidence', evidence.id)) { const revision = this.meta('revision') + 1; this.rawPut('evidence', evidence, revision); this.setMeta('revision', revision); }
      this.db.exec('RELEASE evidence_record'); return { id: evidence.id, path: evidence.path, trace: evidence.trace, verified: true, files: { screenshot: path.join(this.directory, evidence.path), trace: path.join(this.directory, evidence.trace) } };
    } catch (error) { this.db.exec('ROLLBACK TO evidence_record; RELEASE evidence_record'); throw error; }
  }
  capture(input, requestId, context = {}) {
    needed(requestId, 'requestId');
    if (requestId.length > 200) throw new Error('requestId too long');
    if (!input.evidence?.capture || !Array.isArray(input.records) || !input.records.length || !input.records.some(item => item.record?.evidenceIds?.includes('$evidence'))) throw new Error('capture requires evidence.capture and records referencing $evidence');
    const gate = { command: context.command ?? 'capture', agent: context.agent, recordTypes: context.recordTypes ?? input.records.map(item => item.type) };
    assertWorkflowCommand(this, gate);
    const hash = digest(canonical(input)), key = `capture:${requestId}`;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT hash,result FROM requests WHERE id=?').get(key);
      if (previous) {
        if (previous.hash !== hash) throw new Error('requestId reused with different payload');
        const result = JSON.parse(previous.result);
        if (!this.evidenceValid([result.evidence.id])) throw new Error('Archived evidence missing or changed; capture again with a new requestId');
        this.db.exec('COMMIT'); return result;
      }
      const evidence = this.addEvidence(input.evidence, gate);
      const records = input.records.map(item => ({ ...item, record: { ...item.record, ...(item.record?.evidenceIds ? { evidenceIds: item.record.evidenceIds.map(id => id === '$evidence' ? evidence.id : id) } : {}) } }));
      const result = { evidence, ...this.put(records, `capture-records:${requestId}`, gate) };
      this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(key, hash, json(result));
      this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  expand(item) {
    const result = { ...item }; delete result.revision;
    if (item.evidenceIds) result.evidence = item.evidenceIds.map(id => this.get('evidence', id)).filter(Boolean);
    return result;
  }
  materialize() {
    const { map: source, bytes: sourceBytes } = this.source();
    const list = type => [...this.rows(type)].filter(r => r.status !== 'retired').map(r => this.expand(r));
    const runtimeOnly = this.runtimeOnly();
    const completeness = runtimeOnly ? 'runtime-only' : 'verified';
    const traversalStatus = runtimeOnly ? 'runtime-observed' : 'converged';
    const graph = { schemaVersion: 1, sourceMapHash: digest(sourceBytes), status: traversalStatus, candidateReviews: list('candidate'), groups: list('group'), nodes: list('node'), edges: list('edge'), stateSpaces: list('space'), runtimeDiscoveries: list('occurrence').map(o => ({ ...this.get('control', o.controlId), ...o })), runtimeSweeps: list('sweep'), remainingCandidateIds: [], remainingEdgeIds: [] };
    const entries = list('entry');
    const coverage = { sourceInventory: { completeness, sourceFiles: source.sourceFiles, entries }, coverage: entries.map(e => ({ ...e, status: this.effective('entry', e) })), sourceInteractionInventory: { completeness, status: traversalStatus, remainingControlIds: [], controls: list('control'), stateVectors: list('vector') }, traversal: { status: traversalStatus, visitedEntryIds: entries.filter(e => this.effective('entry', e) === 'covered').map(e => e.id), remainingEntryIds: entries.filter(e => this.effective('entry', e) !== 'covered').map(e => e.id) } };
    return { source, sourceBytes, graph, coverage };
  }
  audit(context = {}) {
    assertWorkflowCommand(this, { command: context.command ?? 'audit', agent: context.agent, recordTypes: context.recordTypes ?? [] });
    const facts = this.materialize(), freshness = this.freshness();
    const run = { sourceMap: { sha256: digest(facts.sourceBytes), createdAt: facts.source.createdAt } };
    const problems = graphProblems({ ...facts, current: freshness.current, run, runDirectory: this.directory, workflow: this.meta('workflow') });
    if (!freshness.fresh) problems.push(`Snapshot stale: ${freshness.invalidation}`);
    for (const type of ['node', 'edge', 'vector', 'entry', 'sweep']) for (const r of this.rows(type)) if (r.status !== 'retired' && !this.evidenceValid(r.evidenceIds)) problems.push(`${type}/${r.id}: evidence missing, changed, or from another snapshot`);
    if (!this.runtimeOnly()) for (const f of this.rows('file')) if (!doneStates.has(this.effective('file', f))) problems.push(`file/${f.id}: file review unfinished`);
    for (const r of this.rows('occurrence')) if (this.effective('occurrence', r) !== 'covered') problems.push(`occurrence/${r.id}: state/control/action coverage incomplete`);
    for (const q of this.rows('question')) if (!q.question || !q.impact || !q.groupId || !this.get('group', q.groupId) || !q.entryIds?.length || q.entryIds.some(id => !this.get('entry', id)) || !this.evidenceValid(q.evidenceIds) || !['open', 'resolved'].includes(q.status) || q.status === 'resolved' && (!q.answer || !q.conclusion)) problems.push(`question/${q.id}: missing question, impact, group, entry, evidence, or answer`);
    return { complete: problems.length === 0, problems: [...new Set(problems)], freshness: { ...freshness, current: undefined }, revision: this.meta('revision') };
  }
  summary() {
    const counts = {};
    for (const type of TYPES) { const c = { total: 0, complete: 0, pending: 0, blocked: 0, retired: 0 }; for (const r of this.rows(type)) { c.total++; const s = this.effective(type, r); if (s === 'retired') c.retired++; else if (doneStates.has(s)) c.complete++; else if (['blocked', 'unavailable'].includes(s)) c.blocked++; else c.pending++; } counts[type] = c; }
    const freshness = this.freshness(); delete freshness.current;
    return { schemaVersion: 1, freshness, snapshotId: this.meta('snapshotId'), createdAt: this.meta('createdAt'), revision: this.meta('revision'), source: this.meta('source'), scope: this.meta('scope'), counts, artifacts: { database: 'index.sqlite', sourceMap: 'source-map.json', report: 'report.md', brief: 'brief.json' } };
  }
}

export function initialize({ source, output, scope, frozenSource, priorOutput, workflow, evidenceProfile, runtimeSource }) {
  const runtime = source?.type === 'runtime';
  if (!runtime && source?.type !== 'html') throw new Error('Only local HTML and declared runtime sources are implemented');
  needed(scope?.observableBoundary, 'scope.observableBoundary');
  if (!['full', 'partial'].includes(scope.mode)) throw new Error('scope.mode must be full or partial');
  let workspaceRoot, location, map, metrics = {}, metadataSource, normalizedRuntimeSource;
  const directory = realDestination(path.resolve(output));
  if (runtime) {
    if (evidenceProfile !== 'runtime-only') throw new Error('Runtime source requires runtime-only evidence profile');
    if (!workflow?.adapter) throw new Error('Runtime source requires a resolved workflow');
    normalizedRuntimeSource = runtimeSource ?? normalizeRuntimeSource(source, workflow.adapter);
    metadataSource = normalizedRuntimeSource;
    map = runtimeSourceMap(normalizedRuntimeSource);
    if (frozenSource && ['origin', 'sourceFiles', 'candidates', 'problems'].some(k => json(map[k]) !== json(frozenSource[k]))) throw new Error('Frozen runtime source differs from declared source; new run required');
    if (frozenSource) map = frozenSource;
  } else {
    workspaceRoot = fs.realpathSync(source.workspaceRoot ?? path.dirname(path.resolve(source.location)));
    location = path.resolve(workspaceRoot, source.location);
    if (!/\.html?$/i.test(location)) throw new Error('HTML adapter requires a local HTML entry');
    const root = path.dirname(fs.realpathSync(location));
    if (directory === root || inside(root, directory)) throw new Error('Output must be outside source tree');
    const discovered = discoverPrototypeSource({ workspaceRoot, location, metrics });
    if (frozenSource && ['origin', 'sourceFiles', 'candidates', 'problems'].some(k => json(discovered[k]) !== json(frozenSource[k]))) throw new Error('Frozen mf-dev-flow source differs from current source; new run required');
    if (discovered.problems.some(problem => problem.startsWith('无法解析 '))) throw new Error(`Source parsing failed: ${discovered.problems.filter(problem => problem.startsWith('无法解析 ')).join('; ')}`);
    map = frozenSource ?? { ...discovered, createdAt: now() };
    metadataSource = { type: 'html', workspaceRoot, location };
  }
  if (fs.existsSync(directory)) throw new Error('Output already exists; query/next to resume, new directory for new source version');
  const bytes = json(map) + '\n';
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  const staging = `${directory}.init-${crypto.randomUUID()}`; fs.mkdirSync(staging);
  const db = new DatabaseSync(path.join(staging, 'index.sqlite'));
  try {
    db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE records(type TEXT NOT NULL,id TEXT NOT NULL,status TEXT NOT NULL,file TEXT NOT NULL,node TEXT NOT NULL,identity TEXT,body TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(type,id),UNIQUE(type,identity)); CREATE INDEX records_filter ON records(type,file,node,status,id); CREATE TABLE requests(id TEXT PRIMARY KEY,hash TEXT NOT NULL,result TEXT NOT NULL);');
    const metadata = {
      schemaVersion: 1,
      snapshotId: crypto.randomUUID(),
      createdAt: map.createdAt,
      source: metadataSource,
      scope,
      extractorRevision: runtime ? null : EXTRACTOR_REVISION,
      sourceMapHash: digest(bytes),
      revision: 0,
      cacheMetrics: metrics,
      priorOutput: priorOutput ? path.resolve(priorOutput) : null,
      reusePolicy: runtime ? 'declared-runtime-revision-only; all observations require this snapshot' : 'static-cache-only; all runtime observations require this snapshot',
    };
    if (runtime) Object.assign(metadata, { workflow, workflowState: initialWorkflowState(workflow, map.createdAt), evidenceProfile, runtimeSource: normalizedRuntimeSource, sourceFreshness: 'declared-revision' });
    db.exec('BEGIN');
    for (const [key, value] of Object.entries(metadata)) db.prepare('INSERT INTO meta VALUES(?,?)').run(key, json(value));
    for (const [type, items] of [['file', map.sourceFiles.map(f => ({ ...f, id: `file-${digest(f.path).slice(0, 24)}`, file: f.path }))], ['candidate', map.candidates]]) for (const item of items) db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?)').run(type, item.id, 'pending', item.file ?? '', '', null, json({ ...item, status: 'pending' }), 0);
    db.exec('COMMIT'); db.close();
    fs.writeFileSync(path.join(staging, 'source-map.json'), bytes);
    fs.renameSync(staging, directory);
  } catch (e) { try { db.close(); } catch {} fs.rmSync(staging, { recursive: true, force: true }); throw e; }
  const store = new AnalysisStore(directory);
  try { return { ...store.summary(), cacheMetrics: metrics }; } finally { store.close(); }
}
