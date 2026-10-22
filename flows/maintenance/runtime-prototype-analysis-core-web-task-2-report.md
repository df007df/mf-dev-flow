# Task 2 report — immutable runtime source snapshots and evidence profiles

## Scope

Completed only the Task 2 files:

- `modules/prototype/core/runtime-source.mjs`
- `modules/prototype/core/store.js`
- `modules/prototype/catalog.js`
- `modules/prototype/tests/runtime-workflow.test.mjs`

## Initial failure and repair

The required compatibility command initially had 21 passing tests and one failure:

```text
Expected: /Only local HTML/
Actual:   Error: scope.observableBoundary required
```

`initialize()` validated `scope.observableBoundary` before it established whether the
source was supported.  An unsupported legacy source therefore leaked into the new
runtime scope validation.  The repair validates the source type first, then applies
the unchanged scope validation.  Runtime sources still require their workflow,
`runtime-only` evidence profile, revisioned/sanitized locator, and all subsequent
runtime-only audit requirements.

## Security repair: `localPreview` locator sanitization

The Task 2 security review found that `locator.localPreview` bypassed the URL
normalizer.  A preview URI such as
`file:///tmp/mf-dev-flow-preview/index.html?token=opaque-value#session` was written
unchanged into native metadata, the frozen source map, catalog metadata, and then
the public `prototype status` summary.  A userinfo-bearing local preview URI was
also accepted.

TDD repair record:

- **RED:** Added a real runtime initialization test which asserted that a file
  `localPreview` is stripped before native persistence, frozen-source persistence,
  and catalog `status`; it failed because the old value retained both query and
  fragment.  Added a separate credential-bearing local-preview assertion; it
  failed because the old initializer did not throw.
- **GREEN:** `localPreview()` now removes query and fragment text before any
  persistence and rejects URI authority userinfo (including protocol-relative
  locators).  It retains supported local preview formats such as `file:///...` and
  ordinary local-path strings, rather than coercing them to a different URL form.
- **Regression proof:** The focused runtime suite passed 6/6 and the full Task 2
  compatibility command passed 24/24.

## Final verification

```text
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/analysis.test.mjs \
  .codex/skills/mf-dev-flow/modules/prototype/tests/analysis-requirements.test.mjs \
  .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs

24 passed, 0 failed
```

Also passed:

```text
node --check modules/prototype/core/runtime-source.mjs
node --check modules/prototype/core/store.js
node --check modules/prototype/catalog.js
node --check modules/prototype/tests/runtime-workflow.test.mjs
git diff --check -- .codex/skills/mf-dev-flow
```

The Task 2 files are untracked in this pre-existing untracked skill tree, so they
were additionally checked with `git diff --no-index --check /dev/null <file>`; each
produced no whitespace diagnostics.

## Self-review

- Runtime source normalization requires an explicit immutable revision, matches the
  resolved adapter, rejects static-source claims and credential-bearing locators, and
  persists URL and `localPreview` locators without query or fragment text.  The
  local-preview regression covers the native source map and catalog `status`, so
  sensitive URI pieces cannot reappear through either persisted summary.
- Runtime-only source maps intentionally have no static files or candidates; their
  audit still requires archived evidence plus group, entry, node, control,
  occurrence, and sweep coverage.
- Runtime freshness never claims remote source equality: it is reported as
  `declared-revision`, while requirements changes and corrupted archived evidence
  still invalidate the batch.
- Acceptance records the declared revision, and existing HTML behavior remains
  unchanged apart from the restored source-type-first validation order for unsupported
  sources.
