// Delivery command family — gate machinery (delivery gate / for-stop sessions).
// Extracted from runtime/delivery.mjs (structural split; behavior unchanged).

import path from "node:path";

import fs from "node:fs";

import { GATE_SCHEMA_VERSION } from "./helpers.mjs";

import { activeDeliveryWorkPlans, runningSessionTaskCandidates } from "./work.mjs";

import { DELIVERY_STAGES, isGenericDelivery } from "../../../dashboard/server/delivery-contract.js";

import {
  ACTIVE_DELIVERY_STATUSES,
  currentFile,
  deliveryInput,
  ensureProject,
  executionFile,
  fail,
  listRuns,
  now,
  readJson,
  runDir,
  scopeCovers,
  stageRecord,
  terminal,
  valueFor,
  workPlanFile,
} from "../shared.mjs";

export function gateError(message) {
  fail(`gate 输入无效：${message}`);
}

export function parseGateSince() {
  const value = valueFor("--since");
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) gateError("--since 必须是 ISO 8601 时间");
  return { value, time };
}

export function parseGateSession() {
  const value = valueFor("--session");
  if (value === undefined) return null;
  if (typeof value !== "string" || !value.trim())
    gateError("--session 必须是非空会话 ID");
  return value.trim();
}

export function readSessionFiles(since) {
  const manifestFile = valueFor("--session-files");
  if (!manifestFile) return [];
  let manifest;
  try {
    manifest = readJson(manifestFile);
  } catch {
    gateError(`无法读取 --session-files：${manifestFile}`);
  }
  if (!Array.isArray(manifest) && manifest?.schemaVersion !== 1)
    gateError("session-files.schemaVersion 必须为 1");
  const files = Array.isArray(manifest) ? manifest : manifest.files;
  if (!Array.isArray(files)) gateError("session-files.files 必须是数组");
  const result = [];
  for (const entry of files) {
    const raw = typeof entry === "string" ? { path: entry } : entry;
    if (!raw || typeof raw.path !== "string" || !raw.path.trim())
      gateError("session-files.files 的每项必须包含 path");
    const observedAt = raw.observedAt ?? null;
    if (
      observedAt !== null &&
      (typeof observedAt !== "string" || Number.isNaN(Date.parse(observedAt)))
    )
      gateError(`文件 ${raw.path} 的 observedAt 必须是 ISO 8601 时间`);
    if (since && observedAt && Date.parse(observedAt) < since.time) continue;
    result.push({ path: raw.path, observedAt });
  }
  return result;
}

export function sessionPathMatchesScope(filePath, scope) {
  const candidates = [filePath];
  if (path.isAbsolute(filePath))
    candidates.push(path.relative(process.cwd(), filePath));
  return candidates.some((candidate) => scopeCovers(scope, candidate));
}

export function commandArgument(value) {
  return JSON.stringify(value);
}

export function suggestedWorkFinish(run, task, execution, files) {
  const agent = execution?.agent ?? "<agent-id>";
  const changedFiles = files.join(",");
  return [
    "node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs work finish",
    `--run ${commandArgument(run.id)}`,
    `--task ${commandArgument(task.id)}`,
    `--agent ${commandArgument(agent)}`,
    "--status done",
    '--summary "<本任务结果>"',
    `--files ${commandArgument(changedFiles)}`,
    '--tests "<实际测试命令与结果>"',
  ].join(" ");
}

export function gateReason(code, message, taskId = null) {
  return { code, message, taskId };
}

export function activeRunForGate() {
  if (!fs.existsSync(currentFile())) return null;
  const current = readJson(currentFile());
  if (!current.active?.type || !current.active?.id) return null;
  const file = path.join(
    runDir(current.active.type, current.active.id),
    "run.json",
  );
  if (!fs.existsSync(file)) return null;
  return {
    type: current.active.type,
    id: current.active.id,
    dir: path.dirname(file),
    run: readJson(file),
  };
}

export function gateStages(input) {
  return (isGenericDelivery(input) ? input.stages ?? [] : input.stages ?? DELIVERY_STAGES).map((definition) => {
    const stage = stageRecord(input, definition.id);
    return {
      id: definition.id,
      title: definition.title,
      status: stage?.status ?? "missing",
      updatedAt: stage?.updatedAt ?? null,
    };
  });
}

function executionCoversSessionFiles(execution, files) {
  if (!terminal(execution?.status)) return false;
  const recorded = execution.changedFiles ?? [];
  return files.every((file) =>
    recorded.some((entry) => sessionPathMatchesScope(file.path, entry)),
  );
}

// `current.json` is a workspace-wide pointer and may belong to a different
// agent. Stop is instead anchored to the session's own completed task record
// whenever that record names every changed file. A direct session match wins;
// the terminal-record fallback preserves older records that predate session
// binding while still requiring explicit changedFiles evidence.
export function runForStopSessionEvidence(sessionFiles, sessionId) {
  if (!sessionFiles.length || !sessionId) return null;
  const candidates = [];
  for (const run of listRuns().filter((item) => item.type === "delivery")) {
    if (!fs.existsSync(workPlanFile(run))) continue;
    const plan = readJson(workPlanFile(run));
    for (const task of plan.tasks ?? []) {
      if (
        !sessionFiles.every((file) =>
          (task.writes ?? []).some((scope) =>
            sessionPathMatchesScope(file.path, scope),
          ),
        )
      )
        continue;
      const file = executionFile(run, task.id);
      if (!fs.existsSync(file)) continue;
      const execution = readJson(file);
      if (!executionCoversSessionFiles(execution, sessionFiles)) continue;
      const attemptMatchesSession = (execution.attempts ?? []).some(
        (attempt) => attempt.sessionId === sessionId,
      );
      candidates.push({
        run,
        task,
        execution,
        sessionMatch:
          sessionId &&
          (execution.sessionId === sessionId || attemptMatchesSession),
        updatedAt: Date.parse(execution.updatedAt ?? "") || 0,
      });
    }
  }
  candidates.sort(
    (left, right) =>
      Number(right.sessionMatch) - Number(left.sessionMatch) ||
      right.updatedAt - left.updatedAt,
  );
  return candidates[0] ?? null;
}

export function runForStopSessionTask(sessionFiles, sessionId) {
  return stopSessionTaskResolution(sessionFiles, sessionId).candidate;
}

export function stopSessionTaskResolution(sessionFiles, sessionId) {
  if (!sessionFiles.length || !sessionId)
    return { candidate: null, ambiguous: false };
  const candidates = runningSessionTaskCandidates(
    sessionId,
    activeDeliveryWorkPlans(),
  ).filter((candidate) =>
    sessionFiles.every((file) =>
      (candidate.task.writes ?? []).some((scope) =>
        sessionPathMatchesScope(file.path, scope),
      ),
    ),
  );
  const runIds = new Set(candidates.map((candidate) => candidate.run.id));
  // 同运行多任务共享父会话是受支持的并发模型；交由 gate 按 task scope 分账。
  return {
    candidate: candidates.length === 1 || runIds.size === 1 ? candidates[0] : null,
    ambiguous: runIds.size > 1,
  };
}

export function gateForStop() {
  ensureProject();
  if (!process.argv.includes("--for-stop"))
    gateError("gate 目前只支持 --for-stop");
  const since = parseGateSince();
  const sessionId = parseGateSession();
  const sessionFiles = readSessionFiles(since);
  const sessionEvidence = runForStopSessionEvidence(sessionFiles, sessionId);
  const sessionTaskResolution = stopSessionTaskResolution(sessionFiles, sessionId);
  const sessionTask = sessionTaskResolution?.candidate ?? null;
  const activeRun = activeRunForGate();
  const run = sessionEvidence?.run ?? sessionTask?.run ?? activeRun;
  const input = run?.type === "delivery" ? deliveryInput(run) : null;
  const base = {
    schemaVersion: GATE_SCHEMA_VERSION,
    generatedAt: now(),
    mode: "for-stop",
    session: {
      id: sessionId,
      since: since?.value ?? null,
      files: sessionFiles,
      codeChanged: sessionFiles.length > 0,
    },
    activeRun: activeRun
      ? { type: activeRun.type, id: activeRun.id, status: activeRun.run.status }
      : null,
    resolvedRun: sessionEvidence
      ? {
          type: run.type,
          id: run.id,
          taskId: sessionEvidence.task.id,
          source: sessionEvidence.sessionMatch
            ? "session-task-execution"
            : "terminal-task-record",
        }
      : null,
    stages: input ? gateStages(input) : [],
    verdict: "pass",
    reasons: [],
    auditWarnings: [],
    nextCommand: null,
  };
  const pushAuditWarning = (code, message, taskId = null, nextCommand = null) => {
    base.auditWarnings.push({ ...gateReason(code, message, taskId), nextCommand });
  };

  if (!sessionFiles.length) {
    base.reasons.push(
      gateReason("NO_SESSION_CODE_CHANGES", "本会话没有需要登记的代码改动。"),
    );
    console.log(JSON.stringify(base));
    return;
  }
  if (!sessionEvidence && sessionTaskResolution?.ambiguous) {
    base.verdict = "need_followup";
    base.reasons.push(
      gateReason(
        "AMBIGUOUS_SESSION_BINDING",
        "当前会话匹配多个进行中的任务；先为并行任务使用不同会话，再结束本次会话。",
      ),
    );
    base.nextCommand = "node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs work conflict-status --run <运行ID>";
    console.log(JSON.stringify(base));
    return;
  }
  if (
    !run ||
    run.type !== "delivery" ||
    !ACTIVE_DELIVERY_STATUSES.has(run.run.status) &&
      !sessionEvidence
  ) {
    base.reasons.push(
      gateReason(
        "NO_ACTIVE_IN_PROGRESS_DELIVERY",
        "没有处于进行中的 delivery 运行，无需强制回写。",
      ),
    );
    console.log(JSON.stringify(base));
    return;
  }
  if (!input && !sessionEvidence) {
    base.verdict = "need_followup";
    base.reasons.push(
      gateReason(
        "DELIVERY_INPUT_MISSING",
        "进行中的 delivery 运行缺少 delivery-input.json，无法确认阶段状态。",
      ),
    );
    base.nextCommand = `node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs run context --id ${commandArgument(run.id)}`;
    console.log(JSON.stringify(base));
    return;
  }

  const plan = fs.existsSync(workPlanFile(run))
    ? readJson(workPlanFile(run))
    : { tasks: [] };
  const unmatched = [];
  // 运行内任务可共享写入范围，因此 Stop 门禁按“是否已有终态任务记录该改动”分账，
  // 不要求每个范围重叠的任务都重复登记同一文件。
  for (const file of sessionFiles) {
    const matching = plan.tasks
      .filter((task) =>
        task.writes?.some((scope) => sessionPathMatchesScope(file.path, scope)),
      )
      .map((task) => {
        const executionPath = executionFile(run, task.id);
        return {
          task,
          execution: fs.existsSync(executionPath) ? readJson(executionPath) : null,
        };
      });
    if (!matching.length) {
      unmatched.push(file.path);
      continue;
    }
    const finishedRecords = matching
      .filter(({ execution }) => terminal(execution?.status))
      .filter(({ execution }) =>
        (execution.changedFiles ?? []).some((recorded) =>
          sessionPathMatchesScope(file.path, recorded),
        ),
      );
    if (finishedRecords.length) {
      finishedRecords.sort(
        (left, right) =>
          (Date.parse(right.execution.updatedAt ?? "") || 0) -
          (Date.parse(left.execution.updatedAt ?? "") || 0),
      );
      const { task, execution } = finishedRecords[0];
      const observedAt = file.observedAt ? Date.parse(file.observedAt) : null;
      const executionUpdatedAt = execution.updatedAt
        ? Date.parse(execution.updatedAt)
        : Number.NaN;
      if (
        observedAt &&
        (Number.isNaN(executionUpdatedAt) || executionUpdatedAt < observedAt)
      ) {
        pushAuditWarning(
          "TASK_EXECUTION_STALE",
          `任务 ${task.id} 的最后回写早于本会话最后一次改动。`,
          task.id,
          suggestedWorkFinish(run, task, execution, [file.path]),
        );
      }
      continue;
    }
    const openRecord = matching.find(({ execution }) => !terminal(execution?.status));
    const selected = openRecord ?? matching[0];
    if (openRecord) {
      base.reasons.push(
        gateReason(
          "TASK_EXECUTION_NOT_FINISHED",
          `任务 ${selected.task.id} 的执行记录尚未以 work finish 写入终态。`,
          selected.task.id,
        ),
      );
      base.nextCommand ??= suggestedWorkFinish(
        run,
        selected.task,
        selected.execution,
        [file.path],
      );
      continue;
    }
    pushAuditWarning(
      "SESSION_FILE_NOT_RECORDED",
      `会话改动没有被运行 ${run.id} 的终态任务记录：${file.path}`,
      selected.task.id,
      suggestedWorkFinish(run, selected.task, selected.execution, [file.path]),
    );
  }
  if (unmatched.length) {
    pushAuditWarning(
      "SESSION_FILE_OUTSIDE_TASK_SCOPE",
      `会话改动未匹配当前 work-plan 的写入范围：${unmatched.join("、")}`,
      null,
      `node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs run context --id ${commandArgument(run.id)}`,
    );
  }

  if (base.reasons.length) {
    base.verdict = "need_followup";
  } else if (base.auditWarnings.length) {
    base.reasons.push(
      gateReason(
        "AUDIT_WARNINGS_PRESENT",
        `有 ${base.auditWarnings.length} 条文件登记审计提醒；默认不阻塞，主 agent 复核后处理。`,
      ),
    );
  } else {
    base.reasons.push(
      gateReason(
        "TASK_EXECUTION_CURRENT",
        "会话改动已由匹配任务的终态执行记录登记。",
      ),
    );
  }
  console.log(JSON.stringify(base));
}
