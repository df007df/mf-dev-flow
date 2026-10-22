import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DELIVERY_PROCESS_ROOT = path.join(MODULE_DIR, "processes");
const MAX_MANIFEST_BYTES = 262144;
const MAX_AGENT_BYTES = 65536;
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const AGENT_ID = /^[a-z][a-z0-9_-]{0,63}$/;

const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const copy = (value) => JSON.parse(JSON.stringify(value));
const fail = (message) => {
  throw new Error(`交付流程无效：${message}`);
};
const requiredString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) fail(`${label} 必须是非空字符串`);
  return value;
};
const inside = (root, candidate) =>
  candidate === root || candidate.startsWith(root + path.sep);

function readJson(file) {
  try {
    if (fs.statSync(file).size > MAX_MANIFEST_BYTES)
      fail(`流程清单超过 ${MAX_MANIFEST_BYTES} 字节`);
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) fail("process.json 不是有效 JSON");
    if (error.code === "ENOENT") fail("process.json 不存在");
    throw error;
  }
}

function stageSnapshot(stage, processDirectory) {
  const definition = copy(stage);
  requiredString(definition.id, "stage.id");
  requiredString(definition.title, `阶段 ${definition.id}.title`);
  requiredString(definition.objective, `阶段 ${definition.id}.objective`);
  if (!Array.isArray(definition.ownerRoles) || !definition.ownerRoles.length)
    fail(`阶段 ${definition.id}.ownerRoles 必须是非空数组`);
  if (!Array.isArray(definition.reportFields) || !definition.reportFields.length)
    fail(`阶段 ${definition.id}.reportFields 必须是非空数组`);
  if (!Array.isArray(definition.evidenceGates))
    fail(`阶段 ${definition.id}.evidenceGates 必须是数组`);
  const agentFile = requiredString(definition.agentFile, `阶段 ${definition.id}.agentFile`);
  const requested = path.resolve(processDirectory, agentFile);
  if (path.isAbsolute(agentFile) || !inside(processDirectory, requested))
    fail(`阶段 ${definition.id}.agentFile 必须位于流程目录内`);
  if (!fs.existsSync(requested)) fail(`阶段 ${definition.id} 的 agent 文件不存在`);
  const agentPath = fs.realpathSync(requested);
  const realProcessDirectory = fs.realpathSync(processDirectory);
  if (!inside(realProcessDirectory, agentPath))
    fail(`阶段 ${definition.id}.agentFile 必须位于流程目录内`);
  const stat = fs.statSync(agentPath);
  if (!stat.isFile()) fail(`阶段 ${definition.id}.agentFile 必须是文件`);
  if (stat.size > MAX_AGENT_BYTES)
    fail(`阶段 ${definition.id} 的 agent 文件超过 ${MAX_AGENT_BYTES} 字节`);
  const instructions = fs.readFileSync(agentPath, "utf8");
  if (!instructions.trim()) fail(`阶段 ${definition.id} 的 agent 文件不能为空`);
  const agentId = definition.agentId ?? definition.id;
  if (!AGENT_ID.test(agentId)) fail(`阶段 ${definition.id}.agentId 不合法`);
  delete definition.agentFile;
  delete definition.agentId;
  definition.agent = {
    id: agentId,
    file: path.relative(realProcessDirectory, agentPath),
    sha256: digest(instructions),
    instructions,
  };
  return definition;
}

export function loadDeliveryProcess({ id, version, root = DELIVERY_PROCESS_ROOT } = {}) {
  if (!ID.test(id ?? "")) fail("流程 ID 不合法");
  if (!Number.isSafeInteger(version) || version < 1) fail("流程版本必须是正整数");
  const processDirectory = path.join(path.resolve(root), id, `v${version}`);
  const manifest = readJson(path.join(processDirectory, "process.json"));
  if (manifest.schemaVersion !== 1) fail("schemaVersion 必须为 1");
  if (manifest.id !== id) fail("process.json 的 id 与请求不一致");
  if (manifest.version !== version) fail("process.json 的 version 与请求不一致");
  requiredString(manifest.title, "title");
  if (!Array.isArray(manifest.stages) || !manifest.stages.length)
    fail("stages 必须是非空数组");
  const stageIds = new Set();
  const stages = manifest.stages.map((stage) => {
    const snapshot = stageSnapshot(stage, processDirectory);
    if (stageIds.has(snapshot.id)) fail(`阶段 ID 重复：${snapshot.id}`);
    stageIds.add(snapshot.id);
    return snapshot;
  });
  const terminals = stages.filter((stage) => stage.terminal);
  if (terminals.length !== 1 || stages.at(-1)?.id !== terminals[0]?.id)
    fail("必须且只能将最后一个阶段声明为 terminal");
  const profileHashes = stages.map((stage) => ({
    id: stage.id,
    agentId: stage.agent.id,
    sha256: stage.agent.sha256,
  }));
  return {
    ...copy(manifest),
    stages,
    sha256: digest(canonical({ manifest, profileHashes })),
  };
}

export function parseDeliveryProcessSpecifier(value) {
  const match = /^([a-z][a-z0-9-]{0,63})@([1-9]\d*)$/.exec(value ?? "");
  if (!match) fail("--process 必须使用 id@版本 格式");
  const version = Number(match[2]);
  if (!Number.isSafeInteger(version)) fail("--process 版本超出安全整数范围");
  return { id: match[1], version };
}

export function stageAgentFor(task, stageId) {
  const stage = task?.stageDefinitions?.find((item) => item.id === stageId);
  return stage?.agent ? copy(stage.agent) : null;
}
