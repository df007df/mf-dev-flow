# Mini Program Runtime Prototype Analysis — Task 2 Verification

## Scope

- Modified `modules/prototype/core/runtime-source.mjs`.
- Modified `modules/prototype/tests/runtime-workflow.test.mjs`.
- No catalog, process loader, CLI, capabilities, dashboard, plan, ledger, or real `.mf-dev-flow` files were changed. No commit or staging was performed.

## RED

Added the Mini Program locator and initialization tests, then ran:

```bash
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs
```

The new direct normalizer test and the Mini Program initialization test failed as intended, both with `runtime locator requires url or localPreview`. This demonstrated that the existing runtime-source layer had no simulator locator mode.

During final boundary review, an additional `file:/tmp/miniapp` project-path case failed with `Missing expected exception.` The path check was then tightened to reject one-slash URI forms while retaining legitimate Windows absolute paths.

## GREEN

`normalizeRuntimeSource` now derives allowed runtime source modes from the resolved adapter snapshot. It supports the strict simulator capability contract while preserving the existing web `url` and `localPreview` modes. The Mini Program form accepts only:

```json
{
  "mode": "wechat-devtools-simulator",
  "projectPath": "miniapp",
  "entryRoute": "pages/home/index"
}
```

It rejects user-home expansion, URI/query/fragment/control-character paths, `..`, unsafe or empty routes, arbitrary locator fields, a mode not declared by the adapter, and a blank compile revision. Project paths are normalized without resolving them against a user home directory. The evidence schema and its archival path were not changed.

Verification completed successfully:

```bash
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/core/runtime-source.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs
git diff --check -- .codex/skills/mf-dev-flow
```

Focused runtime workflow suite: 20 passed, 0 failed.

## Self-review

- The simulator path is adapter-directed in the shared runtime-source normalizer; no catalog special case was added.
- A Mini Program batch creates the existing runtime-analysis workflow snapshot and cannot request `source-and-runtime`, because the resolved adapter does not declare static discovery.
- The persisted locator is an exact allow-list, while trace metadata remains the place for adapter-specific observation details.
- Existing web locator sanitization and legacy HTML tests remain green in the focused suite.

## Review repair — adapter, revision, path, and evidence boundaries

### Scope preserved

- Modified only `modules/prototype/core/runtime-source.mjs`, `modules/prototype/tests/runtime-workflow.test.mjs`, and this report.
- Did not modify the process loader, catalog, CLI, dashboard, plans, ledger, or any real `.mf-dev-flow` directory. No commit or staging was performed.

### RED

Added the reviewed negative cases before changing the runtime-source implementation, then ran:

```bash
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs
```

The suite failed as expected: 20 passed and 2 failed. A Mini Program source accepted the string adapter fallback, and unsafe revision text was accepted. These failures reproduced the verified P1 bypasses before the implementation changed.

The added tests also preserve and pressure-test the reviewed P2 boundaries: source-mode declaration drift, direct `runtimeSourceMap` mismatch, `../outside`, POSIX absolute paths, `file:miniapp`, `C:miniapp`, unknown locator fields, and the common evidence record shape.

### GREEN

- `normalizeRuntimeSource` now accepts only a resolved adapter object; adapter strings and missing adapter snapshots fail closed.
- `runtimeSourceMap` accepts an explicit resolved adapter snapshot or the non-enumerable snapshot attached by `normalizeRuntimeSource`. It never derives authorization from `source.adapter` text. A `web-runtime@1` snapshot therefore cannot persist a `wechat-devtools-simulator` source.
- Runtime source modes are checked against the resolved versioned adapter contract. The composed Mini Program workflow snapshot currently omits its manifest's top-level `sourceModes`; for that one backward-compatible snapshot shape, the code reconstructs the simulator mode only after an exact match of its immutable Mini Program capabilities. Any capability or explicit source-mode drift fails closed.
- Frozen runtime revisions are opaque identifiers limited to 128 bytes and `[A-Za-z0-9][A-Za-z0-9._-]*`. Query/fragment markers, control characters, line breaks, credential-like `token=` forms, whitespace, unsupported characters, and oversized values are rejected before a batch can be installed.
- Mini Program project paths are now strictly relative and reject absolute/UNC/drive/URI/home-expansion forms, `..`, query/fragment/control characters, empty results, and unknown locator keys. The current normalizer API does not receive a workspace root, so it cannot perform a meaningful `realpath` or symlink-containment check; relative-path semantics are the enforced boundary until a caller deliberately supplies that root.
- The Mini Program workflow test reaches `runtime-observe`, archives a synthetic PNG plus JSONL trace through the shared capture path, and asserts the persisted evidence has exactly the shared fields: action, assertion, capture, capture time, IDs/status, PNG/trace paths and hashes, snapshot ID, and record revision. No adapter-specific evidence key is stored.

### Verification

```bash
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/*.test.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/core/runtime-source.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs
```

- Focused runtime workflow suite: 22 passed, 0 failed.
- Full prototype module suite, including web runtime and legacy HTML coverage: 61 passed, 0 failed.
- Both changed JavaScript modules passed syntax validation.
