# Versioned Delivery Processes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make feature-map delivery select a versioned four-stage process whose stage agents are independently editable and whose instructions are frozen per run.

**Architecture:** A delivery-process loader reads one manifest plus four stage-agent files and returns a validated, hashed snapshot. Delivery run creation persists that snapshot; task creation copies its stage definitions. Claim, brief, and checkpoint resumption use the frozen stage agent, with attempt-level handoff records when an agent changes at a verified checkpoint.

**Tech Stack:** Node.js ESM, `node:test`, existing mf-dev-flow isolated fixture helpers.

**Spec:** `.codex/skills/mf-dev-flow/flows/maintenance/versioned-delivery-processes-design.md`

## Global Constraints

- Only write `.codex/skills/mf-dev-flow/` and test fixtures; never read or mutate real `.mf-dev-flow`.
- Preserve generic and historical delivery behavior when `deliveryProcess` is absent.
- Source process files are not the authority after run creation; the persisted snapshot is.
- An agent may change only between validated checkpoint attempts.

---

### Task 1: Add a validated, hashable process loader and default process files

**Files:**
- Create: `.codex/skills/mf-dev-flow/modules/delivery/processes.mjs`
- Create: `.codex/skills/mf-dev-flow/modules/delivery/processes/miniapp-product/v1/process.json`
- Create: `.codex/skills/mf-dev-flow/modules/delivery/processes/miniapp-product/v1/agents/prototype-alignment.md`
- Create: `.codex/skills/mf-dev-flow/modules/delivery/processes/miniapp-product/v1/agents/technical-solution.md`
- Create: `.codex/skills/mf-dev-flow/modules/delivery/processes/miniapp-product/v1/agents/development.md`
- Create: `.codex/skills/mf-dev-flow/modules/delivery/processes/miniapp-product/v1/agents/e2e-acceptance.md`
- Test: `.codex/skills/mf-dev-flow/scripts/delivery-processes.test.mjs`

**Interfaces:**
- Produces `loadDeliveryProcess({ id, version })`, returning a frozen process snapshot with stage definitions and agent content hashes.
- Produces `stageAgentFor(task, stageId)`, returning the frozen `{ id, instructions, sha256 }` profile or `null`.

- [ ] **Step 1: Write failing loader tests** for valid loading, four unique ordered stages, source hashes, missing agent file, and `../` path rejection.
- [ ] **Step 2: Run the new test** with `node --test .codex/skills/mf-dev-flow/scripts/delivery-processes.test.mjs`; verify the expected missing-module failure.
- [ ] **Step 3: Add the four agent files and manifest** with contract-equivalent four stages and stage-local instructions.
- [ ] **Step 4: Implement the minimal loader** using canonical JSON plus SHA-256, size-limited UTF-8 files, and resolved-path containment checks.
- [ ] **Step 5: Re-run the loader test** and confirm every assertion passes.

### Task 2: Freeze the selected process during feature-map delivery creation

**Files:**
- Modify: `.codex/skills/mf-dev-flow/modules/runtime/shared.mjs`
- Modify: `.codex/skills/mf-dev-flow/scripts/mf-dev-flow.feature-refinement.test.mjs`
- Test: `.codex/skills/mf-dev-flow/scripts/delivery-processes.test.mjs`

**Interfaces:**
- `createDeliveryRun` persists `deliveryProcess: { id, version, sha256 }` and frozen stages carrying each agent profile.
- Existing callers keep the generic manual-run path unchanged.

- [ ] **Step 1: Write failing fixture tests** asserting a feature-map run carries `miniapp-product@1`, all four profiles, and a source-edit after creation cannot alter the persisted snapshot.
- [ ] **Step 2: Run the focused test files** and verify failure because no `deliveryProcess` exists yet.
- [ ] **Step 3: Replace the hard-coded feature-map miniapp contract lookup** with the loader snapshot while preserving generic manual runs.
- [ ] **Step 4: Run focused tests** and confirm the snapshot assertions pass.

### Task 3: Enforce stage-agent identity and record checkpoint handoffs

**Files:**
- Modify: `.codex/skills/mf-dev-flow/modules/runtime/delivery.mjs`
- Modify: `.codex/skills/mf-dev-flow/scripts/delivery-processes.test.mjs`
- Test: `.codex/skills/mf-dev-flow/scripts/delivery-contract.test.mjs`

**Interfaces:**
- `work claim --agent <profile-id> --target-phase <stage>` rejects a frozen-process task when the profile differs.
- `work bind-session` allows a different profile only for a resumable checkpoint and records a handoff on the new attempt.

- [ ] **Step 1: Write failing fixture tests** for initial wrong-agent rejection, same-attempt change rejection, and valid checkpoint handoff from `prototype-alignment` to `technical-solution`.
- [ ] **Step 2: Run the process test** and verify the missing validation/handoff assertions fail.
- [ ] **Step 3: Implement minimal frozen-profile lookup and checks** in claim and bind; extend attempt records with `agent` and add a handoff record only on checkpoint resumption.
- [ ] **Step 4: Run focused tests** and confirm wrong agents are rejected while the checkpoint handoff is accepted.

### Task 4: Render only the active agent instruction in the stage brief

**Files:**
- Modify: `.codex/skills/mf-dev-flow/modules/delivery/contract.mjs`
- Modify: `.codex/skills/mf-dev-flow/modules/runtime/delivery.mjs`
- Modify: `.codex/skills/mf-dev-flow/scripts/delivery-contract.test.mjs`

**Interfaces:**
- `renderDeliveryBrief` accepts an optional active agent profile and emits its ID/instructions after the current stage contract only.

- [ ] **Step 1: Write a failing brief test** that expects the solution profile in the solution brief and asserts development/acceptance agent text is absent.
- [ ] **Step 2: Run `node --test .codex/skills/mf-dev-flow/scripts/delivery-contract.test.mjs`** and verify the assertion fails.
- [ ] **Step 3: Add conditional active-profile rendering** and pass the stage profile from `workDeliveryBrief`.
- [ ] **Step 4: Re-run the contract test** and confirm the brief stays stage-local.

### Task 5: Run maintenance regression gates

**Files:**
- Test: `.codex/skills/mf-dev-flow/modules/workflow/tests/*.test.mjs`
- Test: `.codex/skills/mf-dev-flow/scripts/*.test.mjs`

- [ ] **Step 1: Run all workflow and script fixture tests** using the commands in `flows/maintenance/architecture.md`.
- [ ] **Step 2: Inspect changed files and verify** only `.codex/skills/mf-dev-flow/` changed for this task.
- [ ] **Step 3: Report test commands, exit codes, and any remaining limitations** without claiming completion before the fresh evidence exists.
