import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AnalysisStore, initialize, canonical, boundedPage } from './core/store.js';
import { digest, EXTRACTOR_REVISION } from './core/html-source.js';
import { readAnalysisRequirements, requirementsBrief, resolveAnalysisRequirements } from './core/analysis-requirements.mjs';
import { parsePrototypeSpecifier, loadPrototypeProcess, loadPrototypeAdapter, composePrototypeWorkflow } from './processes.mjs';
import { normalizeRuntimeSource } from './core/runtime-source.mjs';
import { assertWorkflowCommand, markWorkflowAccepted, transitionWorkflow, workflowBrief, workflowSummary } from './core/workflow.mjs';
import { STORE_DIRECTORY, storePath } from '../skill-identity.mjs';
export const catalogDirectory = root => path.join(path.resolve(root), STORE_DIRECTORY, 'prototype');
export const hasCatalog = root => fs.existsSync(path.join(catalogDirectory(root), 'catalog.sqlite'));
const json = JSON.stringify;
const required = (value, name) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} required`); return value; };
const idCheck = id => { if (!/^[\w\p{L}.-]{1,200}$/u.test(String(id ?? ''))) throw new Error('Invalid ID'); return id; };
const time = () => new Date().toISOString();
const runtimeTypes = ['group', 'entry', 'node', 'edge', 'space', 'vector', 'control', 'occurrence', 'sweep'];
const sourceFingerprint = (source, map) => digest(canonical(source?.type === 'runtime' ? map.origin : map.sourceFiles));
const list = value => Array.isArray(value) ? value : [];
const requiredTrimmed = (value, name) => required(value, name).trim();

function localRequirementScope(record) {
  const groupId = typeof record?.groupId === 'string' && record.groupId.trim() ? record.groupId : null;
  const entryIds = list(record?.entryIds).filter(id => typeof id === 'string' && id.trim());
  // Legacy records could carry a parent group plus explicit child entries.
  // The entry list is the narrower, directly expressed reach; retaining both
  // would recreate an invalid union scope. The original tuple stays immutable
  // in its historical requirement_update event.
  return entryIds.length ? { entryIds } : groupId ? { groupId } : null;
}

function restoreRequirementScope(record, scope) {
  const restored = { ...record };
  delete restored.groupId; delete restored.entryIds; delete restored.impactScope;
  return { ...restored, ...scope };
}

// A requirement without an explicit reach is not a harmless default-global
// change. It must be repaired before it can take part in a planning revision.
function requirementScopeProblem(record) {
  const global = record?.impactScope === 'global';
  const group = typeof record?.groupId === 'string' && record.groupId.trim();
  const entries = list(record?.entryIds).filter(id => typeof id === 'string' && id.trim());
  if (record?.impactScope !== undefined && !global)
    return 'Requirement impactScope must be global';
  if (global && (group || entries.length))
    return 'Global requirement cannot also declare groupId or entryIds';
  if (group && entries.length)
    return 'Requirement scope must use either groupId or entryIds, not both';
  if (!global && !group && !entries.length)
    return 'Requirement impact scope required: declare groupId, entryIds, or impactScope=global';
  return null;
}

function frozenWorkflowIdentifiers(workflow) {
  if (!workflow) return null;
  if (!workflow.process?.id || !Number.isInteger(workflow.process.version) || !workflow.adapter?.id || !Number.isInteger(workflow.adapter.version) || !['runtime-only', 'source-and-runtime'].includes(workflow.evidenceProfile))
    throw new Error('Workflow snapshot metadata is invalid');
  return {
    process: { id: workflow.process.id, version: workflow.process.version },
    adapter: { id: workflow.adapter.id, version: workflow.adapter.version },
    evidenceProfile: workflow.evidenceProfile,
  };
}

function resolveRuntimeWorkflow(input, options) {
  const supplied = ['process', 'adapter', 'evidenceProfile', 'agent'].filter(key => options[key] !== undefined);
  if (!supplied.length) {
    if (input.source?.type === 'runtime') throw new Error('Runtime source requires --process, --adapter, --evidence-profile, and --agent');
    return null;
  }
  if (input.source?.type !== 'runtime') throw new Error('Workflow options currently require a runtime source');
  if (supplied.length !== 4) throw new Error('Runtime source requires --process, --adapter, --evidence-profile, and --agent');
  const process = loadPrototypeProcess(parsePrototypeSpecifier(options.process));
  const adapter = loadPrototypeAdapter(parsePrototypeSpecifier(options.adapter));
  const workflow = composePrototypeWorkflow({ process, adapter, evidenceProfile: options.evidenceProfile });
  const source = normalizeRuntimeSource(input.source, workflow.adapter);
  const initialStage = workflow.stages.find(stage => stage.id === workflow.initialStageId);
  if (options.agent !== initialStage.agent.id) throw new Error(`Init must run as ${initialStage.agent.id}`);
  return { source, workflow };
}

export class PrototypeCatalog {
  constructor(root = process.cwd(), { create = false, directory = catalogDirectory(root) } = {}) {
    this.root = path.resolve(root); this.directory = path.resolve(directory);
    const file = path.join(this.directory, 'catalog.sqlite');
    if (!create && !fs.existsSync(file)) throw new Error('Prototype catalog not initialized; prototype init --input <file>');
    if (create) fs.mkdirSync(this.directory, { recursive: true });
    this.db = new DatabaseSync(file); this.db.exec('PRAGMA busy_timeout=5000');
    if (create) this.db.exec("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS semantic(type TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(type,id)); CREATE TABLE IF NOT EXISTS events(revision INTEGER PRIMARY KEY,at TEXT NOT NULL,kind TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,hash TEXT NOT NULL,result TEXT NOT NULL); CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,body TEXT NOT NULL); INSERT OR IGNORE INTO meta VALUES('schemaVersion','2'); INSERT OR IGNORE INTO meta VALUES('revision','0');");
    if (this.meta('schemaVersion') !== 2) throw new Error('Unsupported prototype catalog schema');
  }
  close() { this.db.close(); }
  meta(key) { const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; }
  setMeta(key, value) { this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(key, json(value)); }
  get(type, id) { const row = this.db.prepare('SELECT body,revision FROM semantic WHERE type=? AND id=?').get(type, id); return row ? { ...JSON.parse(row.body), revision: row.revision } : null; }
  rows(type) { return this.db.prepare('SELECT id,body,revision FROM semantic WHERE type=? ORDER BY id').all(type).map(r => { const record = JSON.parse(r.body); if (type === 'requirement' && record.kind === undefined) record.kind = 'product'; return { ...record, revision: r.revision }; }); }
  batchDirectory(id = this.meta('activeBatch')) { return path.join(this.directory, 'analyses', idCheck(id)); }
  transaction(requestId, expectedRevision, payload, action) {
    required(requestId, 'requestId'); if (requestId.length > 200 || Buffer.byteLength(json(payload)) > 1048576) throw new Error('Semantic request too large');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const hash = digest(canonical(payload));
      const existing = this.db.prepare('SELECT hash,result FROM requests WHERE id=?').get(requestId);
      if (existing) { if (hash !== existing.hash) throw new Error('Request ID reused with different payload'); this.db.exec('COMMIT'); return JSON.parse(existing.result); }
      if (!Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) !== this.meta('revision')) throw new Error(`Semantic revision conflict; expected-revision must be ${this.meta('revision')}`);
      const result = action();
      this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId, hash, json(result)); this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  event(kind, subject, before, after) {
    const revision = this.meta('revision') + 1;
    this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run(revision, time(), kind, subject, json({ before, after }));
    this.setMeta('revision', revision); return revision;
  }
  setRecord(type, record, revision) { const body = { ...record }; delete body.revision; if (Buffer.byteLength(json(body)) > 65536) throw new Error('Semantic record exceeds 64 KiB'); this.db.prepare('INSERT OR REPLACE INTO semantic VALUES(?,?,?,?)').run(type, idCheck(record.id), json(body), revision); }
  requirementKnownScopeProblem(record) {
    if (!this.meta('accepted') || record?.impactScope === 'global') return null;
    if (record?.groupId && !this.get('group', record.groupId))
      return `Requirement groupId is not an accepted group: ${record.groupId}`;
    const unknownEntries = list(record?.entryIds).filter(id => !this.get('entry', id));
    if (unknownEntries.length)
      return `Requirement entryIds are not accepted entries: ${unknownEntries.join(',')}`;
    return null;
  }
  initializeBatch(input, options) {
    required(options.requestId, 'requestId');
    if (!input.scope || typeof input.scope !== 'object' || Array.isArray(input.scope))
      throw new Error('scope required');
    if (['analysisRequirements', 'analysisRequirementSelection'].some(key => Object.hasOwn(input.scope, key)))
      throw new Error('scope analysis requirement snapshots are reserved; use prototype analysis-requirements commands');
    const runtime = resolveRuntimeWorkflow(input, options);
    if (runtime) input = { ...input, source: runtime.source };
    const {
      analysisRequirements: ignoredRequirements,
      analysisRequirementSelection: ignoredSelection,
      analysisRequirementIds,
      analysisRequirementLabels,
      ...submittedScope
    } = input.scope;
    const requirements = resolveAnalysisRequirements(this.root, {
      sourceType: input.source?.type,
      mode: submittedScope.mode,
      ids: analysisRequirementIds ?? null,
      labels: analysisRequirementLabels ?? [],
    });
    input = {
      ...input,
      scope: {
        ...submittedScope,
        analysisRequirements: requirements,
        analysisRequirementSelection: requirements.selection,
      },
    };
    const batchId = idCheck(options.batch ?? `analysis-${digest(options.requestId).slice(0, 24)}`);
    const output = this.batchDirectory(batchId);
    // Fixed caller input + request ID makes a retry select the same completed initialization.
    return this.transaction(options.requestId, options.expectedRevision ?? 0, { action: 'init', input, batch: options.batch ?? null }, () => {
      const initHash = digest(canonical({ input, requestId: options.requestId }));
      const marker = path.join(this.directory, `.init-${batchId}.json`);
      if (fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker, 'utf8')).hash !== initHash) throw new Error('Batch belongs to another initialization');
      if (fs.existsSync(output) && !fs.existsSync(marker)) throw new Error('Analysis batch exists; query/next to resume');
      fs.writeFileSync(marker, json({ hash: initHash }));
      // Native initialize atomically renames its complete directory. A catalog-commit
      // interruption can therefore reopen exactly that batch, without deleting data.
      if (!fs.existsSync(output)) {
        try {
          initialize({
            source: { ...input.source, ...(input.source?.type === 'html' ? { workspaceRoot: input.source.workspaceRoot ?? this.root } : {}) },
            scope: input.scope,
            output,
            workflow: runtime?.workflow,
            evidenceProfile: runtime?.workflow.evidenceProfile,
            runtimeSource: runtime?.source,
          });
        }
        catch (error) { if (!fs.existsSync(output)) fs.rmSync(marker, { force: true }); throw error; }
      }
      const native = new AnalysisStore(output);
      let source, workflowStatus;
      try {
        const nativeSource = native.meta('source'), map = native.source().map;
        source = { ...nativeSource, files: map.sourceFiles, fingerprint: sourceFingerprint(nativeSource, map) };
        workflowStatus = workflowSummary(native);
      } finally { native.close(); }
      const before = this.meta('source');
      this.setMeta('activeBatch', batchId); this.setMeta('source', source);
      this.setMeta('workflow', runtime?.workflow ?? null);
      this.setMeta('evidenceProfile', runtime?.workflow.evidenceProfile ?? null);
      this.setMeta('runtimeSource', runtime?.source ?? null);
      const requirementsSummary = requirementsBrief(requirements);
      // AR snapshots are batch input, not product semantics. Persist their
      // current-batch summary without incrementing the global semantic
      // revision, otherwise a registry-only change would falsely invalidate
      // accepted prototype facts and planning consumers.
      this.setMeta('analysisRequirements', requirementsSummary);
      if (!before || before.fingerprint !== source.fingerprint || before.location !== source.location) {
        const revision = this.event('source_registered', batchId, before, source); this.setMeta('sourceRevision', revision);
      }
      return {
        batchId,
        snapshotId: (() => { const store = new AnalysisStore(output); try { return store.meta('snapshotId'); } finally { store.close(); } })(),
        semanticRevision: this.meta('revision'),
        sourceChanged: !before || before.fingerprint !== source.fingerprint,
        analysisRequirements: requirementsSummary,
        ...(runtime ? { workflow: workflowStatus, evidenceProfile: runtime.workflow.evidenceProfile, runtimeSource: runtime.source, next: 'prototype next --type entry --limit 10 --json' } : { next: 'prototype next --type candidate --limit 10 --json' }),
      };
    });
  }
  mutate(kind, action, input, options) {
    if (!['question', 'requirement', 'note'].includes(kind)) throw new Error('Unknown semantic record type');
    idCheck(input.id); required(input.actor, 'actor');
    if (input.groupId !== undefined && input.groupId !== null) idCheck(input.groupId);
    for (const key of ['entryIds', 'evidenceIds']) if (input[key] !== undefined) {
      if (!Array.isArray(input[key]) || input[key].some(id => typeof id !== 'string' || !id.trim())) throw new Error(`${key} must be an array of IDs`);
    }
    for (const key of ['question', 'text', 'impact', 'answer', 'conclusion']) if (input[key] !== undefined && typeof input[key] !== 'string') throw new Error(`${key} must be text`);
    if (input.kind !== undefined && !['product', 'technical'].includes(input.kind))
      throw new Error('kind must be product or technical');
    if (input.impactScope !== undefined && input.impactScope !== 'global')
      throw new Error('impactScope must be global');
    return this.transaction(options.requestId, options.expectedRevision, { kind, action, input }, () => {
      const before = this.get(kind, input.id);
      let after;
      if (action === 'add') {
        if (before) throw new Error('ID exists; update using dedicated semantic command');
        required(kind === 'question' ? input.question : input.text, kind === 'question' ? 'question' : 'text');
        const origin = input.origin ?? 'user'; if (!['user', 'observed', 'inferred'].includes(origin)) throw new Error('origin must be user, observed or inferred');
        if (origin === 'observed') {
          const batch = new AnalysisStore(this.batchDirectory(input.batch));
          try { if (!batch.freshness().fresh || !batch.evidenceValid(input.evidenceIds)) throw new Error('Observed semantic statement needs current batch evidence'); } finally { batch.close(); }
        }
        after = { ...input, origin, status: kind === 'question' ? 'open' : input.status ?? 'proposed', createdAt: time() };
      } else {
        if (!before) throw new Error('Semantic record not found');
        if (action === 'answer' && kind === 'question') {
          required(input.answer, 'answer'); required(input.conclusion, 'conclusion');
          after = { ...before, answer: input.answer, conclusion: input.conclusion, answerOrigin: 'user', actor: input.actor, status: input.status ?? 'resolved' };
          if (!['open', 'resolved'].includes(after.status)) throw new Error('Question status must be open or resolved');
        } else if (action === 'update') {
          after = { ...before, ...input }; delete after.revision;
          if (after.groupId === null) delete after.groupId;
          if (kind === 'question' && ['answer', 'conclusion', 'status'].some(k => input[k] !== undefined)) throw new Error('Use question answer for answers/conclusions/status');
          if (after.origin !== before.origin || canonical(after.evidenceIds) !== canonical(before.evidenceIds)) throw new Error('Origin/evidence cannot be relabeled by semantic update');
          if (kind === 'requirement'
            && (before.groupId || list(before.entryIds).length)
            && after.impactScope === 'global')
            throw new Error('Cannot widen a locally scoped requirement to global through update; withdraw it and add an explicit global requirement instead');
        } else throw new Error('Unsupported semantic action');
      }
      if (kind === 'question' && !['open', 'resolved'].includes(after.status)) throw new Error('Invalid question status');
      if (kind !== 'question' && !['proposed', 'confirmed', 'withdrawn'].includes(after.status)) throw new Error('Requirement/note status must be proposed, confirmed or withdrawn');
      if (kind === 'requirement' && after.status !== 'withdrawn') {
        const scopeProblem = requirementScopeProblem(after) ?? this.requirementKnownScopeProblem(after);
        if (scopeProblem) throw new Error(scopeProblem);
      }
      const revision = this.event(`${kind}_${action}`, input.id, before, after); after.updatedAt = time();
      this.setRecord(kind, after, revision);
      return { id: input.id, semanticRevision: revision, origin: after.origin, status: after.status, next: 'feature impact', developmentAuthorized: false };
    });
  }
  accept(options) {
    return this.transaction(options.requestId, options.expectedRevision, { action: 'accept', batch: options.batch ?? this.meta('activeBatch') }, () => {
      const batchId = options.batch ?? this.meta('activeBatch'), native = new AnalysisStore(this.batchDirectory(batchId));
      native.db.exec('BEGIN IMMEDIATE');
      try {
        const workflowCommand = assertWorkflowCommand(native, { command: 'accept', agent: options.agent });
        const frozenWorkflow = frozenWorkflowIdentifiers(workflowCommand?.workflow);
        if (workflowCommand && workflowCommand.state.activeStageId !== 'audit-accept')
          throw new Error('Workflow acceptance requires the active audit-accept stage');
        if (workflowCommand && !['in_progress', 'accepted'].includes(workflowCommand.state.status))
          throw new Error(`Workflow is ${workflowCommand.state.status}; create a new analysis batch`);
        const scope = native.meta('scope');
        if (scope?.mode === 'partial')
          throw new Error('Partial analysis cannot replace the accepted product baseline; run a full analysis before accept');
        const requirements = scope?.analysisRequirements;
        const nativeSource = native.meta('source'), nativeMap = native.source().map;
        if (nativeSource?.type !== this.meta('source')?.type || sourceFingerprint(nativeSource, nativeMap) !== this.meta('source')?.fingerprint) throw new Error('Batch does not match current registered source');
        const audit = native.audit({ command: 'accept', agent: options.agent }); if (!audit.complete) throw new Error(`Analysis incomplete (${audit.problems.length}); prototype audit --batch ${batchId}`);
        const projection = {};
        for (const type of runtimeTypes) projection[type] = [...native.rows(type)].filter(r => r.status !== 'retired').map(record => {
          const result = { ...record }; delete result.revision; delete result.status; delete result.observedOnce;
          // Operational evidence fields do not define the semantic product revision.
          result.evidenceIds = record.evidenceIds ?? [];
          return result;
        });
        const semantics = Object.fromEntries(Object.entries(projection).map(([type, records]) => [type, records.map(({ evidenceIds, ...record }) => record)]));
        // Frozen AR records prove which analysis protocol was followed. They are
        // audit provenance, not observed prototype facts, so they cannot by
        // themselves cause a product semantic revision or feature-map impact.
        const fingerprint = digest(canonical(semantics));
        const previous = this.meta('accepted');
        const changed = !previous || previous.fingerprint !== fingerprint || previous.sourceFingerprint !== this.meta('source')?.fingerprint;
        const snapshotId = digest(canonical({ batchId, projection }));
        const evidence = [...native.rows('evidence')];
        this.db.prepare('INSERT OR IGNORE INTO snapshots VALUES(?,?)').run(snapshotId, json({ id: snapshotId, batchId, fingerprint, projection, evidence, analysisRequirements: requirementsBrief(requirements), extractorRevision: native.meta('extractorRevision'), ...(frozenWorkflow ? { workflow: frozenWorkflow } : {}) }));
        const revision = changed ? this.event('analysis_accepted', batchId, previous, { batchId, fingerprint, snapshotId }) : this.meta('revision');
        for (const type of runtimeTypes) {
          this.db.prepare('DELETE FROM semantic WHERE type=?').run(type);
          for (const record of projection[type]) this.setRecord(type, { ...record, sourceBatch: batchId, origin: 'observed' }, revision);
        }
        if (workflowCommand?.state.status === 'in_progress') {
          native.setMeta('workflowState', {
            ...workflowCommand.state,
            history: [...workflowCommand.state.history, { stageId: 'audit-accept', agent: options.agent, outcome: 'accepted', at: time(), reason: 'complete audit accepted' }],
          });
        }
        const workflow = markWorkflowAccepted(native, { agent: options.agent });
        this.setMeta('accepted', { batchId, snapshotId, indexRevision: native.meta('revision'), fingerprint, sourceFingerprint: this.meta('source')?.fingerprint, analysisRequirements: requirementsBrief(requirements), ...(frozenWorkflow ? { workflow: frozenWorkflow } : {}), at: time() });
        native.db.exec('COMMIT');
        return { accepted: true, batchId, semanticRevision: revision, semanticChanged: changed, ...(nativeSource.type === 'runtime' ? { sourceRevision: nativeSource.revision } : {}), ...(frozenWorkflow ? { evidenceProfile: frozenWorkflow.evidenceProfile } : {}), ...(workflow ? { workflow } : {}), next: changed ? 'feature impact' : 'prototype status --json', developmentAuthorized: false };
      } catch (error) { native.db.exec('ROLLBACK'); throw error; } finally { native.close(); }
    });
  }
  recover(options) {
    const fromSnapshot = idCheck(requiredTrimmed(options.fromSnapshot, 'from-snapshot'));
    const sourceEquivalence = requiredTrimmed(options.sourceEquivalence, 'source-equivalence');
    if (Buffer.byteLength(sourceEquivalence) > 4000) throw new Error('source-equivalence too large');
    if (options.restoreScopes !== true) throw new Error('restore-scopes required');
    return this.transaction(options.requestId, options.expectedRevision, {
      action: 'recover', fromSnapshot, sourceEquivalence, restoreScopes: true,
    }, () => {
      const currentAccepted = this.meta('accepted');
      if (!currentAccepted?.batchId || !currentAccepted?.snapshotId)
        throw new Error('Accepted baseline required for snapshot recovery');
      if (currentAccepted.snapshotId === fromSnapshot)
        throw new Error('Recovery source must differ from the current accepted snapshot');
      const currentSource = this.meta('source');
      if (!currentSource?.fingerprint) throw new Error('Current prototype source required for snapshot recovery');

      const currentBatch = new AnalysisStore(this.batchDirectory(currentAccepted.batchId), { readOnly: true });
      try {
        if (currentBatch.meta('scope')?.mode !== 'partial')
          throw new Error('Snapshot recovery only repairs an accepted partial analysis');
      } finally { currentBatch.close(); }

      const sourceRow = this.db.prepare('SELECT body FROM snapshots WHERE id=?').get(fromSnapshot);
      if (!sourceRow) throw new Error('Recovery snapshot not found');
      let sourceSnapshot;
      try { sourceSnapshot = JSON.parse(sourceRow.body); }
      catch { throw new Error('Recovery snapshot is invalid'); }
      if (sourceSnapshot.id !== fromSnapshot || !sourceSnapshot.batchId || !sourceSnapshot.projection || typeof sourceSnapshot.projection !== 'object')
        throw new Error('Recovery snapshot is invalid');
      for (const type of runtimeTypes) {
        if (!Array.isArray(sourceSnapshot.projection[type])) throw new Error(`Recovery snapshot is missing ${type} projection`);
        for (const record of sourceSnapshot.projection[type]) if (!record || typeof record !== 'object' || idCheck(record.id) !== record.id)
          throw new Error(`Recovery snapshot has invalid ${type} record`);
      }

      const sourceBatch = new AnalysisStore(this.batchDirectory(sourceSnapshot.batchId), { readOnly: true });
      let sourceIndexRevision, sourceRequirements, sourceWorkflow;
      try {
        if (sourceBatch.meta('scope')?.mode !== 'full')
          throw new Error('Recovery source must be an accepted full analysis snapshot');
        sourceIndexRevision = sourceBatch.meta('revision');
        sourceRequirements = requirementsBrief(sourceBatch.meta('scope')?.analysisRequirements);
        sourceWorkflow = frozenWorkflowIdentifiers(sourceBatch.meta('workflow'));
      } finally { sourceBatch.close(); }

      const evidenceProblems = this.acceptedEvidenceProblems({ batchId: sourceSnapshot.batchId, snapshotId: fromSnapshot }, { requireExtractor: false });
      if (evidenceProblems.length) throw new Error(`Recovery snapshot evidence cannot be verified: ${evidenceProblems.join('; ')}`);

      const acceptEvents = this.db.prepare("SELECT revision,body FROM events WHERE kind='analysis_accepted' ORDER BY revision").all().map(event => ({ ...event, body: JSON.parse(event.body) }));
      const replacements = acceptEvents.filter(event => event.body.before?.snapshotId === fromSnapshot && event.body.after?.snapshotId === currentAccepted.snapshotId);
      if (replacements.length !== 1)
        throw new Error('Recovery requires the current partial snapshot to directly replace the requested full snapshot');
      const replacement = replacements[0];

      const recoveredAt = time();
      const sourceEquivalenceRecord = {
        kind: 'user_confirmed_unchanged_prototype',
        reason: sourceEquivalence,
        confirmedAt: recoveredAt,
        recoveredFrom: fromSnapshot,
        historicalBatchId: sourceSnapshot.batchId,
        replacedSnapshotId: currentAccepted.snapshotId,
        currentSourceFingerprint: currentSource.fingerprint,
      };
      const recoverySnapshotId = digest(canonical({
        kind: 'snapshot-recovery@1', recoveredFrom: fromSnapshot,
        replacedSnapshotId: currentAccepted.snapshotId,
        currentSourceFingerprint: currentSource.fingerprint,
        sourceEquivalence,
        projection: sourceSnapshot.projection,
      }));
      const recoveredSnapshot = {
        ...sourceSnapshot,
        id: recoverySnapshotId,
        recoveredFrom: fromSnapshot,
        recovery: sourceEquivalenceRecord,
      };
      this.db.prepare('INSERT OR IGNORE INTO snapshots VALUES(?,?)').run(recoverySnapshotId, json(recoveredSnapshot));

      const accepted = {
        batchId: sourceSnapshot.batchId,
        snapshotId: recoverySnapshotId,
        indexRevision: sourceIndexRevision,
        fingerprint: sourceSnapshot.fingerprint,
        sourceFingerprint: currentSource.fingerprint,
        analysisRequirements: sourceSnapshot.analysisRequirements ?? sourceRequirements,
        ...(sourceSnapshot.workflow ?? sourceWorkflow ? { workflow: sourceSnapshot.workflow ?? sourceWorkflow } : {}),
        recoveredFrom: fromSnapshot,
        sourceEquivalence: sourceEquivalenceRecord,
        at: recoveredAt,
      };
      const recoveryRevision = this.event('snapshot_recovered', fromSnapshot, currentAccepted, accepted);
      for (const type of runtimeTypes) {
        this.db.prepare('DELETE FROM semantic WHERE type=?').run(type);
        for (const record of sourceSnapshot.projection[type])
          this.setRecord(type, { ...record, sourceBatch: sourceSnapshot.batchId, origin: 'observed' }, recoveryRevision);
      }
      this.setMeta('accepted', accepted);

      const groups = new Set(sourceSnapshot.projection.group.map(record => record.id));
      const entries = new Set(sourceSnapshot.projection.entry.map(record => record.id));
      const widenedScopes = new Map();
      for (const event of this.db.prepare("SELECT revision,subject,body FROM events WHERE kind='requirement_update' AND revision>? ORDER BY revision").all(replacement.revision)) {
        const change = JSON.parse(event.body), scope = localRequirementScope(change.before);
        if (scope && change.after?.impactScope === 'global' && !widenedScopes.has(event.subject)) widenedScopes.set(event.subject, scope);
      }
      const requirementIds = [];
      for (const [id, scope] of widenedScopes) {
        const current = this.get('requirement', id);
        if (!current || current.status === 'withdrawn' || current.impactScope !== 'global' || current.groupId || list(current.entryIds).length) continue;
        if (scope.groupId && !groups.has(scope.groupId)) throw new Error(`Recovered requirement group is not in the full snapshot: ${scope.groupId}`);
        const unknownEntries = list(scope.entryIds).filter(entryId => !entries.has(entryId));
        if (unknownEntries.length) throw new Error(`Recovered requirement entries are not in the full snapshot: ${unknownEntries.join(',')}`);
        const restored = restoreRequirementScope(current, scope);
        const scopeProblem = requirementScopeProblem(restored);
        if (scopeProblem) throw new Error(`Recovered requirement scope is invalid: ${scopeProblem}`);
        const scopeRevision = this.event('requirement_scope_recovered', id, current, restored);
        restored.updatedAt = time();
        this.setRecord('requirement', restored, scopeRevision);
        requirementIds.push(id);
      }
      return {
        recovered: true,
        fromSnapshot,
        snapshotId: recoverySnapshotId,
        batchId: sourceSnapshot.batchId,
        semanticRevision: this.meta('revision'),
        restored: {
          groupCount: sourceSnapshot.projection.group.length,
          entryCount: sourceSnapshot.projection.entry.length,
          requirementIds,
        },
        next: 'graph sync --json',
        developmentAuthorized: false,
      };
    });
  }
  checkpoint(options) {
    const native = new AnalysisStore(this.batchDirectory(options.batch));
    try {
      return transitionWorkflow(native, {
        stageId: options.stage,
        agent: options.agent,
        toStageId: options.to,
        outcome: options.outcome,
        reason: options.reason,
        requestId: options.requestId,
        expectedIndexRevision: options.expectedRevision,
      });
    } finally { native.close(); }
  }
  brief(options = {}) {
    const native = new AnalysisStore(this.batchDirectory(options.batch));
    try { return workflowBrief(native, { maxBytes: options.maxBytes }); }
    finally { native.close(); }
  }
  acceptedEvidenceProblems(accepted, { requireExtractor = true } = {}) {
    const problems = [];
    if (!accepted) return problems;
    try {
      const snapshot = JSON.parse(this.db.prepare('SELECT body FROM snapshots WHERE id=?').get(accepted.snapshotId).body);
      if (requireExtractor && snapshot.extractorRevision !== EXTRACTOR_REVISION) problems.push('原型抽取器已变化；需新批次核验');
      const directory = this.batchDirectory(accepted.batchId), base = fs.realpathSync(directory);
      const refs = new Set(Object.values(snapshot.projection).flatMap(rows => rows.flatMap(record => record.evidenceIds ?? [])));
      for (const id of refs) {
        const record = snapshot.evidence.find(evidence => evidence.id === id);
        if (!record || !['path', 'trace'].every(key => {
          const file = path.resolve(directory, record[key]);
          return file.startsWith(directory + path.sep) && fs.realpathSync(file).startsWith(base + path.sep) && digest(fs.readFileSync(file)) === record[`${key}Hash`];
        })) problems.push(`已接受证据损坏或缺失：${id}`);
      }
    } catch (error) { problems.push(`已接受证据不可核验：${error.message}`); }
    return problems;
  }
  sourceState() {
    const source = this.meta('source'); if (!source) return { fresh: false, problems: ['No prototype source'], files: [] };
    const accepted = this.meta('accepted');
    const pending = !accepted || accepted.sourceFingerprint !== source.fingerprint;
    if (source.type === 'runtime') {
      const evidenceProblems = this.acceptedEvidenceProblems(accepted, { requireExtractor: false });
      return {
        fresh: !pending && evidenceProblems.length === 0,
        files: [],
        changedFiles: [],
        problems: [...evidenceProblems, ...(pending ? ['新来源尚未形成已核验结论'] : [])],
      };
    }
    const expected = new Map(source.files.map(f => [f.path, f.sha256]));
    const files = [];
    const visit = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (['.git', 'node_modules', STORE_DIRECTORY].includes(entry.name)) continue;
        const file = path.join(directory, entry.name), relative = path.relative(source.workspaceRoot, file).split(path.sep).join('/');
        if (entry.isSymbolicLink()) files.push({ path: relative, hash: 'symlink-unverified' });
        else if (entry.isDirectory()) visit(file);
        else if (/\.(?:html?|[cm]?js|jsx|tsx?|css|json)$/i.test(file)) files.push({ path: relative, hash: digest(fs.readFileSync(file)) });
      }
    };
    try { visit(path.dirname(source.location)); } catch (error) { return { fresh: false, problems: [`Source unreadable: ${error.message}`], files }; }
    const changes = files.filter(f => expected.get(f.path) !== f.hash).map(f => f.path);
    for (const ref of expected.keys()) if (!files.some(f => f.path === ref)) changes.push(ref);
    const evidenceProblems = this.acceptedEvidenceProblems(accepted);
    return { fresh: changes.length === 0 && !pending && evidenceProblems.length === 0, files, changedFiles: changes, problems: [...evidenceProblems, ...changes.map(f => `原型源码变化：${f}；先新建分析批次并核验`), ...(pending ? ['新来源尚未形成已核验结论'] : [])] };
  }
  acceptedSourceState() {
    const accepted = this.meta('accepted'), current = this.meta('source');
    const pending = !accepted || accepted.sourceFingerprint !== current?.fingerprint;
    const recovered = Boolean(accepted?.recoveredFrom
      && accepted?.sourceEquivalence?.currentSourceFingerprint === current?.fingerprint);
    const recoveryEvidenceOptions = recovered ? { requireExtractor: false } : null;
    if (!accepted) return {
      files: [], identity: [], problems: [],
      readiness: { status: 'source_pending', acceptedBatch: null, activeBatch: this.meta('activeBatch'), message: '当前原型来源尚未形成已接受结论' },
    };
    try {
      const native = new AnalysisStore(this.batchDirectory(accepted.batchId), { readOnly: true });
      try {
        const nativeSource = native.meta('source'), map = native.source().map;
        // Runtime snapshots store extractorRevision:null (store.js), so the
        // HTML-extractor pin only applies to static HTML sources.
        const extractorPin = recovered || nativeSource?.type === 'runtime' ? { requireExtractor: false } : {};
        const archivedFiles = list(map.sourceFiles).map(file => ({ path: file.path, hash: file.hash ?? file.sha256 }));
        const activeState = pending ? null : this.sourceState();
        // A source edited in place is still the accepted source identity, not
        // a separate pending batch. Keep its freshness failures visible to
        // planning and delivery; only a newly registered, unaccepted source
        // is held outside the released-map fingerprint.
        const files = recovered ? archivedFiles : activeState?.files ?? archivedFiles;
        const evidenceOptions = recoveryEvidenceOptions ?? (nativeSource?.type === 'runtime' ? { requireExtractor: false } : {});
        const problems = [...new Set([...this.acceptedEvidenceProblems(accepted, evidenceOptions), ...(activeState?.problems ?? [])])];
        return {
          files,
          // A runtime source has no file inventory. Its frozen origin is the
          // stable source identity so accepting a new runtime revision remains
          // a global migration event rather than disappearing behind [].
          identity: recovered ? archivedFiles : nativeSource?.type === 'runtime' ? map.origin : files,
          problems,
          readiness: pending
            ? { status: 'source_pending', acceptedBatch: accepted.batchId, activeBatch: this.meta('activeBatch'), message: '当前新来源尚未验收；已发布地图仍基于已接受来源' }
            : problems.length
              ? { status: 'source_invalid', acceptedBatch: accepted.batchId, activeBatch: this.meta('activeBatch'), message: '已接受原型证据不可核验' }
              : { status: 'ready', acceptedBatch: accepted.batchId, activeBatch: this.meta('activeBatch'), ...(recovered ? { recoveredFrom: accepted.recoveredFrom } : {}) },
        };
      } finally { native.close(); }
    } catch (error) {
      return {
        files: [], identity: [], problems: [`已接受来源不可读取：${error.message}`],
        readiness: { status: 'source_invalid', acceptedBatch: accepted.batchId, activeBatch: this.meta('activeBatch'), message: '已接受原型来源不可读取' },
      };
    }
  }
  revisionFor(source, { planning = false } = {}) {
    const records = type => this.rows(type).map(({ revision, sourceBatch, evidenceIds, updatedAt, ...record }) => record);
    const groups = records('group'), entries = records('entry'), questions = records('question'), allRequirements = records('requirement'), notes = records('note');
    const nodes = records('node'), edges = records('edge');
    const scopeProblems = planning
      ? allRequirements.filter(record => record.status !== 'withdrawn').map(record => ({ id: record.id, problem: requirementScopeProblem(record) ?? this.requirementKnownScopeProblem(record) })).filter(item => item.problem)
      : [];
    const invalidRequirementIds = new Set(scopeProblems.map(item => item.id));
    // Invalid legacy requirements remain visible through semantic queries, but
    // cannot silently alter a released feature-map fingerprint as global work.
    const requirements = planning ? allRequirements.filter(record => !invalidRequirementIds.has(record.id)) : allRequirements;
    const groupContainsRequirement = (record, groupId) => record.groupId === groupId;
    const groupRevisions = groups.map(group => ({ id: group.id, entryIds: entries.filter(e => e.feature === group.id).map(e => e.id).sort(), hash: digest(canonical({ group, nodes: nodes.filter(n => n.groupId === group.id), edges: edges.filter(e => nodes.some(n => n.id === e.from && n.groupId === group.id)), questions: questions.filter(q => q.groupId === group.id), requirements: requirements.filter(r => groupContainsRequirement(r, group.id)), notes: notes.filter(r => r.groupId === group.id) })) }));
    const entryRevisions = entries.map(entry => {
      const entryRequirements = planning ? requirements.filter(record => list(record.entryIds).includes(entry.id)) : [];
      return { id: entry.id, groupId: entry.feature, hash: digest(canonical({ entry, nodes: nodes.filter(n => n.entryIds?.includes(entry.id)), edges: edges.filter(e => nodes.some(n => n.id === e.from && n.entryIds?.includes(entry.id))), ...(entryRequirements.length ? { requirements: entryRequirements } : {}) })) };
    });
    const unassigned = planning
      ? [
          ...questions.filter(record => !record.groupId || !groups.some(group => group.id === record.groupId)),
          ...notes.filter(record => !record.groupId || !groups.some(group => group.id === record.groupId)),
          ...requirements.filter(record => record.status !== 'withdrawn' && record.impactScope === 'global'),
        ]
      : [...questions, ...requirements, ...notes].filter(record => !record.groupId || !groups.some(group => group.id === record.groupId));
    const revision = { schemaVersion: 1, semanticRevision: this.meta('revision'), groups: groupRevisions, entries: entryRevisions, requirements: requirements.map(r => ({ id: r.id, hash: digest(canonical(r)) })), questions: questions.map(q => ({ id: q.id, hash: digest(canonical(q)) })), global: digest(canonical({ source: source.identity ?? source.files, unassigned })), files: { semantic: this.meta('accepted')?.fingerprint ?? null }, sourceFiles: source.files, sourceProblems: source.problems };
    // Progress/index revisions and readiness diagnostics are absent from the
    // product fingerprint. A pending source blocks publishing, not use of the
    // already accepted map.
    const fingerprint = digest(canonical({ ...revision, semanticRevision: undefined }));
    if (!planning) return { ...revision, fingerprint };
    const planningReadiness = { ...source.readiness, scopeProblems };
    if (scopeProblems.length && planningReadiness.status === 'ready') {
      planningReadiness.status = 'scope_required';
      planningReadiness.message = '存在未声明影响范围的需求';
    }
    return { ...revision, planningReadiness, fingerprint };
  }
  revision() { return this.revisionFor(this.sourceState()); }
  planningRevision() { return this.revisionFor(this.acceptedSourceState(), { planning: true }); }
  batchSummary(id) {
    const directory = this.batchDirectory(id);
    const store = new AnalysisStore(directory, { readOnly: true });
    try {
      const scope = store.meta('scope'), source = store.meta('source');
      const counts = Object.fromEntries(store.db.prepare('SELECT type, count(*) n FROM records GROUP BY type').all().map(row => [row.type, row.n]));
      const accepted = Boolean(this.db.prepare("SELECT 1 FROM snapshots WHERE json_extract(body, '$.batchId')=? LIMIT 1").get(id));
      const blocked = store.db.prepare("SELECT count(*) n FROM records WHERE status='blocked'").get().n > 0;
      const events = this.db.prepare("SELECT revision, at, kind FROM events WHERE subject=? AND kind IN ('source_registered','analysis_requirements_registered','analysis_requirements_frozen','analysis_accepted') ORDER BY revision DESC LIMIT 20").all(id).reverse();
      const titles = { source_registered: '登记原型来源', analysis_requirements_registered: '保存本次分析要求', analysis_requirements_frozen: '冻结本次分析要求', analysis_accepted: '验收分析结论' };
      const sourceLabel = source.type === 'runtime' ? source.locator.url ?? source.locator.localPreview : source.location;
      return {
        id, title: `${scope.mode === 'full' ? '全量原型分析' : '指定范围原型分析'} · ${path.basename(sourceLabel)}`,
        active: id === this.meta('activeBatch'), accepted,
        status: accepted ? 'done' : blocked ? 'blocked' : 'pending',
        createdAt: store.meta('createdAt'), source: sourceLabel,
        scope: scope.mode, observableBoundary: String(scope.observableBoundary ?? '').slice(0, 1000),
        analysisRequirements: requirementsBrief(scope.analysisRequirements),
        counts, indexRevision: store.meta('revision'),
        executionLog: [{ id: 'created', at: store.meta('createdAt'), title: '创建分析批次' }, ...events.map(event => ({ id: String(event.revision), at: event.at, title: titles[event.kind] }))],
        reportPath: fs.existsSync(path.join(directory, 'report.md')) ? `prototype/analyses/${id}/report.md` : null,
      };
    } finally { store.close(); }
  }
  page(collection, options = {}) {
    const cursor = Number(options.cursor ?? 0), limit = Number(options.limit ?? 20), revision = this.meta('revision');
    if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid pagination');
    if (cursor > 0 && options.revision === undefined || options.revision !== undefined && Number(options.revision) !== revision) throw new Error('Semantic cursor needs current revision; restart at cursor 0');
    const mapping = { groups: 'group', entries: 'entry', nodes: 'node', edges: 'edge', questions: 'question', requirements: 'requirement', notes: 'note' };
    let rows;
    if (collection === 'changes') rows = this.db.prepare('SELECT revision,at,kind,subject,body FROM events ORDER BY revision').all().map(r => ({ id: String(r.revision), ...r, ...JSON.parse(r.body), body: undefined }));
    else if (collection === 'snapshots') rows = this.db.prepare('SELECT body FROM snapshots ORDER BY id').all().map(r => JSON.parse(r.body));
    else if (collection === 'batches') rows = fs.existsSync(path.join(this.directory, 'analyses')) ? fs.readdirSync(path.join(this.directory, 'analyses'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
      try { return this.batchSummary(entry.name); }
      catch { return { id: entry.name, title: entry.name, status: 'unverified', error: '该次分析记录暂时无法读取' }; }
    }).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')) || b.id.localeCompare(a.id)) : [];
    else if (mapping[collection]) rows = this.rows(mapping[collection]);
    else throw new Error('Unknown semantic collection');
    rows = rows.filter(r => (!options.id || r.id === options.id) && (!options.group || r.groupId === options.group || r.feature === options.group || collection === 'edges' && this.get('node', r.from)?.groupId === options.group) && (!options.status || r.status === options.status) && (!options.subject || r.subject === options.subject));
    const items = rows.slice(cursor, cursor + limit).map(r => {
      if (options.field) {
        const text = json(options.field === 'record' ? r : r[options.field]) ?? 'null', offset = Number(options.textOffset ?? 0), size = Number(options.textLimit ?? 2048);
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(size) || size < 1 || size > 8192) throw new Error('Invalid text page');
        return { type: collection, id: r.id, field: options.field, text: text.slice(offset, offset + size), nextTextOffset: offset + size < text.length ? offset + size : null };
      }
      return options.detail ? { type: collection, id: r.id, record: r } : { type: collection, id: r.id, revision: r.revision, status: r.status, title: String(r.title ?? r.question ?? r.text ?? r.label ?? r.kind ?? '').slice(0, 240), groupId: r.groupId ?? r.feature, origin: r.origin, sourceBatch: r.sourceBatch, evidenceIds: (r.evidenceIds ?? []).slice(0, 3) };
    });
    return boundedPage(items, { revision, cursor, nextCursor: cursor + limit < rows.length ? cursor + limit : null, maxBytes: options.maxBytes });
  }
  reportStatus() {
    const report = this.meta('report'), revision = this.meta('revision');
    const generationError = this.meta('reportGenerationError');
    if (generationError?.semanticRevision === revision) return { status: 'generation_failed', reason: 'generation_error', nextCommand: 'prototype report --json', semanticRevision: report?.semanticRevision ?? null, currentSemanticRevision: revision, message: generationError.message };
    if (!report) return { status: 'not_materialized', reason: 'never_generated', nextCommand: 'prototype report --json', semanticRevision: null, currentSemanticRevision: revision };
    if (!fs.existsSync(path.join(this.directory, 'report.md'))) return { status: 'not_materialized', reason: 'file_missing', nextCommand: 'prototype report --json', semanticRevision: report.semanticRevision, currentSemanticRevision: revision, batchId: report.batchId };
    if (report.semanticRevision !== revision) return { status: 'stale', reason: 'semantic_changed', nextCommand: 'prototype report --json', semanticRevision: report.semanticRevision, currentSemanticRevision: revision, batchId: report.batchId };
    try {
      const native = new AnalysisStore(this.batchDirectory(report.batchId), { readOnly: true });
      try {
        if (native.meta('revision') !== report.indexRevision) return { status: 'stale', semanticRevision: report.semanticRevision, currentSemanticRevision: revision, batchId: report.batchId, reason: 'traversal_changed', nextCommand: 'prototype audit --json' };
      } finally { native.close(); }
    } catch (error) {
      return { status: 'stale', semanticRevision: report.semanticRevision, currentSemanticRevision: revision, batchId: report.batchId, reason: 'batch_unreadable', nextCommand: 'prototype status --json', message: String(error instanceof Error ? error.message : error).slice(0, 500) };
    }
    return { status: 'ready', semanticRevision: report.semanticRevision, currentSemanticRevision: revision, batchId: report.batchId, formatVersion: report.formatVersion };
  }
  status() {
    const revision = this.revision(), source = this.meta('source'), counts = {};
    for (const type of ['group', 'entry', 'question', 'requirement', 'note']) counts[type] = this.db.prepare('SELECT count(*) n FROM semantic WHERE type=?').get(type).n;
    const reportStatus = this.reportStatus();
    const sourceSummary = source?.type === 'runtime' ? { type: source.type, adapter: source.adapter, revision: source.revision } : source ? { type: source.type, location: source.location } : null;
    const accepted = this.meta('accepted');
    let workflow = null, activeBatchAnalysisRequirements = null;
    try {
      const native = new AnalysisStore(this.batchDirectory());
      try {
        workflow = workflowSummary(native);
        activeBatchAnalysisRequirements = requirementsBrief(native.meta('scope')?.analysisRequirements);
      } finally { native.close(); }
    } catch {}
    return {
      schemaVersion: 2,
      status: revision.sourceProblems.length ? 'stale' : 'ready',
      activeBatch: this.meta('activeBatch'),
      acceptedBatch: accepted?.batchId ?? null,
      semanticRevision: this.meta('revision'),
      fingerprint: revision.fingerprint,
      source: sourceSummary,
      workflow,
      analysisRequirements: requirementsBrief(readAnalysisRequirements(this.root)),
      activeBatchAnalysisRequirements,
      acceptedAnalysisRequirements: accepted?.analysisRequirements ?? null,
      counts,
      sourceProblems: revision.sourceProblems.slice(0, 8),
      sourceProblemCount: revision.sourceProblems.length,
      report: storePath('prototype', 'report.md'),
      reportStatus,
      recovery: revision.sourceProblems.length
        ? { layer: 'source_or_evidence', action: 'reobserve', command: 'prototype status --json', message: '来源或已接受证据失效；按缺口重新取证并接受。仅重建报告不能修复。' }
        : { layer: 'report', action: reportStatus.status === 'ready' ? 'none' : 'rebuild', command: reportStatus.nextCommand ?? null },
      next: revision.sourceProblems.length ? 'prototype next --json' : 'feature impact',
    };
  }
}
