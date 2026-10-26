import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPORARY_ROOT = process.platform === "win32" ? path.resolve(process.env.TEMP ?? process.env.TMP ?? ".") : "/tmp";
export const DEMO_WORKSPACE = path.join(TEMPORARY_ROOT, "mf-dev-flow-travel-demo");
const INPUT_DIRECTORIES = ["prd", "prototype", "app"];

export function prepareDemoWorkspace(sourceRoot, destination = DEMO_WORKSPACE) {
  const source = path.resolve(sourceRoot);
  const target = path.resolve(destination);
  if (source === target) throw new Error("演示输入目录与临时工作区不能相同");
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const name of INPUT_DIRECTORIES) {
    const input = path.join(source, name);
    if (fs.existsSync(input)) fs.cpSync(input, path.join(target, name), { recursive: true });
  }
  return { source, destination: target, copied: INPUT_DIRECTORIES.filter((name) => fs.existsSync(path.join(target, name))) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = prepareDemoWorkspace(MODULE_ROOT);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
