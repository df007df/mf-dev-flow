# Travel Project Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one reproducible travel-checklist project whose five milestones are produced by actually running `mf-dev-flow` through PRD/prototype intake, feature analysis, first delivery, change-impact review, replanning, and final multi-feature delivery, with indexed case documentation and large browser screenshots.

**Architecture:** Run the public skill and CLI against one example project, capture each verified stage as a complete `.mf-dev-flow` milestone, and retain a sanitized command/output provenance manifest. A scoped selector only restores a selected snapshot; it never creates project conclusions. Ordinary dashboard readers calculate PRD, prototype, planning, delivery, and impact views without demo-only branches, while versioned prototype and application HTML files provide reproducible visual states.

**Tech Stack:** Node.js ESM and `node:test`, existing `mf-dev-flow` JSON contracts, static HTML/CSS/JavaScript, Next.js dashboard, Playwright browser automation, Markdown.

**Spec:** `docs/superpowers/specs/2026-10-26-travel-project-evolution-design.md`

## Global Constraints

- Maintain exactly one public synthetic project: `旅行清单示例`.
- Generate canonical `.mf-dev-flow` state through the actual `project`, `prd`, `prototype`, `feature`, `delivery`, and `work` commands; never directly assemble final truth files to imitate a successful run.
- Agent-authored protocol inputs such as PRD findings, prototype observations, and feature proposals are allowed only at their documented workflow locations and must pass the command-level check/apply gates.
- Capture a milestone only after the corresponding status/check/audit/apply/verify command succeeds; the snapshot helper only copies files and hashes them.
- Record sanitized relative commands, input paths, output paths, exit status, and output hashes for every milestone. No command record may contain an absolute home path.
- Use no external API, login, database, credential, or network service.
- Do not add demo-specific branches to dashboard or runtime production code.
- Every completed synthetic feature must have a runnable page, repeatable verification steps, and real browser screenshots.
- The selector may replace only `examples/travel-checklist-evolution/.mf-dev-flow/`; it must not accept an arbitrary CLI destination.
- Preserve timestamps produced by the real execution. Once a milestone is frozen, do not rewrite those times; replay may produce different times while preserving the same state semantics.
- Dashboard screenshots must include the section title, status context, case cards, feature card, and containing group when those elements are relevant.
- Application screenshots must include the page title, controls, content region, and result summary.
- The dashboard remains read-only and bound to `127.0.0.1`.
- Current tree and Git history must be scanned for fixed local paths, credentials, private URLs, customer names, and internal project identifiers before publication.

---

## File Map

### Example runtime and selectors

- Rename `examples/five-minute-cycle/` to `examples/travel-checklist-evolution/` so the directory describes a multi-stage story.
- Create `examples/travel-checklist-evolution/scripts/select-case.mjs`: validate `case-01` through `case-05`, replace only the active example state, and print the selected case.
- Create `examples/travel-checklist-evolution/scripts/select-case.test.mjs`: isolated selector safety, repeatability, and invalid-ID tests.
- Create `examples/travel-checklist-evolution/scripts/snapshot-case.mjs`: copy an already verified active `.mf-dev-flow` state to a milestone and write a SHA-256 manifest; it must refuse missing provenance or a failed final gate.
- Create `examples/travel-checklist-evolution/scripts/snapshot-case.test.mjs`: prove the snapshot helper never invents state and rejects failed/incomplete provenance.
- Create `examples/travel-checklist-evolution/scripts/run-recorded.mjs`: invoke the public `mf-dev-flow` CLI, preserve its exit code and terminal output, and append only a sanitized relative command plus output hashes to the selected Case provenance log.
- Create `examples/travel-checklist-evolution/scripts/run-recorded.test.mjs`: prove success/failure propagation, gate tagging, relative-path enforcement, and absence of absolute workspace paths in records.
- Create `examples/travel-checklist-evolution/scripts/verify-example.mjs`: validate milestone shape, expected planning/impact state, docs, images, and PNG dimensions.
- Create `examples/travel-checklist-evolution/generation/README.md`: exact clean-room replay sequence and the boundary between user inputs, Agent analysis, CLI outputs, and browser evidence.
- Create `examples/travel-checklist-evolution/generation/case-01.jsonl` through `case-05.jsonl`: sanitized records from the real execution.

### Versioned product inputs and results

- Create `examples/travel-checklist-evolution/prd/v1.md` and `prd/v2.md`: frozen human-readable requirements.
- Create `examples/travel-checklist-evolution/prototype/v1.html` and `prototype/v2.html`: executable source prototypes.
- Move the existing filter implementation to `examples/travel-checklist-evolution/app/v1.html`.
- Modify `examples/travel-checklist-evolution/app/index.html`: final stage-grouped list, completed-only filter, and visible-result progress summary.

### Milestone state

- Create `examples/travel-checklist-evolution/milestones/case-01/.mf-dev-flow/`: registered project, PRD v1 source, and prototype v1 source.
- Create `examples/travel-checklist-evolution/milestones/case-02/.mf-dev-flow/`: verified PRD/prototype analysis, initial feature map, and acceptance cases.
- Create `examples/travel-checklist-evolution/milestones/case-03/.mf-dev-flow/`: completed filter delivery, stage evidence, and feature history.
- Create `examples/travel-checklist-evolution/milestones/case-04/.mf-dev-flow/`: PRD/prototype v2 with the old v1 planning baseline, producing a real `review_required` impact result.
- Create `examples/travel-checklist-evolution/milestones/case-05/.mf-dev-flow/`: refreshed v2 baseline, three completed features, impact-review history, dependencies, and final delivery evidence.
- Keep `examples/travel-checklist-evolution/.mf-dev-flow/` selected to `case-05` in Git so the default dashboard shows the complete evolution.

### Documentation and screenshots

- Replace `examples/travel-checklist-evolution/README.md` with the ordered case index and quick-start commands.
- Create five documents under `examples/travel-checklist-evolution/cases/` using one fixed template.
- Create `examples/travel-checklist-evolution/screenshots/manifest.json` and ten named large PNG screenshots.
- Modify root `README.md` and `docs/five-minute-demo.md` to link to the evolution index and explain the former five-minute entry.

---

### Task 1: Establish the renamed example, safe selector, and provenance-only snapshotter

**Files:**
- Rename: `examples/five-minute-cycle/` → `examples/travel-checklist-evolution/`
- Create: `examples/travel-checklist-evolution/scripts/select-case.mjs`
- Create: `examples/travel-checklist-evolution/scripts/select-case.test.mjs`
- Create: `examples/travel-checklist-evolution/scripts/snapshot-case.mjs`
- Create: `examples/travel-checklist-evolution/scripts/snapshot-case.test.mjs`
- Create: `examples/travel-checklist-evolution/scripts/run-recorded.mjs`
- Create: `examples/travel-checklist-evolution/scripts/run-recorded.test.mjs`
- Create: `examples/travel-checklist-evolution/generation/README.md`
- Modify: `README.md`
- Modify: `docs/five-minute-demo.md`

**Interfaces:**
- Produces: `selectCase(exampleRoot: string, caseId: string): { caseId: string, source: string, destination: string }`.
- CLI: `node scripts/select-case.mjs case-03` when run from any directory.
- Milestone contract: `<exampleRoot>/milestones/<caseId>/.mf-dev-flow/` is copied to `<exampleRoot>/.mf-dev-flow/`.
- Snapshot contract: `snapshotCase(exampleRoot, caseId)` copies only an existing active `.mf-dev-flow` whose `generation/<caseId>.jsonl` ends in a successful gate record; it also writes `milestones/<caseId>/manifest.json` with relative paths and SHA-256 values.
- Recorded CLI: `node scripts/run-recorded.mjs case-02 [--gate] -- feature status`; it always invokes `../../scripts/mf-dev-flow.mjs` from the example root and cannot execute an arbitrary binary.

- [ ] **Step 1: Rename the existing example with Git-aware moves**

Run:

```bash
mkdir -p examples/travel-checklist-evolution
git mv examples/five-minute-cycle/README.md examples/travel-checklist-evolution/README.md
git mv examples/five-minute-cycle/app examples/travel-checklist-evolution/app
git mv examples/five-minute-cycle/cases.md examples/travel-checklist-evolution/cases-legacy.md
git mv examples/five-minute-cycle/screenshots examples/travel-checklist-evolution/screenshots
git mv examples/five-minute-cycle/.mf-dev-flow examples/travel-checklist-evolution/.mf-dev-flow
rmdir examples/five-minute-cycle
```

Expected: `git status --short` reports renames and no deleted screenshot without a matching destination.

- [ ] **Step 2: Write the selector tests first**

Create a `node:test` suite that uses `fs.mkdtempSync()` and asserts:

```js
const selected = selectCase(root, "case-03");
assert.equal(selected.caseId, "case-03");
assert.equal(fs.readFileSync(path.join(root, ".mf-dev-flow", "project.json"), "utf8"), "case-03-state\n");
assert.throws(() => selectCase(root, "../../outside"), /未知演进 Case/);
assert.equal(fs.readFileSync(path.join(outside, "sentinel.txt"), "utf8"), "keep");
```

Call `selectCase(root, "case-03")` twice and assert the second active tree has the same recursively sorted relative file list and file hashes as the first.

- [ ] **Step 3: Run the selector test and verify the expected failure**

Run:

```bash
node --test examples/travel-checklist-evolution/scripts/select-case.test.mjs
```

Expected: FAIL because `select-case.mjs` does not exist.

- [ ] **Step 4: Implement the scoped selector**

Use these constants and checks:

```js
const CASE_IDS = new Set(["case-01", "case-02", "case-03", "case-04", "case-05"]);
const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function selectCase(exampleRoot, caseId) {
  if (!CASE_IDS.has(caseId)) throw new Error(`未知演进 Case：${caseId}`);
  const root = path.resolve(exampleRoot);
  const source = path.join(root, "milestones", caseId, ".mf-dev-flow");
  const destination = path.join(root, ".mf-dev-flow");
  if (!fs.existsSync(path.join(root, "milestones", caseId, "manifest.json")))
    throw new Error(`Case 快照不完整：${caseId}`);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true, errorOnExist: false });
  return { caseId, source, destination };
}
```

The CLI must use `MODULE_ROOT` only; do not parse a destination flag.

- [ ] **Step 5: Write command-recorder and snapshot-refusal tests before implementation**

The recorder tests must invoke harmless real CLI commands, assert the subprocess exit code is preserved, confirm `--gate` changes only the record kind, and reject an argument containing the absolute example root. The record may contain `argv`, relative `cwd`, ISO execution time, exit code, and stdout/stderr SHA-256 values, but not raw command output or an absolute path.

The snapshot tests must assert that a missing provenance log, an empty active state, or a final JSONL record with `"exitCode": 1` is rejected. A successful fixture must preserve the active bytes exactly and produce a manifest hash equal to an independently calculated SHA-256 value.

- [ ] **Step 6: Implement the fixed-target command recorder and snapshotter**

`run-recorded.mjs` must always call:

```js
spawnSync(process.execPath, [path.resolve(MODULE_ROOT, "../../scripts/mf-dev-flow.mjs"), ...argv], {
  cwd: MODULE_ROOT,
  encoding: "utf8",
});
```

It prints the child stdout/stderr back to the terminal, hashes them for the JSONL record, and exits with the child's exact status. It must never accept a binary, shell string, environment dump, or alternate working directory.

The module may call only filesystem copy/read/hash operations. It must not import runtime commands, synthesize `project.json`, rewrite statuses, normalize timestamps, or generate feature/acceptance/delivery data. Its final precondition is:

```js
const records = fs.readFileSync(provenanceFile, "utf8").trim().split("\n").map(JSON.parse);
const final = records.at(-1);
if (!final || final.exitCode !== 0 || final.kind !== "gate")
  throw new Error(`Case 尚未通过最终门禁：${caseId}`);
```

- [ ] **Step 7: Add temporary selector fixtures only inside the test and run both tests**

Create minimal milestone trees inside the test's temporary directory; do not commit fabricated project-state fixtures merely to satisfy the selector.

Run:

```bash
node --test examples/travel-checklist-evolution/scripts/select-case.test.mjs
node --test examples/travel-checklist-evolution/scripts/run-recorded.test.mjs
node --test examples/travel-checklist-evolution/scripts/snapshot-case.test.mjs
```

Expected: PASS, including invalid case and outside-sentinel checks.

- [ ] **Step 8: Update old links to the renamed directory**

Run:

```bash
rg -n "examples/five-minute-cycle|five-minute-cycle" README.md docs examples
```

Change every matched local link to `examples/travel-checklist-evolution/`. Keep “五分钟最小闭环” as historical explanatory copy only where the sentence explicitly says it was the former entry.

- [ ] **Step 9: Commit the selector and snapshot foundation**

```bash
git add README.md docs/five-minute-demo.md examples/travel-checklist-evolution/scripts examples/travel-checklist-evolution/generation/README.md examples/travel-checklist-evolution/app examples/travel-checklist-evolution/screenshots examples/travel-checklist-evolution/README.md examples/travel-checklist-evolution/cases-legacy.md
git diff --cached --check
git commit -m "refactor: evolve travel demo structure"
```

---

### Task 2: Produce Case 01 and Case 02 by running the real project, PRD, prototype, and planning flows

**Files:**
- Create: `examples/travel-checklist-evolution/prd/v1.md`
- Create: `examples/travel-checklist-evolution/prototype/v1.html`
- Replace: `examples/travel-checklist-evolution/milestones/case-01/.mf-dev-flow/**`
- Replace: `examples/travel-checklist-evolution/milestones/case-02/.mf-dev-flow/**`
- Create: `examples/travel-checklist-evolution/scripts/verify-example.mjs`

**Interfaces:**
- Consumes: milestone and selector contracts from Task 1.
- Produces: `verifyMilestone(exampleRoot: string, caseId: string): { caseId: string, featureIds: string[], impactStatus: string | null }`.
- Source IDs: `prd-travel-v1`, prototype group `trip-list`, prototype entries `trip-list-default` and `trip-list-completed`.
- Initial feature ID: `completed-filter`.

- [ ] **Step 1: Write verification assertions for Case 01 and Case 02**

The verifier must load each snapshot without selecting it and assert:

```js
assert.equal(case01.project.project.name, "旅行清单示例");
assert.deepEqual(case01.prdManifest.sources.map((source) => source.id), ["prd-travel-v1"]);
assert.equal(case01.prototypeTask.status, "in_progress");

assert.deepEqual(case02.featureMap.features.map((feature) => feature.id), ["completed-filter"]);
assert.equal(case02.featureMap.features[0].status, "not_started");
assert.deepEqual(case02.acceptance.records.map((record) => record.id), [
  "AC-TRIP-001",
  "AC-TRIP-002",
  "AC-TRIP-003",
]);
```

Also call `prdSummary(store)`, `prototypeSummary(store)`, and `planningSummary(store)`; assert that each returns non-null data and contains no `error`, `sourceProblems`, or `groupProblems` entries.

- [ ] **Step 2: Run verification and confirm the expected failure**

Run:

```bash
node examples/travel-checklist-evolution/scripts/verify-example.mjs case-01 case-02
```

Expected: FAIL because v1 inputs and complete snapshots do not exist.

- [ ] **Step 3: Write PRD v1 and prototype v1**

PRD v1 must state exactly these observable requirements:

```markdown
- 默认显示三项旅行准备事项及完成状态。
- 用户可以开启“仅看已完成”，此时只显示两项已完成事项。
- 用户可以关闭筛选并恢复全部三项。
- 本版不包含分组、进度摘要、编辑、持久化或远程同步。
```

Prototype v1 must contain `data-entry-id="trip-list-default"`, a button named `仅看已完成`, three list items, and an `aria-live="polite"` result description. Its JavaScript must allow the default, completed-only, and restored states to be reproduced.

- [ ] **Step 4: Run the real registration and intake commands for Case 01**

From the example root, run the actual project initialization/registration sequence, ingest `prd/v1.md` with `prd ingest --file`, initialize the HTML prototype through the registered prototype process/adapter, and confirm the outputs with `project status`, `prd status --json`, and `prototype status --json`.

The resulting active state must contain:

- `project.json` with prototype location `prototype/v1.html`, code root `app`, and browser-manual test commands.
- `prd/manifest.json` with source `prd-travel-v1` and a SHA-256 hash of `prd/v1.md`.
- `prd/sources/prd-travel-v1.md` as the frozen source text.
- `prototype/task.json` with status `in_progress` and source run `travel-prototype-v1`.
- Empty-but-valid `prototype/feature-index.json`, `coverage.json`, and `open-questions.json`.

Record every command and exit code in `generation/case-01.jsonl`, using paths relative to the example root. After the final three status commands succeed, append a `kind: "gate"` record and run `snapshot-case.mjs case-01`. Do not edit generated canonical state to force the expected shape.

- [ ] **Step 5: Complete the real analysis and planning commands for Case 02**

Use the skill protocol to author PRD findings and prototype observations, then run `prd check`, `prd render`, prototype audit/accept, `feature refine`, proposal patching, and `feature apply`. Case 02 must include:

- A checked PRD findings batch `travel-prd-v1` whose evidence quotes exist verbatim in the frozen source.
- Prototype group `trip-list`, two entries, observed evidence paths, zero unresolved questions, and an `原型图流程.md` report.
- `planning/feature-map.json` schema version 4 with `completed-filter`, `sourceEntries` for both v1 entries, `sourceRequirementIds: ["REQ-TRIP-FILTER"]`, P1/W1 labels, explicit analysis, no blockers, and a `prototypeBaseline` produced by `readPrototypeRevision(store)`.
- Three active acceptance cases for default, enabled, and restored filter states.
- A human-readable `planning/功能演进地图.md` containing scope and out-of-scope statements.

The successful `prd check`, prototype audit/accept, and `feature apply` outputs are mandatory provenance records. Run `feature status` as the final gate, append the gate record to `generation/case-02.jsonl`, then use `snapshot-case.mjs case-02`. Do not write `prototypeBaseline`, planning revision IDs, hashes, label history, or map status directly; they must come from the commands.

- [ ] **Step 6: Run Case 01 and Case 02 verification**

```bash
node examples/travel-checklist-evolution/scripts/verify-example.mjs case-01 case-02
node --test examples/travel-checklist-evolution/scripts/select-case.test.mjs
```

Expected: both commands pass; Case 02 planning impact is `current`.

- [ ] **Step 7: Commit the input and analysis stages**

```bash
git add examples/travel-checklist-evolution/prd examples/travel-checklist-evolution/prototype examples/travel-checklist-evolution/milestones/case-01 examples/travel-checklist-evolution/milestones/case-02 examples/travel-checklist-evolution/scripts/verify-example.mjs
git diff --cached --check
git commit -m "docs: add PRD and prototype analysis stages"
```

---

### Task 3: Deliver the first filter feature through the real delivery flow in Case 03

**Files:**
- Rename: `examples/travel-checklist-evolution/app/index.html` → `examples/travel-checklist-evolution/app/v1.html`
- Replace: `examples/travel-checklist-evolution/milestones/case-03/.mf-dev-flow/**`
- Modify: `examples/travel-checklist-evolution/scripts/verify-example.mjs`
- Create: `dashboard/tests/browser/example-evolution.spec.ts`

**Interfaces:**
- Consumes: `completed-filter`, v1 prototype baseline, and three acceptance IDs from Task 2.
- Produces: delivery run `travel-filter-v1`, task `implement-completed-filter`, and a `done` feature-history event sequence.

- [ ] **Step 1: Write browser assertions for the v1 application**

The browser test must open `app/v1.html` and assert:

```js
await expect(page.locator("[data-trip-item]:visible")).toHaveCount(3);
await page.getByRole("button", { name: "仅看已完成" }).click();
await expect(page.locator("[data-trip-item]:visible")).toHaveCount(2);
await expect(page.getByText("显示 2 / 3 项")).toBeVisible();
await page.getByRole("button", { name: "显示全部项目" }).click();
await expect(page.locator("[data-trip-item]:visible")).toHaveCount(3);
```

Serve the example with a local static HTTP server in test setup; do not use `file://`.

- [ ] **Step 2: Run the browser test and verify the expected failure**

Run:

```bash
pnpm --dir dashboard exec playwright test tests/browser/example-evolution.spec.ts
```

Expected: FAIL because `app/v1.html` and its result summary do not exist yet.

- [ ] **Step 3: Move and harden the first delivered application**

Move the existing page to `app/v1.html`, add `data-trip-item` to each row, and update an `aria-live="polite"` element to exactly `显示 3 / 3 项` or `显示 2 / 3 项` after each action. Keep the current hidden-row CSS rule.

- [ ] **Step 4: Run the actual focused delivery and freeze Case 03**

Restore Case 02, start `completed-filter` through `feature start`, register its task with `work plan`, claim/bind the session, follow the frozen process stages, develop `app/v1.html`, register real browser evidence and each frozen acceptance-case result, then run `work finish`, `work merge-check`, `work verify`, and the run-completion command required by the frozen process.

The command-generated state must include:

- Feature status `done` and confirmed stage summaries for `prototype_alignment`, `technical_solution`, `development`, and `end_to_end_acceptance`.
- `delivery-runs/travel-filter-v1/run.json`, `work-plan.json`, `delivery-input.json`, and `executions/implement-completed-filter.json` with their real execution timestamps.
- `planning/feature-history.json` events connecting the task and four confirmed stages to `completed-filter`.
- Visual evidence records whose paths resolve to Case 03 prototype and application screenshots once Task 7 captures them.
- `execution-index.json` containing the completed run.

Do not edit the feature or run to `done`. The state transition must be performed by the delivery/work commands after all task and stage records are terminal. Record the actual sequence in `generation/case-03.jsonl`, end with successful `feature status` and delivery verification gate records, then run `snapshot-case.mjs case-03`.

- [ ] **Step 5: Extend milestone verification**

Assert:

```js
assert.equal(case03.planning.features[0].status, "done");
assert.equal(case03.planning.features[0].planningStatus, "current");
assert.ok(Object.values(case03.planning.features[0].stages).every((stage) => stage.status === "confirmed"));
assert.equal(case03.runs.find((run) => run.id === "travel-filter-v1").status, "done");
```

- [ ] **Step 6: Run Case 03 tests**

```bash
pnpm --dir dashboard exec playwright test tests/browser/example-evolution.spec.ts
node examples/travel-checklist-evolution/scripts/verify-example.mjs case-03
```

Expected: browser interactions and milestone readers pass.

- [ ] **Step 7: Commit the first delivery**

```bash
git add dashboard/tests/browser/example-evolution.spec.ts examples/travel-checklist-evolution/app/v1.html examples/travel-checklist-evolution/milestones/case-03 examples/travel-checklist-evolution/scripts
git diff --cached --check
git commit -m "feat: demonstrate first travel feature delivery"
```

---

### Task 4: Run PRD/prototype v2 and let the real impact engine produce Case 04

**Files:**
- Create: `examples/travel-checklist-evolution/prd/v2.md`
- Create: `examples/travel-checklist-evolution/prototype/v2.html`
- Replace: `examples/travel-checklist-evolution/milestones/case-04/.mf-dev-flow/**`
- Modify: `examples/travel-checklist-evolution/scripts/verify-example.mjs`

**Interfaces:**
- Consumes: Case 03 planning map with the v1 `prototypeBaseline`.
- Produces: a v2 prototype revision for which `prototypeImpact(oldMap, readPrototypeRevision(case04Store))` returns `review_required` and includes `completed-filter`.
- New requirement IDs: `REQ-TRIP-GROUPS` and `REQ-TRIP-PROGRESS`.
- New prototype entries: `trip-stage-groups` and `trip-progress-summary`.

- [ ] **Step 1: Add failing Case 04 impact assertions**

```js
const impact = prototypeImpact(case04Map, readPrototypeRevision(case04Store));
assert.equal(impact.status, "review_required");
assert.ok(impact.affected.some((item) => item.id === "completed-filter"));
assert.ok(impact.changedEntryIds.includes("trip-list-completed"));
assert.equal(planningSummary(case04Store).features[0].planningStatus, "review_required");
```

- [ ] **Step 2: Run Case 04 verification and confirm the expected failure**

```bash
node examples/travel-checklist-evolution/scripts/verify-example.mjs case-04
```

Expected: FAIL because the v2 source and changed revision are absent.

- [ ] **Step 3: Write PRD v2 and prototype v2**

PRD v2 must preserve the v1 filter requirements and add:

```markdown
- 清单按“出发前”和“旅途中”两个阶段分组。
- 筛选开启时，各分组只显示其中已完成的事项；空分组不显示。
- 进度摘要以当前可见事项为分母和分子，不沿用未筛选的全量统计。
```

Prototype v2 must visibly contain both group headings, four total items, the filter control, and `[data-progress-summary]`. The completed-only interaction must leave two visible items and show `当前结果：2 / 2 已完成`.

- [ ] **Step 4: Execute the changed-source flows while preserving the old planning baseline**

Restore Case 03, ingest PRD v2 as an additional source, run the actual v2 prototype analysis and acceptance flow, and do not start a new feature refinement yet. The existing feature map and v1 baseline remain untouched because no planning command has applied a new map.

Run `feature impact --json` and `feature status`; both outputs must report the stale/review-required condition and name `completed-filter`. Record them in `generation/case-04.jsonl`, add the successful impact-read gate record, and run `snapshot-case.mjs case-04`. Do not manually add `planningStatus`; the dashboard must derive it from the mismatched baseline.

- [ ] **Step 5: Run impact and reader verification**

```bash
node examples/travel-checklist-evolution/scripts/verify-example.mjs case-04
node --test dashboard/tests/prototype-impact.test.js dashboard/tests/prd.test.js
```

Expected: Case 04 returns `review_required`; existing impact and PRD tests pass.

- [ ] **Step 6: Commit the change-impact stage**

```bash
git add examples/travel-checklist-evolution/prd/v2.md examples/travel-checklist-evolution/prototype/v2.html examples/travel-checklist-evolution/milestones/case-04 examples/travel-checklist-evolution/scripts/verify-example.mjs
git diff --cached --check
git commit -m "feat: demonstrate proactive prototype impact review"
```

---

### Task 5: Replan and deliver the three-feature final application in Case 05

**Files:**
- Create: `examples/travel-checklist-evolution/app/index.html`
- Replace: `examples/travel-checklist-evolution/milestones/case-05/.mf-dev-flow/**`
- Modify: `dashboard/tests/browser/example-evolution.spec.ts`
- Modify: `examples/travel-checklist-evolution/scripts/verify-example.mjs`

**Interfaces:**
- Feature IDs: `stage-groups`, `completed-filter`, `visible-progress`.
- Dependency order: `completed-filter.dependsOn = ["stage-groups"]`; `visible-progress.dependsOn = ["stage-groups", "completed-filter"]`.
- Final visible summary contract: default `当前结果：2 / 4 已完成`; filtered `当前结果：2 / 2 已完成`.

- [ ] **Step 1: Add failing final application browser assertions**

```js
await page.goto(`${baseURL}/app/index.html`);
await expect(page.getByRole("heading", { name: "出发前" })).toBeVisible();
await expect(page.getByRole("heading", { name: "旅途中" })).toBeVisible();
await expect(page.locator("[data-trip-item]:visible")).toHaveCount(4);
await expect(page.locator("[data-progress-summary]")).toHaveText("当前结果：2 / 4 已完成");
await page.getByRole("button", { name: "仅看已完成" }).click();
await expect(page.locator("[data-trip-item]:visible")).toHaveCount(2);
await expect(page.locator("[data-progress-summary]")).toHaveText("当前结果：2 / 2 已完成");
```

- [ ] **Step 2: Run the final browser test and verify the expected failure**

Run the same Playwright command from Task 3.

Expected: v1 assertions pass and final application assertions fail because `app/index.html` is absent.

- [ ] **Step 3: Implement the final static application**

Use one in-memory item array with `{ title, stage, done }`. Render groups from that array on every filter change, omit groups with zero visible items, and calculate the summary from `visibleItems`:

```js
const visibleItems = filterDone ? items.filter((item) => item.done) : items;
const completed = visibleItems.filter((item) => item.done).length;
summary.textContent = `当前结果：${completed} / ${visibleItems.length} 已完成`;
```

Keep the page dependency-free, keyboard-accessible, and deterministic.

- [ ] **Step 4: Produce the final replanned map through refine, patch, validation, and apply**

Restore Case 04, run `feature refine --scope auto`, use the skill's proposal/patch workflow to provide the three-feature proposal and all mandatory impact reviews, validate it through the actual planning gates, then run `feature apply`. The resulting command-generated schema-version-4 map must contain:

- Two groups: `trip-organization` and `trip-feedback`.
- Three `done` features with P/W reasons, development requirements, analysis, stage summaries, and source links.
- A fresh v2 `prototypeBaseline` from `readPrototypeRevision(case05Store)`.
- `impactReviews` and migrations documenting `completed-filter` as `revise/revalidate` and both new features as `add/revalidate`.
- `reassessment` history preserving the reason, affected feature, targets, and delivery impact.
- Acceptance cases for group visibility, group-aware filtering, and visible progress in addition to the original filter cases.

Do not call `impactReviewProblems(...)` as a substitute for the public flow. `feature apply` is the authoritative validation and must reject an incomplete review. Record refine, proposal-patch, apply, and fresh `feature status` outputs in `generation/case-05.jsonl`.

- [ ] **Step 5: Deliver the three features through actual delivery/work commands**

Start the eligible features through the public delivery commands in dependency order. Each product task must be command-linked to exactly one leaf feature, pass its frozen process stages, record its browser evidence and acceptance-case decisions, and complete via `work finish`, merge-check, verify, and run completion. Feature history must be the command-produced history showing initial planning, first delivery, impact review, replan, and final delivery.

After the final `feature status`, `work index`, and run verification commands succeed, append the Case 05 gate record and run `snapshot-case.mjs case-05`.

- [ ] **Step 6: Extend final milestone assertions**

```js
assert.deepEqual(case05.planning.features.map((feature) => feature.id), [
  "stage-groups",
  "completed-filter",
  "visible-progress",
]);
assert.ok(case05.planning.features.every((feature) => feature.status === "done"));
assert.equal(case05.planning.prototypeImpact.status, "current");
assert.deepEqual(case05.byId.get("visible-progress").dependsOn, ["stage-groups", "completed-filter"]);
assert.ok(case05.history.some((event) => event.kind === "impact_reviewed"));
```

- [ ] **Step 7: Run app, milestone, and dashboard-reader tests**

```bash
pnpm --dir dashboard exec playwright test tests/browser/example-evolution.spec.ts
node examples/travel-checklist-evolution/scripts/verify-example.mjs case-05
node --test dashboard/tests/prototype-impact.test.js dashboard/tests/feature-stage-history.test.js modules/runtime/tests/acceptance-cases.test.mjs
```

Expected: both application versions pass; Case 05 has three current, completed features.

- [ ] **Step 8: Select Case 05 as the committed default and commit**

```bash
node examples/travel-checklist-evolution/scripts/select-case.mjs case-05
git add examples/travel-checklist-evolution/app/index.html examples/travel-checklist-evolution/.mf-dev-flow examples/travel-checklist-evolution/milestones/case-05 examples/travel-checklist-evolution/scripts
git diff --cached --check
git commit -m "feat: complete travel project evolution demo"
```

---

### Task 6: Write the five case guides and README indexes

**Files:**
- Replace: `examples/travel-checklist-evolution/README.md`
- Create: `examples/travel-checklist-evolution/cases/01-prd-and-prototype.md`
- Create: `examples/travel-checklist-evolution/cases/02-analysis-and-planning.md`
- Create: `examples/travel-checklist-evolution/cases/03-first-delivery.md`
- Create: `examples/travel-checklist-evolution/cases/04-change-impact.md`
- Create: `examples/travel-checklist-evolution/cases/05-replanning-and-final-delivery.md`
- Modify: `README.md`
- Modify: `docs/five-minute-demo.md`
- Delete: `examples/travel-checklist-evolution/cases-legacy.md`

**Interfaces:**
- Consumes: the exact case IDs, commands, filenames, and expected states from Tasks 1–5.
- Produces: root index → example index → ordered case guide navigation.

- [ ] **Step 1: Add documentation checks to the verifier**

For each case, assert the guide contains these headings exactly:

```js
const required = [
  "## 场景说明",
  "## 前置状态",
  "## 如何操作",
  "## 应用效果",
  "## 看板变化",
  "## 截图",
  "## 产生的状态与证据",
  "## 下一步",
];
```

Parse local Markdown links and image links; assert every relative target exists beneath the repository root.

- [ ] **Step 2: Run documentation verification and confirm the expected failure**

```bash
node examples/travel-checklist-evolution/scripts/verify-example.mjs docs
```

Expected: FAIL because the case guides and index do not exist.

- [ ] **Step 3: Write every case guide using observed facts**

Each guide must include:

- `node scripts/select-case.mjs case-0N` from the example directory.
- `node ../../scripts/mf-dev-flow.mjs dashboard` to open the ordinary dashboard.
- The exact page or dashboard section to inspect.
- Expected feature IDs, statuses, visible counts, and impact status.
- The fixed statement that the data is a public synthetic fixture.
- A “如何由 mf-dev-flow 产生” subsection linking to the sanitized generation record and naming the command gate that produced the milestone.
- Previous/next case links.

Case 04 must explicitly show why `completed-filter` is affected and why old planning cannot continue. Case 05 must explain both new dependencies and the visible-result summary semantics.

- [ ] **Step 4: Replace the example README with an ordered index**

The index table columns are `Case`, `难度`, `建议时间`, `主要输入`, `可观察结果`, and `入口`. Use difficulty values `入门`, `基础`, `进阶`, `高级`, `完整闭环`, and cumulative times `3`, `5`, `7`, `8`, `10` minutes.

Include one copy-paste quick start that installs dashboard dependencies, selects Case 01, starts the dashboard, and points to Case 01.

- [ ] **Step 5: Update the root README**

Replace “五分钟看懂一次闭环” with “从 PRD 到变更影响：一个项目的完整演进”. Embed only the final large dashboard overview image, then link the five cases through the example index rather than duplicating all instructions.

- [ ] **Step 6: Run documentation checks and commit**

```bash
node examples/travel-checklist-evolution/scripts/verify-example.mjs docs
git add README.md docs/five-minute-demo.md examples/travel-checklist-evolution/README.md examples/travel-checklist-evolution/cases examples/travel-checklist-evolution/cases-legacy.md
git diff --cached --check
git commit -m "docs: index the travel evolution cases"
```

---

### Task 7: Capture and verify large screenshots for every case

**Files:**
- Create: `examples/travel-checklist-evolution/screenshots/manifest.json`
- Create: `examples/travel-checklist-evolution/screenshots/case-01-prototype-v1.png`
- Create: `examples/travel-checklist-evolution/screenshots/case-01-dashboard-sources.png`
- Create: `examples/travel-checklist-evolution/screenshots/case-02-dashboard-analysis.png`
- Create: `examples/travel-checklist-evolution/screenshots/case-02-dashboard-features.png`
- Create: `examples/travel-checklist-evolution/screenshots/case-03-app-filter.png`
- Create: `examples/travel-checklist-evolution/screenshots/case-03-dashboard-delivery.png`
- Create: `examples/travel-checklist-evolution/screenshots/case-04-prototype-v2.png`
- Create: `examples/travel-checklist-evolution/screenshots/case-04-dashboard-impact.png`
- Create: `examples/travel-checklist-evolution/screenshots/case-05-app-final.png`
- Create: `examples/travel-checklist-evolution/screenshots/case-05-dashboard-evolution.png`
- Modify: all five case guides and `README.md` image paths.

**Interfaces:**
- Manifest item: `{ "caseId": string, "kind": "app" | "prototype" | "dashboard", "file": string, "minWidth": 1400, "minHeight": 800, "shows": string[] }`.
- Every case must have at least one dashboard image and at least one application/prototype image.

- [ ] **Step 1: Add screenshot manifest and PNG dimension assertions**

Read PNG width and height from the IHDR bytes:

```js
const pngSize = (file) => {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};
```

Assert all manifest files exist, are at least their configured dimensions, and every case has both required visual kinds.

- [ ] **Step 2: Run screenshot verification and confirm the expected failure**

```bash
node examples/travel-checklist-evolution/scripts/verify-example.mjs screenshots
```

Expected: FAIL listing the ten missing images.

- [ ] **Step 3: Capture prototype and application screenshots**

Start a local static server rooted at the example. Use a `1600 × 1000` viewport. Capture full visible project cards, not isolated controls. Exercise the filter before capturing Case 03 and Case 05 result states.

For each image, inspect it visually and confirm the page title, active control, list/group context, and result summary are readable.

- [ ] **Step 4: Capture dashboard screenshots milestone by milestone**

For each case:

1. Run `node scripts/select-case.mjs case-0N`.
2. Start `node ../../scripts/mf-dev-flow.mjs dashboard` from the example directory.
3. Use a `1600 × 1000` viewport.
4. Capture the full relevant section using its section container, including the section heading and surrounding status context.
5. Stop the dashboard before selecting the next case.

Case 02 and Case 05 feature screenshots must include case cards, feature cards, and their containing groups. Case 04 must include the impact warning and affected `completed-filter` card.

- [ ] **Step 5: Restore the committed default and wire images into docs**

```bash
node scripts/select-case.mjs case-05
```

Add each image immediately after the relevant expected-result paragraph, with descriptive Chinese alt text. Do not use thumbnails or HTML width attributes that make the screenshots unreadable.

- [ ] **Step 6: Run screenshot and docs verification**

```bash
node scripts/verify-example.mjs screenshots docs case-01 case-02 case-03 case-04 case-05
```

Expected: all image dimensions, links, case states, and default Case 05 selection pass.

- [ ] **Step 7: Commit screenshots and references**

```bash
git add README.md examples/travel-checklist-evolution
git diff --cached --check
git commit -m "docs: add large evolution case screenshots"
```

---

### Task 8: Run full regression, privacy audit, and publication checks

**Files:**
- Modify only files required to correct failures found by the commands below.

**Interfaces:**
- Consumes: completed example and existing repository validation commands.
- Produces: a clean Git tree whose local `HEAD^{tree}` matches the published GitHub `main` tree.

- [ ] **Step 1: Run example-specific verification from a clean Case 05 default**

```bash
node examples/travel-checklist-evolution/scripts/select-case.mjs case-05
node --test examples/travel-checklist-evolution/scripts/select-case.test.mjs
node --test examples/travel-checklist-evolution/scripts/run-recorded.test.mjs
node --test examples/travel-checklist-evolution/scripts/snapshot-case.test.mjs
node examples/travel-checklist-evolution/scripts/verify-example.mjs all
pnpm --dir dashboard exec playwright test tests/browser/example-evolution.spec.ts
```

Expected: all pass and the selector reports `case-05`.

For every milestone, independently hash the selected `.mf-dev-flow` tree and compare it with `milestones/<caseId>/manifest.json`. Verify each provenance log ends with a successful gate and contains the required public commands for that Case.

- [ ] **Step 2: Run targeted core and dashboard regressions**

```bash
node --test scripts/mf-dev-flow.object-locate.test.mjs scripts/mf-dev-flow.project-check.test.mjs scripts/mf-dev-flow.feature-refinement.test.mjs modules/runtime/tests/acceptance-cases.test.mjs modules/runtime/tests/project-card.test.mjs
pnpm --dir dashboard test
pnpm --dir dashboard exec tsc --noEmit --incremental false
```

Expected: all selected Node tests, dashboard tests, and type checks pass.

- [ ] **Step 3: Run the full maintained core suite**

```bash
node --test --test-reporter=dot scripts/*.test.mjs modules/*/tests/*.test.mjs integrations/codex/hooks/mf-dev-flow.test.mjs
```

Expected: exit 0; record actual test counts and do not describe zero discovered tests as success.

- [ ] **Step 4: Scan the current tree for private fixed information and secret patterns**

```bash
rg -n -i "(/Users/|/home/|PRIVATE_USER|PRIVATE_PROJECT|api[_-]?key|access[_-]?token|client[_-]?secret|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY)" --glob '!dashboard/pnpm-lock.yaml' .
```

Expected: no private path, internal project identifier, credential, or private-key match in the publishable tree. Review neutral documentation terms separately rather than blindly replacing them.

- [ ] **Step 5: Scan Git history for the same fixed information**

```bash
git rev-list --all | while read -r commit; do git grep -I -n -i -E '(/Users/|/home/|PRIVATE_USER|PRIVATE_PROJECT|api[_-]?key|access[_-]?token|client[_-]?secret|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY)' "$commit" -- . ':!dashboard/pnpm-lock.yaml' || true; done
```

Expected: no undisclosed private project information or credential material. The GitHub account name in commit metadata is not a file-content leak; report it separately if encountered.

- [ ] **Step 6: Inspect the final staged diff and commit fixes if needed**

```bash
git status --short
git diff --check
git diff --stat
```

If fixes were required, stage exact paths, run `git diff --cached --check`, and commit with a message describing the actual correction.

- [ ] **Step 7: Publish without rewriting history and verify the remote tree**

Push normally when the configured transport works. If direct Git transport remains unavailable, use the GitHub Git Data API to create blobs, a tree based on remote `main`, a non-forced commit, and a fast-forward ref update. Abort if the remote base tree differs from the local parent tree.

Verify:

```bash
gh api repos/<owner>/mf-dev-flow/commits/main --jq '[.sha, .commit.tree.sha, .commit.message] | @tsv'
git rev-parse HEAD^{tree}
git status --short
```

Expected: remote and local tree SHA values match; the worktree is clean.
