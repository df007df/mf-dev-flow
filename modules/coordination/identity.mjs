export const COORDINATION_IDENTITY_SCHEMA_VERSION = 1;

export function isCoordinationInstallationId(value) {
  return typeof value === "string" && value.length > 0;
}

/** identity 是本地 Outbox 的公开归属标识；这里不触碰文件系统。 */
export function isCoordinationIdentity(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return false;
  const prototype = Object.getPrototypeOf(identity);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.keys(identity).length === 2
    && Object.hasOwn(identity, "schemaVersion")
    && Object.hasOwn(identity, "installationId")
    && identity.schemaVersion === COORDINATION_IDENTITY_SCHEMA_VERSION
    && isCoordinationInstallationId(identity.installationId);
}
