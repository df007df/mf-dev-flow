// Measures only tool source and temporary fixtures; never reads the real project store.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { hookContext, registry } from '../route.mjs';
import { DELIVERY_STAGES, renderDeliveryBrief } from '../../delivery/contract.mjs';
const skill = fileURLToPath(new URL('../../../', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-dev-flow-context-metrics-'));
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
try {
  const entryBytes = fs.statSync(path.join(skill, 'SKILL.md')).size;
  const routes = {};
  for (const flow of registry.flows) routes[flow.id] = { flowEntryBytes: fs.statSync(path.join(skill, flow.entry)).size, skillPlusFlowBytes: entryBytes + fs.statSync(path.join(skill, flow.entry)).size, hookContextBytes: bytes(hookContext({ root, session: 'fixture-session-0000000000000000000000', flow: flow.id })) };
  write(path.join(root, '.mf-dev-flow/current.json'), { active: { type: 'delivery', id: 'fixture-delivery' } });
  write(path.join(root, '.mf-dev-flow/delivery-runs/fixture-delivery/work-plan.json'), { tasks: [{ id: 'fixture-task' }] });
  write(path.join(root, '.mf-dev-flow/delivery-runs/fixture-delivery/executions/fixture-task.json'), { sessionId: 'fixture-session-0000000000000000000000', status: 'in_progress', targetPhase: 'end_to_end_acceptance', stages: { prototype_alignment: { status: 'confirmed' }, api_mock: { status: 'in_progress' } } });
  const result = { schemaVersion: 1, measuredAt: new Date().toISOString(), source: 'tool files and synthetic temporary context', baselineEntryBytes: 15634, entryBytes, entryReductionPercent: Number(((1 - entryBytes / 15634) * 100).toFixed(1)), flowListBytes: bytes({ schemaVersion: registry.schemaVersion, flows: registry.flows }) + 1, routes, boundDeliveryHookBytes: bytes(hookContext({ root, session: 'fixture-session-0000000000000000000000' })), hookHardLimitBytes: 2048, currentStageBriefBytes: Object.fromEntries(DELIVERY_STAGES.map((stage, index) => [stage.id, bytes(renderDeliveryBrief({ targetPhase: DELIVERY_STAGES.at(-1).id, completedStageIds: DELIVERY_STAGES.slice(0, index).map(s => s.id) }))])), limitation: 'UTF-8 byte measurements, not tokenizer counts or measured model usage; first operation may read its own additional protocol.' };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
