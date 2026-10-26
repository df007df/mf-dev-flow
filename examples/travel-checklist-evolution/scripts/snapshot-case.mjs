import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEMO_WORKSPACE } from "./demo-workspace.mjs";

const CASE_IDS = new Set(["case-01", "case-02", "case-03", "case-04", "case-05"]);
const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function filesUnder(root, directory = root) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`快照拒绝符号链接：${path.relative(root, file)}`);
    if (entry.isDirectory()) files.push(...filesUnder(root, file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

export function snapshotCase(exampleRoot, caseId, { stateRoot = exampleRoot } = {}) {
  if (!CASE_IDS.has(caseId)) throw new Error(`未知演进 Case：${caseId}`);
  const root = path.resolve(exampleRoot);
  const active = path.join(path.resolve(stateRoot), ".mf-dev-flow");
  if (!fs.existsSync(active)) throw new Error("缺少活动 .mf-dev-flow 状态");
  const files = filesUnder(active);
  if (!files.length) throw new Error("活动 .mf-dev-flow 状态为空");
  const provenanceFile = path.join(root, "generation", `${caseId}.jsonl`);
  if (!fs.existsSync(provenanceFile)) throw new Error(`缺少 Case 执行记录：${caseId}`);
  const records = fs.readFileSync(provenanceFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  const final = records.at(-1);
  if (!final || final.exitCode !== 0 || final.kind !== "gate")
    throw new Error(`Case 尚未通过最终门禁：${caseId}`);

  const milestone = path.join(root, "milestones", caseId);
  const destination = path.join(milestone, ".mf-dev-flow");
  fs.rmSync(milestone, { recursive: true, force: true });
  fs.mkdirSync(milestone, { recursive: true });
  fs.cpSync(active, destination, { recursive: true, errorOnExist: false });
  const manifest = {
    schemaVersion: 1,
    caseId,
    capturedAt: new Date().toISOString(),
    files: files
      .map((file) => ({ path: path.relative(active, file).split(path.sep).join("/"), sha256: sha256(file) }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  fs.writeFileSync(path.join(milestone, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { caseId, source: active, destination, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = process.argv.slice(2);
    const scratchIndex = input.indexOf("--scratch");
    const scratch = scratchIndex !== -1;
    if (scratch) input.splice(scratchIndex, 1);
    const result = snapshotCase(MODULE_ROOT, input[0], {
      stateRoot: scratch ? DEMO_WORKSPACE : MODULE_ROOT,
    });
    process.stdout.write(`${JSON.stringify({ caseId: result.caseId, files: result.manifest.files.length })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
