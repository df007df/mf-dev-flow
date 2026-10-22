# Mini Program Runtime Analysis — Task 4 Report

## Completed scope

Documented the `wechat-miniapp-runtime@1` runtime-only route across the five prototype flow documents and added a regression assertion that reads all five documents.

- `entry.md` provides the exact Mini Program initialization command and the safe simulator locator/revision requirements.
- `workflow.md` defines the shared stage checkpoint, page-stack and selector-action evidence rules, and distinguishes scenario preparation from business interaction.
- `contract.md` constrains the simulator source shape and keeps unobservable branches unfinished.
- `capture.md` states that the CLI does not control WeChat Developer Tools and lists the required trace fields without exposing real locators, credentials, sessions, or Agent instructions.
- `report-format.md` states that a runtime-only Mini Program report is not source-code review.

The documentation test requires each Mini Program contract statement to occur exactly once across these five documents, preventing both omission and contradictory duplication.

## Independent-review repair (P1)

The independent review found one documentation/implementation mismatch: `contract.md` allowed a “sanitized absolute path” for `projectPath`, while the runtime-source validator rejects every absolute path. The repair was deliberately documentation-only:

- Added the exact public contract to the document assertion first: `小程序 projectPath：只接受经过净化的工作区相对路径，不允许任何绝对路径。`
- Confirmed the new assertion failed against the old prose (`0 !== 1`), with the other 22 focused checks passing.
- Replaced the inconsistent `contract.md` sentence with that exact contract; no runtime-source behavior changed.
- Reran the focused runtime workflow suite: 23/23 passed; reran the complete prototype suite: 62/62 passed.

The five-document assertion now requires this project-path boundary exactly once alongside the existing Mini Program contracts.

## TDD evidence

1. Added the documentation assertion first.
2. Ran `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs`; it failed as expected because the adapter-choice claim occurred `0` times.
3. Added the minimal protocol prose and reran the focused suite: 23/23 passed.

## Verification

- `node --check .codex/skills/mf-dev-flow/modules/prototype/core/runtime-source.mjs` — passed.
- `node --test .codex/skills/mf-dev-flow/modules/prototype/tests/*.test.mjs` — 62/62 passed.
- `git diff --check -- .codex/skills/mf-dev-flow` — passed.
- `node --test .codex/skills/mf-dev-flow/modules/workflow/tests/*.test.mjs .codex/skills/mf-dev-flow/scripts/*.test.mjs` — 77 passed, 1 skipped, 2 pre-existing unrelated failures in `mf-dev-flow.project-check.test.mjs`:
  - line 71 reads `protected` from an undefined value;
  - line 152 expected the project-card check to fail, but it succeeded.

## Boundaries and follow-up

No real WeChat Developer Tools session was opened, compiled, refreshed, automated, or published. The isolated Mini Program fixture remains a normalized evidence/archive test only; an actual user-authorized simulator run still requires the `runtime-observe` Agent to verify page stack, selector action, screenshot, trace, and checkpoint evidence.

No files were committed or staged.
