import path from 'node:path';

const RUNTIME_ADAPTER_SNAPSHOT = Symbol('runtimeAdapterSnapshot');
const MAX_RUNTIME_REVISION_BYTES = 128;
const SAFE_RUNTIME_REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WECHAT_MINIAPP_CAPABILITIES = {
  sourceDiscovery: false,
  operations: ['pageStack', 'selectorAction', 'simulatorScreenshot', 'traceArchive', 'compileRefresh'],
  evidence: { screenshot: 'png', trace: true },
};
const IOS_APP_CAPABILITIES = {
  sourceDiscovery: false,
  operations: ['screenState', 'elementAction', 'simulatorScreenshot', 'traceArchive', 'appLaunch'],
  evidence: { screenshot: 'png', trace: true },
};
const RUNTIME_ADAPTER_CONTRACTS = {
  'web-runtime@1': {
    sourceModes: ['url', 'local-preview'],
  },
  'wechat-miniapp-runtime@1': {
    sourceModes: ['wechat-devtools-simulator'],
    capabilities: WECHAT_MINIAPP_CAPABILITIES,
  },
  'ios-app-runtime@1': {
    sourceModes: ['ios-simulator'],
    capabilities: IOS_APP_CAPABILITIES,
  },
};

const required = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} required`);
  return value.trim();
};

const canonical = value => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);

function frozenRevision(value, label) {
  const revision = required(value, label);
  if (Buffer.byteLength(revision) > MAX_RUNTIME_REVISION_BYTES
    || /[\0\r\n?#]/.test(revision)
    || /(?:token|secret|password|authorization|api[_-]?key|session|cookie)\s*=/i.test(revision)
    || !SAFE_RUNTIME_REVISION.test(revision))
    throw new Error(`${label} is invalid`);
  return revision;
}

function resolvedAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter))
    throw new Error('resolved runtime adapter required');
  if (typeof adapter.id !== 'string' || !adapter.id.trim() || !Number.isSafeInteger(adapter.version))
    throw new Error('resolved runtime adapter required');
  if (!adapter.capabilities || typeof adapter.capabilities !== 'object' || Array.isArray(adapter.capabilities))
    throw new Error('resolved runtime adapter capabilities required');
  const specifier = `${adapter.id}@${adapter.version}`;
  const contract = RUNTIME_ADAPTER_CONTRACTS[specifier];
  if (!contract) throw new Error(`unsupported resolved runtime adapter ${specifier}`);
  const declaration = adapter.sourceModes ?? adapter.capabilities.sourceModes;
  if (declaration !== undefined && canonical(declaration) !== canonical(contract.sourceModes))
    throw new Error(`resolved runtime adapter ${specifier} sourceModes contract is invalid`);
  // The composed Mini Program workflow snapshot predates top-level sourceModes.
  // Its exact immutable capability profile is the only accepted compatibility
  // form; any capability drift fails closed rather than inferring a mode.
  if (declaration === undefined) {
    if (!contract.capabilities || canonical(adapter.capabilities) !== canonical(contract.capabilities))
      throw new Error(`resolved runtime adapter ${specifier} must declare sourceModes`);
  }
  return { id: adapter.id, version: adapter.version, capabilities: adapter.capabilities, sourceModes: [...contract.sourceModes] };
}

function adapterSpecifier(adapter) {
  const resolved = resolvedAdapter(adapter);
  return { resolved, specifier: `${resolved.id}@${resolved.version}` };
}

function sanitizedUrl(value) {
  let parsed;
  try { parsed = new URL(required(value, 'locator.url')); }
  catch { throw new Error('locator.url must be an absolute URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('locator.url must use http or https');
  if (parsed.username || parsed.password) throw new Error('locator.url credentials are not allowed');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function localPreview(value) {
  const preview = required(value, 'locator.localPreview');
  if (/[\r\n\0]/.test(preview) || Buffer.byteLength(preview) > 1024) throw new Error('locator.localPreview is invalid');
  const sanitized = preview.replace(/[?#].*$/, '');
  if (!sanitized) throw new Error('locator.localPreview is invalid');
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/?#]*@/i.test(sanitized)) throw new Error('locator.localPreview credentials are not allowed');
  return sanitized;
}

function simulatorProjectPath(value) {
  const projectPath = required(value, 'locator.projectPath');
  if (/[\r\n\0?#]/.test(projectPath) || Buffer.byteLength(projectPath) > 1024)
    throw new Error('locator.projectPath is invalid');
  if (/^(?:~(?:[\\/]|$)|\$HOME(?:[\\/]|$)|%USERPROFILE%(?:[\\/]|$))/i.test(projectPath))
    throw new Error('locator.projectPath must not expand a user home directory');
  if (path.posix.isAbsolute(projectPath.replace(/\\/g, '/'))
    || path.win32.isAbsolute(projectPath)
    || /^[a-z][a-z0-9+.-]*:/i.test(projectPath))
    throw new Error('locator.projectPath must be workspace-relative');
  const segments = projectPath.replace(/\\/g, '/').split('/');
  if (segments.includes('..')) throw new Error('locator.projectPath must not contain ..');
  const normalized = path.posix.normalize(projectPath.replace(/\\/g, '/'));
  if (!normalized || normalized === '.' || normalized === '/' || normalized === '..' || normalized.startsWith('../'))
    throw new Error('locator.projectPath is invalid');
  return normalized.replace(/^\.\//, '');
}

function simulatorEntryRoute(value) {
  const entryRoute = required(value, 'locator.entryRoute');
  if (!/^pages\/[A-Za-z0-9_/-]+$/.test(entryRoute)
    || entryRoute.includes('..')
    || entryRoute.split('/').some(segment => !segment))
    throw new Error('locator.entryRoute must use pages/* without empty or unsafe segments');
  return entryRoute;
}

function simulatorLocator(locator, modes) {
  if (modes && !modes.has('wechat-devtools-simulator'))
    throw new Error('runtime source mode is not declared by the adapter');
  if (Object.keys(locator).some(key => !['mode', 'projectPath', 'entryRoute'].includes(key)))
    throw new Error('simulator locator may contain only mode, projectPath, and entryRoute');
  if (locator.mode !== 'wechat-devtools-simulator')
    throw new Error('runtime source mode must be wechat-devtools-simulator');
  return {
    mode: 'wechat-devtools-simulator',
    projectPath: simulatorProjectPath(locator.projectPath),
    entryRoute: simulatorEntryRoute(locator.entryRoute),
  };
}

function iosBundleId(value) {
  const bundleId = required(value, 'locator.bundleId');
  if (Buffer.byteLength(bundleId) > 256) throw new Error('locator.bundleId is invalid');
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(bundleId)
    || !bundleId.includes('.')
    || bundleId.includes('..')
    || /(?:token|secret|password|authorization|api[_-]?key|session|cookie)\s*=/i.test(bundleId))
    throw new Error('locator.bundleId must be a dotted identifier without credentials');
  return bundleId;
}

function iosSimulatorDevice(value) {
  const device = required(value, 'locator.device');
  if (Buffer.byteLength(device) > 128 || /[\0\r\n]/.test(device))
    throw new Error('locator.device is invalid');
  if (!/^[A-Za-z0-9][A-Za-z0-9 ()._-]*$/.test(device)
    || device.includes('..')
    || /^(?:~(?:[\\/]|$)|\$HOME(?:[\\/]|$)|%USERPROFILE%(?:[\\/]|$))/i.test(device))
    throw new Error('locator.device must be a simulator name or UDID without paths');
  return device;
}

function iosSimulatorLocator(locator, modes) {
  if (modes && !modes.has('ios-simulator'))
    throw new Error('runtime source mode is not declared by the adapter');
  if (Object.keys(locator).some(key => !['mode', 'bundleId', 'device'].includes(key)))
    throw new Error('iOS locator may contain only mode, bundleId, and device');
  if (locator.mode !== 'ios-simulator')
    throw new Error('runtime source mode must be ios-simulator');
  return {
    mode: 'ios-simulator',
    bundleId: iosBundleId(locator.bundleId),
    device: iosSimulatorDevice(locator.device),
  };
}

function snapshotRuntimeSource(source, adapter) {
  Object.defineProperty(source, RUNTIME_ADAPTER_SNAPSHOT, {
    value: adapter,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return source;
}

export function normalizeRuntimeSource(source, adapter) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('runtime source required');
  if (source.type !== 'runtime') throw new Error('source.type must be runtime');
  const { resolved, specifier: expectedAdapter } = adapterSpecifier(adapter);
  if (required(source.adapter, 'source.adapter') !== expectedAdapter) throw new Error(`runtime source adapter must be ${expectedAdapter}`);
  for (const field of ['candidates', 'sourceFiles', 'sourceComplete', 'sourceDiscovery']) {
    if (Object.hasOwn(source, field)) throw new Error(`runtime source cannot declare static ${field}`);
  }
  if (!source.locator || typeof source.locator !== 'object' || Array.isArray(source.locator)) throw new Error('runtime locator required');
  const modes = new Set(resolved.sourceModes);
  if (source.locator.mode === 'wechat-devtools-simulator') {
    return snapshotRuntimeSource({
      type: 'runtime',
      adapter: expectedAdapter,
      locator: simulatorLocator(source.locator, modes),
      revision: frozenRevision(source.revision, 'runtime compile revision'),
    }, resolved);
  }
  if (source.locator.mode === 'ios-simulator') {
    return snapshotRuntimeSource({
      type: 'runtime',
      adapter: expectedAdapter,
      locator: iosSimulatorLocator(source.locator, modes),
      revision: frozenRevision(source.revision, 'runtime build revision'),
    }, resolved);
  }
  if (source.locator.mode !== undefined && (!['url', 'local-preview'].includes(source.locator.mode)
    || (!source.locator.url && !source.locator.localPreview)))
    throw new Error('runtime source mode is not declared by the adapter');
  const locator = {};
  if (source.locator.url !== undefined) locator.url = sanitizedUrl(source.locator.url);
  if (source.locator.localPreview !== undefined) locator.localPreview = localPreview(source.locator.localPreview);
  if (!locator.url && !locator.localPreview) throw new Error('runtime locator requires url or localPreview');
  const mode = locator.url ? 'url' : 'local-preview';
  if (modes && !modes.has(mode)) throw new Error('runtime source mode is not declared by the adapter');
  return snapshotRuntimeSource({
    type: 'runtime',
    adapter: expectedAdapter,
    locator,
    revision: frozenRevision(source.revision, 'runtime revision'),
  }, resolved);
}

export function runtimeSourceMap(source, adapter, createdAt = new Date().toISOString()) {
  const snapshot = adapter ?? source?.[RUNTIME_ADAPTER_SNAPSHOT];
  if (!snapshot) throw new Error('resolved runtime adapter required');
  const normalized = normalizeRuntimeSource(source, snapshot);
  return {
    schemaVersion: 1,
    origin: {
      type: normalized.type,
      adapter: normalized.adapter,
      locator: normalized.locator,
      revision: normalized.revision,
    },
    sourceFiles: [],
    candidates: [],
    problems: [],
    createdAt,
  };
}
