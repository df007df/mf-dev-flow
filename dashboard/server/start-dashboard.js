import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { ENVIRONMENT, SKILL_ID, STORE_DIRECTORY } from "../../modules/skill-identity.mjs";

export const DASHBOARD_HOST = "127.0.0.1";
export const DASHBOARD_PORT = 4173;
export function isPortListening(port, host = DASHBOARD_HOST) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(1500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", (error) => {
      socket.destroy();
      error.code === "ECONNREFUSED" ? resolve(false) : reject(error);
    });
  });
}

export async function startDashboard({
  cwd,
  args = [],
  port = DASHBOARD_PORT,
}) {
  if ((args[0] === "dashboard" ? args.slice(1) : args).length)
    throw new Error(`看板固定使用 ${DASHBOARD_PORT} 端口，不支持额外参数。`);
  const url = `http://${DASHBOARD_HOST}:${port}`;
  if (await isPortListening(port)) {
    console.log(`${SKILL_ID} 观察台已在运行：${url}`);
    return { status: "already_running", url };
  }
  if (!fs.existsSync(path.join(cwd, STORE_DIRECTORY, "project.json")))
    throw new Error("尚未初始化；先运行 init。");
  const directory = fileURLToPath(new URL("../", import.meta.url));
  const next = path.join(directory, "node_modules/next/dist/bin/next");
  if (!fs.existsSync(next))
    throw new Error(`先执行 pnpm --dir ${directory} install。`);
  const child = spawn(
    process.execPath,
    [next, "dev", "--hostname", DASHBOARD_HOST, "--port", String(port)],
    {
      cwd: directory,
      stdio: "inherit",
      env: { ...process.env, [ENVIRONMENT.WORKSPACE_ROOT]: path.resolve(cwd) },
    },
  );
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child.once("exit", (code) => {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (code) process.exitCode = code;
  });
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  console.log(`${SKILL_ID} Next 观察台：${url}（按 Ctrl+C 停止）`);
  return { status: "started", url, child };
}
