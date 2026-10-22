import fs from "node:fs";
import path from "node:path";
import { ENVIRONMENT, STORE_DIRECTORY } from "../../modules/skill-identity.mjs";

export function workspaceRoot() {
  if (process.env[ENVIRONMENT.WORKSPACE_ROOT])
    return path.resolve(process.env[ENVIRONMENT.WORKSPACE_ROOT]);
  let directory = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(directory, STORE_DIRECTORY, "project.json")))
      return directory;
    const parent = path.dirname(directory);
    if (parent === directory)
      throw new Error(
        `找不到 ${STORE_DIRECTORY}/project.json；请设置 ${ENVIRONMENT.WORKSPACE_ROOT}。`,
      );
    directory = parent;
  }
}
// 工作区由环境或上行目录在运行时决定，不能作为构建期文件追踪的静态根。
export const workspaceStore = () => path.join(/* turbopackIgnore: true */ workspaceRoot(), STORE_DIRECTORY);

export function archivedFile(store, relative) {
  try {
    if (!relative || relative.includes("\0")) return null;
    const root = fs.realpathSync(store);
    const candidate = path.resolve(root, relative);
    if (!candidate.startsWith(root + path.sep)) return null;
    const file = fs.realpathSync(candidate);
    return file.startsWith(root + path.sep) && fs.statSync(file).isFile()
      ? file
      : null;
  } catch {
    return null;
  }
}
