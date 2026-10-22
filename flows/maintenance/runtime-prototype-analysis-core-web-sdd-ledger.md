# SDD ledger — plan: flows/maintenance/runtime-prototype-analysis-core-web-implementation-plan.md

## Execution context

- Base Git commit: `941e97348d799ec52530d316d05e1a8c856f87db`
- Target scope: `.codex/skills/mf-dev-flow/` only.
- Tasks: 1. process/adapter loader; 2. runtime source snapshots; 3. workflow gates; 4. audit/report/acceptance; 5. public commands/docs/regression; 6. dashboard runtime workflow summary.

## Rulings

- Ruling: execute serially in the current workspace — the user previously authorized in-place mf-dev-flow maintenance and `.codex/skills/mf-dev-flow/` is already untracked, so a Git worktree would omit the baseline skill files. Cost if wrong: an unrelated untracked mf-dev-flow change could be mistaken for task output; mitigation: each dispatch receives an exact file ownership list and reviews use per-task file snapshots.
- Ruling: keep SDD briefs, reports, snapshots and ledger under `flows/maintenance/` instead of the skill default `.superpowers/sdd/` — mf-dev-flow maintenance permits writes only within the skill/hook scope. Cost if wrong: the artifacts are visible alongside maintenance documentation rather than ignored scratch space; mitigation: use task-specific filenames and leave no artifacts outside the permitted scope.
- Ruling: do not create Git commits or stage files — the target directory is untracked in a dirty workspace and the user did not authorize altering repository history/index. Cost if wrong: normal commit-range review packages are unavailable; mitigation: generate read-only per-task before/after diff packages from allowed snapshots and require reviewers to inspect every owned file.
- Ruling: implement the core/web plan before the Mini Program plan — the Mini Program adapter depends on the process loader, runtime source and workflow gates. Cost if wrong: Mini Program delivery starts later; mitigation: it remains a separate, fully specified second plan with no duplicated core state machine.
- Ruling: add a dashboard task after the public runtime workflow is available — users need to see the selected process, adapter, evidence boundary, active Agent/stage, source revision and recovery state in the existing 原型图分析 block. Cost if wrong: the card could add visual density; mitigation: show a compact read-only summary only for new workflow batches and preserve legacy layout unchanged.

## Preflight plan scan

| Tasks / interface | Producer → consumer | Finding |
| --- | --- | --- |
| 1 → 2 / `composePrototypeWorkflow` | Validated process/adapter snapshots are passed to runtime initialization. | Compatible; v1 web adapter rejects `source-and-runtime`, exactly as the spec requires. |
| 2 → 3 / native `workflow` metadata | Runtime batches persist snapshot/evidence profile before stage gates read them. | Compatible; legacy batches have no key and remain no-op for gates. |
| 3 → 4 / workflow state | Checkpoints expose active audit stage before acceptance marks it accepted. | Compatible; checkpoint optimistic revision is native index revision, while accept keeps catalog semantic revision. |
| 4 → 5 / capabilities and report text | Runtime-only report declaration and acceptance metadata are exposed by public commands/docs. | Compatible; no browser control is added to Node CLI. |
| 3/4 → 6 / bounded workflow status | Catalog status exposes stage/adapter/evidence/recovery data; dashboard renders only that summary. | Compatible; no extra dashboard API query or sensitive workflow snapshot data is exposed. |
| Task 1 | Loader tests, manifest graph, and file set agree. | No conflict. |
| Task 2 | Runtime source tests, metadata and audit branch agree. | No conflict. |
| Task 3 | Gate tests, command forwarding and transition interface agree. | No conflict after clarifying native index revision in the plan. |
| Task 4 | Acceptance tests, report declaration and format validation agree. | No conflict. |
| Task 5 | Read-only discovery, documentation and legacy regression agree. | No conflict. |
| Task 6 | Bounded catalog status, dashboard component and legacy UI regression agree. | Compatible; executes after public workflow status exists. |

## Task state

- Task 1: complete — loader/manifests/Agent snapshots implemented; focused tests 7/7 pass; independent review PASS after realpath and web-adapter-contract regression repairs. Report: `runtime-prototype-analysis-core-web-task-1-report.md`.
- Task 2: complete — immutable runtime source, sanitized locator persistence and runtime-only audit semantics implemented; focused tests 24/24 pass; independent security review PASS. Report: `runtime-prototype-analysis-core-web-task-2-report.md`.
- Task 3: complete — store-level stage gates, bounded workflow status and transactional checkpoint transitions implemented; focused/legacy tests 39/39 pass; independent review PASS after concurrency and reason-record repairs. Report: `runtime-prototype-analysis-core-web-task-3-report.md`.
- Task 4: complete — runtime-only audit/report/acceptance now use the real graph audit path with honest coverage limits; prototype suite 51/51 passes; independent review PASS after audit-path and negative-coverage repairs. Report: `runtime-prototype-analysis-core-web-task-4-report.md`.
- Task 5: complete — loader-backed public process/adapter capabilities and documentation implemented; prototype suite 54/54 passes; independent review PASS. The separate workflow/scripts suite retains two pre-existing unrelated `mf-dev-flow.project-check.test.mjs` failures, recorded in report. Report: `runtime-prototype-analysis-core-web-task-5-report.md`.
- Task 6: complete — 原型图分析 dashboard now renders a safe runtime workflow summary only for workflow batches; targeted Playwright 1/1, smoke 1/1 and dashboard build pass; independent review PASS after checkpoint/status assertion repair. Full E2E retains five pre-existing historical-fixture failures, recorded separately. Report: `runtime-prototype-analysis-core-web-task-6-report.md`.
