import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { prototypeAdapterCapabilities, prototypeAdapterList, prototypeCapabilities, prototypeProcessList } from './capabilities.mjs';
import { PrototypeCatalog, catalogDirectory, hasCatalog } from './catalog.js';
import { AnalysisStore, boundedPage } from './core/store.js';
import { digest } from './core/html-source.js';
import { renderReport } from './core/report.js';
import { assertPrototypeReportFormat, PROTOTYPE_REPORT_FORMAT_VERSION, SUPPORTED_PROTOTYPE_REPORT_FORMAT_VERSIONS, reportText } from './core/report-format.js';
import { execute, parseArgs, printResult } from './analysis-cli.mjs';
import { readAnalysisRequirements, requirementsBrief, analysisRequirementsCommand } from './core/analysis-requirements.mjs';
import { STORE_DIRECTORY, temporaryDirectoryPrefix } from '../skill-identity.mjs';

function inputFile(options) {
  if (!options.input || fs.statSync(options.input).size > 1048576) throw new Error('--input file <=1 MiB required');
  return JSON.parse(fs.readFileSync(options.input, 'utf8'));
}
function firstInitialization(root, input, options) {
  // Build and validate away from the live namespace. Readers only recognize the
  // final catalog filename; failed input/source parsing can never shadow history.
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), temporaryDirectoryPrefix('prototype-init')));
  let catalog, lock, installedBatch, temporaryCatalog;
  const directory = catalogDirectory(root);
  try {
    catalog = new PrototypeCatalog(root, { create: true, directory: staging });
    const result = catalog.initializeBatch(input, options);
    catalog.close(); catalog = null;
    fs.mkdirSync(directory, { recursive: true });
    lock = path.join(directory, '.init.lock');
    try { fs.closeSync(fs.openSync(lock, 'wx')); } catch (error) { lock = null; throw error; }
    if (hasCatalog(root)) throw new Error('Catalog initialized concurrently; retry against current revision');
    const target = path.join(directory, 'analyses', result.batchId);
    if (fs.existsSync(target)) throw new Error('Analysis batch exists; choose a new batch ID');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    installedBatch = target; fs.cpSync(path.join(staging, 'analyses', result.batchId), target, { recursive: true, errorOnExist: true, force: false });
    temporaryCatalog = path.join(directory, `.${path.basename(staging)}.sqlite`);
    fs.copyFileSync(path.join(staging, 'catalog.sqlite'), temporaryCatalog, fs.constants.COPYFILE_EXCL);
    fs.renameSync(temporaryCatalog, path.join(directory, 'catalog.sqlite')); temporaryCatalog = null; installedBatch = null;
    return result;
  } finally {
    catalog?.close();
    if (temporaryCatalog) fs.rmSync(temporaryCatalog, { force: true });
    if (installedBatch) fs.rmSync(installedBatch, { recursive: true, force: true });
    if (lock) fs.rmSync(lock, { force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// A report is a validated materialized view of the catalog plus one analysis
// batch. Keep the write in this command layer: public readers must never
// generate a report as a side effect of opening the dashboard.
function materializeReport(catalog, { batch } = {}) {
  const batchId = batch ?? catalog.meta('activeBatch');
  const native = new AnalysisStore(catalog.batchDirectory(batchId));
  let report;
  try { report = renderReport(native); } finally { native.close(); }
  const prefix = path.relative(catalog.directory, catalog.batchDirectory(batchId)).split(path.sep).join('/');
  let markdown = fs.readFileSync(report.report, 'utf8').replace(/\]\((screenshots|traces)\//g, `](${prefix}/$1/`);
  markdown += '\n## 用户问题、回答与需求\n\n遍历证据与用户意图区分保存；用户需求尚未体现在原型中时不计为 observed。\n';
  for (const kind of ['question', 'requirement', 'note']) for (const record of catalog.rows(kind)) {
    markdown += `\n### ${reportText(record.id)} · ${reportText(record.status)} · ${reportText(record.origin)}\n\n内容：${reportText(record.question ?? record.text)}\n\n影响：${reportText(record.impact)}\n\nAgent 回答：${reportText(record.answer)}\n\n结论：${reportText(record.conclusion)}\n`;
  }
  markdown += '\n## 语义变更与回答历史\n';
  for (const event of catalog.db.prepare('SELECT * FROM events ORDER BY revision').iterate()) markdown += `\n- 修订 ${event.revision} · ${reportText(event.at)} · ${reportText(event.kind)} · ${reportText(event.subject)}\n\n  ${reportText(event.body)}\n`;
  assertPrototypeReportFormat(markdown, { canonical: true });
  const file = path.join(catalog.directory, 'report.md'), temporary = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(temporary, markdown); fs.renameSync(temporary, file); } finally { fs.rmSync(temporary, { force: true }); }
  catalog.setMeta('report', { formatVersion: PROTOTYPE_REPORT_FORMAT_VERSION, semanticRevision: catalog.meta('revision'), hash: digest(markdown), batchId, indexRevision: report.revision });
  catalog.setMeta('reportGenerationError', null);
  return { report: file, traversalComplete: report.complete, semanticRevision: catalog.meta('revision'), acceptedBatch: catalog.meta('accepted')?.batchId ?? null, formatVersion: PROTOTYPE_REPORT_FORMAT_VERSION };
}

function refreshAcceptedReport(catalog, batch) {
  const accepted = catalog.meta('accepted');
  if (!accepted) return { status: 'not_materialized' };
  // Do not replace the current accepted report with an in-progress batch.
  const reportBatch = batch ?? catalog.meta('report')?.batchId ?? accepted.batchId;
  try {
    return { status: 'ready', automatic: true, ...materializeReport(catalog, { batch: reportBatch }) };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 500);
    catalog.setMeta('reportGenerationError', { semanticRevision: catalog.meta('revision'), message });
    return { status: 'generation_failed', message };
  }
}

export function prototypeCommand(args, root = process.cwd()) {
  const [command = 'status', action, ...rest] = args;
  if (command === 'capabilities') return prototypeCapabilities();
  if (command === 'process') {
    if (action !== 'list' || rest.length) throw new Error('Usage: prototype process list');
    return prototypeProcessList();
  }
  if (command === 'adapter') {
    if (action === 'list' && !rest.length) return prototypeAdapterList();
    if (action === 'capabilities') {
      const { options } = parseArgs(args.slice(1));
      if (!options.adapter) throw new Error('--adapter required');
      return prototypeAdapterCapabilities(options.adapter);
    }
    throw new Error('Usage: prototype adapter list | prototype adapter capabilities --adapter <id@version>');
  }
  if (command === 'analysis-requirements') return analysisRequirementsCommand(root, args.slice(1));
  const semantic = ['question', 'requirement', 'note'].includes(command);
  const { options } = parseArgs([command, ...(semantic ? rest : args.slice(1))]);
  if (!hasCatalog(root) && ['status', 'summary'].includes(command)) return { schemaVersion: 2, status: 'not_initialized', legacyArchivePresent: fs.existsSync(catalogDirectory(root)), analysisRequirements: requirementsBrief(readAnalysisRequirements(root)), next: 'prototype init --input <file> --request-id <ID> --json' };
  const initialInput = command === 'init' ? inputFile(options) : null;
  if (command === 'init' && initialInput.schemaVersion !== 1) throw new Error('Input schemaVersion must be 1');
  if (command === 'init' && !hasCatalog(root)) return firstInitialization(root, initialInput, options);
  const catalog = new PrototypeCatalog(root);
  try {
    if (command === 'init') return catalog.initializeBatch(initialInput, options);
    if (semantic) {
      const result = catalog.mutate(command, action, inputFile(options), options);
      return { ...result, reportGeneration: refreshAcceptedReport(catalog) };
    }
    if (command === 'accept') {
      const result = catalog.accept(options);
      return { ...result, reportGeneration: refreshAcceptedReport(catalog, result.batchId) };
    }
    if (command === 'recover') {
      const result = catalog.recover(options);
      return { ...result, reportGeneration: refreshAcceptedReport(catalog, result.batchId) };
    }
    if (command === 'checkpoint') return catalog.checkpoint(options);
    if (command === 'brief') return catalog.brief(options);
    if (['status', 'summary'].includes(command)) {
      const status = catalog.status();
      if (status.workflow === null) {
        const { workflow, ...legacy } = status;
        return legacy;
      }
      return status;
    }
    if (command === 'revision') {
      const revision = options.planning ? catalog.planningRevision() : catalog.revision();
      if (!options.collection) { const { groups, entries, requirements, questions, sourceFiles, ...header } = revision; return { ...header, sourceProblems: header.sourceProblems.slice(0, 8), sourceProblemCount: header.sourceProblems.length, counts: { groups: groups.length, entries: entries.length, requirements: requirements.length, questions: questions.length, sourceFiles: sourceFiles.length } }; }
      if (!['groups', 'entries', 'requirements', 'questions', 'sourceFiles'].includes(options.collection)) throw new Error('Invalid revision collection');
      const cursor = Number(options.cursor ?? 0), limit = Number(options.limit ?? 20);
      if (cursor > 0 && options.fingerprint !== revision.fingerprint) throw new Error('Revision fingerprint changed; restart');
      if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid pagination');
      const items = revision[options.collection];
      return boundedPage(items.slice(cursor, cursor + limit).map(r => ({ type: options.collection, id: r.id ?? r.path, ...r })), { cursor, nextCursor: cursor + limit < items.length ? cursor + limit : null, revision: catalog.meta('revision'), maxBytes: options.maxBytes, metadata: { fingerprint: revision.fingerprint } });
    }
    if (command === 'query' && options.collection) return catalog.page(options.collection, options);
    if (command === 'report') return materializeReport(catalog, { batch: options.batch });
    if (command === 'document') {
      const file = path.join(catalog.directory, 'report.md');
      if (!fs.existsSync(file)) throw new Error('Report not materialized; prototype report first');
      const content = fs.readFileSync(file, 'utf8'), report = catalog.meta('report');
      if (!report || report.semanticRevision !== catalog.meta('revision') || digest(content) !== report.hash) throw new Error('Report stale; prototype report first');
      const native = new AnalysisStore(catalog.batchDirectory(report.batchId));
      try { if (native.meta('revision') !== report.indexRevision) throw new Error('Report traversal changed; prototype report first'); } finally { native.close(); }
      const cursor = Number(options.cursor ?? 0), length = Number(options.textLimit ?? 4000);
      if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(length) || length < 1 || length > 8192) throw new Error('Invalid document page');
      if (cursor > 0 && options.fingerprint !== report.hash) throw new Error('Document changed; restart at cursor 0');
      const formatVersion = Number(report.formatVersion);
      if (!SUPPORTED_PROTOTYPE_REPORT_FORMAT_VERSIONS.includes(formatVersion)) throw new Error(`Report format missing or unsupported; prototype report regenerates v${PROTOTYPE_REPORT_FORMAT_VERSION}`);
      assertPrototypeReportFormat(content, { canonical: true, formatVersion });
      return boundedPage([{ type: 'document', id: 'report', text: content.slice(cursor, cursor + length), nextTextOffset: cursor + length < content.length ? cursor + length : null }], { maxBytes: options.maxBytes, revision: catalog.meta('revision'), metadata: { fingerprint: report.hash, formatVersion } });
    }
    if (['next', 'query', 'put', 'evidence', 'capture', 'audit', 'freshness'].includes(command)) {
      const output = catalog.batchDirectory(options.batch);
      const forwarded = args.filter((_, i) => args[i] !== '--batch' && args[i - 1] !== '--batch');
      if (options.out) throw new Error(`Prototype storage is owned by ${STORE_DIRECTORY}/prototype; --out not accepted`);
      if (command === 'put' || command === 'capture') {
        const payload = inputFile(options);
        const batch = command === 'capture' ? payload.records : payload;
        if (!Array.isArray(batch)) throw new Error('Batch array required');
        if (batch.some(r => ['implementationStatus', 'testStatus', 'leafFeatureIds', 'dependsOn', 'stages', 'developmentRecords'].some(key => r.record?.[key] !== undefined))) throw new Error('Development state belongs to planning/delivery records');
        if (batch.some(r => ['question', 'requirement', 'note'].includes(r.type))) throw new Error('Questions/requirements use dedicated semantic commands');
      }
      return execute([...forwarded, '--out', output]);
    }
    throw new Error('Unknown prototype command');
  } finally { catalog.close(); }
}
export function main(args) {
  try {
    if (args[0] === 'analysis-requirements') {
      printResult(prototypeCommand(args));
      return;
    }
    const parsed = ['question', 'requirement', 'note'].includes(args[0]) ? [args[0], ...args.slice(2)] : ['process', 'adapter'].includes(args[0]) ? args.slice(1) : args;
    const { options } = parseArgs(parsed);
    const result = prototypeCommand(args);
    if (['process', 'adapter'].includes(args[0])) process.stdout.write(JSON.stringify(result) + '\n');
    else printResult(result, options.maxBytes);
  }
  catch (error) { process.stderr.write(JSON.stringify({ error: String(error.message).slice(0, 700) }) + '\n'); process.exitCode = 1; }
}
