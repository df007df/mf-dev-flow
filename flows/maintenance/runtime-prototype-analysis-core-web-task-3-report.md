# Task 3 verification report — workflow state, checkpoints, and Agent gates

## Scope verified

- `.codex/skills/mf-dev-flow/modules/prototype/core/workflow.mjs`
- `.codex/skills/mf-dev-flow/modules/prototype/core/store.js`
- `.codex/skills/mf-dev-flow/modules/prototype/catalog.js`
- `.codex/skills/mf-dev-flow/modules/prototype/analysis-cli.mjs`
- `.codex/skills/mf-dev-flow/modules/prototype/cli.mjs`
- `.codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs`

No implementation code, plan, ledger, dashboard files, real `.mf-dev-flow` state, index, or commit was modified during final verification.

## Prior TDD evidence

- RED: before Task 3, runtime batches had no workflow state or `checkpoint` command, so the Task 3 stage-ownership and transition tests were expected to fail.
- GREEN: the implementation worker completed the focused runtime workflow and legacy/public regression command with **36/36 passing**. This includes stage ownership, valid and invalid graph transitions, direct `analysis-cli` ownership enforcement, bounded `brief`/`next`/`query` Agent metadata, runtime-status locator redaction, and legacy batches continuing to operate without `--agent`.

## Final verification

Completed after the worker's earlier command chain was interrupted:

```text
node --check .codex/skills/mf-dev-flow/modules/prototype/core/workflow.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/core/store.js
node --check .codex/skills/mf-dev-flow/modules/prototype/catalog.js
node --check .codex/skills/mf-dev-flow/modules/prototype/analysis-cli.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/cli.mjs
git diff --check -- .codex/skills/mf-dev-flow
```

All six checks exited `0` with no output. The behavioral suite was already complete (not interrupted), so it was not rerun solely to replace a successful 36/36 result.

## Current-code self-review

- `workflow.mjs` derives the active stage from the frozen process snapshot, requires the matching active Agent for mutations, limits allowed commands and record types by stage, rejects graph skips, and records checkpoint transitions with an optimistic native index revision.
- `store.js` invokes the workflow gate before writes/audit, so direct `analysis-cli` calls cannot bypass ownership checks.
- `catalog.js` routes checkpoint and brief through the native analysis batch. Runtime status exposes only process/adapter/evidence-profile, stage/Agent, checkpoint, revision, and state; it summarizes the source as type/adapter/revision and does not return the locator.
- `analysis-cli.mjs` carries parsed `--agent` and command context into store methods. The legacy no-workflow path remains a no-op in the workflow assertion.
- The Task 3 test file exercises both enforcement boundaries and the public bounded metadata contract.

Verdict: **PASS**. No outstanding Task 3 verification issue found.

## Review repair — transactional checkpoint validation

### Root cause and RED evidence

`transitionWorkflow` captured the active workflow state and checked the expected index revision before `BEGIN IMMEDIATE`. A second connection could therefore commit after those reads but before the first caller acquired the write lock; the first caller would then build a state transition from stale data.

The first red run against the pre-repair implementation was:

```text
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs

# tests 12
# pass 10
# fail 2
```

The two new assertions failed as intended: a `validated` checkpoint accepted a whitespace-only reason, and a controlled two-connection interleave let the stale caller commit instead of throwing. The interleave is deterministic, not a claim of thread parallelism: the first real `AnalysisStore` intercepts only its `BEGIN IMMEDIATE` call while a second real `AnalysisStore` performs a valid, same-stage group write that advances the native index revision.

### Repair

- `transitionWorkflow` now opens `BEGIN IMMEDIATE`, resolves exact `requestId` replay first, then re-reads and validates the current workflow state, active Agent, graph edge, trimmed reason, and native index revision before it mutates metadata.
- Every checkpoint outcome now requires a non-empty trimmed `checkpoint reason`; the stored event uses that normalized text.
- An identical replay returns its original result before stale state/revision validation, preserving request idempotency without adding another history entry.

### Green verification

```text
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs

# tests 13
# pass 13
# fail 0

node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs .codex/skills/mf-dev-flow/modules/prototype/tests/unified.test.mjs .codex/skills/mf-dev-flow/modules/prototype/tests/analysis.test.mjs .codex/skills/mf-dev-flow/modules/prototype/tests/analysis-requirements.test.mjs

# tests 39
# pass 39
# fail 0
```

### Repair self-review

- The stale-index regression uses two independently opened SQLite-backed stores. The interleaved write preserves the active stage, so the asserted `Index revision conflict` specifically proves the in-transaction revision recheck rather than merely an Agent/stage mismatch.
- The state-history assertion proves the rejected caller did not append a transition or overwrite the other connection's valid state.
- The whitespace test covers `validated`, the outcome previously exempted from reason validation, and confirms the accepted reason is normalized before persistence.
- The replay test confirms the idempotency lookup happens inside the transaction before stale state and revision validation.

### Final syntax and hygiene

```text
node --check .codex/skills/mf-dev-flow/modules/prototype/core/workflow.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/core/store.js
node --check .codex/skills/mf-dev-flow/modules/prototype/catalog.js
node --check .codex/skills/mf-dev-flow/modules/prototype/analysis-cli.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/cli.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs
git diff --check -- .codex/skills/mf-dev-flow
```

All commands exited `0` with no output. A trailing-whitespace scan of the two repaired source/test files and this report also returned no matches.
