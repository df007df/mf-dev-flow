// capability 命令组（M3）：list/show 只读注册表；git-diff 为本批新落地的原子能力命令。
// 能力命令只给原始事实（清单/差异），影响判断归流程与图查询（见 git-diff 判定简报）。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadCapabilityRegistry, capabilityProblems, capabilitySummary, resolveCapability, gateOwnership } from "../capabilities/registry.mjs";

function parseArgs(rest) {
  const out = { flags: new Set() };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--json" || token === "--include-untracked") out.flags.add(token.slice(2));
    else if (["--id", "--version", "--repo", "--base", "--head"].includes(token)) out[token.slice(2)] = rest[++i];
  }
  return out;
}

function fail(message) {
  process.stderr.write(`${JSON.stringify({ error: String(message).slice(0, 700) })}\n`);
  process.exitCode = 1;
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function capabilityList() {
  try {
    const registry = loadCapabilityRegistry();
    const problems = capabilityProblems(registry);
    emit({
      schemaVersion: 1,
      capabilities: capabilitySummary(registry.entries),
      gateOwnership: Object.fromEntries([...gateOwnership(registry).entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
      registryValid: problems.length === 0,
      ...(problems.length ? { problems } : {}),
    });
  } catch (error) { fail(error); }
}

export function capabilityShow() {
  const args = parseArgs(process.argv.slice(4));
  if (!args.id) return fail("用法：capability show --id <能力ID> [--version <n>]");
  try {
    const registry = loadCapabilityRegistry();
    const entry = resolveCapability(registry.entries, args.id, args.version !== undefined ? Number(args.version) : null);
    if (!entry) return fail(`未注册的能力：${args.id}${args.version ? `@${args.version}` : ""}`);
    emit({
      schemaVersion: 1,
      id: entry.id,
      version: entry.version,
      title: entry.title,
      gates: entry.gates ?? [],
      commands: entry.commands ?? [],
      provider: entry.provider,
      judgment: fs.readFileSync(entry.agentPath, "utf8"),
    });
  } catch (error) { fail(error); }
}

const SAFE_REF = /^[A-Za-z0-9_][A-Za-z0-9._@\/{}^~-]{0,119}$/;
function assertRef(name, value) {
  if (typeof value !== "string" || !value) throw new Error(`--${name} 必填`);
  if (!SAFE_REF.test(value) || value.includes("..") || value.startsWith("-")) throw new Error(`--${name} 不是合法 git 引用：${value}`);
  return value;
}

function git(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} 失败：${(result.stderr || result.stdout || "").trim().slice(0, 200)}`);
  return result.stdout;
}

export function capabilityGitDiff() {
  const args = parseArgs(process.argv.slice(4));
  try {
    const repo = path.resolve(args.repo ?? process.cwd());
    if (!fs.existsSync(repo)) throw new Error(`仓库路径不存在：${repo}`);
    git(repo, ["rev-parse", "--git-dir"]);
    const base = assertRef("base", args.base);
    const head = args.head !== undefined ? assertRef("head", args.head) : null;
    const baseSha = git(repo, ["rev-parse", "--verify", `${base}^{commit}`]).trim();
    const headSha = git(repo, ["rev-parse", "--verify", head ? `${head}^{commit}` : "HEAD"]).trim();
    const diffArgs = ["diff", "--name-status", baseSha];
    if (head) diffArgs.push(headSha);
    const files = [];
    for (const line of git(repo, diffArgs).split("\n")) {
      if (!line.trim()) continue;
      const [statusRaw, ...rest] = line.split("\t");
      const status = statusRaw.replace(/[0-9]+/g, "");
      if (status === "R" || status === "C") files.push({ status, path: rest[0], to: rest[1] });
      else files.push({ status, path: rest[0] });
    }
    if (args.flags.has("include-untracked"))
      for (const line of git(repo, ["ls-files", "--others", "--exclude-standard"]).split("\n"))
        if (line.trim()) files.push({ status: "U", path: line });
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    emit({ schemaVersion: 1, repo, base: { ref: base, sha: baseSha }, head: head ? { ref: head, sha: headSha } : { ref: "working-tree", sha: headSha }, files });
  } catch (error) { fail(error); }
}
