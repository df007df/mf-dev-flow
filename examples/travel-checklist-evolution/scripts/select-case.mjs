import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CASE_IDS = new Set(["case-01", "case-02", "case-03", "case-04", "case-05"]);
const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function validatedSource(root, caseId) {
  const milestone = path.join(root, "milestones", caseId);
  const source = path.join(milestone, ".mf-dev-flow");
  const manifestFile = path.join(milestone, "manifest.json");
  if (!fs.existsSync(source) || !fs.existsSync(manifestFile))
    throw new Error(`Case 快照不完整：${caseId}`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.caseId !== caseId || !Array.isArray(manifest.files))
    throw new Error(`Case 清单无效：${caseId}`);
  for (const entry of manifest.files) {
    const file = path.resolve(source, entry.path);
    const relative = path.relative(source, file);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error(`Case 清单路径无效：${entry.path}`);
    if (!fs.existsSync(file) || sha256(file) !== entry.sha256)
      throw new Error(`Case 文件哈希不一致：${entry.path}`);
  }
  return source;
}

export function selectCase(exampleRoot, caseId) {
  if (!CASE_IDS.has(caseId)) throw new Error(`未知演进 Case：${caseId}`);
  const root = path.resolve(exampleRoot);
  const source = validatedSource(root, caseId);
  const destination = path.join(root, ".mf-dev-flow");
  const temporary = path.join(root, `.mf-dev-flow.next-${caseId}`);
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.cpSync(source, temporary, { recursive: true, errorOnExist: false });
  fs.rmSync(destination, { recursive: true, force: true });
  fs.renameSync(temporary, destination);
  return { caseId, source, destination };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = selectCase(MODULE_ROOT, process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
