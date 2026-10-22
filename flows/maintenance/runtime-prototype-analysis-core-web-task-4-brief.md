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
