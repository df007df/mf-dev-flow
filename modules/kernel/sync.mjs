// Kernel 双写与默认过程数据读取（M1 第二批）。
// - writeKernelRecords：校验后原子写入 .mf-dev-flow/tasks/；非法记录抛错（双写失败即缺陷，不静默）。
// - readHookObservations：镜像 Codex hook 状态文件约定（.codex/skills/mf-dev-flow/integrations/codex/hooks/policy-engine.mjs 的 stateFile），
//   只读消费；无状态=none、schema 不符=degraded，两者都不拒绝完成，只降级准确性（M2 §5）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { writeLocalKernelRecords } from "./local-file-sink.mjs";
import { ENVIRONMENT, temporaryDirectoryName } from "../skill-identity.mjs";

/** 由任务显式声明的阶段推断类型引用（不读 taskStageDefinitions 的回退值）：
 * stageDefinitions:[] = 新式无阶段契约 → generic-delivery；含 technical_solution → feature-development v2；
 * 其余声明 → v1；字段缺失 = 历史任务，按既有约定沿用旧四阶段契约 v1。 */
export function inferTaskTypeRef(task) {
  const declared = task?.stageDefinitions;
  if (Array.isArray(declared)) {
    if (!declared.length) return { id: "generic-delivery", version: 1 };
    if (declared.some(stage => stage.id === "technical_solution"))
      return { id: "feature-development", version: 2 };
    return { id: "feature-development", version: 1 };
  }
  return { id: "feature-development", version: 1 };
}

export function hookStateFile(projectRoot, sessionId) {
  return hookStateCandidates(projectRoot, sessionId)[0];
}

/** Codex 唯一状态目录；状态键为 sha256(root\0sessionId)。 */
export function hookStateCandidates(projectRoot, sessionId) {
  const key = crypto
    .createHash("sha256")
    .update(`${path.resolve(projectRoot)}\u0000${sessionId}`)
    .digest("hex");
  const directories = [
    process.env[ENVIRONMENT.CODEX_GATE_STATE_DIRECTORY] || path.join(os.tmpdir(), temporaryDirectoryName("codex-gate")),
  ];
  return [...new Set(directories.map(directory => path.join(directory, `${key}.json`)))];
}

/** 读取会话在任意宿主下被 hook 观测的写文件清单；since 为领取时间（ISO），只取其后观察。 */
export function readHookObservations({ projectRoot, sessionId, since = null }) {
  if (!sessionId) return { health: "none", files: [] };
  const normalize = value => String(value).replace(/^\.\//, "");
  const merged = new Set();
  let health = "none";
  for (const file of hookStateCandidates(projectRoot, sessionId)) {
    let raw;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") health = "degraded";
      continue;
    }
    try {
      const state = JSON.parse(raw);
      if (state?.schemaVersion !== 1 || !Array.isArray(state.files)) throw new Error("schema");
      health = "observed";
      for (const entry of state.files) {
        if (typeof entry?.path !== "string") continue;
        if (since && (!entry.observedAt || entry.observedAt < since)) continue;
        merged.add(normalize(entry.path));
      }
    } catch {
      health = "degraded";
    }
  }
  return { health, files: health === "degraded" ? [] : [...merged].sort() };
}

/** 校验并落盘 kernel 记录：tasks/<runId>.json + tasks/<runId>/<taskId>.json。 */
export function writeKernelRecords(args) {
  return writeLocalKernelRecords(args);
}
