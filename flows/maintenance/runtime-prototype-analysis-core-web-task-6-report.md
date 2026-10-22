# Task 6 verification report — 原型图分析看板运行态流程摘要

## Scope and constraints

- Repaired only the TypeScript boundary in `dashboard/app/components/prototype-workflow-summary.tsx`, then updated this report.
- No plan, ledger, catalog, core workflow, real `.mf-dev-flow`, existing tests, staging area, or commit was changed.
- Read the Task 6 brief and the current summary component, catalog integration, smoke fixture, browser test, and dashboard scripts.
- No standalone `typecheck` script is declared in `dashboard/package.json`; `pnpm build` is the declared TypeScript verification path.

## Fresh verification

| Check | Command | Result |
| --- | --- | --- |
| Production build and TypeScript | `pnpm build` | **PASS** — compilation and TypeScript checking complete. |
| Dashboard smoke | `pnpm test:smoke` | **PASS** — 1/1. |
| Targeted runtime workflow browser regression | `pnpm exec playwright test tests/browser/dashboard.spec.ts --grep '运行态原型批次仅展示受限流程摘要'` | **PASS** — 1/1. |
| Diff hygiene | `git diff --check` plus trailing-whitespace scan of the Task 6 files | **PASS**. |

## RED: exact build failure

`next build` compiled successfully, then failed while running TypeScript:

```text
app/components/prototype-workflow-summary.tsx(53,46): error TS18046: 'item.version' is of type 'unknown'.
app/components/prototype-workflow-summary.tsx(53,66): error TS18046: 'item.version' is of type 'unknown'.
app/components/prototype-workflow-summary.tsx(55,25): error TS2322: Type 'unknown' is not assignable to type 'number'.
Failed to type check.
```

The build also emitted existing Turbopack warnings about dynamic filesystem access in `dashboard/server/readers/runs.js`; they were warnings, not the build-stopping error above.

## GREEN: narrow type-boundary repair

`record()` intentionally exposes untrusted workflow input as `Record<string, unknown>`. `Number.isSafeInteger(item.version)` validates the runtime value but does not narrow TypeScript's `unknown`, so the prior helper returned an untyped version into the display model.

The `identity()` helper now extracts `id` and `version`, requires `id` to be a valid identifier and `version` to be a safe integer in the existing range, then returns a display-only identity where **both fields are explicit strings**. It still accepts only the public numeric manifest version at its input boundary, exposes no raw workflow field, and does not change the rendered values or the accepted runtime workflow contract.

## Targeted behavior covered

The passing browser regression verifies the dashboard exposes the bounded runtime summary for `runtime-analysis@1` and `web-runtime@1`, maps `runtime-only` to `运行态覆盖`, shows `structure-model`, and omits the fixture's token, session, hash, and Agent-instruction values. It also verifies an old HTML batch renders no `运行态分析状态` block.

The smoke test verifies the normal dashboard state path refreshes after the runtime batch fixture is created and returns the persisted bounded workflow fields without the source token.

## Full browser suite boundary

The full `pnpm test:e2e` result reported before this final verification was **4 passed / 5 failed**. The Task 6 runtime-summary test passed; the five failures depend on the absent historical prototype fixture (for example, `长期原型真源`). Per scope, those unrelated fixture failures were not repaired or re-run here.

## Self-review

- The sole implementation change is in the summary's allow-listing helper; no raw object, `any`, locator, session, token, Agent text, hash, evidence, or checkpoint reason can enter the component props.
- The explicit `typeof version === "number"` guard precedes numeric checks, and `String(version)` happens only after the safe integer and range guards.
- Existing target assertions still verify the rendered summary and the absence of sensitive fixture values; legacy HTML still has no summary block.
- The final production build remains successful. The two existing filesystem-tracing warnings are unchanged and outside this Task 6 repair.

## Final status

Task 6 is build-verifiable: targeted browser regression and smoke both pass, and `pnpm build` is green. The known unrelated historical E2E fixture failures were not re-run or changed.

## P2 repair: checkpoint and workflow-status browser assertions

The final Task 6 review found one P2 coverage gap: the runtime-summary fixture supplied a `validated` checkpoint and `in_progress` workflow state, but the browser test did not assert their user-visible rendering.

Before changing the test, the targeted Playwright case passed with the existing component state:

```text
1 passed
```

The same bounded runtime-summary test now explicitly requires both rendered label/value pairs:

- `最近检查点 已验证`
- `分析状态 分析中`

This makes a regression in either checkpoint outcome mapping or workflow-state mapping fail without exposing the fixture's checkpoint reason or other sensitive workflow data.

## P2 repair verification and self-review

The P2 repair is limited to the existing Task 6 browser regression and this report. It does not change component behavior, fixture data, dashboard state caching, core workflow code, plans, the ledger, real `.mf-dev-flow`, staging, or commits.

The required final commands were run after adding the assertions:

| Check | Command | Result |
| --- | --- | --- |
| Targeted runtime workflow browser regression | `pnpm exec playwright test tests/browser/dashboard.spec.ts --grep '运行态原型批次仅展示受限流程摘要'` | **PASS** — 1/1. |
| Dashboard smoke | `pnpm test:smoke` | **PASS** — 1/1. |
| Production build and TypeScript | `pnpm build` | **PASS** — compilation and TypeScript complete; only the pre-existing dynamic-filesystem tracing warnings remain. |

Self-review: the assertions match the component's user-visible Chinese labels and their fixture-derived mappings (`validated` → `已验证`; `in_progress` → `分析中`). They remain scoped to the existing isolated runtime fixture, retain all prior sensitive-data absence assertions, and leave the legacy HTML no-summary assertion intact.
