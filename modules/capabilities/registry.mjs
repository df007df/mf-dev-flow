// 能力注册表（M3）：任务内可复用原子功能的统一登记处。
// 能力三件套 = 判定提示词（agentFile）+ 命令面（commands）+ 提供的门禁 ID（gates）。
// 原则不变：能力提供原子事实，"结果判断"归流程（stage brief 引用能力 gates，命令核验证据存在性）。
// 命令实现暂留原模块（provider 引用），注册表是登记与校验层，不是转发层——避免 M3 引入双实现。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadCapabilityRegistry(root = here) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "registry.json"), "utf8"));
  const entries = raw.capabilities.map(entry => ({
    ...entry,
    agentPath: entry.agentFile ? path.resolve(root, entry.agentFile) : null,
  }));
  return { schemaVersion: raw.schemaVersion, kernelGates: raw.kernelGates ?? [], entries };
}

export function resolveCapability(entries, id, version = null) {
  const matches = entries.filter(e => e.id === id);
  if (!matches.length) return null;
  if (version !== null) return matches.find(e => e.version === version) ?? null;
  return matches.reduce((a, b) => (b.version > a.version ? b : a));
}

/** 全部门禁 ID 归属：capability 提供 ∪ kernel 原生；types 的 evidenceGates 必须可归因。 */
export function gateOwnership(registry) {
  const byGate = new Map();
  for (const entry of registry.entries)
    for (const gate of entry.gates ?? []) {
      if (byGate.has(gate)) byGate.get(gate).push(entry.id);
      else byGate.set(gate, [entry.id]);
    }
  for (const gate of registry.kernelGates) byGate.set(gate, byGate.get(gate) ? [...byGate.get(gate), "kernel"] : ["kernel"]);
  return byGate;
}

export function capabilityProblems(registry) {
  const problems = [];
  const keys = new Set();
  for (const entry of registry.entries) {
    const key = `${entry.id}@${entry.version}`;
    if (keys.has(key)) problems.push(`注册重复：${key}`);
    keys.add(key);
    if (typeof entry.title !== "string" || !entry.title) problems.push(`${key}: title 必填`);
    if (!entry.agentPath) problems.push(`${key}: agentFile 必填（能力必须携带判定提示词）`);
    else if (!fs.existsSync(entry.agentPath)) problems.push(`${key}: agentFile 不存在：${entry.agentFile}`);
    if (!Array.isArray(entry.commands) || !entry.commands.length) problems.push(`${key}: commands 至少一条（能力必须有命令面）`);
    if (!Array.isArray(entry.gates)) problems.push(`${key}: gates 必须是数组（查询型可为空）`);
    if (typeof entry.provider !== "string" || !entry.provider) problems.push(`${key}: provider 必须指向实现模块`);
  }
  for (const [gate, providers] of gateOwnership(registry))
    if (providers.filter(p => p !== "kernel").length > 1)
      problems.push(`gate 多主：${gate} 由 ${providers.join("、")} 同时声明`);
  return problems;
}

export function capabilitySummary(entries) {
  return entries
    .map(entry => ({
      id: entry.id,
      version: entry.version,
      title: entry.title,
      gates: entry.gates ?? [],
      commands: entry.commands ?? [],
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.version - b.version));
}

/**
 * 流程门禁要求某能力已注册并提供指定门禁。
 * 供 delivery 等触发方在确认能力型门禁前按需加载判定简报；
 * 能力只提供判定口径，字段结构由外层流程 schema 定义，这里不做结构校验。
 * @returns {{ id: string, version: number, agentPath: string }} 解析到的能力条目
 */
export function requireCapabilityGates(registry, id, gates) {
  const entry = resolveCapability(registry.entries, id);
  if (!entry)
    throw new Error(
      `能力 ${id} 未在能力索引注册。请先执行 capability show --id ${id} 加载判定简报（capability list --json 可查看全部能力），再确认该阶段。`,
    );
  const missing = (gates ?? []).filter(gate => !(entry.gates ?? []).includes(gate));
  if (missing.length)
    throw new Error(
      `能力 ${id}@${entry.version} 未声明门禁归属：${missing.join("、")}。请检查 modules/capabilities/registry.json 的能力 gates 后重试。`,
    );
  return entry;
}
