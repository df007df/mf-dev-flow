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
