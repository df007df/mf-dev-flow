# Runtime Prototype Analysis WeChat Mini Program Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `wechat-miniapp-runtime@1` on the completed runtime-analysis core so a user-authorized WeChat Developer Tools simulator session can produce the same normalized runtime-only evidence and report contract as a web runtime batch.

**Architecture:** The adapter contributes a strict simulator capability declaration and a runtime-observe Agent overlay; it does not fork the process, catalog, report or evidence schema. The core plan must be complete first: this plan only registers a second adapter and verifies its environment-specific instructions/capability gates against the shared workflow snapshot and evidence boundaries.

**Tech Stack:** Node.js >=22.18, JSON manifests, Markdown Agent overlays, `node:test`, current WeChat Developer Tools skills for actual user-authorized execution, shared runtime prototype core from the web plan.

**Spec:** [runtime-prototype-analysis-design.md](runtime-prototype-analysis-design.md)

## Global Constraints

- Execute this plan only after `runtime-prototype-analysis-core-web-implementation-plan.md` is complete and its prototype regression suite passes.
- Keep implementation under `.codex/skills/mf-dev-flow/`; do not open, compile, automate or publish a real Mini Program during isolated unit tests.
- The adapter is `runtime-only` in v1. It must not advertise WXML/JS static discovery or source coverage.
- Require a user-authorized simulator/project locator and immutable build or compile revision; redact any identifiers not required for analysis history.
- Normalize each simulator observation to existing screenshot, trace and assertion fields. Selector actions, page-stack navigation, simulator refreshes and compile events belong in trace metadata, not in a new evidence table.
- Do not commit from this current untracked workspace.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `modules/prototype/adapters/wechat-miniapp-runtime/v1/adapter.json` | Declare simulator-only locator, page-stack, selector, screenshot, trace and refresh capabilities. |
| `modules/prototype/adapters/wechat-miniapp-runtime/v1/agents/runtime-observe.md` | Add Mini Program-specific safety and evidence instructions to the generic observation Agent. |
| `modules/prototype/tests/processes.test.mjs` | Verify adapter loader, overlay composition and manifest safety. |
| `modules/prototype/tests/runtime-workflow.test.mjs` | Verify Mini Program init, capability rejection, workflow gates and normalized evidence acceptance using an isolated file fixture. |
| `modules/prototype/tests/unified.test.mjs` | Verify public adapter discovery and legacy/web coexistence. |
| `flows/prototype/{entry,workflow,contract,capture}.md` | Explain simulator selection, locator/revision inputs, preparation-vs-business actions and evidence requirements. |

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

## Task 4: Document the Mini Program path and hand off safely

**Files:**

- Modify: `flows/prototype/entry.md`
- Modify: `flows/prototype/workflow.md`
- Modify: `flows/prototype/contract.md`
- Modify: `flows/prototype/capture.md`
- Modify: `flows/prototype/report-format.md`

**Interfaces:**

- Documents this exact initialization pattern:

```bash
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs prototype init \
  --process runtime-analysis@1 --adapter wechat-miniapp-runtime@1 \
  --evidence-profile runtime-only --agent scope-snapshot \
  --input input.json --request-id miniapp-analysis-001
```

- Documents the required input locator and the difference between simulator preparation and business interactions.

- [ ] **Step 1: Write documentation assertions before updating prose.**

Add a test that reads the five flow documents and asserts each Mini Program claim appears once: adapter choice, `runtime-only` limitation, page-stack/selector trace requirement, no direct CLI operation, and stage checkpoint requirement.

- [ ] **Step 2: Run the documentation assertion to verify it fails.**

Run: `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs`

Expected: FAIL because flow documents do not describe the Mini Program adapter contract.

- [ ] **Step 3: Update the protocol documents.**

State that compile/refresh and role/data setup are scenario preparation only; they do not count as observed business interactions. Require the actual trace to name route, precondition, selector/action, expected and observed result. State that unobservable pages/branches remain uncompleted and that the report's runtime-only section is not a source review.

- [ ] **Step 4: Run final checks.**

Run:

```bash
node --check .codex/skills/mf-dev-flow/modules/prototype/core/runtime-source.mjs
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/*.test.mjs
node --test .codex/skills/mf-dev-flow/modules/workflow/tests/*.test.mjs .codex/skills/mf-dev-flow/scripts/*.test.mjs
git diff --check -- .codex/skills/mf-dev-flow
```

Expected: all adapter and prototype tests pass; only planned mf-dev-flow files are changed. Do not commit from this current untracked workspace.
