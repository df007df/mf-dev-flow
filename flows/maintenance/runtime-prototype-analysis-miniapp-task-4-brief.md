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
