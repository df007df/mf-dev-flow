## Task 1: Register a constrained WeChat simulator adapter and its Agent overlay

**Files:**

- Create: `modules/prototype/adapters/wechat-miniapp-runtime/v1/adapter.json`
- Create: `modules/prototype/adapters/wechat-miniapp-runtime/v1/agents/runtime-observe.md`
- Modify: `modules/prototype/tests/processes.test.mjs`

**Interfaces:**

- `loadPrototypeAdapter({ id: 'wechat-miniapp-runtime', version: 1 })` returns a snapshot with `capabilities.sourceDiscovery === false`.
- The manifest accepts source mode `wechat-devtools-simulator` only.
- `capabilities.operations` contains `pageStack`, `selectorAction`, `simulatorScreenshot`, `traceArchive`, `compileRefresh`; all are declarative capability names, not Node CLI methods.
- The only overlay target is `runtime-observe`.

- [ ] **Step 1: Write a failing adapter loader test.**

```js
test('wechat simulator overlay composes only into runtime-observe', () => {
  const adapter = loadPrototypeAdapter({ id: 'wechat-miniapp-runtime', version: 1 });
  const workflow = composePrototypeWorkflow({
    process: loadPrototypeProcess({ id: 'runtime-analysis', version: 1 }),
    adapter,
    evidenceProfile: 'runtime-only',
  });
  assert.equal(adapter.capabilities.sourceDiscovery, false);
  assert.deepEqual(adapter.capabilities.operations, [
    'pageStack', 'selectorAction', 'simulatorScreenshot', 'traceArchive', 'compileRefresh',
  ]);
  assert.match(workflow.stages.find(stage => stage.id === 'runtime-observe').agent.instructions, /页面栈/);
  assert.doesNotMatch(workflow.stages.find(stage => stage.id === 'structure-model').agent.instructions, /页面栈/);
});
```

- [ ] **Step 2: Run the loader test to verify it fails.**

Run: `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs`

Expected: FAIL because the Mini Program adapter manifest and overlay do not exist.

- [ ] **Step 3: Add the manifest and overlay.**

Use this capability shape:

```json
{
  "schemaVersion": 1,
  "id": "wechat-miniapp-runtime",
  "version": 1,
  "title": "微信开发者工具小程序模拟器",
  "sourceModes": ["wechat-devtools-simulator"],
  "capabilities": {
    "sourceDiscovery": false,
    "operations": ["pageStack", "selectorAction", "simulatorScreenshot", "traceArchive", "compileRefresh"],
    "evidence": {"screenshot": "png", "trace": true}
  },
  "agentOverlays": [{"stageId": "runtime-observe", "file": "agents/runtime-observe.md"}]
}
```

The overlay must require: checking the active page stack before and after navigation; selector-based user interaction rather than forced/script clicks; simulator refresh/recompile only as scenario preparation; screenshotting an entirely visible target state; and recording page route, query, selector/action, preconditions, assertion and result in the actual trace. It must distinguish a business interaction from a role/data/demo preparation action.

- [ ] **Step 4: Run loader regression tests.**

Run: `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs`

Expected: PASS, including loader rejection for an overlay that names a non-process stage or leaves the adapter version root.
