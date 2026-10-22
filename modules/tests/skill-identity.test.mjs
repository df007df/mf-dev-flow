import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const identityFile = fileURLToPath(new URL("../skill-identity.mjs", import.meta.url));

test("central skill identity defines stable storage, object, CLI, and temporary namespaces", async () => {
  assert.equal(fs.existsSync(identityFile), true, "the skill identity module must exist");
  const identity = await import("../skill-identity.mjs");

  assert.equal(identity.SKILL_ID, "mf-dev-flow");
  assert.equal(identity.STORE_DIRECTORY, ".mf-dev-flow");
  assert.equal(identity.PRIVATE_STORE_DIRECTORY, ".mf-dev-flow-private");
  assert.equal(identity.OBJECT_REF_PREFIX, "mf-dev-flow:");
  assert.equal(identity.CLI_FILE_NAME, "mf-dev-flow.mjs");
  assert.equal(identity.exportFileName(), "mf-dev-flow-export.json");
  assert.equal(identity.exportFileName({ pending: true }), "mf-dev-flow-export.pending.json");
  assert.equal(identity.temporaryDirectoryName("codex-gate"), "mf-dev-flow-codex-gate");
  assert.equal(identity.temporaryDirectoryPrefix("prototype"), "mf-dev-flow-prototype-");
  assert.equal(identity.ENVIRONMENT.CODEX_GATE_STATE_DIRECTORY, "MF_DEV_FLOW_CODEX_GATE_STATE_DIR");
});

test("key runtime boundaries consume the shared skill identity", () => {
  const consumers = [
    "../kernel/object-ref.mjs",
    "../runtime/shared.mjs",
    "../prototype/client.mjs",
    "../workflow/route.mjs",
    "../../scripts/mf-dev-flow.mjs",
    "../../integrations/codex/hooks/policy-engine.mjs",
    "../../dashboard/server/workspace.js",
  ];
  for (const consumer of consumers) {
    const source = fs.readFileSync(fileURLToPath(new URL(consumer, import.meta.url)), "utf8");
    assert.match(source, /skill-identity\.mjs/, `${consumer} must consume skill-identity.mjs`);
  }
});
