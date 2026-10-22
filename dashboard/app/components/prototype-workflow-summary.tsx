import { stamp } from "../lib/format";

type WorkflowIdentity = Readonly<{
  id: string;
  version: string;
}>;

type EvidenceProfile = "runtime-only" | "source-and-runtime";
type WorkflowStatus = "in_progress" | "accepted" | "stale" | "blocked";
type CheckpointOutcome = "validated" | "gap" | "accepted";

type PrototypeWorkflowSummaryProps = Readonly<{
  process: WorkflowIdentity;
  adapter: WorkflowIdentity;
  evidenceProfile: EvidenceProfile;
  activeStageId: string | null;
  lastCheckpoint: Readonly<{
    outcome: CheckpointOutcome;
    at: string;
  }> | null;
  status: WorkflowStatus;
}>;

const evidenceLabels: Record<EvidenceProfile, string> = {
  "runtime-only": "运行态覆盖",
  "source-and-runtime": "源码与运行态覆盖",
};

const checkpointLabels: Record<CheckpointOutcome, string> = {
  validated: "已验证",
  gap: "发现缺口",
  accepted: "已验收",
};

const statusLabels: Record<WorkflowStatus, string> = {
  in_progress: "分析中",
  accepted: "已验收",
  stale: "需重新取证",
  blocked: "已阻塞",
};

const identifier = /^[a-z0-9][a-z0-9-]{0,79}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function identity(value: unknown): WorkflowIdentity | null {
  const item = record(value);
  const id = item?.id;
  const version = item?.version;
  if (typeof id !== "string" || !identifier.test(id)) return null;
  if (typeof version !== "number" || !Number.isSafeInteger(version)
    || version < 1 || version > 10000)
    return null;
  return { id, version: String(version) };
}

function stageId(value: unknown): string | null {
  return typeof value === "string" && identifier.test(value) ? value : null;
}

function checkpoint(value: unknown): PrototypeWorkflowSummaryProps["lastCheckpoint"] {
  const item = record(value);
  if (!item || !["validated", "gap", "accepted"].includes(String(item.outcome)))
    return null;
  if (typeof item.at !== "string" || Number.isNaN(Date.parse(item.at))) return null;
  return { outcome: item.outcome as CheckpointOutcome, at: item.at };
}

/**
 * Select the only workflow fields that the dashboard may render. Deliberately
 * omit locators, Agent data, hashes, sessions, evidence payloads and checkpoint
 * reasons: those can be sensitive or unbounded and belong in their own tools.
 */
export function prototypeWorkflowSummaryProps(
  workflow: unknown,
): PrototypeWorkflowSummaryProps | null {
  const item = record(workflow);
  const process = identity(item?.process);
  const adapter = identity(item?.adapter);
  const evidenceProfile = item?.evidenceProfile;
  const status = item?.status;
  if (!process || !adapter) return null;
  if (evidenceProfile !== "runtime-only" && evidenceProfile !== "source-and-runtime")
    return null;
  if (!Object.hasOwn(statusLabels, String(status))) return null;
  return {
    process,
    adapter,
    evidenceProfile,
    activeStageId: stageId(item?.activeStageId),
    lastCheckpoint: checkpoint(item?.lastCheckpoint),
    status: status as WorkflowStatus,
  };
}

export function PrototypeWorkflowSummary(props: PrototypeWorkflowSummaryProps) {
  const currentStage = props.activeStageId
    ?? (props.status === "accepted" ? "已验收" : "未登记");
  const recentCheckpoint = props.lastCheckpoint
    ? `${checkpointLabels[props.lastCheckpoint.outcome]} · ${stamp(props.lastCheckpoint.at)}`
    : "尚未检查";
  return (
    <section className="prototype-overview-card" aria-label="运行态分析状态">
      <h3>运行态分析状态</h3>
      <p className="muted">仅陈述已观察并归档的行为，不声明源码全覆盖。</p>
      <dl className="prototype-baseline">
        <div>
          <dt>流程</dt>
          <dd><code>{` ${props.process.id}@${props.process.version}`}</code></dd>
        </div>
        <div>
          <dt>适配器</dt>
          <dd><code>{` ${props.adapter.id}@${props.adapter.version}`}</code></dd>
        </div>
        <div>
          <dt>证据等级</dt>
          <dd>{` ${evidenceLabels[props.evidenceProfile]}`}</dd>
        </div>
        <div>
          <dt>当前阶段</dt>
          <dd><code>{` ${currentStage}`}</code></dd>
        </div>
        <div>
          <dt>最近检查点</dt>
          <dd>{` ${recentCheckpoint}`}</dd>
        </div>
        <div>
          <dt>分析状态</dt>
          <dd>{` ${statusLabels[props.status]}`}</dd>
        </div>
      </dl>
    </section>
  );
}
