#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { STORE_DIRECTORY } from '../modules/skill-identity.mjs';
const [command, subcommand] = process.argv.slice(2);
const commandError = error => {
  process.stderr.write(JSON.stringify({ error: String(error?.message ?? error).slice(0, 700) }) + '\n');
  process.exitCode = 1;
};
const coordinationStatusOptions = args => {
  let limit;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') continue;
    if (argument === '--limit') {
      const value = args[++index];
      if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(value ?? '')) {
        throw new Error('--limit 必须是 1 到 50 的整数');
      }
      limit = Number(value);
      continue;
    }
    throw new Error('coordination status 仅支持 --json 与 --limit <1-50>');
  }
  return limit === undefined ? {} : { limit };
};
if (command === 'version') {
  try {
    if (process.argv.slice(3).some(argument => argument !== '--json')) {
      throw new Error('version 仅支持 --json');
    }
    const { mfDevFlowVersion } = await import('../modules/workflow/version.mjs');
    process.stdout.write(JSON.stringify(mfDevFlowVersion()) + '\n');
  } catch (error) { commandError(error); }
} else if (command === 'coordination') {
  try {
    if (subcommand !== 'status') throw new Error('coordination 仅支持 status');
    const { coordinationStatus } = await import('../modules/coordination/status.mjs');
    process.stdout.write(JSON.stringify(coordinationStatus({ projectRoot: process.cwd(), ...coordinationStatusOptions(process.argv.slice(4)) })) + '\n');
  } catch (error) { commandError(error); }
} else if (command === 'work' && subcommand === 'types') {
  const { taskTypes, validationProfileCatalog } = await import('../modules/delivery/types.mjs');
  process.stdout.write(JSON.stringify({ schemaVersion: 1, types: taskTypes(), validationProfiles: validationProfileCatalog() }) + '\n');
} else if (command === 'flow' || !command || ['help', '--help'].includes(command)) {
  const { flowCommand } = await import('../modules/workflow/route.mjs');
  try { process.stdout.write(JSON.stringify(flowCommand(command === 'flow' ? process.argv.slice(3) : ['list'])) + '\n'); }
  catch (error) { process.stderr.write(JSON.stringify({ error: error.message.slice(0, 700) }) + '\n'); process.exitCode = 1; }
} else if (command === 'prototype' && subcommand === 'capabilities') {
  const { prototypeCapabilities } = await import('../modules/prototype/capabilities.mjs');
  process.stdout.write(JSON.stringify(prototypeCapabilities()) + '\n');
} else if (command === 'prototype' && subcommand === 'analysis-requirements') {
  const { main } = await import('../modules/prototype/cli.mjs');
  main(process.argv.slice(3));
} else if (command === 'prototype' && subcommand === 'index') {
  const { main } = await import('./prototype-index.mjs'); main(process.argv.slice(4));
} else if (command === 'prototype' && !['map', 'sync-tasks'].includes(subcommand) && !process.argv.includes('--from-run') && !process.argv.includes('--run')) {
  if (!fs.existsSync(path.join(process.cwd(), STORE_DIRECTORY, 'prototype', 'catalog.sqlite')) && ['status', 'summary'].includes(subcommand)) {
    try {
      let analysisRequirements = null;
      try {
        const { readAnalysisRequirements, requirementsBrief } = await import('../modules/prototype/core/analysis-requirements.mjs');
        analysisRequirements = requirementsBrief(readAnalysisRequirements(process.cwd()));
      } catch (error) {
        // Keep empty status available in stripped bootstraps that deliberately
        // omit parser, SQLite, and analysis modules. Malformed AR data still
        // throws normally in a complete skill.
        if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
      }
      process.stdout.write(JSON.stringify({
        schemaVersion: 2,
        items: [{
          type: 'result',
          id: 'result',
          status: 'not_initialized',
          legacyArchivePresent: fs.existsSync(path.join(process.cwd(), STORE_DIRECTORY, 'prototype')),
          ...(analysisRequirements ? { analysisRequirements } : {}),
          next: 'prototype init --input <file> --request-id <ID> --json',
        }],
      }) + '\n');
    }
    catch (error) { process.stderr.write(JSON.stringify({ error: error.message.slice(0, 700) }) + '\n'); process.exitCode = 1; }
  } else {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 22 || major === 22 && minor < 18) { process.stderr.write('原型索引需要 Node >=22.18\n'); process.exitCode = 1; }
    else { const { main } = await import('../modules/prototype/cli.mjs'); main(process.argv.slice(3)); }
  }
} else await import('../dashboard/server/cli-runtime.js');
