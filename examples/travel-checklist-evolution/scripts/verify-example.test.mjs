import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyMilestone } from "./verify-example.mjs";

const exampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Case 01 is a real registered PRD and unaccepted prototype milestone", () => {
  const result = verifyMilestone(exampleRoot, "case-01");
  assert.equal(result.projectName, "旅行清单示例");
  assert.deepEqual(result.prdSourceIds, ["v1-a1650f2cd8d2"]);
  assert.equal(result.prototypeStatus, "stale");
  assert.deepEqual(result.featureIds, []);
  assert.equal(result.impactStatus, null);
});

test("Case 02 is an accepted prototype with a current initial feature map", () => {
  const result = verifyMilestone(exampleRoot, "case-02");
  assert.equal(result.prototypeStatus, "ready");
  assert.deepEqual(result.featureIds, ["trip-list-filter"]);
  assert.deepEqual(result.featureStatuses, ["not_started"]);
  assert.deepEqual(result.acceptanceCaseIds, [
    "AC-trip-list-completed",
    "AC-trip-list-default",
    "AC-trip-list-restore",
  ]);
  assert.equal(result.impactStatus, "current");
});

test("Case 03 is the real completed v1 delivery", () => {
  const result = verifyMilestone(exampleRoot, "case-03");
  assert.deepEqual(result.featureIds, ["trip-list-filter"]);
  assert.deepEqual(result.featureStatuses, ["done"]);
  assert.equal(result.impactStatus, "current");
});

test("Case 04 preserves v1 completion but blocks stale planning after v2", () => {
  const result = verifyMilestone(exampleRoot, "case-04");
  assert.deepEqual(result.prdSourceIds, ["v1-a1650f2cd8d2", "v2-8cf1d449d0a9"]);
  assert.deepEqual(result.featureStatuses, ["done"]);
  assert.equal(result.impactStatus, "review_required");
});

test("Case 05 completes three dependent v2 functions and supersedes v1 ACs", () => {
  const result = verifyMilestone(exampleRoot, "case-05");
  assert.deepEqual(result.featureIds, ["trip-stage-groups", "trip-list-filter", "visible-progress-summary"]);
  assert.deepEqual(result.featureStatuses, ["done", "done", "done"]);
  assert.deepEqual(result.activeAcceptanceCaseIds, [
    "AC-v2-filter-completed",
    "AC-v2-filter-restore",
    "AC-v2-groups-default",
    "AC-v2-summary-completed",
    "AC-v2-summary-default",
  ]);
  assert.deepEqual(result.supersededAcceptanceCaseIds, [
    "AC-trip-list-completed",
    "AC-trip-list-default",
    "AC-trip-list-restore",
  ]);
  assert.equal(result.impactStatus, "current");
});
