import { SKILL_ID } from "../skill-identity.mjs";

export const MF_DEV_FLOW_VERSION = "1.1.0";

/** 稳定、离线可审计的技能发行元数据；发布时由维护者显式更新。 */
export function mfDevFlowVersion() {
  return {
    schemaVersion: 1,
    skill: SKILL_ID,
    version: MF_DEV_FLOW_VERSION,
    coordination: {
      eventSchemaVersion: 1,
      defaultPublisher: "disabled",
      localOutbox: "explicit-injection-only",
    },
  };
}

export function mfDevFlowLabel() {
  return `${mfDevFlowVersion().skill}@${MF_DEV_FLOW_VERSION}`;
}
