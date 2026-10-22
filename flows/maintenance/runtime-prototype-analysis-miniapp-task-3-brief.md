## Task 3: Test stage-gated Mini Program evidence and public capability discovery

**Files:**

- Modify: `modules/prototype/tests/runtime-workflow.test.mjs`
- Modify: `modules/prototype/tests/unified.test.mjs`
- Modify: `modules/prototype/capabilities.mjs`
- Modify: `modules/prototype/cli.mjs`

**Interfaces:**

- `prototype adapter list` includes both `web-runtime@1` and `wechat-miniapp-runtime@1` after registration.
- `prototype adapter capabilities --adapter wechat-miniapp-runtime@1` returns the declarative capability summary but no operating credentials/session IDs.
- `prototype capture --agent runtime-observe` accepts the same fixture PNG/trace payload used by web runtime tests after the workflow reaches `runtime-observe`.

- [ ] **Step 1: Write failing integration tests.**

```js
test('miniapp runtime batch uses the common stage gate and evidence archive', () => {
  const f = initializedMiniappBatch();
  assert.throws(() => captureMiniappEvidence(f), /当前应先执行 structure-model/);
  checkpoint(f, 'structure-model', 'structure-model', 'runtime-observe', 'validated');
  const result = captureMiniappEvidence(f);
  assert.equal(result.evidence.verified, true);
  assert.equal(status(f).workflow.adapter.id, 'wechat-miniapp-runtime');
});

test('public runtime adapters list web and wechat without pretending the CLI drives either UI', () => {
  const items = prototypeCommand(['adapter', 'list'], root).items;
  assert.deepEqual(items.map(item => item.id), ['web-runtime@1', 'wechat-miniapp-runtime@1']);
  assert.match(prototypeCommand(['adapter', 'capabilities', '--adapter', 'wechat-miniapp-runtime@1'], root).note, /Agent/);
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs .codex/skills/mf-dev-flow/modules/prototype/tests/unified.test.mjs`

Expected: FAIL because the Mini Program adapter is not publicly listed and no Mini Program batch fixture exists.

- [ ] **Step 3: Implement discovery and fixture coverage.**

Use the existing one-pixel PNG and non-empty JSONL trace fixture only to test archive and schema behavior; label it synthetic and do not claim it tests WeChat Developer Tools. Add a separate manual acceptance checklist in the overlay/docs for an actual authorized simulator session: page stack before/after, selector action, screenshot dimensions, trace content and `prototype capture` result all must be reviewed by the observation Agent.

Expose the manifest through the same loader-backed command as the web adapter and include a capability note: `适配器声明环境契约；CLI 不直接操控微信开发者工具。`

- [ ] **Step 4: Run shared core regression tests.**

Run:

```bash
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/unified.test.mjs
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/*.test.mjs
```

Expected: PASS. The fixture demonstrates a normalized evidence boundary, while the overlay remains responsible for actual simulator-operation guidance.
