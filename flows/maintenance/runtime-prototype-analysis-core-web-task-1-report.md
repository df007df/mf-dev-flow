# Task 1 report — versioned prototype process and web adapter loader

## Scope

Repaired only the assigned prototype process loader and its focused tests. No plan, ledger, dashboard, real `.mf-dev-flow`, Git index, or commit was changed.

## Root cause

`versionDirectory()` only compared lexical paths. Node then followed a `v<version>` symbolic link while loading the manifest, so a directory outside the approved loader root could be accepted. Separately, the loader only type-checked `web-runtime@1` capabilities and overlays, allowing its fixed runtime contract to drift without rejection.

## TDD record

### Initial RED (recorded before Task 1 implementation)

```text
$ node --test .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs
exit 1: ERR_MODULE_NOT_FOUND for processes.mjs
```

This was the expected initial RED because the loader and manifests did not yet exist.

### Repair RED

After adding the two regressions, before loader changes:

```text
TAP version 13
# Subtest: runtime process and web adapter snapshot every Agent file before init
ok 1 - runtime process and web adapter snapshot every Agent file before init
# Subtest: loader rejects path traversal, unsupported evidence profiles and illegal transitions
ok 2 - loader rejects path traversal, unsupported evidence profiles and illegal transitions
# Subtest: workflow retains the loaded Agent snapshot when its copied source changes
ok 3 - workflow retains the loaded Agent snapshot when its copied source changes
# Subtest: loader rejects a version directory symlink that escapes its approved root
not ok 4 - loader rejects a version directory symlink that escapes its approved root
  error: 'Missing expected exception.'
# Subtest: web-runtime@1 rejects malformed critical capability or overlay contracts
not ok 5 - web-runtime@1 rejects malformed critical capability or overlay contracts
  error: 'Missing expected exception: enables static source discovery'
1..5
# tests 5
# pass 3
# fail 2
# duration_ms 60.909083
```

### GREEN and hygiene checks

```text
$ node --test .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs && node --check .codex/skills/mf-dev-flow/modules/prototype/processes.mjs && git diff --check -- .codex/skills/mf-dev-flow
TAP version 13
# Subtest: runtime process and web adapter snapshot every Agent file before init
ok 1 - runtime process and web adapter snapshot every Agent file before init
  ---
  duration_ms: 5.67325
  type: 'test'
  ...
# Subtest: loader rejects path traversal, unsupported evidence profiles and illegal transitions
ok 2 - loader rejects path traversal, unsupported evidence profiles and illegal transitions
  ---
  duration_ms: 2.857125
  type: 'test'
  ...
# Subtest: workflow retains the loaded Agent snapshot when its copied source changes
ok 3 - workflow retains the loaded Agent snapshot when its copied source changes
  ---
  duration_ms: 3.462667
  type: 'test'
  ...
# Subtest: loader rejects a version directory symlink that escapes its approved root
ok 4 - loader rejects a version directory symlink that escapes its approved root
  ---
  duration_ms: 2.342583
  type: 'test'
  ...
# Subtest: web-runtime@1 rejects malformed critical capability or overlay contracts
ok 5 - web-runtime@1 rejects malformed critical capability or overlay contracts
  ---
  duration_ms: 9.048666
  type: 'test'
  ...
1..5
# tests 5
# suites 0
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 63.710917
```

The command exited 0. `node --check` and `git diff --check -- .codex/skills/mf-dev-flow` were silent and successful.

## Repair

- Resolve the requested root, selected version directory, manifest, and every Agent/overlay file through `realpathSync` before reading them.
- Require every resolved file to remain beneath both the approved resolved root and the selected resolved version directory.
- Reject a `v<version>` symbolic link that exits its approved root; the regression skips only if the platform reports that symbolic-link creation is unavailable.
- Freeze `web-runtime@1` to its runtime-only contract: no source discovery, `url` and `local-preview` source modes, selector navigation, PNG screenshots, trace archival, and exactly the `runtime-observe` overlay backed by `agents/runtime-observe.md`.

## Self-review

- Confirmed the boundary is applied before every manifest or Agent read; a version directory, manifest, or Agent symbolic link cannot redirect a read outside the approved resolved root or version directory.
- Confirmed every contract mutation in the regression test is rejected by `loadPrototypeAdapter`, while the shipped manifest still loads.
- Mutation check: removing the resolved-root check reintroduces the symlink test failure; weakening the fixed capability or overlay equality reintroduces the malformed-contract test failure.
- Reviewed only the assigned paths; the working tree remains uncommitted and un-staged.

## Review coverage repair

The follow-up review correctly identified that the earlier regression proof did not cover a `process.json` symlink, a generic Agent-file symlink, or each allowed overlay field independently. This repair changes only `modules/prototype/tests/processes.test.mjs`; the existing loader implementation already rejects all four cases.

### RED — deliberately bypassed pre-fix fixture

The command below copied `modules/prototype` to a disposable temporary directory, removed only the resolved-file boundary guard and `web-runtime@1` fixed-contract guard from that copied `processes.mjs`, then ran the new assertions' real loader inputs. It removed the temporary directory on exit and did not modify the workspace.

```text
$ node --input-type=module <<'NODE'
> // Copy modules/prototype into os.tmpdir(); deliberately remove the resolved-file
> // boundary guard and validateWebRuntimeAdapter contract guard from the copied loader.
> // Load a copied runtime-analysis fixture with external process.json and generic-Agent
> // symlinks, then a copied web-runtime fixture with changed stageId and existing alternate
> // agentFile. Each successful load represents the Missing expected exception from the
> // corresponding new assert.throws assertion.
> NODE
RED manifest symlink: Missing expected exception (bypassed fixture accepted external process.json).
RED generic Agent symlink: Missing expected exception (bypassed fixture accepted external Agent file).
RED overlay stageId: Missing expected exception (bypassed fixture accepted altered stageId).
RED overlay agentFile: Missing expected exception (bypassed fixture accepted alternate existing Agent file).
```

This proves the precise pre-fix failures: without `resolvedFileInside()`'s realpath containment test, both external file links load; without the fixed web-adapter equality test, an altered allowed overlay stage or a different existing overlay Agent file loads.

### GREEN and hygiene checks

```text
$ node --test .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs && node --check .codex/skills/mf-dev-flow/modules/prototype/processes.mjs && git diff --check -- .codex/skills/mf-dev-flow
TAP version 13
# Subtest: runtime process and web adapter snapshot every Agent file before init
ok 1 - runtime process and web adapter snapshot every Agent file before init
# Subtest: loader rejects path traversal, unsupported evidence profiles and illegal transitions
ok 2 - loader rejects path traversal, unsupported evidence profiles and illegal transitions
# Subtest: workflow retains the loaded Agent snapshot when its copied source changes
ok 3 - workflow retains the loaded Agent snapshot when its copied source changes
# Subtest: loader rejects a version directory symlink that escapes its approved root
ok 4 - loader rejects a version directory symlink that escapes its approved root
# Subtest: loader rejects a process manifest symlink that exits its selected version directory
ok 5 - loader rejects a process manifest symlink that exits its selected version directory
# Subtest: loader rejects a generic Agent symlink that exits its selected version directory
ok 6 - loader rejects a generic Agent symlink that exits its selected version directory
# Subtest: web-runtime@1 rejects malformed critical capability or overlay contracts
ok 7 - web-runtime@1 rejects malformed critical capability or overlay contracts
1..7
# tests 7
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 64.252084
```

The command exited 0. `node --check` and `git diff --check -- .codex/skills/mf-dev-flow` were silent and successful.

### Follow-up self-review

- Each new symlink test changes only a copied fixture. Its helper restores the copied regular file in `finally`, even when the assertion fails; the temporary roots are removed with `t.after`.
- A test skips only when `fs.symlinkSync` reports the platform cannot create a symbolic link, and includes that exact error code in the skip reason.
- The `agentFile` mutation first creates an alternate, valid copied Agent file. Its rejection therefore proves the exact overlay allow-list, rather than merely a missing-file failure.
- Mutation check: removing the realpath containment branch makes both new symlink tests fail; relaxing the exact overlay equality makes each independent overlay mutation fail.
- No production code, plan, ledger, dashboard, root `.mf-dev-flow`, Git index, or commit was changed.
