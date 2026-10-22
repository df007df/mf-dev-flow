import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { digest } from './prototype-source-map.js';
import { exportFileName } from '../../modules/skill-identity.mjs';
const require = createRequire(import.meta.url);
// The SQLite runtime is needed only for explicitly opted-in new indexes.
// Existing map/audit histories keep the previous Node/dependency path.
export function indexedProjectionProblems(runDirectory) {
  const output = path.join(runDirectory, 'analysis-index');
  if (!fs.existsSync(path.join(output, 'index.sqlite'))) return [];
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(output, 'index.sqlite'), { readOnly: true });
    let revision;
    try { revision = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value); } finally { db.close(); }
    const marker = JSON.parse(fs.readFileSync(path.join(output, exportFileName()), 'utf8'));
    if (revision !== marker.revision) return ['批量索引存在未物化修改；先 prototype index export --run <ID>'];
    for (const [name, expected] of Object.entries(marker.hashes)) if (digest(fs.readFileSync(path.join(runDirectory, name))) !== expected) return [`批量索引派生文件 ${name} 已被另行修改，不能绕过索引真源`];
    if (!marker.auditComplete) return ['批量索引尚未通过完整审计；查询 prototype index audit 并补齐，再 export'];
    return [];
  } catch (error) { return [`批量索引兼容投影无法核验：${error.message}`]; }
}
