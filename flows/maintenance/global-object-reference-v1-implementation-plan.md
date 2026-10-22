# 全局对象引用 V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution with the approved maintenance workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 mf-dev-flow 的持久、可公开寻址对象提供项目内稳定 Object Ref，并通过公共 `object locate` 命令解析到真源，同时保持现有 ID、Graph Ref 和真实 `.mf-dev-flow` 数据兼容。

**Architecture:** 新增纯 `object-ref` 内核模块，将 Object Ref 的格式、解析、kind 注册和 Graph Ref 映射集中管理。运行时 resolver 只读各域已有真源，并由 command registry 暴露 `object locate`；看板只接收安全摘要并复制 Object Ref，不暴露 locator。

**Tech Stack:** Node.js ESM、node:test、Node SQLite（仅经既有 public CLI/adapter）、TypeScript/React 看板、临时 fixture。

**Spec:** `.codex/skills/mf-dev-flow/flows/maintenance/global-object-reference-v1-design.md`

## Global Constraints

- 仅写 `.codex/skills/mf-dev-flow/` 与临时 fixture；不读取、扫描、迁移真实 `.mf-dev-flow`。
- Object Ref 是派生值，不在历史 JSON/SQLite 中回填 `globalId`，不引入递增计数器或全局 registry。
- 只读 resolver 的路径必须相对工作区且 fail-closed；默认 dashboard state 不输出绝对路径、会话、原始证据或密钥。
- 不改变已有 `id`、`runId`、`taskId`、Graph Ref、图边格式或既有 CLI 输出的字段语义；只增加字段/命令。
- 当前并发声明与归因改动保持独立，不混入本功能的测试断言、文档或提交。
- 按用户当前习惯不自动提交；需要提交时由用户明确提出。

---

## File Structure

| 文件 | 职责 |
| --- | --- |
| `modules/kernel/object-ref.mjs` | Object Ref 的 kind 注册、格式化、解析、Graph Ref 映射和纯校验 |
| `modules/kernel/tests/object-ref.test.mjs` | 纯函数的回环、非法输入、兼容映射回归 |
| `modules/kernel/record.mjs` | 复用 graph-compatible 映射，修正 `feature-group` 前缀校验 |
| `modules/graph/graph.mjs` | 使用共享 Graph Ref 映射，不重复维护前缀→kind 表 |
| `modules/runtime/object.mjs` | 公共 `object locate` 参数解析和各域只读 Truth Pointer resolver |
| `modules/workflow/registry.json` | 注册 `object locate` 命令路由 |
| `scripts/mf-dev-flow.object-locate.test.mjs` | 通过公共 CLI 驱动临时 fixture 的跨域定位与失败回归 |
| `dashboard/server/readers/*` | 给已有摘要附加安全 `ref`，不返回 locator |
| `dashboard/app/*` | 在功能、运行/任务和图节点复制 Object Ref |
| `dashboard/tests/*` | 钉住附加 ref 与 locator 不泄露的服务端/UI 契约 |
| `flows/maintenance/validation.md` | 记录本轮隔离验证命令、结果和边界 |

## Task 1: Object Ref 内核与 Graph Ref 兼容层

**Files:**
- Create: `.codex/skills/mf-dev-flow/modules/kernel/object-ref.mjs`
- Create: `.codex/skills/mf-dev-flow/modules/kernel/tests/object-ref.test.mjs`
- Modify: `.codex/skills/mf-dev-flow/modules/kernel/record.mjs`
- Modify: `.codex/skills/mf-dev-flow/modules/graph/graph.mjs`

**Interfaces:**
- Produces `OBJECT_KINDS`, `formatObjectRef({kind, key})`, `parseObjectRef(ref)`, `objectRefFor(kind, ...segments)`, `toGraphRef(ref)` and `graphRefKind(ref)`.
- `formatObjectRef({kind:"task",key:"delivery/20260910-094549Z/theme-fix"})` returns `mf-dev-flow:task:delivery/20260910-094549Z/theme-fix`.
- `toGraphRef("mf-dev-flow:feature-group:reading")` returns `feature-group:reading`; unsupported Object Ref kinds return `null` rather than guessing.

- [ ] Write failing node:test cases for every V1 kind, URL segment round trips, empty/control-character rejection, unsupported graph mappings, and `feature-group` Graph Ref acceptance.
- [ ] Run the focused test file and confirm it fails because the module does not exist.
- [ ] Implement the pure module and replace duplicated graph prefix→kind logic with its graph-compatible mapping.
- [ ] Run the focused test plus existing kernel/graph tests; confirm all pass.

## Task 2: Read-only `object locate` public command

**Files:**
- Create: `.codex/skills/mf-dev-flow/modules/runtime/object.mjs`
- Modify: `.codex/skills/mf-dev-flow/modules/workflow/registry.json`
- Create: `.codex/skills/mf-dev-flow/scripts/mf-dev-flow.object-locate.test.mjs`

**Interfaces:**
- Consumes `parseObjectRef(ref)` and existing safe JSON/catalog readers.
- Produces `objectLocate()` for `object locate --ref <ObjectRef> --json` with `{schemaVersion:1,object,truthPointer,summary}` or `{error:{code,message}}` and nonzero exit.
- Resolver coverage: project, project-card, prototype group/entry/source, PRD source/batch, system-card, feature-group/feature, run/task, release when its existing truth source exists, and code-file.

- [ ] Build a temporary fixture containing only the minimal valid JSON/catalog/run structures for each object domain; never point the CLI at this repository’s `.mf-dev-flow`.
- [ ] Write failing public-CLI tests for one successful locate per kind, unknown native ID, malformed Object Ref, unknown kind, escaped path traversal, and ambiguous task/run key.
- [ ] Implement resolver helpers per source family. Resolve JSON pointers deterministically; normalize all returned paths to workspace-relative POSIX paths; use catalog APIs for modern prototype data rather than ad-hoc SQL in dashboard code.
- [ ] Register the command through the existing command registry and run the focused test file until all success and failure cases pass.

## Task 3: Additive references in graph, CLI summaries and dashboard readers

**Files:**
- Modify: `.codex/skills/mf-dev-flow/modules/graph/graph.mjs`
- Modify: relevant `modules/runtime/archive.mjs`, `modules/runtime/planning.mjs`, `modules/runtime/prd.mjs`, and `modules/runtime/system.mjs` summary builders
- Modify: relevant `dashboard/server/readers/*.js`
- Modify or create focused dashboard/server fixture tests

**Interfaces:**
- Graph node keeps existing `ref` as Graph Ref and gains `objectRef` when it has a mapping.
- Public summaries retain all historical ID fields and add `ref` only when the Object Ref can be derived.
- `/api/state` contains safe Object Ref strings but never contains `truthPointer` or locator path details.

- [ ] Add failing tests asserting a feature group, feature, run, task, PRD source and system card receive the deterministic Object Ref while their existing IDs are unchanged.
- [ ] Add a negative state serialization assertion: no `truthPointer`, absolute path, `sessionId`, evidence payload or secret-bearing field appears merely because references were added.
- [ ] Implement additive decoration at existing read boundaries; do not write decorations back to any record.
- [ ] Run targeted graph/runtime/dashboard reader tests and TypeScript checking; ensure existing consumer shapes remain valid.

## Task 4: Safe copy affordances in the dashboard

**Files:**
- Modify: `.codex/skills/mf-dev-flow/dashboard/app/components/feature-board.tsx`
- Modify: `.codex/skills/mf-dev-flow/dashboard/app/components/run-history.tsx`
- Modify: `.codex/skills/mf-dev-flow/dashboard/app/components/graph-board.tsx`
- Modify: `.codex/skills/mf-dev-flow/dashboard/app/lib/types.ts`
- Modify: the smallest relevant dashboard tests

**Interfaces:**
- Reuses existing `CopyButton` with labels such as `复制引用`.
- Feature, run/task and graph-node type definitions receive optional `ref`/`objectRef` fields; Graph Ref is still rendered where it was before.

- [ ] Write/extend rendering tests to prove the copy action uses Object Ref, and that an absent optional ref leaves the prior UI usable.
- [ ] Add the smallest additive UI changes: feature cards/board, run/task history, and graph node details receive a copy action only when an Object Ref is present.
- [ ] Run dashboard tests and `tsc --noEmit --incremental false`; fix type mismatches without casting opaque data to `any` merely to bypass checks.

## Task 5: Documentation, isolation proof and full regression

**Files:**
- Modify: `.codex/skills/mf-dev-flow/flows/overview/records.md`
- Modify: `.codex/skills/mf-dev-flow/flows/maintenance/validation.md`
- Modify only the directly affected flow/CLI docs discovered during implementation

- [ ] Document Object Ref versus Graph Ref, the project-local V1 boundary, and the exact `object locate` contract.
- [ ] Run the complete mf-dev-flow isolated suite, dashboard TypeScript check, and `git diff --check`.
- [ ] Verify the test commands only created and removed temporary fixture directories, then record exact counts and known limits in `validation.md`.
- [ ] Inspect `git diff --name-only` to confirm the change is confined to the planned mf-dev-flow files and does not include existing user changes; do not commit unless explicitly requested.

## Plan Self-Review

- **Spec coverage:** Tasks 1–2 implement the identity, locator and compatibility contract; Tasks 3–4 implement additive safe exposure; Task 5 records limits and validates isolation.
- **Placeholder scan:** No task relies on a later unnamed type or an unspecified test command; unsupported/ambiguous values have explicit expected failure behavior.
- **Type consistency:** `ObjectRef` is the serialized `mf-dev-flow:<kind>:<key>` string; `Graph Ref` remains `prefix:id`; `truthPointer` is a locate-only object and never part of dashboard state.
