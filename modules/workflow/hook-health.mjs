import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ENVIRONMENT, temporaryDirectoryName } from '../skill-identity.mjs';

const events = new Set(['SessionStart', 'SubagentStart', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop', 'SessionEnd', 'session-start', 'before-write', 'after-file-edit', 'stop', 'unknown']);
const directory = root => path.join(process.env[ENVIRONMENT.HOOK_HEALTH_DIRECTORY] || path.join(os.tmpdir(), temporaryDirectoryName('hook-health')), crypto.createHash('sha256').update(path.resolve(root)).digest('hex'));
export const HEALTH_WARNING = '[mf-dev-flow adapter_degraded] 流程 hook 未完成核验；这不是门禁通过。请用 flow health --json 定位事件，修复后重试；产品完成仍须公共命令验证。';

export function recordHookHealth({ root, adapter, event, status, error }) {
  // Do not persist raw input, stderr, paths, credentials or exception messages.
  try {
    const folder = directory(root);
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const kind = adapter === 'codex' ? adapter : 'codex';
    const file = path.join(folder, `${kind}-${events.has(event) ? event : 'unknown'}.json`);
    const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const at = new Date().toISOString();
    const failure = status === 'degraded' ? { at, code: /^[A-Z_0-9]{1,64}$/.test(error?.code ?? '') ? error.code : 'ADAPTER_ERROR' } : previous.lastFailure;
    const value = { adapter, event: events.has(event) ? event : 'unknown', status, checkedAt: at, ...(failure ? { lastFailure: failure } : {}) };
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temporary, file);
  } catch { /* Observability must not change the host's fail-open policy. */ }
}

export function hookHealth(root = process.cwd()) {
  const folder = directory(root);
  if (!fs.existsSync(folder)) return { status: 'unknown', events: [], note: '尚无本工作区的 hook 观测；不代表已启用或通过。' };
  const records = fs.readdirSync(folder).filter(file => file.endsWith('.json')).slice(0, 30).map(file => {
    try { return JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8')); }
    catch { return { status: 'degraded', event: 'unreadable_health_record' }; }
  });
  return { status: records.some(record => record.status === 'degraded') ? 'degraded' : 'observed', events: records, note: '仅表示最近适配器调用结果；历史故障保留，不能替代业务门禁或证明所有写入都被拦截。' };
}
