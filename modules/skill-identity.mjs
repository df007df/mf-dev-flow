export const SKILL_ID = "mf-dev-flow";
export const STORE_DIRECTORY = `.${SKILL_ID}`;
export const PRIVATE_STORE_DIRECTORY = `${STORE_DIRECTORY}-private`;
export const OBJECT_REF_PREFIX = `${SKILL_ID}:`;
export const CLI_FILE_NAME = `${SKILL_ID}.mjs`;
export const SKILL_INSTALL_DIRECTORY = `.codex/skills/${SKILL_ID}`;

export const ENVIRONMENT = Object.freeze({
  HOME: "MF_DEV_FLOW_HOME",
  PROJECT_ROOT: "MF_DEV_FLOW_PROJECT_ROOT",
  WORKSPACE_ROOT: "MF_DEV_FLOW_WORKSPACE_ROOT",
  CLI_PATH: "MF_DEV_FLOW_CLI_PATH",
  CODEX_GATE_STATE_DIRECTORY: "MF_DEV_FLOW_CODEX_GATE_STATE_DIR",
  CODEX_SESSION_ID: "MF_DEV_FLOW_CODEX_SESSION_ID",
  HOOK_HEALTH_DIRECTORY: "MF_DEV_FLOW_HOOK_HEALTH_DIR",
  DASHBOARD_URL: "MF_DEV_FLOW_DASHBOARD_URL",
});

export const storePath = (...segments) => [STORE_DIRECTORY, ...segments].join("/");
export const privateStorePath = (...segments) => [PRIVATE_STORE_DIRECTORY, ...segments].join("/");
export const exportFileName = ({ pending = false } = {}) =>
  `${SKILL_ID}-export${pending ? ".pending" : ""}.json`;
export const temporaryDirectoryName = purpose => `${SKILL_ID}-${purpose}`;
export const temporaryDirectoryPrefix = purpose => `${SKILL_ID}-${purpose}-`;
