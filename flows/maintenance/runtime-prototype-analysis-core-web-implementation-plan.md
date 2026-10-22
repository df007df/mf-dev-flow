# Runtime Prototype Analysis Core and Web Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the versioned runtime-analysis workflow core and a `web-runtime@1` adapter so a source-less running web prototype can produce a bounded, evidence-backed, runtime-only accepted analysis without weakening existing HTML analysis batches.

**Architecture:** A new prototype process/adapter loader validates immutable manifests and freezes process, stage Agent and adapter snapshots during `prototype init`. A workflow state stored in each new analysis batch gates mutating analysis commands and permits only declared stage transitions. A runtime source snapshot has a caller-supplied immutable revision rather than HTML source discovery; it therefore produces `runtime-only` conclusions and never claims source coverage.

**Tech Stack:** Node.js >=22.18, ES modules, `node:sqlite` `DatabaseSync`, `node:test`, existing prototype catalog/analysis stores, JSON manifests, Markdown Agent instructions.

**Spec:** [runtime-prototype-analysis-design.md](runtime-prototype-analysis-design.md)

## Global Constraints

- Keep all production changes inside `.codex/skills/mf-dev-flow/`, and use isolated temporary fixtures for tests; do not read or modify a real `.mf-dev-flow` directory.
- Preserve the existing local HTML workflow as the default. New workflow behavior activates only when `prototype init` receives both `--process` and `--adapter`.
- Process and adapter specifiers must match `id@positive-integer-version`; definitions, stage files and overlays are bounded, path-contained and SHA-256 snapshotted before any batch write.
- Runtime-only batches require a non-empty immutable `source.revision`; they may report observed coverage only and must not report source candidates, branch coverage, state-space completeness or source-file completeness.
- All real observations still enter only through existing `put`, `capture`, `evidence`, `audit` and `accept` command boundaries. The CLI must not operate a browser, synthesize screenshots or fabricate traces.
- Existing semantic `question`, `requirement` and `note` commands remain cross-stage and retain their revision/history behavior.
- Use test-first implementation. In this dirty checkout do not commit; an executor working in a clean task worktree may commit only files created by that task.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `modules/prototype/processes.mjs` | Validate, load and snapshot versioned process and adapter manifests; compose a stage Agent with an adapter overlay. |
| `modules/prototype/processes/runtime-analysis/v1/process.json` | Declare the `scope-snapshot → structure-model ⇄ runtime-observe → audit-accept` transition graph and command ownership. |
| `modules/prototype/processes/runtime-analysis/v1/agents/*.md` | Independent generic instructions for each runtime-analysis stage. |
| `modules/prototype/adapters/web-runtime/v1/adapter.json` | Describe web locator, navigation, screenshot and trace capabilities plus the runtime-observe overlay. |
| `modules/prototype/adapters/web-runtime/v1/agents/runtime-observe.md` | Web-specific operation and evidence rules layered onto the generic observation Agent. |
| `modules/prototype/core/runtime-source.mjs` | Normalize a runtime source locator/revision and create a no-static-discovery source map. |
| `modules/prototype/core/workflow.mjs` | Pure workflow snapshot/state validation, active-stage lookup, transition checks and command-to-stage authorization. |
| `modules/prototype/core/store.js` | Persist workflow metadata in a batch, branch freshness/audit/materialization for `runtime-only`, and gate low-level writes. |
| `modules/prototype/catalog.js` | Resolve selections before init, persist catalog metadata, expose stage brief/checkpoint handling and protect acceptance. |
| `modules/prototype/analysis-cli.mjs` | Preserve `--agent` and command metadata when forwarding workflow-gated store commands. |
| `modules/prototype/cli.mjs` | Parse new flags and commands, enrich bounded results with current-stage data, preserve legacy command behavior. |
| `modules/prototype/capabilities.mjs` | Report available process and adapter definitions without claiming browser execution. |
| `modules/prototype/core/report.js`, `core/report-format.js` | Render and validate an explicit runtime-only coverage declaration. |
| `dashboard/app/components/prototype-workflow-summary.tsx` | Render a compact, read-only runtime workflow summary only when a batch has workflow metadata. |
| `dashboard/app/components/prototype-catalog.tsx`, `dashboard/app/globals.css` | Place and style the summary in the existing 原型图分析 catalog block without changing the legacy layout. |
| `dashboard/tests/browser/dashboard.spec.ts`, `dashboard/tests/integration/dashboard-smoke.test.mjs` | Verify safe workflow fields render and legacy batches still omit the summary. |
| `modules/prototype/tests/processes.test.mjs` | Isolated loader and snapshot tests. |
| `modules/prototype/tests/runtime-workflow.test.mjs` | Runtime source, stage-gating, transition, acceptance and legacy-compatibility tests. |
| `modules/prototype/tests/unified.test.mjs` | Extend public CLI/capability/report regression coverage. |
| `flows/prototype/{entry,workflow,contract,capture,report-format}.md` | Document explicit process/adapter selection, runtime-only claims and stage handoffs. |

## Task 1: Add versioned process and adapter definition loading

**Files:**

- Create: `modules/prototype/processes.mjs`
- Create: `modules/prototype/processes/runtime-analysis/v1/process.json`
- Create: `modules/prototype/processes/runtime-analysis/v1/agents/scope-snapshot.md`
- Create: `modules/prototype/processes/runtime-analysis/v1/agents/structure-model.md`
- Create: `modules/prototype/processes/runtime-analysis/v1/agents/runtime-observe.md`
- Create: `modules/prototype/processes/runtime-analysis/v1/agents/audit-accept.md`
- Create: `modules/prototype/adapters/web-runtime/v1/adapter.json`
- Create: `modules/prototype/adapters/web-runtime/v1/agents/runtime-observe.md`
- Create: `modules/prototype/tests/processes.test.mjs`

**Interfaces:**

- Produces `parsePrototypeSpecifier(value): { id: string, version: number }`.
- Produces `loadPrototypeProcess({ id, version, root? }): PrototypeProcessSnapshot`.
- Produces `loadPrototypeAdapter({ id, version, root? }): PrototypeAdapterSnapshot`.
- Produces `composePrototypeWorkflow({ process, adapter, evidenceProfile }): PrototypeWorkflowSnapshot`.
- `PrototypeWorkflowSnapshot.stages[*].agent` has `{ id, sha256, instructions, overlaySha256?, overlayInstructions? }`; its `instructions` is the frozen generic Agent text followed by the frozen adapter overlay.
- Consumes only `id@version` strings and an `evidenceProfile` of `runtime-only` or `source-and-runtime`.

- [ ] **Step 1: Write failing loader tests.**

```js
test('runtime process and web adapter snapshot every Agent file before init', () => {
  const process = loadPrototypeProcess({ id: 'runtime-analysis', version: 1 });
  const adapter = loadPrototypeAdapter({ id: 'web-runtime', version: 1 });
  const workflow = composePrototypeWorkflow({ process, adapter, evidenceProfile: 'runtime-only' });
  assert.equal(workflow.initialStageId, 'scope-snapshot');
  assert.deepEqual(workflow.stages.map(stage => stage.id), [
    'scope-snapshot', 'structure-model', 'runtime-observe', 'audit-accept',
  ]);
  assert.match(workflow.stages.find(stage => stage.id === 'runtime-observe').agent.instructions, /网页/);
  assert.equal(workflow.adapter.capabilities.sourceDiscovery, false);
});

test('loader rejects path traversal, unsupported evidence profiles and illegal transitions', () => {
  const process = loadPrototypeProcess({ id: 'runtime-analysis', version: 1 });
  const adapter = loadPrototypeAdapter({ id: 'web-runtime', version: 1 });
  assert.throws(() => parsePrototypeSpecifier('web-runtime'), /id@version/);
  assert.throws(() => loadPrototypeAdapter({ id: '../web-runtime', version: 1 }), /ID/);
  assert.throws(() => composePrototypeWorkflow({ process, adapter, evidenceProfile: 'all' }), /evidenceProfile/);
  assert.throws(() => composePrototypeWorkflow({ process, adapter, evidenceProfile: 'source-and-runtime' }), /sourceDiscovery/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bad-prototype-process-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'bad/v1/agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bad/v1/process.json'), JSON.stringify({
    schemaVersion: 1, id: 'bad', version: 1, initialStageId: 'first',
    stages: [{ id: 'first', agentFile: 'agents/first.md', transitions: ['missing'] }],
  }));
  fs.writeFileSync(path.join(root, 'bad/v1/agents/first.md'), 'first');
  assert.throws(() => loadPrototypeProcess({ id: 'bad', version: 1, root }), /transition/);
});
```

- [ ] **Step 2: Run the new loader test to verify it fails.**

Run: `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs`

Expected: FAIL because `processes.mjs` and manifests do not exist.

- [ ] **Step 3: Implement the loader and manifests.**

Implement the same bounded-file and canonical-hash discipline as `modules/delivery/processes.mjs`, but reject a sequential-only manifest. Require this exact process graph:

```json
{
  "schemaVersion": 1,
  "id": "runtime-analysis",
  "version": 1,
  "initialStageId": "scope-snapshot",
  "stages": [
    {"id":"scope-snapshot","agentFile":"agents/scope-snapshot.md","commands":["init"],"transitions":["structure-model"]},
    {"id":"structure-model","agentFile":"agents/structure-model.md","commands":["put","checkpoint"],"transitions":["runtime-observe"]},
    {"id":"runtime-observe","agentFile":"agents/runtime-observe.md","commands":["put","capture","evidence","checkpoint"],"transitions":["structure-model","audit-accept"]},
    {"id":"audit-accept","agentFile":"agents/audit-accept.md","commands":["audit","checkpoint","accept"],"transitions":["structure-model","runtime-observe"],"terminal":true}
  ]
}
```

Require all paths to remain below their selected version directory. Limit manifest bytes to 256 KiB, Agent/overlay bytes to 64 KiB, reject duplicate stage IDs and missing `initialStageId`, and require every transition target to exist. `web-runtime@1` must declare `sourceDiscovery: false`, `sourceModes: ["url", "local-preview"]`, selector navigation, PNG screenshot and trace archival support; it must expose only a `runtime-observe` overlay.

`composePrototypeWorkflow` must reject `source-and-runtime` unless the selected adapter declares `sourceDiscovery: true`; no v1 runtime adapter meets that condition. This preserves the profile for a later source-aware adapter without allowing a misleading web-runtime selection.

- [ ] **Step 4: Run the loader tests.**

Run: `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs`

Expected: PASS; mutate a temporary copied Agent source in the test and assert the previously returned workflow snapshot still contains the original instructions/hash.

- [ ] **Step 5: Check syntax and diff hygiene.**

Run: `node --check .codex/skills/mf-dev-flow/modules/prototype/processes.mjs && git diff --check -- .codex/skills/mf-dev-flow`

Expected: exit 0.

## Task 2: Support immutable runtime source snapshots and evidence profiles

**Files:**

- Create: `modules/prototype/core/runtime-source.mjs`
- Modify: `modules/prototype/core/store.js:47-64,317-347`
- Modify: `modules/prototype/catalog.js:49-82,123-155`
- Create: `modules/prototype/tests/runtime-workflow.test.mjs`

**Interfaces:**

- Produces `normalizeRuntimeSource(source, adapter): RuntimeSource` where `source` must contain `{ type: 'runtime', adapter: 'web-runtime@1', locator: { url?: string, localPreview?: string }, revision: string }`.
- Produces `runtimeSourceMap(source): { schemaVersion: 1, origin, sourceFiles: [], candidates: [], problems: [], createdAt }`.
- Extends `initialize({ source, scope, workflow?, output })`; the existing HTML signature remains valid.
- Persists native metadata keys `workflow`, `evidenceProfile` and `runtimeSource`; persists catalog source with `type`, locator and revision without credentials or opaque URL query data.

The new test file defines these reusable helpers once, before its tests, and all later tasks use them rather than incomplete inline CLI arguments:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function writeInput(root, name, value) {
  const file = path.join(root, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}
function runtimeInitArgs(root, source, requestId = 'runtime-init') {
  return [
    'init', '--process', 'runtime-analysis@1', '--adapter', 'web-runtime@1',
    '--evidence-profile', 'runtime-only', '--agent', 'scope-snapshot',
    '--input', writeInput(root, `${requestId}.json`, {
      schemaVersion: 1, source,
      scope: { mode: 'full', observableBoundary: 'Synthetic runtime fixture only' },
    }),
    '--request-id', requestId, '--batch', requestId,
  ];
}
function runtimeSource(revision = 'preview-build-42') {
  return {
    type: 'runtime', adapter: 'web-runtime@1',
    locator: { url: 'https://preview.example.test/app' }, revision,
  };
}
function runtimeCapturePayload(root, snapshotId) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const screenshot = path.join(root, 'runtime.png');
  const trace = path.join(root, 'runtime.trace.jsonl');
  fs.writeFileSync(screenshot, png);
  fs.writeFileSync(trace, '{"route":"/app","selector":"#go","action":"click","expected":"Done","actual":"Done"}\n');
  return {
    evidence: {
      snapshotId, path: screenshot, trace, capturedAt: new Date().toISOString(),
      action: 'Open the fixture page and click Go',
      assertion: { expected: 'Done', actual: 'Done', passed: true },
      capture: { target: '#app', zoom: 1, deviceScaleFactor: 1, sourceUnchanged: true, fullTargetVisible: true, outputSize: { width: 1, height: 1 } },
    },
    records: [
      { type: 'entry', record: { id: 'home', feature: 'home', status: 'covered', evidenceIds: ['$evidence'] } },
      { type: 'node', record: { id: 'home', label: 'Home', purpose: 'Fixture screen', groupId: 'home', values: {}, resetAction: 'Open fixture', entryIds: ['home'], status: 'covered', evidenceIds: ['$evidence'] } },
      { type: 'edge', record: { id: 'go', from: 'home', to: 'home', controlId: 'go', action: { type: 'click', target: '#go', force: false, script: false }, inputClass: 'none', outcomeKey: 'done', outcome: 'Done', status: 'covered', evidenceIds: ['$evidence'] } },
      { type: 'occurrence', record: { id: 'home-go', nodeId: 'home', controlId: 'go', edgeIds: ['go'] } },
      { type: 'sweep', record: { id: 'home', nodeId: 'home', complete: true, discoveryIds: ['home-go'], status: 'covered', evidenceIds: ['$evidence'] } },
    ],
  };
}
```

- [ ] **Step 1: Write failing runtime-only initialization tests.**

```js
test('runtime-only init freezes a revisioned web locator without HTML discovery', () => {
  const result = prototypeCommand([
    'init', '--process', 'runtime-analysis@1', '--adapter', 'web-runtime@1',
    '--evidence-profile', 'runtime-only', '--agent', 'scope-snapshot',
    '--input', input(root, {
      schemaVersion: 1,
      source: { type: 'runtime', adapter: 'web-runtime@1', locator: { url: 'https://preview.example.test/app' }, revision: 'preview-build-42' },
      scope: { mode: 'full', observableBoundary: 'test preview only' },
    }),
    '--request-id', 'runtime-init', '--batch', 'runtime-web',
  ], root);
  assert.equal(result.workflow.activeStageId, 'structure-model');
  assert.equal(result.evidenceProfile, 'runtime-only');
  assert.deepEqual(new AnalysisStore(batch(root, 'runtime-web')).source().map.sourceFiles, []);
});

test('runtime-only source rejects absent revision, HTML candidates and source-complete claims', () => {
  assert.throws(() => prototypeCommand(runtimeInitArgs(root, runtimeSource(''), 'missing-revision'), root), /revision/);
});
```

- [ ] **Step 2: Run the runtime workflow test to verify it fails.**

Run: `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs`

Expected: FAIL because `prototype init` has no process/adapter/evidence-profile parsing and only accepts HTML source discovery.

- [ ] **Step 3: Implement runtime source normalization and initialization branching.**

Keep `html-source.js` untouched. In `store.js`, branch `initialize` and `freshness` by `source.type`: HTML uses the existing discoverer unchanged; runtime uses `runtimeSourceMap` and requires the frozen explicit revision. Runtime freshness must still reject analysis-requirements changes and corrupted archived evidence, but it must never infer that a remote source has not changed. Report this as `sourceFreshness: "declared-revision"`; acceptance must echo the frozen revision.

In `catalog.initializeBatch`, resolve and validate process/adapter/workflow before creating the marker or output directory. Store the workflow snapshot in the native batch metadata and store a sanitized runtime source summary in catalog metadata. Remove URL credentials, fragments and query text before persisting locator summaries; reject locators containing credentials.

- [ ] **Step 4: Add runtime-only audit semantics.**

Update `AnalysisStore.materialize()` and `audit()` so an empty static source inventory is valid only when `evidenceProfile === 'runtime-only'`. Require at least one group, entry, node, control/occurrence, sweep and archived evidence before audit can complete; do not require `candidate`, `sourceIds`, source branch outcomes or state-space vectors in runtime-only mode. Retain the current stricter graph audit for HTML/source-and-runtime mode.

- [ ] **Step 5: Run focused tests.**

Run: `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/analysis.test.mjs .codex/skills/mf-dev-flow/modules/prototype/tests/analysis-requirements.test.mjs .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs`

Expected: PASS. Existing HTML tests must prove their candidate/source completeness behavior did not change.

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

## Task 4: Gate audit/acceptance and render runtime-only conclusions honestly

**Files:**

- Modify: `modules/prototype/core/graph-audit.js`
- Modify: `modules/prototype/core/report.js`
- Modify: `modules/prototype/core/report-format.js`
- Modify: `modules/prototype/catalog.js:123-155,253-275`
- Modify: `modules/prototype/tests/runtime-workflow.test.mjs`
- Modify: `modules/prototype/tests/unified.test.mjs`

**Interfaces:**

- `graphProblems(facts)` branches only on `facts.workflow.evidenceProfile`.
- `prototype accept` for a workflow batch requires `activeStageId === 'audit-accept'`, `--agent audit-accept`, a complete audit and no stale workflow/source state.
- `renderReport(store)` exposes `evidenceProfile` and a coverage declaration derived from batch metadata.

- [ ] **Step 1: Write failing acceptance/report tests.**

```js
function completedRuntimeWorkflow(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-workflow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initialized = prototypeCommand(runtimeInitArgs(root, runtimeSource(), 'complete-runtime'), root);
  const modelFile = writeInput(root, 'runtime-model.json', [
    { type: 'group', record: { id: 'home', title: 'Home', purpose: 'Fixture flow', order: 0, entryNodeIds: ['home'] } },
    { type: 'control', record: { id: 'go', locator: '#go', event: 'click', sourceIds: [] } },
  ]);
  prototypeCommand(['put', '--agent', 'structure-model', '--input', modelFile, '--request-id', 'runtime-model'], root);
  checkpoint(root, 'structure-model', 'structure-model', 'runtime-observe', 'validated', 'model ready', 'model-checkpoint');
  prototypeCommand(validCaptureArgs(root, initialized.snapshotId, 'runtime-observe', 'runtime-capture'), root);
  checkpoint(root, 'runtime-observe', 'runtime-observe', 'audit-accept', 'validated', 'evidence ready', 'evidence-checkpoint');
  return { root };
}

test('runtime-only acceptance refuses source-coverage claims and writes its limit into the report', t => {
  const f = completedRuntimeWorkflow(t);
  assert.throws(() => prototypeCommand(acceptArgs(f.root, 'runtime-observe', 'wrong-accept-agent'), f.root), /audit-accept/);
  const accepted = prototypeCommand(acceptArgs(f.root, 'audit-accept', 'accept-runtime'), f.root);
  assert.equal(accepted.evidenceProfile, 'runtime-only');
  const report = fs.readFileSync(path.join(f.root, '.mf-dev-flow/prototype/report.md'), 'utf8');
  assert.match(report, /运行态覆盖/);
  assert.match(report, /不声明源码全覆盖/);
  assert.doesNotMatch(report, /源码候选已全部覆盖/);
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs`

Expected: FAIL because accept lacks workflow ownership and the report has no evidence-profile declaration.

- [ ] **Step 3: Implement evidence-profile-aware audit/report/acceptance.**

Preserve every current HTML/source-and-runtime condition in `graph-audit.js`. For runtime-only, replace only source-derived requirements with the minimum observed-runtime set defined in Task 2. Put an explicit sentence in the fixed “覆盖与未覆盖” report section: `证据等级：运行态覆盖。本报告只描述已实际观察并归档证据的行为；不声明源码、隐藏分支或未观察状态的完整性。` Extend the report format validator to require that sentence only for runtime-only reports.

Require that `accept` observes both the complete audit and the active audit stage. On success, set workflow status to `accepted`, append the acceptance transition/history record and include frozen process/adapter/evidence-profile identifiers in the accepted snapshot metadata without changing semantic fingerprint rules for equivalent observed behavior.

- [ ] **Step 4: Run the complete prototype module suite.**

Run: `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/*.test.mjs`

Expected: PASS with current HTML report-format and public API expectations intact.

## Task 5: Register `web-runtime@1`, document the public workflow and verify compatibility

**Files:**

- Modify: `modules/prototype/capabilities.mjs`
- Modify: `modules/prototype/cli.mjs:86-154`
- Modify: `scripts/mf-dev-flow.mjs:12-36` only if top-level command dispatch needs explicit process/adapter subcommands
- Modify: `flows/prototype/entry.md`
- Modify: `flows/prototype/workflow.md`
- Modify: `flows/prototype/contract.md`
- Modify: `flows/prototype/capture.md`
- Modify: `flows/prototype/report-format.md`
- Modify: `modules/prototype/tests/unified.test.mjs`

**Interfaces:**

- `prototype process list` returns only manifest ID/version/title/stage IDs/hashes; no Agent instruction bodies.
- `prototype adapter list` returns ID/version/title/capability summary; `prototype adapter capabilities --adapter web-runtime@1` returns bounded declarative capabilities.
- `prototype capabilities` distinguishes `analysisAdapters` (static discovery) from `runtimeAdapters` (Agent-operated environment contracts).

- [ ] **Step 1: Write failing public-command and legacy tests.**

```js
test('public capabilities distinguish static HTML from runtime web support', () => {
  const capabilities = prototypeCommand(['capabilities'], root);
  assert.deepEqual(capabilities.analysisAdapters.map(item => item.id), ['html']);
  assert.deepEqual(capabilities.runtimeAdapters.map(item => item.id), ['web-runtime']);
  assert.equal(prototypeCommand(['adapter', 'capabilities', '--adapter', 'web-runtime@1'], root).capabilities.sourceDiscovery, false);
});

test('legacy HTML init remains byte-for-byte compatible without process flags', () => {
  const before = prototypeCommand(['status'], legacyRoot);
  prototypeCommand(legacyHtmlInitArgs, legacyRoot);
  assert.equal(prototypeCommand(['status'], legacyRoot).workflow, undefined);
  assert.equal(before.status, 'not_initialized');
});
```

- [ ] **Step 2: Run the public command test to verify it fails.**

Run: `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/unified.test.mjs`

Expected: FAIL because runtime adapter listing/capabilities are not exposed.

- [ ] **Step 3: Implement public discovery and documentation.**

Expose manifests through loader-backed read-only commands. Do not advertise that Node CLI controls a browser: documentation and capability output must state that the active stage Agent uses available browser automation and must archive actual screenshot/trace files through `prototype capture`.

Document this exact web batch command and its evidence limitation:

```bash
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs prototype init \
  --process runtime-analysis@1 --adapter web-runtime@1 \
  --evidence-profile runtime-only --agent scope-snapshot \
  --input input.json --request-id web-analysis-001
```

Document checkpoint syntax, the build/preview revision requirement, stages that may loop, and the fact that legacy HTML batches do not acquire new stage gates.

- [ ] **Step 4: Run regression suites and static checks.**

Run:

```bash
node --check .codex/skills/mf-dev-flow/modules/prototype/processes.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/core/runtime-source.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/core/workflow.mjs
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/*.test.mjs
node --test .codex/skills/mf-dev-flow/modules/workflow/tests/*.test.mjs .codex/skills/mf-dev-flow/scripts/*.test.mjs
```

Expected: all newly added runtime workflow tests pass; any pre-existing unrelated failure is recorded separately and not “fixed” by weakening prototype gates.

- [ ] **Step 5: Review changed files before handoff.**

Run: `git diff --check -- .codex/skills/mf-dev-flow && git status --short -- .codex/skills/mf-dev-flow`

Expected: no whitespace errors; only the planned mf-dev-flow files are changed. Do not commit from this current untracked workspace.

## Task 6: Surface safe runtime workflow context in the 原型图分析 dashboard block

**Files:**

- Create: `dashboard/app/components/prototype-workflow-summary.tsx`
- Modify: `dashboard/app/components/prototype-catalog.tsx:111-214`
- Modify: `dashboard/app/globals.css`
- Modify: `dashboard/tests/browser/dashboard.spec.ts`
- Modify: `dashboard/tests/integration/dashboard-smoke.test.mjs`

**Interfaces:**

- `PrototypeCatalog.status()` exposes `workflow` only for new workflow batches:

```js
{
  process: { id, version },
  adapter: { id, version },
  evidenceProfile: 'runtime-only' | 'source-and-runtime',
  activeStage: { id, agentId } | null,
  lastCheckpoint: { outcome: 'validated' | 'gap', at, reason } | null,
  indexRevision: 0,
  status: 'in_progress' | 'accepted' | 'stale' | 'blocked'
}
```

- `PrototypeWorkflowSummary` returns `null` when `workflow` is absent, has `aria-label="运行态分析状态"` when rendered, and displays only the approved bounded fields. It maps `runtime-only` to `运行态覆盖` and explains that the conclusion covers only observed, archived behavior.
- Never render Agent instructions, manifest hashes, raw source locators (including query strings), local paths, session IDs, capture payloads or credentials. The existing report dialog remains the place for report content.

- [ ] **Step 1: Write failing dashboard assertions.**

Provide a runtime workflow fixture through the normal dashboard state path and assert it renders a compact summary:

```ts
const summary = page.getByLabel('运行态分析状态');
await expect(summary).toContainText('流程 runtime-analysis@1');
await expect(summary).toContainText('适配器 web-runtime@1');
await expect(summary).toContainText('证据等级 运行态覆盖');
await expect(summary).toContainText('当前阶段 structure-model');
await expect(summary).not.toContainText('token=');
```

In the legacy native/HTML fixture, assert `getByLabel('运行态分析状态')` has count zero.

- [ ] **Step 2: Run the focused dashboard test to verify it fails.**

Run the existing dashboard browser/integration command used by this repository for `dashboard.spec.ts` and `dashboard-smoke.test.mjs`.

Expected: FAIL because the catalog block does not yet render workflow metadata.

- [ ] **Step 3: Implement the compact, read-only summary.**

Render the summary first in the existing `prototype-overview-grid` only if `data.workflow` exists. Keep its labels short: 流程, 适配器, 证据等级, 当前阶段, 最近检查点, 分析状态. For an absent checkpoint, show `尚未检查`; for an accepted batch, the current stage may be omitted or shown as `已验收`. Reuse existing neutral/status CSS tokens and keep mobile wrapping intact. Do not add an API endpoint or a second dashboard fetch: `prototypeSummary()` already forwards catalog `status()`.

- [ ] **Step 4: Verify safe rendering and regressions.**

Run the focused browser and integration tests, then the relevant dashboard lint/typecheck command. Inspect the workflow component and fixture to prove sensitive raw fields are neither accepted as props nor rendered.

Expected: runtime batches expose operational context; legacy cards retain their current requirements/history/report layout; no secret-like fixture source string appears in the DOM.
