// tasktype 命令组：只读查看任务类型注册表（M1 增量入口；旧命令不受影响）。
// 输出遵守"查询按页/最小化"：list 只给摘要，show 给单个类型。
import { loadRegistry, listSummary, resolveType, registryProblems } from "../types/registry.mjs";

function parseArgs(rest) {
  const out = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--json") out.json = true;
    else if (["--id", "--version", "--verbose"].includes(token)) out[token.slice(2)] = rest[++i];
  }
  return out;
}

function fail(error) {
  process.stderr.write(JSON.stringify({ error: String(error.message ?? error).slice(0, 700) }) + "\n");
  process.exitCode = 1;
}

export function tasktypeList() {
  try {
    const registry = loadRegistry();
    const problems = registryProblems(registry);
    process.stdout.write(JSON.stringify({
      schemaVersion: 1,
      types: listSummary(registry.entries),
      registryValid: problems.length === 0,
      ...(problems.length ? { problems } : {}),
    }) + "\n");
  } catch (error) { fail(error); }
}

export function tasktypeShow() {
  try {
    const args = parseArgs(process.argv.slice(4));
    if (!args.id) throw new Error("用法：tasktype show --id <类型ID> [--version <n>] --json");
    const registry = loadRegistry();
    const version = args.version !== undefined ? Number(args.version) : null;
    if (args.version !== undefined && !Number.isInteger(version)) throw new Error("--version 必须为整数");
    const entry = resolveType(registry.entries, args.id, version);
    if (!entry) throw new Error(`未注册的任务类型：${args.id}${version ? `@${version}` : ""}`);
    const problems = registryProblems(registry).filter(p => p.startsWith(`${entry.id}@${entry.version}:`));
    const summary = listSummary(registry.entries).find(item => item.id === entry.id);
    process.stdout.write(JSON.stringify({
      schemaVersion: 1,
      id: entry.id,
      version: entry.version,
      flow: entry.flow,
      registeredStatus: entry.status ?? "published",
      latestVersion: summary?.latestVersion ?? null,
      process: entry.process,
      contractProblems: problems,
    }) + "\n");
  } catch (error) { fail(error); }
}
