import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const PROTOTYPE_PROCESS_ROOT = path.join(MODULE_DIRECTORY, "processes");
export const PROTOTYPE_ADAPTER_ROOT = path.join(MODULE_DIRECTORY, "adapters");
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_AGENT_BYTES = 64 * 1024;
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const AGENT_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const EVIDENCE_PROFILES = new Set(["runtime-only", "source-and-runtime"]);
const WEB_RUNTIME_V1_CAPABILITIES = {
  sourceDiscovery: false,
  sourceModes: ["url", "local-preview"],
  navigation: { selector: true },
  screenshots: { png: true },
  archival: { trace: true },
};
const WEB_RUNTIME_V1_OVERLAY = {
  stageId: "runtime-observe",
  agentFile: "agents/runtime-observe.md",
};
const WECHAT_MINIAPP_RUNTIME_V1_SOURCE_MODES = ["wechat-devtools-simulator"];
const WECHAT_MINIAPP_RUNTIME_V1_CAPABILITIES = {
  sourceDiscovery: false,
  operations: [
    "pageStack",
    "selectorAction",
    "simulatorScreenshot",
    "traceArchive",
    "compileRefresh",
  ],
  evidence: { screenshot: "png", trace: true },
};
const WECHAT_MINIAPP_RUNTIME_V1_OVERLAY = {
  stageId: "runtime-observe",
  agentFile: "agents/runtime-observe.md",
};
const IOS_APP_RUNTIME_V1_SOURCE_MODES = ["ios-simulator"];
const IOS_APP_RUNTIME_V1_CAPABILITIES = {
  sourceDiscovery: false,
  operations: [
    "screenState",
    "elementAction",
    "simulatorScreenshot",
    "traceArchive",
    "appLaunch",
  ],
  evidence: { screenshot: "png", trace: true },
};
const IOS_APP_RUNTIME_V1_OVERLAY = {
  stageId: "runtime-observe",
  agentFile: "agents/runtime-observe.md",
};

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const canonical = (value) => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const copy = (value) => JSON.parse(JSON.stringify(value));
const fail = (message) => { throw new Error(`原型流程无效：${message}`); };
const requiredString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) fail(`${label} 必须是非空字符串`);
  return value;
};
const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

function readJson(file, label) {
  try {
    if (fs.statSync(file).size > MAX_MANIFEST_BYTES)
      fail(`${label} 超过 ${MAX_MANIFEST_BYTES} 字节`);
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${label} 不是有效 JSON`);
    if (error?.code === "ENOENT") fail(`${label} 不存在`);
    throw error;
  }
}

function realDirectory(root, label) {
  let resolved;
  try {
    resolved = fs.realpathSync(root);
  } catch (error) {
    if (error?.code === "ENOENT") fail(`${label} 根目录不存在`);
    throw error;
  }
  if (!fs.statSync(resolved).isDirectory()) fail(`${label} 根目录必须是目录`);
  return resolved;
}

function resolvedFileInside({ root, directory, file, label }) {
  if (path.isAbsolute(file)) fail(`${label} 必须位于版本目录内`);
  const requested = path.resolve(directory, file);
  if (!inside(directory, requested)) fail(`${label} 必须位于版本目录内`);
  let resolved;
  try {
    resolved = fs.realpathSync(requested);
  } catch (error) {
    if (error?.code === "ENOENT") fail(`${label} 不存在`);
    throw error;
  }
  if (!inside(root, resolved) || !inside(directory, resolved))
    fail(`${label} 必须位于版本目录内`);
  if (!fs.statSync(resolved).isFile()) fail(`${label} 必须是文件`);
  return resolved;
}

function versionDirectory(root, id, version, label) {
  if (!ID.test(id ?? "")) fail(`${label} ID 不合法`);
  if (!Number.isSafeInteger(version) || version < 1) fail(`${label} 版本必须是正整数`);
  const resolvedRoot = realDirectory(root, label);
  const requested = path.resolve(resolvedRoot, id, `v${version}`);
  if (!inside(resolvedRoot, requested)) fail(`${label} 目录必须位于根目录内`);
  let directory;
  try {
    directory = fs.realpathSync(requested);
  } catch (error) {
    if (error?.code === "ENOENT") fail(`${label} 目录不存在`);
    throw error;
  }
  if (!inside(resolvedRoot, directory)) fail(`${label} 目录必须位于根目录内`);
  if (!fs.statSync(directory).isDirectory()) fail(`${label} 目录必须是目录`);
  return { root: resolvedRoot, directory };
}

function readAgent({ agentFile, root, directory, label }) {
  requiredString(agentFile, `${label}.agentFile`);
  const realAgent = resolvedFileInside({
    root,
    directory,
    file: agentFile,
    label: `${label}.agentFile`,
  });
  const stat = fs.statSync(realAgent);
  if (stat.size > MAX_AGENT_BYTES) fail(`${label} 的 Agent 文件超过 ${MAX_AGENT_BYTES} 字节`);
  const instructions = fs.readFileSync(realAgent, "utf8");
  if (!instructions.trim()) fail(`${label} 的 Agent 文件不能为空`);
  return {
    file: path.relative(directory, realAgent),
    sha256: digest(instructions),
    instructions,
  };
}

function stageSnapshot(stage, root, directory) {
  if (!stage || typeof stage !== "object" || Array.isArray(stage)) fail("stage 必须是对象");
  const definition = copy(stage);
  const id = requiredString(definition.id, "stage.id");
  if (!ID.test(id)) fail(`阶段 ID 不合法：${id}`);
  if (!Array.isArray(definition.transitions) || definition.transitions.some((target) => !ID.test(target)))
    fail(`阶段 ${id}.transitions 必须是合法阶段 ID 数组`);
  const agent = readAgent({ agentFile: definition.agentFile, root, directory, label: `阶段 ${id}` });
  const agentId = definition.agentId ?? id;
  if (!AGENT_ID.test(agentId)) fail(`阶段 ${id}.agentId 不合法`);
  delete definition.agentFile;
  delete definition.agentId;
  return { ...definition, agent: { id: agentId, ...agent } };
}

function validateStageCommands(stage) {
  if (!Array.isArray(stage.commands) || !stage.commands.length || stage.commands.some((command) => !ID.test(command)))
    fail(`阶段 ${stage.id}.commands 必须是非空命令数组`);
}

function validateRuntimeAnalysis(process) {
  if (process.id !== "runtime-analysis" || process.version !== 1) return;
  const expected = [
    ["scope-snapshot", ["init"], ["structure-model"]],
    ["structure-model", ["put", "checkpoint"], ["runtime-observe"]],
    ["runtime-observe", ["put", "capture", "evidence", "checkpoint"], ["structure-model", "audit-accept"]],
    ["audit-accept", ["audit", "checkpoint", "accept"], ["structure-model", "runtime-observe"]],
  ];
  if (process.initialStageId !== "scope-snapshot" || process.stages.length !== expected.length)
    fail("runtime-analysis@1 必须使用受限的四阶段图");
  for (let index = 0; index < expected.length; index += 1) {
    const [id, commands, transitions] = expected[index];
    const stage = process.stages[index];
    if (stage.id !== id || canonical(stage.commands) !== canonical(commands) || canonical(stage.transitions) !== canonical(transitions))
      fail("runtime-analysis@1 的阶段图、命令或转移不匹配");
    if (Boolean(stage.terminal) !== (id === "audit-accept")) fail("runtime-analysis@1 的 terminal 声明不匹配");
  }
}

export function parsePrototypeSpecifier(value) {
  const match = /^([a-z][a-z0-9-]{0,63})@([1-9]\d*)$/.exec(value ?? "");
  if (!match) fail("specifier 必须使用 id@version 格式");
  const version = Number(match[2]);
  if (!Number.isSafeInteger(version)) fail("specifier 版本超出安全整数范围");
  return { id: match[1], version };
}

export function loadPrototypeProcess({ id, version, root = PROTOTYPE_PROCESS_ROOT } = {}) {
  const location = versionDirectory(root, id, version, "流程");
  const manifest = readJson(resolvedFileInside({
    root: location.root,
    directory: location.directory,
    file: "process.json",
    label: "process.json",
  }), "process.json");
  if (manifest.schemaVersion !== 1) fail("process.json 的 schemaVersion 必须为 1");
  if (manifest.id !== id || manifest.version !== version) fail("process.json 与请求的流程版本不一致");
  if (!Array.isArray(manifest.stages) || !manifest.stages.length) fail("process.json.stages 必须是非空数组");
  requiredString(manifest.initialStageId, "process.json.initialStageId");
  const stageIds = new Set();
  const stages = manifest.stages.map((stage) => {
    const snapshot = stageSnapshot(stage, location.root, location.directory);
    if (stageIds.has(snapshot.id)) fail(`阶段 ID 重复：${snapshot.id}`);
    stageIds.add(snapshot.id);
    return snapshot;
  });
  if (!stageIds.has(manifest.initialStageId)) fail("initialStageId 未在 stages 中声明");
  for (const stage of stages) {
    for (const target of stage.transitions) {
      if (!stageIds.has(target)) fail(`阶段 ${stage.id} 的 transition 指向不存在的阶段 ${target}`);
    }
  }
  for (const stage of stages) validateStageCommands(stage);
  validateRuntimeAnalysis({ ...manifest, stages });
  const profileHashes = stages.map((stage) => ({ id: stage.id, agentId: stage.agent.id, sha256: stage.agent.sha256 }));
  return {
    id,
    version,
    initialStageId: manifest.initialStageId,
    stages,
    sha256: digest(canonical({ manifest, profileHashes })),
  };
}

function adapterOverlaySnapshot(overlay, root, directory) {
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) fail("adapter overlay 必须是对象");
  const stageId = requiredString(overlay.stageId, "adapter overlay.stageId");
  if (!ID.test(stageId)) fail("adapter overlay.stageId 不合法");
  return {
    stageId,
    ...readAgent({ agentFile: overlay.agentFile, root, directory, label: `adapter overlay ${stageId}` }),
  };
}

function validateWebRuntimeAdapter(manifest) {
  if (manifest.id !== "web-runtime" || manifest.version !== 1) return;
  if (canonical(manifest.capabilities) !== canonical(WEB_RUNTIME_V1_CAPABILITIES))
    fail("web-runtime@1 的运行态能力契约不匹配");
  if (!Array.isArray(manifest.overlays) || manifest.overlays.length !== 1
    || canonical(manifest.overlays[0]) !== canonical(WEB_RUNTIME_V1_OVERLAY))
    fail("web-runtime@1 必须且只能声明 runtime-observe overlay");
}

function validateWechatMiniappRuntimeAdapter(manifest) {
  if (manifest.id !== "wechat-miniapp-runtime" || manifest.version !== 1) return;
  if (canonical(manifest.sourceModes) !== canonical(WECHAT_MINIAPP_RUNTIME_V1_SOURCE_MODES))
    fail("wechat-miniapp-runtime@1 的运行态来源模式契约不匹配");
  if (canonical(manifest.capabilities) !== canonical(WECHAT_MINIAPP_RUNTIME_V1_CAPABILITIES))
    fail("wechat-miniapp-runtime@1 的运行态能力契约不匹配");
  if (!Array.isArray(manifest.overlays) || manifest.overlays.length !== 1
    || canonical(manifest.overlays[0]) !== canonical(WECHAT_MINIAPP_RUNTIME_V1_OVERLAY))
    fail("wechat-miniapp-runtime@1 必须且只能声明 runtime-observe overlay");
}

function validateIosAppRuntimeAdapter(manifest) {
  if (manifest.id !== "ios-app-runtime" || manifest.version !== 1) return;
  if (canonical(manifest.sourceModes) !== canonical(IOS_APP_RUNTIME_V1_SOURCE_MODES))
    fail("ios-app-runtime@1 的运行态来源模式契约不匹配");
  if (canonical(manifest.capabilities) !== canonical(IOS_APP_RUNTIME_V1_CAPABILITIES))
    fail("ios-app-runtime@1 的运行态能力契约不匹配");
  if (!Array.isArray(manifest.overlays) || manifest.overlays.length !== 1
    || canonical(manifest.overlays[0]) !== canonical(IOS_APP_RUNTIME_V1_OVERLAY))
    fail("ios-app-runtime@1 必须且只能声明 runtime-observe overlay");
}

export function loadPrototypeAdapter({ id, version, root = PROTOTYPE_ADAPTER_ROOT } = {}) {
  const location = versionDirectory(root, id, version, "适配器");
  const manifest = readJson(resolvedFileInside({
    root: location.root,
    directory: location.directory,
    file: "adapter.json",
    label: "adapter.json",
  }), "adapter.json");
  if (manifest.schemaVersion !== 1) fail("adapter.json 的 schemaVersion 必须为 1");
  if (manifest.id !== id || manifest.version !== version) fail("adapter.json 与请求的适配器版本不一致");
  if (!manifest.capabilities || typeof manifest.capabilities !== "object" || Array.isArray(manifest.capabilities))
    fail("adapter.json.capabilities 必须是对象");
  if (typeof manifest.capabilities.sourceDiscovery !== "boolean")
    fail("adapter.json.capabilities.sourceDiscovery 必须是布尔值");
  if (!Array.isArray(manifest.overlays)) fail("adapter.json.overlays 必须是数组");
  validateWebRuntimeAdapter(manifest);
  validateWechatMiniappRuntimeAdapter(manifest);
  validateIosAppRuntimeAdapter(manifest);
  const stageIds = new Set();
  const overlays = manifest.overlays.map((overlay) => {
    const snapshot = adapterOverlaySnapshot(overlay, location.root, location.directory);
    if (stageIds.has(snapshot.stageId)) fail(`adapter overlay 重复：${snapshot.stageId}`);
    stageIds.add(snapshot.stageId);
    return snapshot;
  });
  const overlayHashes = overlays.map((overlay) => ({ stageId: overlay.stageId, sha256: overlay.sha256 }));
  return {
    id,
    version,
    capabilities: copy(manifest.capabilities),
    overlays,
    sha256: digest(canonical({ manifest, overlayHashes })),
  };
}

export function composePrototypeWorkflow({ process, adapter, evidenceProfile } = {}) {
  if (!process?.id || !adapter?.id) fail("必须加载流程和适配器快照");
  if (!EVIDENCE_PROFILES.has(evidenceProfile)) fail("evidenceProfile 不受支持");
  if (evidenceProfile === "source-and-runtime" && !adapter.capabilities?.sourceDiscovery)
    fail("source-and-runtime 需要适配器声明 sourceDiscovery");
  const overlayByStage = new Map(adapter.overlays.map((overlay) => [overlay.stageId, overlay]));
  for (const stageId of overlayByStage.keys()) {
    if (!process.stages.some((stage) => stage.id === stageId)) fail(`适配器 overlay 指向未声明阶段 ${stageId}`);
  }
  const stages = process.stages.map((stage) => {
    const overlay = overlayByStage.get(stage.id);
    const agent = {
      id: stage.agent.id,
      sha256: stage.agent.sha256,
      instructions: overlay ? `${stage.agent.instructions.trimEnd()}\n\n${overlay.instructions}` : stage.agent.instructions,
    };
    if (overlay) {
      agent.overlaySha256 = overlay.sha256;
      agent.overlayInstructions = overlay.instructions;
    }
    return { ...copy(stage), agent };
  });
  return {
    process: { id: process.id, version: process.version, sha256: process.sha256 },
    adapter: { id: adapter.id, version: adapter.version, sha256: adapter.sha256, capabilities: copy(adapter.capabilities) },
    evidenceProfile,
    initialStageId: process.initialStageId,
    stages,
  };
}
