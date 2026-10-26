import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { DEMO_WORKSPACE } from "./demo-workspace.mjs";

const CASE_IDS = new Set(["case-01", "case-02", "case-03", "case-04", "case-05"]);
const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.resolve(MODULE_ROOT, "../../scripts/mf-dev-flow.mjs");
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

export function recordCommand(
  exampleRoot,
  caseId,
  argv,
  { gate = false, provenanceRoot = exampleRoot, recordedCwd = "." } = {},
) {
  if (!CASE_IDS.has(caseId)) throw new Error(`未知演进 Case：${caseId}`);
  if (!Array.isArray(argv) || !argv.length) throw new Error("缺少 mf-dev-flow 命令参数");
  if (argv.some((value) => path.isAbsolute(String(value))))
    throw new Error("演示命令只能记录相对路径参数");
  const root = path.resolve(exampleRoot);
  const logRoot = path.resolve(provenanceRoot);
  const result = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: root,
    encoding: "utf8",
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exitCode = result.status ?? 1;
  const record = {
    schemaVersion: 1,
    kind: gate ? "gate" : "command",
    at: new Date().toISOString(),
    cwd: recordedCwd,
    argv: [...argv],
    exitCode,
    stdoutSha256: digest(stdout),
    stderrSha256: digest(stderr),
  };
  const directory = path.join(logRoot, "generation");
  fs.mkdirSync(directory, { recursive: true });
  fs.appendFileSync(path.join(directory, `${caseId}.jsonl`), `${JSON.stringify(record)}\n`);
  return { status: exitCode, stdout, stderr, record };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv.slice(2);
  const scratchIndex = input.indexOf("--scratch");
  const scratch = scratchIndex !== -1;
  if (scratch) input.splice(scratchIndex, 1);
  const caseId = input.shift();
  const gateIndex = input.indexOf("--gate");
  const gate = gateIndex !== -1;
  if (gate) input.splice(gateIndex, 1);
  if (input[0] === "--") input.shift();
  try {
    const result = recordCommand(scratch ? DEMO_WORKSPACE : MODULE_ROOT, caseId, input, {
      gate,
      provenanceRoot: MODULE_ROOT,
      recordedCwd: scratch ? "<neutral-demo-workspace>" : ".",
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.status;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
