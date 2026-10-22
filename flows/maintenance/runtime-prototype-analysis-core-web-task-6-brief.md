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
