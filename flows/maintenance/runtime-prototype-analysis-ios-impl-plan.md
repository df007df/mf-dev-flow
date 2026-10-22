# Runtime Prototype Analysis iOS Native App Adapter Implementation Plan

**Goal:** Add `ios-app-runtime@1` on the completed runtime-analysis core so a user-authorized iOS Simulator session can produce the same normalized runtime-only evidence and report contract as a web or Mini Program runtime batch.

**Architecture:** Same shape as `wechat-miniapp-runtime@1`: the adapter contributes only a strict simulator capability declaration and a runtime-observe Agent overlay. The process graph, catalog, capture, report and evidence schemas are not forked. The Node CLI never drives the simulator; the current-stage Agent performs real operations with an available device-automation environment (for example a computer-operation tool against Xcode Simulator) and archives its results through `prototype capture`.

**Tech Stack:** Node.js >=22.18, JSON manifests, Markdown Agent overlays, `node:test`.

**Spec:** [runtime-prototype-analysis-design.md](runtime-prototype-analysis-design.md) — this plan registers a third runtime adapter as the design anticipated for "other formats must provide their own adapter and isolated fixture".

## Contract Decisions

- Adapter id/version: `ios-app-runtime@1`; public title: `iOS 原生 App 模拟器`.
- Source mode: only `ios-simulator`. Locator keys exactly `{ mode, bundleId, device }`:
  - `bundleId`: dotted reverse-DNS identifier, ≤256 bytes, no `..`, no path separators, rejects credential-like `token=`/`session=` segments.
  - `device`: simulator name or UDID, ≤128 bytes, letters/digits/space/`()`/`_`/`.`/`-` only, rejects paths and home-directory expansion.
  - `revision`: the shared bounded opaque build-revision validator (same rules as web/miniapp; no query, fragment, newline or prohibited key=value text).
- Capabilities (exact-locked in the shared loader, drift fails closed): `sourceDiscovery:false`, operations `[screenState, elementAction, simulatorScreenshot, traceArchive, appLaunch]`, evidence `{ screenshot: png, trace: true }`.
- Overlay: exactly one `runtime-observe` Agent overlay; its appendix requires before/after screen-state reads, stable element identity, separating build/install/launch as scenario preparation, full-visibility PNGs and trace fields `bundleId、screen、preconditions、element/action、expected、observed result`.
- Evidence profile: `runtime-only` only; `source-and-runtime` is rejected because `sourceDiscovery` stays false.

## Changes Delivered

- New: `modules/prototype/adapters/ios-app-runtime/v1/adapter.json` and `agents/runtime-observe.md`.
- `modules/prototype/processes.mjs`: `validateIosAppRuntimeAdapter` exact-contract lock wired into `loadPrototypeAdapter`.
- `modules/prototype/core/runtime-source.mjs`: `ios-app-runtime@1` contract entry, `iosSimulatorLocator`/`iosBundleId`/`iosSimulatorDevice` validators, and an `ios-simulator` branch in `normalizeRuntimeSource` (fails closed for foreign adapters, undeclared modes, extra locator keys and prohibited revision text).
- `modules/prototype/capabilities.mjs`: registration in `RUNTIME_ADAPTERS`; note extended to cover the iOS simulator.
- Tests: contract-mutation rejection and overlay composition (processes), public list/capabilities (unified), normalize/revision/init/capture batch and per-document claims (runtime-workflow).
- Flow docs: `flows/prototype/{entry,contract,workflow,capture,report-format}.md` each received the iOS counterpart paragraph; the document-claims test pins each contract sentence to exactly one location.

## Validation Summary (isolated fixtures only)

Unified command from [architecture.md](architecture.md): **210 tests — 209 passed, 0 failed, 1 skipped (pre-existing pixel-audit case)**. Dashboard `tsc --noEmit` passes. The run initially surfaced two pre-existing reds in `scripts/mf-dev-flow.project-check.test.mjs` (logged as unrelated by earlier maintenance reports): `discoverProjectDocumentEvidence` (changed 2026-09-07 18:26) now returns an array of `{path, sha256, updatedAt}` and documents no longer gate status, while the tests asserted the old object shape and a README-missing rejection. After user confirmation they were aligned in this same session: test 1 asserts the array with fingerprints; test 2 became a positive regression that any-named or absent documents never fail the card ("未发现 Markdown 项目文档（仅观察结果，不影响状态）"). The `project` family implementation was not modified. No real `.mf-dev-flow` was read, scanned, written, or migrated; synthetic fixture images/traces prove tool behavior only, not product evidence.

## Known Limits

- The adapter declares environment capabilities only; it cannot verify the Agent's device-automation tool actually controls a booted simulator. Access precheck belongs to the current-stage Agent, same as the browser contract for `web-runtime@1`.
- Real-device (USB iPhone) observation is out of v1 scope; only `ios-simulator` source mode is accepted.
- Source-level iOS discovery (Swift/Objective-C candidate extraction) is deliberately absent; a future source-discovery adapter would need its own plan.
