// Read-only adapter for the feature-level final acceptance registry.
import { acceptanceCasesPage } from '../../modules/runtime/acceptance-cases.mjs';

export function readFeatureAcceptanceCasesPage(root, params) {
  const allowed = new Set(['cursor', 'limit', 'fingerprint', 'id', 'feature', 'status']);
  const options = {};
  for (const [key, value] of params) {
    if (!allowed.has(key) || value.length > 240 || value.startsWith('--'))
      throw new Error('无效最终验收用例查询参数');
    options[key] = value;
  }
  return acceptanceCasesPage(root, options);
}
