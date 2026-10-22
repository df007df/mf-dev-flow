import { loadPrototypeAdapter, loadPrototypeProcess } from './processes.mjs';

const RUNTIME_PROCESSES = Object.freeze([
  { id: 'runtime-analysis', version: 1, title: '运行态原型分析' },
]);

const RUNTIME_ADAPTERS = Object.freeze([
  { id: 'web-runtime', version: 1, title: '运行中的网页' },
  { id: 'wechat-miniapp-runtime', version: 1, title: '微信开发者工具小程序模拟器' },
  { id: 'ios-app-runtime', version: 1, title: 'iOS 原生 App 模拟器' },
]);

const RUNTIME_ADAPTER_NOTE = '适配器声明 Agent 的环境契约；CLI 不直接操控网页、微信开发者工具或 iOS 模拟器。实际取证仅由当前阶段 Agent 在已授权环境中完成，并通过 prototype capture 归档。';

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function processSummary(definition) {
  const process = loadPrototypeProcess(definition);
  return {
    id: process.id,
    version: process.version,
    title: definition.title,
    stageIds: process.stages.map(stage => stage.id),
    sha256: process.sha256,
  };
}

function adapterSummary(definition) {
  const adapter = loadPrototypeAdapter(definition);
  return {
    id: adapter.id,
    version: adapter.version,
    title: definition.title,
    capabilities: copy(adapter.capabilities),
  };
}

export function prototypeProcessList() {
  return { schemaVersion: 1, items: RUNTIME_PROCESSES.map(processSummary) };
}

export function prototypeAdapterList() {
  return { schemaVersion: 1, items: RUNTIME_ADAPTERS.map(adapterSummary) };
}

export function prototypeAdapterCapabilities(specifier) {
  const definition = RUNTIME_ADAPTERS.find(item => `${item.id}@${item.version}` === specifier);
  if (!definition) throw new Error('Unsupported runtime adapter');
  const adapter = adapterSummary(definition);
  return {
    schemaVersion: 1,
    id: adapter.id,
    version: adapter.version,
    title: adapter.title,
    capabilities: adapter.capabilities,
    note: RUNTIME_ADAPTER_NOTE,
  };
}

export function prototypeCapabilities() {
  return {
    schemaVersion: 1,
    registeredSourceTypes: ['html', 'figma', 'design-tool', 'app-build', 'video', 'image', 'other'],
    analysisAdapters: [{ id: 'html', version: 1, input: 'local-html', staticDiscovery: true, browserExecution: false }],
    runtimeAdapters: prototypeAdapterList().items,
    capture: { command: 'prototype capture --input <file> --request-id <ID> --json', dimensions: ['png'], browserRequired: true, archiveRequired: true },
    note: `项目登记不等于适配器支持。${RUNTIME_ADAPTER_NOTE} 其他格式保留观察边界，不伪造点击覆盖。`,
  };
}
