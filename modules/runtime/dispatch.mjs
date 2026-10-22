import { registry } from '../workflow/route.mjs';
export async function dispatchRuntime(args = process.argv.slice(2)) {
  const [command, subcommand] = args;
  if (command === 'dashboard') {
    const { startDashboard } = await import('../../dashboard/server/start-dashboard.js');
    return startDashboard({ cwd: process.cwd(), args });
  }
  const route = registry.commandRoutes.find(r => r.command === command && (!r.subcommand || r.subcommand === subcommand));
  if (!route) throw new Error('Unknown command; mf-dev-flow flow list --json');
  const module = await import(new URL(`../../${route.module}`, import.meta.url));
  return module[route.export]();
}
