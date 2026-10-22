# Mini Program runtime prototype analysis · Task 3 verification

## Scope

- Registered `wechat-miniapp-runtime@1` beside `web-runtime@1` in the loader-backed public adapter discovery response.
- Added a declarative public capability note: adapters describe the current Agent's authorized environment; the CLI does not manipulate a web page or WeChat Developer Tools.
- Added regression coverage for the shared stage gate and the normalized synthetic evidence archive. The one-pixel PNG and JSONL trace are only archive/schema fixtures; they do not claim to operate or test a Mini Program simulator.
- Kept the existing generic `cli.mjs` dispatcher unchanged: it already routes `adapter list` and `adapter capabilities --adapter <id@version>` through the loader-backed capability module.

## TDD record

### RED

After adding the public-discovery expectations, ran:

```bash
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs .codex/skills/mf-dev-flow/modules/prototype/tests/unified.test.mjs
```

Result: 31 passed, 2 failed. Both failures expected `wechat-miniapp-runtime` in the public adapter list but received only `web-runtime`.

### GREEN

Registered the versioned Mini Program adapter and returned the fixed environment-contract note from public capability responses. The same focused command then passed 33/33.

## Verification

```bash
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/unified.test.mjs
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/*.test.mjs
```

Results: loader 10/10, runtime workflow 22/22, unified 11/11, complete prototype suite 61/61.

`node --check` passed for the changed production and test modules. `git diff --check` and an explicit trailing-whitespace scan passed.

## Self-review

- Public outputs contain only versioned identity, title and declared capabilities; they do not include Agent instructions, locator data, credentials, tokens or session identifiers.
- The Mini Program capture regression proves the common stage gate rejects a capture before `structure-model` transitions to `runtime-observe`, then accepts and verifies the synthetic archive afterward.
- The real simulator observation checklist remains in the adapter overlay. This task did not operate WeChat Developer Tools, perform a real page-stack interaction, or assert such an interaction from fixture data.
- No commit, staging, worktree, root `.mf-dev-flow`, runtime-source, processes, dashboard, plans or ledgers were changed.
