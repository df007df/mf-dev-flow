import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('./mf-dev-flow.mjs', import.meta.url));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };

test('system reads are bounded/read-only; preview preserves data and stale publishing is rejected', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-dev-flow-system-query-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const call = (...args) => spawnSync(process.execPath, [cli, 'system', ...args], { cwd: root, encoding: 'utf8' });
  const ok = (...args) => { const result = call(...args); assert.equal(result.status, 0, result.stderr); return result; };
  write(path.join(root, '.mf-dev-flow/project.json'), { project: { name: 'synthetic' }, codeRoots: [] });
  const card = { id: 'a', title: 'A', status: 'confirmed', relationship: 'reference', authority: 'fixture', lastVerifiedAt: '2026-09-07T00:00:00Z', facts: ['long '.repeat(4000)], openQuestions: ['unanswered'], sources: [{ id: 'doc', title: 'Fixture doc', kind: 'document', location: 'fixture.md', authority: 'fixture', accessPolicy: '只读', secretHandling: 'no secrets', status: 'confirmed' }] };
  const file = path.join(root, '.mf-dev-flow/system/cards.json');
  write(file, { schemaVersion: 2, cards: [card, { ...card, id: 'b' }], history: [] });
  const original = fs.readFileSync(file, 'utf8');
  const page = JSON.parse(ok('query', '--limit', '1', '--max-bytes', '1024').stdout);
  assert.equal(page.items.length, 1); assert.equal(page.nextCursor, 1); assert.ok(page.bytes <= 1024);
  const field = JSON.parse(ok('query', '--card', 'a', '--field', 'facts', '--text-limit', '30').stdout);
  assert.equal(field.items[0].text.length, 30); assert.equal(field.items[0].nextTextOffset, 30);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(root, '.mf-dev-flow/current.json')), false);
  const dir = path.join(root, '.mf-dev-flow/system-runs/fixture');
  write(path.join(dir, 'run.json'), { id: 'fixture', type: 'system', title: 'fixture', status: 'done' });
  write(path.join(dir, 'integration.json'), { status: 'passed' });
  write(path.join(dir, 'cards.json'), { schemaVersion: 2, cards: [{ ...card, facts: ['new fact'] }], removeCardIds: [] });
  const preview = JSON.parse(ok('update', '--from-run', 'fixture', '--dry-run').stdout);
  assert.equal(preview.dryRun, true); assert.ok(preview.items[0].changedFields.includes('facts'));
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  write(file, { schemaVersion: 2, cards: [{ ...card, openQuestions: ['concurrent question'] }, { ...card, id: 'b' }], history: [] });
  assert.notEqual(call('query', '--cursor', '1', '--fingerprint', page.fingerprint).status, 0);
  assert.notEqual(call('update', '--from-run', 'fixture', '--expected-fingerprint', preview.fingerprint).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(file)).cards[0].openQuestions[0], 'concurrent question');
  const fresh = JSON.parse(ok('query').stdout);
  const incoming = JSON.parse(fs.readFileSync(path.join(dir, 'cards.json')));
  incoming.cards[0].openQuestions = ['concurrent question']; write(path.join(dir, 'cards.json'), incoming);
  ok('update', '--from-run', 'fixture', '--expected-fingerprint', fresh.fingerprint);
  const updated = JSON.parse(fs.readFileSync(file));
  assert.equal(updated.cards.length, 2); assert.deepEqual(updated.cards[0].facts, ['new fact']);
  assert.deepEqual(updated.cards[0].openQuestions, ['concurrent question']);
  assert.equal(fs.existsSync(path.join(root, '.mf-dev-flow/system/.cards-write.lock')), false);
  // Preview the actual dedupe result, including removal of a merged card ID.
  for (const card of updated.cards) card.sources[0] = { ...card.sources[0], kind: 'codebase', location: '/synthetic/external-repo', accessPolicy: '只读不修改' };
  write(file, updated);
  incoming.cards[0].sources = updated.cards[0].sources; write(path.join(dir, 'cards.json'), incoming);
  const beforeDedupe = fs.readFileSync(file, 'utf8');
  const dedupe = JSON.parse(ok('update', '--from-run', 'fixture', '--dry-run').stdout);
  assert.equal(dedupe.items.find(item => item.id === 'b').action, 'remove_or_merge');
  assert.equal(fs.readFileSync(file, 'utf8'), beforeDedupe);
});

test('public reference addresses use the lightweight path without accepting credentials or opaque URL data', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-dev-flow-system-profile-address-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const call = (...args) => spawnSync(process.execPath, [cli, 'system', ...args], { cwd: root, encoding: 'utf8' });
  const ok = (...args) => { const result = call(...args); assert.equal(result.status, 0, result.stderr); return result; };
  write(path.join(root, '.mf-dev-flow/project.json'), { schemaVersion: 1 });
  const file = path.join(root, '.mf-dev-flow/system/cards.json');
  write(file, { schemaVersion: 2, cards: [{
    id: 'svc', title: 'Fixture', status: 'confirmed', relationship: 'reference', authority: 'fixture',
    lastVerifiedAt: '2026-09-07T00:00:00Z', facts: [], openQuestions: [], sources: [], history: [],
  }], history: [] });

  ok('profile-address', '--card', 'svc', '--environment', 'online', '--address', 'https://service.example.test/', '--evidence', 'fixture public configuration origin');
  let document = JSON.parse(fs.readFileSync(file));
  assert.deepEqual(document.cards[0].referenceProfile.online.addresses, ['https://service.example.test']);
  assert.equal(document.cards[0].changeLog.at(-1).action, 'reference_address_registered');
  assert.equal(document.history.at(-1).action, 'reference_address_updated');
  assert.match(fs.readFileSync(path.join(root, '.mf-dev-flow/system/cards/svc.md'), 'utf8'), /线上地址：https:\/\/service\.example\.test/);

  ok('profile-address', '--card', 'svc', '--environment', 'online', '--address', 'https://service.example.test', '--evidence', 'fixture reconfirmed origin');
  document = JSON.parse(fs.readFileSync(file));
  assert.deepEqual(document.cards[0].referenceProfile.online.addresses, ['https://service.example.test']);
  assert.equal(document.cards[0].changeLog.at(-1).action, 'reference_address_reconfirmed');

  const beforeRejectedWrite = fs.readFileSync(file, 'utf8');
  const credential = call('profile-address', '--card', 'svc', '--environment', 'online', '--address', 'https://user:password@service.example.test', '--evidence', 'fixture');
  assert.notEqual(credential.status, 0); assert.match(credential.stderr, /用户名或密码/);
  const query = call('profile-address', '--card', 'svc', '--environment', 'online', '--address', 'https://service.example.test/?token=abc', '--evidence', 'fixture');
  assert.notEqual(query.status, 0); assert.match(query.stderr, /查询参数/);
  const secretEvidence = call('profile-address', '--card', 'svc', '--environment', 'online', '--address', 'https://service.example.test', '--evidence', 'token=abc');
  assert.notEqual(secretEvidence.status, 0); assert.match(secretEvidence.stderr, /密钥/);
  assert.equal(fs.readFileSync(file, 'utf8'), beforeRejectedWrite);
});


test('two public writers reject a stale snapshot, release the lock and permit a fresh retry', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-dev-flow-system-race-'));
  let child;
  t.after(() => { child?.kill(); fs.rmSync(root, { recursive: true, force: true }); });
  write(path.join(root, '.mf-dev-flow/project.json'), { schemaVersion: 1 });
  const file = path.join(root, '.mf-dev-flow/system/cards.json');
  write(file, { schemaVersion: 2, cards: [{ id: 'svc', title: 'Fixture', status: 'confirmed', sources: [], knownApis: [{ id: 'ping' }] }], history: [] });
  const pause = path.join(root, 'pause.mjs');
  fs.writeFileSync(pause, `import fs from 'node:fs';
    const original = fs.openSync; let once = true;
    fs.openSync = function(file, ...args) {
      if (once && String(file).endsWith('/.cards-write.lock')) {
        once = false; fs.writeFileSync('at-lock', ''); const start = Date.now();
        while (!fs.existsSync('resume')) { if (Date.now() - start > 10000) throw new Error('fixture barrier timeout'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); }
      }
      return original.call(this, file, ...args);
    };`);
  const args = consumer => ['system', 'api-use', '--card', 'svc', '--api', 'ping', '--consumer', consumer, '--purpose', 'SYNTHETIC FIXTURE', '--decision-ref', 'fixture'];
  child = spawn(process.execPath, ['--import', pause, cli, ...args('A')], { cwd: root });
  let stderr = ''; child.stderr.on('data', bytes => stderr += bytes); child.stdout.resume();
  const completed = new Promise(resolve => child.on('close', status => resolve(status)));
  for (let i = 0; !fs.existsSync(path.join(root, 'at-lock')); i++) { assert.ok(i < 500, 'barrier not reached'); await new Promise(resolve => setTimeout(resolve, 10)); }
  const b = spawnSync(process.execPath, [cli, ...args('B')], { cwd: root, encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr);
  fs.writeFileSync(path.join(root, 'resume'), '');
  assert.equal(await completed, 1); assert.match(stderr, /版本冲突/);
  assert.equal(fs.existsSync(path.join(root, '.mf-dev-flow/system/.cards-write.lock')), false);
  const retry = spawnSync(process.execPath, [cli, ...args('A')], { cwd: root, encoding: 'utf8' });
  assert.equal(retry.status, 0, retry.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).cards[0].apiUsages.map(item => item.consumer).sort(), ['A', 'B']);
});
