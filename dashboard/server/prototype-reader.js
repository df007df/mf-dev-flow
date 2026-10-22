// Read-only HTTP adapter. Every modern prototype read goes through its public CLI.
import { callPrototype } from '../../modules/prototype/client.mjs';
export function readPrototypePage(root, params) {
  const command = params.get('command') ?? 'status';
  if (!['status', 'query', 'document', 'revision', 'analysis-requirements'].includes(command)) throw new Error('只允许原型只读查询');
  const allowed = new Set(['collection', 'type', 'batch', 'group', 'id', 'status', 'cursor', 'revision', 'fingerprint', 'field', 'text-offset', 'text-limit', 'limit']);
  const args = [command];
  for (const [key, value] of params) {
    if (key === 'command') continue;
    if (!allowed.has(key) || value.length > 240 || value.startsWith('--')) throw new Error('无效查询参数');
    args.push(`--${key}`, value);
  }
  if (command === 'query') args.push('--detail', '--limit', '10');
  return callPrototype(root, args, 16384);
}
