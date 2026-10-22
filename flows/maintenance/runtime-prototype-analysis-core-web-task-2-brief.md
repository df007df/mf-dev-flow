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
