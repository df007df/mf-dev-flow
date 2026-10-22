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
