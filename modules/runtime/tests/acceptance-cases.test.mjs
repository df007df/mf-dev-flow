import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acceptanceCaseCommand,
  acceptanceCasesPath,
  applyFeatureAcceptanceCases,
  freezeFeatureAcceptanceCases,
  readFeatureAcceptanceCases,
} from '../acceptance-cases.mjs';
import { acceptanceCaseCompletionProblems } from '../delivery/commands.mjs';

function write(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function rootFor(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-dev-flow-ac-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, '.mf-dev-flow/planning/feature-map.json', {
    schemaVersion: 2,
    features: [{ id: 'home-reading', title: '首页阅读' }],
  });
  return root;
}

function add(root, record, revision = 0, requestId = 'add') {
  return acceptanceCaseCommand(root, [
    'add',
    '--input', write(root, requestId + '.json', record),
    '--request-id', requestId,
    '--expected-revision', String(revision),
  ]);
}

test('feature AC records are versioned independently and delivery snapshots are immutable', t => {
  const root = rootFor(t);
  const record = {
    id: 'AC-HOME-001',
    featureId: 'home-reading',
    title: '入口可达',
    detail: '从首页点击时文阅读后，能进入阅读详情并可返回首页。',
    evidenceHints: ['端到端流程截图'],
  };
  const added = add(root, record);
  assert.equal(added.registryRevision, 1);
  assert.deepEqual(add(root, record), added);
  assert.equal(fs.existsSync(path.join(root, acceptanceCasesPath)), true);

  const first = freezeFeatureAcceptanceCases(root, ['home-reading'])['home-reading'];
  assert.equal(first.cases.length, 1);
  assert.equal(first.cases[0].detail, record.detail);
  const revised = acceptanceCaseCommand(root, [
    'revise',
    '--id', 'AC-HOME-001',
    '--input', write(root, 'revise.json', {
      detail: '从首页点击时文阅读后，进入详情、完成一次阅读并可返回首页。',
    }),
    '--request-id', 'revise',
    '--expected-revision', '1',
  ]);
  assert.equal(revised.registryRevision, 2);
  assert.equal(first.cases[0].detail, record.detail);
  const second = freezeFeatureAcceptanceCases(root, ['home-reading'])['home-reading'];
  assert.notEqual(second.fingerprint, first.fingerprint);
  assert.match(second.cases[0].detail, /完成一次阅读/);

  const stages = applyFeatureAcceptanceCases([
    {
      id: 'end_to_end_acceptance',
      acceptanceCriteria: [{ id: 'contract-e2e', title: '基础回归', detail: '流程可用' }],
    },
  ], first);
  assert.deepEqual(
    stages[0].acceptanceCriteria.map(item => item.id),
    ['contract-e2e', 'AC-HOME-001'],
  );
  assert.equal(stages[0].featureAcceptanceSnapshot.fingerprint, first.fingerprint);

  const withdrawn = acceptanceCaseCommand(root, [
    'withdraw',
    '--id', 'AC-HOME-001',
    '--reason', '由新版用例替换',
    '--request-id', 'withdraw',
    '--expected-revision', '2',
  ]);
  assert.equal(withdrawn.record.status, 'withdrawn');
  assert.deepEqual(freezeFeatureAcceptanceCases(root, ['home-reading'])['home-reading'].cases, []);
  assert.equal(readFeatureAcceptanceCases(root).records[0].history.length, 2);
});

test('feature AC rejects unknown features and exposes a separate completion axis for final acceptance', t => {
  const root = rootFor(t);
  assert.throws(() => add(root, {
    id: 'AC-UNKNOWN-001',
    featureId: 'missing',
    title: 'Unknown',
    detail: '不应写入。',
  }), /unknown feature/);

  const task = {
    stageDefinitions: [{
      id: 'end_to_end_acceptance',
      acceptanceCriteria: [{
        id: 'AC-HOME-002',
        title: '完整流程',
        detail: '完成后返回。',
        origin: 'feature-acceptance-case',
      }],
    }],
  };
  assert.deepEqual(
    acceptanceCaseCompletionProblems(task, { acceptanceCases: {} }),
    ['验收用例 AC-HOME-002 尚未记录结果'],
  );
  assert.deepEqual(
    acceptanceCaseCompletionProblems(task, {
      acceptanceCases: {
        'AC-HOME-002': { status: 'passed', evidence: ['evidence/e2e/home.png'] },
      },
    }),
    [],
  );
  assert.match(
    acceptanceCaseCompletionProblems(task, {
      acceptanceCases: {
        'AC-HOME-002': { status: 'failed', evidence: [] },
      },
    })[0],
    /failed/,
  );
});
