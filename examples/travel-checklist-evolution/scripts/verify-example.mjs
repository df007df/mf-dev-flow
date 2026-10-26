import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { planningSummary } from "../../../dashboard/server/readers/planning.js";
import { prdSummary } from "../../../dashboard/server/readers/prd.js";
import { prototypeSummary } from "../../../dashboard/server/readers/sources.js";

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASE_IDS = new Set(["case-01", "case-02", "case-03", "case-04", "case-05"]);
const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const json = (file, fallback = null) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
const CASE_ARTIFACTS = {
  "case-01": ["cases/01-prd-and-prototype-baseline.md", "screenshots/case-01/dashboard-prd-analysis.png"],
  "case-02": ["cases/02-prototype-analysis-and-planning.md", "screenshots/case-02/prototype-v1-default.png"],
  "case-03": ["cases/03-first-delivery.md", "screenshots/case-03/dashboard-feature-group.png"],
  "case-04": ["cases/04-prd-change-impact.md", "screenshots/case-04/dashboard-impact-review.png"],
  "case-05": ["cases/05-replan-and-final-delivery.md", "screenshots/case-05/dashboard-final-feature-group.png"],
};

function filesUnder(root, directory = root) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`快照包含符号链接：${path.relative(root, file)}`);
    if (entry.isDirectory()) files.push(...filesUnder(root, file));
    else if (entry.isFile()) files.push(path.relative(root, file).split(path.sep).join("/"));
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function verifyManifest(exampleRoot, caseId) {
  const milestone = path.join(exampleRoot, "milestones", caseId);
  const store = path.join(milestone, ".mf-dev-flow");
  const manifest = json(path.join(milestone, "manifest.json"));
  assert.equal(manifest?.schemaVersion, 1, `${caseId} manifest schema`);
  assert.equal(manifest?.caseId, caseId, `${caseId} manifest id`);
  const expected = [...manifest.files].sort((left, right) => left.path.localeCompare(right.path));
  assert.deepEqual(filesUnder(store), expected.map((entry) => entry.path), `${caseId} manifest file list`);
  for (const entry of expected) assert.equal(digest(path.join(store, entry.path)), entry.sha256, `${caseId} hash ${entry.path}`);
  return store;
}

function verifyProvenance(exampleRoot, caseId) {
  const file = path.join(exampleRoot, "generation", `${caseId}.jsonl`);
  const records = fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(records.length > 0, `${caseId} provenance empty`);
  assert.equal(records.at(-1).kind, "gate", `${caseId} final provenance kind`);
  assert.equal(records.at(-1).exitCode, 0, `${caseId} final gate exit`);
  for (const record of records) {
    assert.ok(Array.isArray(record.argv) && record.argv.length > 0, `${caseId} argv`);
    assert.equal(record.argv.some((value) => path.isAbsolute(String(value))), false, `${caseId} absolute argv`);
    assert.match(record.stdoutSha256, /^[a-f0-9]{64}$/);
    assert.match(record.stderrSha256, /^[a-f0-9]{64}$/);
  }
}

function verifyPublicArtifacts(exampleRoot, caseId) {
  const [document, screenshot] = CASE_ARTIFACTS[caseId];
  assert.ok(fs.statSync(path.join(exampleRoot, document)).size > 500, `${caseId} case document`);
  const png = fs.readFileSync(path.join(exampleRoot, screenshot));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${caseId} screenshot PNG`);
  assert.ok(png.readUInt32BE(16) >= 1000, `${caseId} screenshot width`);
  assert.ok(png.readUInt32BE(20) >= 300, `${caseId} screenshot height`);
}

function copyRelativeInputs(exampleRoot, workspace, paths) {
  for (const relative of [...new Set(paths.filter(Boolean))]) {
    const source = path.resolve(exampleRoot, relative);
    const boundary = path.relative(exampleRoot, source);
    if (!boundary || boundary.startsWith(`..${path.sep}`) || path.isAbsolute(boundary) || !fs.existsSync(source)) continue;
    const destination = path.join(workspace, boundary);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

function portableWorkspace(exampleRoot, store) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-example-verify-"));
  fs.cpSync(store, path.join(root, ".mf-dev-flow"), { recursive: true });
  const project = json(path.join(store, "project.json"), {});
  const manifest = json(path.join(store, "prd", "manifest.json"), { sources: [] });
  const map = json(path.join(store, "planning", "feature-map.json"), {});
  const prdInputs = manifest.sources.map((source) => source.origin?.path && `prd/${path.basename(source.origin.path)}`);
  const prototypeInputs = map.prototypeBaseline?.sourceFiles?.map((source) => source.path) ?? [project.prototype?.location];
  copyRelativeInputs(exampleRoot, root, [...prdInputs, ...prototypeInputs]);
  const app = path.join(exampleRoot, "app");
  if (fs.existsSync(app)) fs.cpSync(app, path.join(root, "app"), { recursive: true });
  return root;
}

export function verifyMilestone(exampleRoot, caseId) {
  if (!CASE_IDS.has(caseId)) throw new Error(`未知演进 Case：${caseId}`);
  const root = path.resolve(exampleRoot);
  const sourceStore = verifyManifest(root, caseId);
  verifyProvenance(root, caseId);
  verifyPublicArtifacts(root, caseId);
  const workspace = portableWorkspace(root, sourceStore);
  try {
    const store = path.join(workspace, ".mf-dev-flow");
    const project = json(path.join(store, "project.json"));
    const prd = prdSummary(store);
    const prototype = prototypeSummary(store);
    const planning = planningSummary(store);
    const featureMap = json(path.join(store, "planning", "feature-map.json"), { features: [] });
    const acceptance = json(path.join(store, "planning", "acceptance-cases.json"), { records: [] });

    assert.equal(project?.project?.name, "旅行清单示例");
    assert.ok(prd && !prd.error, `${caseId} PRD summary`);
    assert.ok(prototype && !prototype.error, `${caseId} prototype summary`);
    if (caseId === "case-01") {
      assert.equal(prototype.status, "stale");
      assert.equal(prototype.acceptedBatch, null);
      assert.equal(planning, null);
    }
    if (caseId === "case-02") {
      assert.equal(prd.batch?.check?.ok, true);
      assert.equal(prototype.status, "ready");
      assert.deepEqual(prototype.sourceProblems, []);
      assert.ok(planning && planning.prototypeImpact.status === "current");
      assert.deepEqual(planning.prototypeImpact.problems ?? [], []);
      assert.ok(planning.features.every((feature) => feature.planningStatus === "current"));
      assert.ok(planning.features.every((feature) => feature.sourceScreenshots.length > 0));
    }
    if (caseId === "case-03") {
      assert.equal(prototype.status, "ready");
      assert.equal(planning.prototypeImpact.status, "current");
      assert.deepEqual(featureMap.features.map((feature) => feature.status), ["done"]);
    }
    if (caseId === "case-04") {
      assert.equal(prototype.status, "ready");
      assert.equal(planning.prototypeImpact.status, "review_required");
      assert.deepEqual(planning.prototypeImpact.affected.map((feature) => feature.id), ["trip-list-filter"]);
    }
    if (caseId === "case-05") {
      assert.equal(prototype.status, "ready");
      assert.equal(planning.prototypeImpact.status, "current");
      assert.ok(planning.features.every((feature) => feature.status === "done"));
      assert.ok(planning.features.every((feature) => Object.values(feature.stages).every((stage) => stage.status === "confirmed")));
    }

    return {
      caseId,
      projectName: project.project.name,
      prdSourceIds: prd.sources.map((source) => source.id),
      prototypeStatus: prototype.status,
      featureIds: featureMap.features.map((feature) => feature.id),
      featureStatuses: featureMap.features.map((feature) => feature.status),
      acceptanceCaseIds: acceptance.records.map((record) => record.id).sort(),
      activeAcceptanceCaseIds: acceptance.records.filter((record) => record.status === "active").map((record) => record.id).sort(),
      supersededAcceptanceCaseIds: acceptance.records.filter((record) => record.status === "superseded").map((record) => record.id).sort(),
      impactStatus: planning?.prototypeImpact?.status ?? null,
    };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const caseIds = process.argv.slice(2);
    if (!caseIds.length) throw new Error("至少提供一个 Case ID");
    for (const caseId of caseIds) process.stdout.write(`${JSON.stringify(verifyMilestone(MODULE_ROOT, caseId))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
