import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { routeFlow, selectFlow, clearFlow, hookContext, registry } from '../route.mjs';
import { DELIVERY_STAGES, renderDeliveryBrief } from '../../delivery/contract.mjs';
const skill = fileURLToPath(new URL('../../../', import.meta.url));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-dev-flow-route-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }

test('unknown/explicit/maintenance routes are read-only and never initialize product data', t => {
  const root = fixture(t);
  assert.equal(routeFlow({ root }).flow, null);
  assert.equal(routeFlow({ root, intent: 'feature impact' }).flow, 'planning');
  assert.equal(routeFlow({ root, flow: 'prototype' }).flow, 'prototype');
  assert.equal(fs.readdirSync(root).length, 0);
  write(path.join(root, '.mf-dev-flow/current.json'), 'invalid JSON intentionally unreadable to maintenance');
  assert.equal(routeFlow({ root, flow: 'maintenance' }).nextCommand, null);
  selectFlow({ root, session: 'maintenance', flow: 'maintenance' });
  assert.equal(routeFlow({ root, session: 'maintenance' }).flow, 'maintenance');
  assert.ok(Buffer.byteLength(hookContext({ root, session: 'maintenance' })) <= 2048);
  assert.equal(fs.existsSync(path.join(root, '.mf-dev-flow/prototype')), false);
});

test('session-bound task resumes its current stage; explicit selection wins and context remains bounded', t => {
  const root = fixture(t), run = path.join(root, '.mf-dev-flow/delivery-runs/resume');
  write(path.join(root, '.mf-dev-flow/current.json'), { active: { type: 'delivery', id: 'resume' } });
  write(path.join(run, 'work-plan.json'), { tasks: [{ id: 't1' }] });
  write(path.join(run, 'executions/t1.json'), { status: 'in_progress', sessionId: 's1', targetPhase: 'api_mock', stages: { prototype_alignment: { status: 'confirmed' }, api_mock: { status: 'in_progress' } } });
  const route = routeFlow({ root, session: 's1' });
  assert.equal(route.flow, 'delivery'); assert.equal(route.binding.phase, 'api_mock'); assert.match(route.nextCommand, /--run resume --task t1/);
  assert.equal(routeFlow({ root, session: 'other' }).flow, null);
  assert.equal(routeFlow({ root, session: 's1', intent: 'prototype' }).flow, 'prototype');
  assert.equal(routeFlow({ root, session: 's1', flow: 'system' }).flow, 'system');
  const context = hookContext({ root, session: 's1' }); assert.match(context, /api_mock/); assert.ok(Buffer.byteLength(context) <= 2048);
});

test('flow/help and empty prototype status work with parser/SQLite/dashboard modules absent', t => {
  const root = fixture(t), detached = path.join(root, 'skill');
  fs.mkdirSync(path.join(detached, 'scripts'), { recursive: true });
  fs.cpSync(path.join(skill, 'modules/workflow'), path.join(detached, 'modules/workflow'), { recursive: true });
  fs.copyFileSync(path.join(skill, 'modules/skill-identity.mjs'), path.join(detached, 'modules/skill-identity.mjs'));
  fs.copyFileSync(path.join(skill, 'scripts/mf-dev-flow.mjs'), path.join(detached, 'scripts/mf-dev-flow.mjs'));
  for (const args of [['flow', 'list'], ['flow', 'route', '--flow', 'maintenance'], ['prototype', 'status']]) {
    const result = spawnSync(process.execPath, [path.join(detached, 'scripts/mf-dev-flow.mjs'), ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.doesNotMatch(result.stderr, /SQLite/); assert.ok(Buffer.byteLength(result.stdout) < 5000);
  }
  assert.equal(fs.existsSync(path.join(root, '.mf-dev-flow')), false);
});

test('single skill registry links exist and current-stage brief does not preload future stage instructions', () => {
  const text = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'); assert.ok(Buffer.byteLength(text) <= 2500);
  for (const flow of registry.flows) assert.ok(fs.existsSync(path.join(skill, flow.entry)), flow.entry);
  const commands = new Set();
  for (const route of registry.commandRoutes) { const key = `${route.command}/${route.subcommand ?? ''}`; assert.ok(!commands.has(key)); commands.add(key); assert.ok(fs.existsSync(path.join(skill, route.module)), route.module); }
  const brief = renderDeliveryBrief({ targetPhase: DELIVERY_STAGES.at(-1).id, completedStageIds: [DELIVERY_STAGES[0].id] });
  assert.ok(brief.includes(DELIVERY_STAGES[1].objective)); assert.ok(!brief.includes(DELIVERY_STAGES[0].objective)); assert.ok(!brief.includes(DELIVERY_STAGES[2].objective));
});


test('current intent overrides saved flow without loading broken product context or changing the saved preference', t => {
  const root = fixture(t);
  selectFlow({ root, session: 's', flow: 'maintenance' });
  write(path.join(root, '.mf-dev-flow/current.json'), 'broken product JSON');
  const next = routeFlow({ root, session: 's', intent: 'prototype' });
  assert.equal(next.flow, 'prototype'); assert.equal(next.reason, 'current_intent');
  assert.equal(next.binding, null);
  assert.equal(routeFlow({ root, session: 's', intent: 'prototype question answer' }).goal.mode, 'record');
  assert.deepEqual(routeFlow({ root, session: 's', intent: 'prototype status' }).goal.allowedWrites, []);
  assert.equal(routeFlow({ root, session: 's' }).flow, 'maintenance');
  assert.equal(routeFlow({ root, session: 's', intent: 'prototype', flow: 'system' }).flow, 'system');
  assert.equal(routeFlow({ root, intent: 'maintenance' }).goal.mode, 'maintain');
  assert.deepEqual(routeFlow({ root, flow: 'overview' }).goal.allowedWrites, []);
  assert.ok(Buffer.byteLength(hookContext({ root, session: 's', intent: 'prototype' })) <= 2048);
  assert.equal(clearFlow({ root, session: 's' }).cleared, true);
  assert.equal(clearFlow({ root, session: 's' }).cleared, false);
  assert.equal(fs.readFileSync(path.join(root, '.mf-dev-flow/current.json'), 'utf8'), 'broken product JSON');
});

test('commandRoutes 每条都能解析到真实模块与导出（防路由腐烂）', async () => {
  const { pathToFileURL } = await import('node:url');
  const routes = registry.commandRoutes ?? [];
  assert.ok(routes.length > 0);
  const seen = new Set();
  for (const route of routes) {
    const key = `${route.command} ${route.subcommand ?? ''}`.trim();
    assert.ok(!seen.has(key), `重复路由：${key}`);
    seen.add(key);
    const file = path.join(skill, route.module);
    assert.ok(fs.existsSync(file), `${key} → 模块不存在：${route.module}`);
    const module = await import(pathToFileURL(file).href);
    assert.equal(typeof module[route.export], 'function', `${key} → 缺少导出 ${route.export}`);
  }
});
