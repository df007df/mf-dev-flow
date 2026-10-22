import crypto from 'node:crypto';

const json = value => JSON.stringify(value);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${json(key)}:${canonical(value[key])}`).join(',')}}` : json(value);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const required = (value, label) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} required`); return value.trim(); };
const readCommands = new Set(['query', 'next', 'summary', 'freshness', 'brief']);
const recordTypes = {
  'structure-model': new Set(['group', 'entry', 'node', 'control', 'edge', 'space', 'vector', 'candidate']),
  'runtime-observe': new Set(['occurrence', 'sweep', 'entry', 'node', 'edge', 'vector']),
};

function frozenWorkflow(store) {
  const workflow = store.meta('workflow');
  return workflow && typeof workflow === 'object' && Array.isArray(workflow.stages) ? workflow : null;
}

function activeStage(workflow, state) {
  const stage = workflow.stages.find(item => item.id === state.activeStageId);
  if (!stage?.agent?.id) throw new Error('Workflow active stage is invalid');
  return stage;
}

function boundedText(value, maximum) {
  const limit = Math.min(Math.max(Number(maximum) || 2048, 1), 4096);
  let result = '';
  for (const character of String(value ?? '')) {
    if (Buffer.byteLength(result + character) > limit) break;
    result += character;
  }
  return result;
}

function checkpointSummary(entry) {
  if (!entry) return null;
  if (entry.fromStageId) return {
    stageId: entry.fromStageId,
    toStageId: entry.toStageId,
    agentId: entry.agent,
    outcome: entry.outcome,
    at: entry.at,
    reason: entry.reason,
  };
  return {
    stageId: entry.stageId,
    agentId: entry.agent,
    outcome: entry.outcome,
    at: entry.at,
    reason: entry.reason,
  };
}

export function initialWorkflowState(workflow, at = new Date().toISOString()) {
  if (!workflow?.stages?.length) throw new Error('Workflow snapshot required');
  const initial = workflow.stages.find(stage => stage.id === workflow.initialStageId);
  if (!initial?.agent?.id || !initial.transitions?.length) throw new Error('Workflow initial stage is invalid');
  return {
    activeStageId: initial.transitions[0],
    status: 'in_progress',
    history: [{ stageId: initial.id, agent: initial.agent.id, outcome: 'validated', at, reason: 'init snapshot verified' }],
  };
}

export function workflowState(store) {
  if (!frozenWorkflow(store)) return null;
  const state = store.meta('workflowState');
  if (!state || typeof state !== 'object' || !Array.isArray(state.history) || !['in_progress', 'accepted', 'blocked'].includes(state.status)) throw new Error('Workflow state is invalid');
  activeStage(frozenWorkflow(store), state);
  return { activeStageId: state.activeStageId, status: state.status, history: state.history.map(entry => ({ ...entry })) };
}

export function workflowSummary(store) {
  const workflow = frozenWorkflow(store);
  if (!workflow) return null;
  const state = workflowState(store), stage = activeStage(workflow, state);
  return {
    process: { id: workflow.process.id, version: workflow.process.version },
    adapter: { id: workflow.adapter.id, version: workflow.adapter.version },
    evidenceProfile: workflow.evidenceProfile,
    activeStageId: state.activeStageId,
    activeAgentId: stage.agent.id,
    lastCheckpoint: checkpointSummary(state.history.at(-1)),
    indexRevision: store.meta('revision'),
    status: state.status,
  };
}

export function workflowBrief(store, { maxBytes } = {}) {
  const summary = workflowSummary(store);
  if (!summary) return { workflow: null };
  const workflow = frozenWorkflow(store), state = workflowState(store), stage = activeStage(workflow, state);
  return {
    workflow: {
      ...summary,
      activeAgent: {
        id: stage.agent.id,
        sha256: stage.agent.sha256,
        instructions: boundedText(stage.agent.instructions, maxBytes),
      },
    },
  };
}

export function assertWorkflowCommand(store, { command, agent, recordTypes: requestedTypes = [] } = {}) {
  const workflow = frozenWorkflow(store);
  if (!workflow) return null;
  const state = workflowState(store), stage = activeStage(workflow, state);
  if (readCommands.has(command)) return { workflow, state, stage };
  if (state.status !== 'in_progress' && command !== 'accept') throw new Error(`Workflow is ${state.status}; create a new analysis batch`);
  if (typeof agent !== 'string' || !agent.trim() || agent !== stage.agent.id) throw new Error(`当前应先执行 ${state.activeStageId}（Agent: ${stage.agent.id}）`);
  if (!stage.commands.includes(command)) throw new Error(`当前阶段 ${state.activeStageId} 不允许 ${command}`);
  const allowed = recordTypes[state.activeStageId];
  if (requestedTypes.length && (!allowed || requestedTypes.some(type => !allowed.has(type)))) throw new Error(`当前阶段 ${state.activeStageId} 不允许写入这些记录类型`);
  return { workflow, state, stage };
}

export function transitionWorkflow(store, { stageId, agent, toStageId, outcome, reason, requestId, expectedIndexRevision } = {}) {
  required(requestId, 'requestId');
  if (requestId.length > 200) throw new Error('requestId too long');
  const payload = {
    stageId,
    agent,
    toStageId,
    outcome,
    reason: typeof reason === 'string' ? reason.trim() : reason ?? '',
    expectedIndexRevision: Number(expectedIndexRevision),
  };
  const key = `workflow-checkpoint:${requestId}`;
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const existing = store.db.prepare('SELECT hash,result FROM requests WHERE id=?').get(key);
    const hash = digest(canonical(payload));
    if (existing) {
      if (existing.hash !== hash) throw new Error('requestId reused with different payload');
      store.db.exec('COMMIT');
      return JSON.parse(existing.result);
    }
    const current = assertWorkflowCommand(store, { command: 'checkpoint', agent });
    if (!current) throw new Error('Workflow checkpoint requires a workflow batch');
    if (stageId !== current.state.activeStageId) throw new Error(`当前应先执行 ${current.state.activeStageId}`);
    const nextStageId = required(toStageId, 'toStageId');
    if (!['validated', 'gap'].includes(outcome)) throw new Error('checkpoint outcome must be validated or gap');
    const checkpointReason = required(reason, 'checkpoint reason');
    const target = current.workflow.stages.find(stage => stage.id === nextStageId);
    if (!current.stage.transitions.includes(nextStageId) || !target || outcome === 'gap' && target.terminal) throw new Error(`不允许从 ${stageId} 转移到 ${nextStageId}`);
    const actualIndexRevision = store.meta('revision');
    if (!Number.isInteger(Number(expectedIndexRevision)) || Number(expectedIndexRevision) !== actualIndexRevision) throw new Error(`Index revision conflict; expected-revision must be ${actualIndexRevision}`);
    const revision = store.meta('revision') + 1;
    const event = { id: crypto.randomUUID(), at: new Date().toISOString(), fromStageId: stageId, toStageId: nextStageId, agent, outcome, reason: checkpointReason };
    const state = { ...current.state, activeStageId: nextStageId, history: [...current.state.history, event] };
    store.setMeta('workflowState', state);
    store.setMeta('revision', revision);
    const result = { checkpoint: checkpointSummary(event), workflow: workflowSummary(store) };
    store.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(key, hash, json(result));
    store.db.exec('COMMIT');
    return result;
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
}

export function markWorkflowAccepted(store, { agent } = {}) {
  const current = assertWorkflowCommand(store, { command: 'accept', agent });
  if (!current || current.state.status === 'accepted') return workflowSummary(store);
  store.setMeta('workflowState', { ...current.state, status: 'accepted' });
  store.setMeta('revision', store.meta('revision') + 1);
  return workflowSummary(store);
}
