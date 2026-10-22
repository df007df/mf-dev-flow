## Task 3: Add workflow state, checkpoint routing and command ownership gates

**Files:**

- Create: `modules/prototype/core/workflow.mjs`
- Modify: `modules/prototype/core/store.js:123-284`
- Modify: `modules/prototype/catalog.js:123-155,270-275`
- Modify: `modules/prototype/analysis-cli.mjs:22-53`
- Modify: `modules/prototype/cli.mjs:86-154`
- Modify: `modules/prototype/tests/runtime-workflow.test.mjs`

**Interfaces:**

- Produces `workflowState(store): { activeStageId, status, history }`.
- Produces `assertWorkflowCommand(store, { command, agent, recordTypes? })`.
- Produces `transitionWorkflow(store, { stageId, agent, toStageId, outcome, reason, requestId, expectedIndexRevision })`.
- Adds `prototype checkpoint --stage <ID> --agent <ID> --to <ID> --outcome validated|gap --reason <text> --request-id <ID> --expected-revision <native-index-N>`.
- Adds `prototype brief --max-bytes <N>` and adds bounded `workflow` metadata to `next`/`query` responses.

Extend the Task 2 test helpers with the following complete command helpers:

```js
function workflowStatus(root) { return prototypeCommand(['status'], root); }
function workflowBrief(root) { return prototypeCommand(['brief'], root); }
function checkpoint(root, stage, agent, to, outcome, reason, requestId) {
  return prototypeCommand([
    'checkpoint', '--stage', stage, '--agent', agent, '--to', to,
    '--outcome', outcome, '--reason', reason, '--request-id', requestId,
    '--expected-revision', String(workflowBrief(root).workflow.indexRevision),
  ], root);
}
function validCaptureArgs(root, snapshotId, agent, requestId) {
  const file = writeInput(root, `${requestId}.json`, runtimeCapturePayload(root, snapshotId));
  return ['capture', '--agent', agent, '--input', file, '--request-id', requestId];
}
function acceptArgs(root, agent, requestId) {
  return ['accept', '--agent', agent, '--request-id', requestId,
    '--expected-revision', String(workflowStatus(root).semanticRevision)];
}
```

`runtimeCapturePayload` writes the existing fixture's valid one-pixel PNG and non-empty JSONL trace, then returns a capture body with `$evidence` referenced by at least one `entry` record. It is defined in the same test helper block before these helpers.

- [ ] **Step 1: Write failing stage ownership and route tests.**

```js
test('only the active stage Agent can mutate a workflow batch', () => {
  const initialized = prototypeCommand(runtimeInitArgs(root, runtimeSource()), root);
  assert.throws(() => prototypeCommand(validCaptureArgs(root, initialized.snapshotId, 'runtime-observe', 'too-early'), root), /当前应先执行 structure-model/);
  const model = writeInput(root, 'model.json', [{
    type: 'group', record: { id: 'home', title: 'Home', purpose: 'Fixture', order: 0, entryNodeIds: [] },
  }]);
  assert.throws(() => prototypeCommand(['put', '--agent', 'audit-accept', '--input', model, '--request-id', 'wrong-owner'], root), /structure-model/);
});

test('validated checkpoints allow only declared transitions and audit gaps loop back', () => {
  prototypeCommand(runtimeInitArgs(root, runtimeSource()), root);
  checkpoint(root, 'structure-model', 'structure-model', 'runtime-observe', 'validated', 'model ready', 'to-observe');
  assert.throws(() => checkpoint(root, 'runtime-observe', 'runtime-observe', 'audit-accept', 'gap', 'invalid direction', 'bad-gap'), /不允许/);
  checkpoint(root, 'runtime-observe', 'runtime-observe', 'audit-accept', 'validated', 'evidence ready', 'to-audit');
  checkpoint(root, 'audit-accept', 'audit-accept', 'runtime-observe', 'gap', 'missing trace', 'back-to-observe');
  assert.equal(workflowStatus(root).workflow.activeStageId, 'runtime-observe');
});
```

- [ ] **Step 2: Run the workflow tests to verify they fail.**

Run: `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs`

Expected: FAIL because no workflow state or checkpoint command exists.

- [ ] **Step 3: Implement the pure workflow module.**

Initialize the native metadata as:

```js
{
  activeStageId: 'structure-model',
  status: 'in_progress',
  history: [{ stageId: 'scope-snapshot', agent: 'scope-snapshot', outcome: 'validated', at, reason: 'init snapshot verified' }]
}
```

`transitionWorkflow` must reject a non-active `stageId`, a mismatched Agent, a target not in that stage's manifest transitions, an invalid outcome, an empty reason for `gap`, and optimistic native-index-revision conflicts. It increments the native analysis index revision and appends immutable transition records `{ id, at, fromStageId, toStageId, agent, outcome, reason }`. `prototype brief` returns this native `workflow.indexRevision`; `prototype status` returns a bounded `workflow` summary containing process/adapter IDs and versions, evidence profile, active stage/Agent, last checkpoint, index revision and status—but no instruction body, hash, locator, session ID or raw source payload. Never allow a stage to skip the graph.

`assertWorkflowCommand` is a no-op for legacy batches without a workflow snapshot. For workflow batches it requires `--agent`, checks the active stage's declared commands, and restricts record types: `structure-model` may write group/entry/node/control/edge/space/vector/candidate; `runtime-observe` may write occurrence/sweep/entry/node/edge/vector through evidence-backed `capture`; `audit-accept` may run audit/checkpoint/accept only.

- [ ] **Step 4: Wire command gates into CLI/catalog/store.**

In `prototypeCommand`, parse `checkpoint` before forwarding commands to `analysis-cli`. Pass the command and agent to store operations; do not use CLI argument inspection as the enforcement point alone. `next`, `query` and `brief` must return exactly the active stage ID, agent ID/hash and bounded frozen instructions; never include a future-stage Agent. Semantic mutations bypass stage ownership but must still refresh accepted reports exactly as today.

In `analysis-cli.execute`, preserve the parsed `options.agent` and pass `{ command, agent, recordTypes }` into `store.query`, `store.put`, `store.capture`, `store.addEvidence` and `store.audit`. Add the gate inside those store methods before their first write or audit result is returned. This keeps direct `analysis-cli` invocation from bypassing `prototypeCommand`.

- [ ] **Step 5: Run focused workflow and public CLI tests.**

Run: `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs .codex/skills/mf-dev-flow/modules/prototype/tests/unified.test.mjs`

Expected: PASS, including legacy `prototype capture` without `--agent` for a non-workflow batch.
