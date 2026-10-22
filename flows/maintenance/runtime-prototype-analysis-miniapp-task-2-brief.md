## Task 2: Validate simulator locators and preserve a shared runtime evidence shape

**Files:**

- Modify: `modules/prototype/core/runtime-source.mjs`
- Modify: `modules/prototype/tests/runtime-workflow.test.mjs`

**Interfaces:**

- `normalizeRuntimeSource` accepts `{ type: 'runtime', adapter: 'wechat-miniapp-runtime@1', locator: { mode: 'wechat-devtools-simulator', projectPath: string, entryRoute: string }, revision: string }`.
- The normalized persisted locator has exactly `{ mode, projectPath, entryRoute }`; `projectPath` is workspace-relative or a sanitized absolute path without user-home expansion, and `entryRoute` begins with `pages/`.
- Evidence remains `{ snapshotId, path, trace, capturedAt, action, assertion, capture }`; adapter-specific fields may occur inside the trace file, not the public evidence record schema.

- [ ] **Step 1: Write failing locator validation tests.**

```js
test('wechat runtime source requires a simulator locator, route and compile revision', () => {
  const source = {
    type: 'runtime', adapter: 'wechat-miniapp-runtime@1',
    locator: { mode: 'wechat-devtools-simulator', projectPath: 'miniapp', entryRoute: 'pages/home/index' },
    revision: 'compile-20260907-01',
  };
  assert.equal(normalizeRuntimeSource(source, miniAdapter).locator.entryRoute, 'pages/home/index');
  assert.throws(() => normalizeRuntimeSource({ ...source, revision: '' }, miniAdapter), /revision/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, entryRoute: '../secret' } }, miniAdapter), /entryRoute/);
  assert.throws(() => normalizeRuntimeSource({ ...source, locator: { ...source.locator, mode: 'url' } }, miniAdapter), /source mode/);
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs`

Expected: FAIL because runtime source normalization has no Mini Program-specific mode/route validation.

- [ ] **Step 3: Implement adapter-directed locator validation.**

Dispatch by the adapter manifest's `sourceModes`, never hard-code a special branch in `catalog.js`. Validate Mini Program routes with `^pages/[A-Za-z0-9_/-]+$`; reject `..`, query strings, URI schemes and blank segments. Canonicalize the path with the existing workspace-bound path helper, then store only the canonical safe value. Preserve the existing generic capture schema and use the same evidence hashing/archival code as web runtime batches.

- [ ] **Step 4: Run focused runtime tests.**

Run: `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs`

Expected: PASS. A Mini Program fixture must initialize, create the shared workflow snapshot and reject `source-and-runtime` because its adapter has no static discovery capability.
