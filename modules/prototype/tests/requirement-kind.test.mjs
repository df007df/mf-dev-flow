import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { semanticRows } from '../client.mjs';
import { readPrototypeRevision } from '../../planning/impact.mjs';

const cli = fileURLToPath(new URL('../../../scripts/mf-dev-flow.mjs', import.meta.url));
const write = (root, relative, text) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const run = (root, ...args) =>
  spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
const initPrototype = (root) => {
  write(root, 'source/index.html', '<main><button id="demo">Demo</button></main>');
  write(root, '.mf-dev-flow/prototype/analysis-requirements.md', '# SYNTHETIC\nNew user: home only.\n');
  const input = write(root, 'input.json', JSON.stringify({
    schemaVersion: 1,
    source: { type: 'html', location: 'source/index.html' },
    scope: { mode: 'partial', observableBoundary: 'SYNTHETIC' },
  }));
  const init = run(root, 'prototype', 'init', '--input', input, '--batch', 'rules', '--request-id', 'rules-init');
  assert.equal(init.status, 0, init.stderr);
};

test('kind 合法值写入并参与修订哈希；非法值拒绝；存量无 kind 按 product', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-dev-flow-kind-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initPrototype(root);

  // T1-a: requirement add/update is revision-gated; chain --expected-revision from status.
  const status = run(root, 'prototype', 'status', '--json');
  assert.equal(status.status, 0, status.stderr);
  const revision = JSON.parse(status.stdout).items[0].semanticRevision;

  const req = write(root, 'req.json', JSON.stringify({
    id: 'req-tech', actor: '用户', origin: 'user', text: '书签只存本地，不走接口。', kind: 'technical', groupId: 'group-a',
  }));
  const added = run(root, 'prototype', 'requirement', 'add', '--input', req, '--request-id', 'req-1', '--expected-revision', String(revision));
  assert.equal(added.status, 0, added.stderr);
  const addedOut = JSON.parse(added.stdout).items[0];
  assert.equal(addedOut.status, 'proposed');
  assert.equal(addedOut.developmentAuthorized, false);

  const store = path.join(root, '.mf-dev-flow');
  let rows = semanticRows(root, 'requirements');
  assert.equal(rows.find((r) => r.id === 'req-tech').kind, 'technical');
  const hashProposed = readPrototypeRevision(store).requirements.find((r) => r.id === 'req-tech').hash;
  assert.match(hashProposed, /^[a-f0-9]{64}$/);

  // status 翻转改变哈希（复评不可豁免；guard 防止回归"哈希排除 status"）
  const upd = write(root, 'req-upd.json', JSON.stringify({ id: 'req-tech', actor: '用户', status: 'confirmed' }));
  const updated = run(root, 'prototype', 'requirement', 'update', '--input', upd,
    '--request-id', 'req-2', '--expected-revision', String(addedOut.semanticRevision));
  assert.equal(updated.status, 0, updated.stderr);
  const updatedOut = JSON.parse(updated.stdout).items[0];
  const hashConfirmed = readPrototypeRevision(store).requirements.find((r) => r.id === 'req-tech').hash;
  assert.notEqual(hashConfirmed, hashProposed);

  // 缺省 kind → product
  const prod = write(root, 'req-prod.json', JSON.stringify({
    id: 'req-prod', actor: '用户', origin: 'user', text: '首页增加入口。', groupId: 'group-a',
  }));
  const prodAdded = run(root, 'prototype', 'requirement', 'add', '--input', prod, '--request-id', 'req-3', '--expected-revision', String(updatedOut.semanticRevision));
  assert.equal(prodAdded.status, 0, prodAdded.stderr);
  const prodOut = JSON.parse(prodAdded.stdout).items[0];
  rows = semanticRows(root, 'requirements');
  assert.equal(rows.find((r) => r.id === 'req-prod').kind, 'product');

  // 非法 kind 拒绝
  const bad = write(root, 'req-bad.json', JSON.stringify({
    id: 'req-bad', actor: '用户', origin: 'user', text: 'x', kind: 'spec', groupId: 'group-a',
  }));
  const badAdded = run(root, 'prototype', 'requirement', 'add', '--input', bad, '--request-id', 'req-4', '--expected-revision', String(prodOut.semanticRevision));
  assert.notEqual(badAdded.status, 0);
  assert.match(badAdded.stderr, /kind/);
});

test('新增或更新中的有效需求必须声明影响范围：绑定分组或入口，或显式全局', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-dev-flow-requirement-scope-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initPrototype(root);

  const status = run(root, 'prototype', 'status', '--json');
  assert.equal(status.status, 0, status.stderr);
  const revision = JSON.parse(status.stdout).items[0].semanticRevision;
  const unscoped = write(root, 'req-unscoped.json', JSON.stringify({
    id: 'req-unscoped', actor: '用户', origin: 'user', text: '支付接入需要明确影响范围。',
  }));
  const rejected = run(root, 'prototype', 'requirement', 'add', '--input', unscoped,
    '--request-id', 'scope-1', '--expected-revision', String(revision));
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /影响范围|groupId|entryIds|impactScope/);

  const global = write(root, 'req-global.json', JSON.stringify({
    id: 'req-global', actor: '用户', origin: 'user', text: '全局埋点字段调整。', impactScope: 'global',
  }));
  const accepted = run(root, 'prototype', 'requirement', 'add', '--input', global,
    '--request-id', 'scope-2', '--expected-revision', String(revision));
  assert.equal(accepted.status, 0, accepted.stderr);

  const mixed = write(root, 'req-mixed.json', JSON.stringify({
    id: 'req-mixed', actor: '用户', origin: 'user', text: '不能同时宣称全局和局部。', impactScope: 'global', groupId: 'group-a',
  }));
  const mixedRejected = run(root, 'prototype', 'requirement', 'add', '--input', mixed,
    '--request-id', 'scope-3', '--expected-revision', String(JSON.parse(accepted.stdout).items[0].semanticRevision));
  assert.notEqual(mixedRejected.status, 0);
  assert.match(mixedRejected.stderr, /全局|impactScope|groupId|entryIds/);

  const mixedLocal = write(root, 'req-mixed-local.json', JSON.stringify({
    id: 'req-mixed-local', actor: '用户', origin: 'user', text: '局部范围只能选择一种锚点。', groupId: 'group-a', entryIds: ['entry-a'],
  }));
  const localRejected = run(root, 'prototype', 'requirement', 'add', '--input', mixedLocal,
    '--request-id', 'scope-4', '--expected-revision', String(JSON.parse(accepted.stdout).items[0].semanticRevision));
  assert.notEqual(localRejected.status, 0);
  assert.match(localRejected.stderr, /either|groupId|entryIds|范围/);
});
