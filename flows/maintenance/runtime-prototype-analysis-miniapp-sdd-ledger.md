# SDD ledger — plan: flows/maintenance/runtime-prototype-analysis-wechat-miniapp-implementation-plan.md

## Execution context

- Base Git commit: `941e97348d799ec52530d316d05e1a8c856f87db`
- Target scope: `.codex/skills/mf-dev-flow/` only.
- Prerequisite: core/web runtime workflow and dashboard summary completed in `runtime-prototype-analysis-core-web-sdd-ledger.md`.
- Tasks: 1. simulator adapter manifest/overlay; 2. adapter-directed simulator locator; 3. shared gates/public discovery; 4. protocol documentation.

## Rulings

- Ruling: execute serially in the current workspace — the target skill directory is untracked and the user authorized in-place maintenance. Cost if wrong: unrelated untracked changes could be mistaken for task output; mitigation: exact file ownership, task reports and independent reviews.
- Ruling: this adapter remains `runtime-only` and declarative — isolated tests may test normalized files and trace archives but may not open, compile, automate or publish a real Mini Program. Cost if wrong: real tool behavior stays manual; mitigation: the overlay documents the user-authorized simulator evidence checklist.
- Ruling: reuse the common process/store/audit/report model rather than fork it. Cost if wrong: adapter-specific constraints must be expressed in the manifest/overlay and runtime-source validator; mitigation: test web and legacy coexistence after each public discovery change.
- Ruling: extend Mini Program Task 1 ownership to `modules/prototype/processes.mjs` for an adapter-specific exact-contract validator. Cost if wrong: the shared loader gains adapter branching; mitigation: mirror the existing web adapter validation pattern and mutation-test every declared Mini Program capability/overlay boundary.
- Ruling: do not create Git commits or stage files — scope is untracked and the user did not authorize history/index changes. Cost if wrong: normal commit-range review is unavailable; mitigation: reviewers inspect exact current task paths.

## Preflight plan scan

| Tasks / interface | Producer → consumer | Finding |
| --- | --- | --- |
| 1 → 2 / manifest `sourceModes` | Adapter capabilities direct runtime-source validation. | Compatible; v1 only accepts `wechat-devtools-simulator` and runtime-only evidence. |
| 2 → 3 / normalized source/evidence | Existing common workflow gate and evidence archive receive the Mini Program batch. | Compatible; no new evidence table or CLI UI control. |
| 3 → 4 / public adapter discovery | Docs describe the actual manifest contract and Agent responsibilities. | Compatible; no credentials/session IDs leave the adapter declaration. |
| Task 1 | Manifest, overlay and loader tests agree. | No conflict. |
| Task 2 | Locator validation and shared runtime source tests agree. | No conflict. |
| Task 3 | Stage gate, public discovery and synthetic evidence tests agree. | No conflict. |
| Task 4 | Protocol docs and documentation assertions agree. | No conflict. |

## Task state

- Task 1: complete — constrained simulator adapter/overlay and exact loader contract implemented; loader tests 10/10 pass; independent review PASS after manifest mutation-hardening repair. Report: `runtime-prototype-analysis-miniapp-task-1-report.md`.
- Task 2: complete — adapter-directed simulator source validation and shared evidence capture implemented; runtime workflow 22/22 and full prototype suite 61/61 pass; independent review PASS after source-mode/revision/path/evidence hardening. Report: `runtime-prototype-analysis-miniapp-task-2-report.md`.
- Task 3: complete — public adapter discovery now exposes the constrained web and Mini Program contracts; simulator capture exercises the shared stage gate and archive without claiming real Developer Tools automation; full prototype suite 61/61 passes; independent review PASS. Report: `runtime-prototype-analysis-miniapp-task-3-report.md`.
- Task 4: complete — five protocol documents now define the Mini Program runtime contract and are guarded by an exact-once documentation assertion; the project-path wording was aligned with the implementation's relative-path-only validation; full prototype suite 62/62 passes; independent review PASS after P1 repair. Report: `runtime-prototype-analysis-miniapp-task-4-report.md`.
