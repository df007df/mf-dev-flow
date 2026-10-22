import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  composePrototypeWorkflow,
  loadPrototypeAdapter,
  loadPrototypeProcess,
  parsePrototypeSpecifier,
} from "../processes.mjs";

const processRoot = fileURLToPath(new URL("../processes", import.meta.url));
const adapterRoot = fileURLToPath(new URL("../adapters", import.meta.url));

function copiedWebRuntimeAdapterRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prototype-adapter-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(adapterRoot, "web-runtime"), path.join(root, "web-runtime"), { recursive: true });
  return root;
}

function copiedWechatSimulatorAdapterRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prototype-wechat-adapter-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(
    path.join(adapterRoot, "wechat-miniapp-runtime"),
    path.join(root, "wechat-miniapp-runtime"),
    { recursive: true },
  );
  return root;
}

function copiedIosAppAdapterRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prototype-ios-adapter-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(
    path.join(adapterRoot, "ios-app-runtime"),
    path.join(root, "ios-app-runtime"),
    { recursive: true },
  );
  return root;
}

function copiedRuntimeAnalysisProcessRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prototype-process-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(processRoot, "runtime-analysis"), path.join(root, "runtime-analysis"), { recursive: true });
  return root;
}

function assertExternalFileSymlinkIsRejected(t, { root, file, external, expected }) {
  const backup = `${file}.before-symlink`;
  fs.renameSync(file, backup);
  try {
    fs.symlinkSync(external, file, "file");
  } catch (error) {
    fs.renameSync(backup, file);
    t.skip(`symlink creation is unavailable on this platform: ${error?.code ?? "unknown error"}`);
    return;
  }

  try {
    assert.throws(
      () => loadPrototypeProcess({ id: "runtime-analysis", version: 1, root }),
      expected,
    );
  } finally {
    fs.rmSync(file, { force: true });
    fs.renameSync(backup, file);
  }
}

test("runtime process and web adapter snapshot every Agent file before init", () => {
  const process = loadPrototypeProcess({ id: "runtime-analysis", version: 1 });
  const adapter = loadPrototypeAdapter({ id: "web-runtime", version: 1 });
  const workflow = composePrototypeWorkflow({ process, adapter, evidenceProfile: "runtime-only" });
  assert.equal(workflow.initialStageId, "scope-snapshot");
  assert.deepEqual(workflow.stages.map((stage) => stage.id), [
    "scope-snapshot", "structure-model", "runtime-observe", "audit-accept",
  ]);
  assert.match(workflow.stages.find((stage) => stage.id === "runtime-observe").agent.instructions, /网页/);
  assert.equal(workflow.adapter.capabilities.sourceDiscovery, false);
});

test("loader rejects path traversal, unsupported evidence profiles and illegal transitions", (t) => {
  const process = loadPrototypeProcess({ id: "runtime-analysis", version: 1 });
  const adapter = loadPrototypeAdapter({ id: "web-runtime", version: 1 });
  assert.throws(() => parsePrototypeSpecifier("web-runtime"), /id@version/);
  assert.throws(() => loadPrototypeAdapter({ id: "../web-runtime", version: 1 }), /ID/);
  assert.throws(() => composePrototypeWorkflow({ process, adapter, evidenceProfile: "all" }), /evidenceProfile/);
  assert.throws(() => composePrototypeWorkflow({ process, adapter, evidenceProfile: "source-and-runtime" }), /sourceDiscovery/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bad-prototype-process-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "bad/v1/agents"), { recursive: true });
  fs.writeFileSync(path.join(root, "bad/v1/process.json"), JSON.stringify({
    schemaVersion: 1, id: "bad", version: 1, initialStageId: "first",
    stages: [{ id: "first", agentFile: "agents/first.md", transitions: ["missing"] }],
  }));
  fs.writeFileSync(path.join(root, "bad/v1/agents/first.md"), "first");
  assert.throws(() => loadPrototypeProcess({ id: "bad", version: 1, root }), /transition/);
});

test("workflow retains the loaded Agent snapshot when its copied source changes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prototype-process-snapshot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(processRoot, "runtime-analysis"), path.join(root, "runtime-analysis"), { recursive: true });
  const process = loadPrototypeProcess({ id: "runtime-analysis", version: 1, root });
  const adapter = loadPrototypeAdapter({ id: "web-runtime", version: 1 });
  const workflow = composePrototypeWorkflow({ process, adapter, evidenceProfile: "runtime-only" });
  const stage = workflow.stages.find((item) => item.id === "runtime-observe");
  const original = { instructions: stage.agent.instructions, sha256: stage.agent.sha256 };
  fs.appendFileSync(path.join(root, "runtime-analysis/v1/agents/runtime-observe.md"), "\nchanged after load\n");
  const reloaded = loadPrototypeProcess({ id: "runtime-analysis", version: 1, root });
  assert.equal(stage.agent.id, "runtime-observe");
  assert.equal(stage.agent.sha256, original.sha256);
  assert.equal(stage.agent.instructions, original.instructions);
  assert.match(stage.agent.overlayInstructions, /网页/);
  assert.match(stage.agent.overlaySha256, /^[a-f0-9]{64}$/);
  assert.notEqual(reloaded.stages.find((item) => item.id === "runtime-observe").agent.sha256, original.sha256);
});

test("loader rejects a version directory symlink that escapes its approved root", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prototype-process-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "prototype-process-outside-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "escape"), { recursive: true });
  fs.mkdirSync(path.join(outside, "v1", "agents"), { recursive: true });
  fs.writeFileSync(path.join(outside, "v1", "process.json"), JSON.stringify({
    schemaVersion: 1,
    id: "escape",
    version: 1,
    initialStageId: "first",
    stages: [{ id: "first", agentFile: "agents/first.md", commands: ["init"], transitions: [] }],
  }));
  fs.writeFileSync(path.join(outside, "v1", "agents", "first.md"), "first");
  try {
    fs.symlinkSync(path.join(outside, "v1"), path.join(root, "escape", "v1"), "dir");
  } catch (error) {
    t.skip(`symlink creation is unavailable on this platform: ${error?.code ?? "unknown error"}`);
    return;
  }
  assert.throws(
    () => loadPrototypeProcess({ id: "escape", version: 1, root }),
    /目录必须位于根目录内/,
  );
});

test("loader rejects a process manifest symlink that exits its selected version directory", (t) => {
  const root = copiedRuntimeAnalysisProcessRoot(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "prototype-process-manifest-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const file = path.join(root, "runtime-analysis", "v1", "process.json");
  const external = path.join(outside, "process.json");
  fs.copyFileSync(file, external);

  assertExternalFileSymlinkIsRejected(t, {
    root,
    file,
    external,
    expected: /process\.json 必须位于版本目录内/,
  });
});

test("loader rejects a generic Agent symlink that exits its selected version directory", (t) => {
  const root = copiedRuntimeAnalysisProcessRoot(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "prototype-process-agent-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const file = path.join(root, "runtime-analysis", "v1", "agents", "scope-snapshot.md");
  const external = path.join(outside, "scope-snapshot.md");
  fs.copyFileSync(file, external);

  assertExternalFileSymlinkIsRejected(t, {
    root,
    file,
    external,
    expected: /阶段 scope-snapshot\.agentFile 必须位于版本目录内/,
  });
});

test("web-runtime@1 rejects malformed critical capability or overlay contracts", (t) => {
  const cases = [
    ["enables static source discovery", (manifest) => { manifest.capabilities.sourceDiscovery = true; }],
    ["drops a runtime source mode", (manifest) => { manifest.capabilities.sourceModes = ["url"]; }],
    ["removes selector navigation", (manifest) => { manifest.capabilities.navigation.selector = false; }],
    ["removes PNG screenshots", (manifest) => { manifest.capabilities.screenshots.png = false; }],
    ["removes trace archival", (manifest) => { manifest.capabilities.archival.trace = false; }],
    ["adds another stage overlay", (manifest) => { manifest.overlays.push({ stageId: "audit-accept", agentFile: "agents/runtime-observe.md" }); }],
    ["changes the allowed overlay stage", (manifest) => { manifest.overlays[0].stageId = "audit-accept"; }],
    ["changes the allowed overlay Agent file", (manifest, root) => {
      const directory = path.join(root, "web-runtime", "v1", "agents");
      fs.copyFileSync(path.join(directory, "runtime-observe.md"), path.join(directory, "alternate.md"));
      manifest.overlays[0].agentFile = "agents/alternate.md";
    }],
  ];

  for (const [description, mutate] of cases) {
    const root = copiedWebRuntimeAdapterRoot(t);
    const file = path.join(root, "web-runtime", "v1", "adapter.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    mutate(manifest, root);
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(
      () => loadPrototypeAdapter({ id: "web-runtime", version: 1, root }),
      /web-runtime@1/,
      description,
    );
  }
});

test("wechat-miniapp-runtime@1 rejects malformed runtime capability or overlay contracts", (t) => {
  const cases = [
    ["adds another source mode", (manifest) => {
      manifest.sourceModes.push("url");
    }],
    ["enables static source discovery", (manifest) => {
      manifest.capabilities.sourceDiscovery = true;
    }],
    ["changes the required operation list", (manifest) => {
      manifest.capabilities.operations.push("cliAutomation");
    }],
    ["changes PNG evidence", (manifest) => {
      manifest.capabilities.evidence.screenshot = "jpeg";
    }],
    ["disables trace evidence", (manifest) => {
      manifest.capabilities.evidence.trace = false;
    }],
    ["adds another capability", (manifest) => {
      manifest.capabilities.cliAutomation = true;
    }],
    ["changes the allowed overlay stage", (manifest) => {
      manifest.overlays[0].stageId = "audit-accept";
    }],
    ["changes the allowed overlay Agent file", (manifest, root) => {
      const directory = path.join(root, "wechat-miniapp-runtime", "v1", "agents");
      fs.copyFileSync(path.join(directory, "runtime-observe.md"), path.join(directory, "alternate.md"));
      manifest.overlays[0].agentFile = "agents/alternate.md";
    }],
    ["adds another overlay", (manifest) => {
      manifest.overlays.push({ stageId: "structure-model", agentFile: "agents/runtime-observe.md" });
    }],
  ];

  for (const [description, mutate] of cases) {
    const root = copiedWechatSimulatorAdapterRoot(t);
    const file = path.join(root, "wechat-miniapp-runtime", "v1", "adapter.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    mutate(manifest, root);
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(
      () => loadPrototypeAdapter({ id: "wechat-miniapp-runtime", version: 1, root }),
      /wechat-miniapp-runtime@1/,
      description,
    );
  }
});

test("wechat simulator overlay composes only into runtime-observe", () => {
  const adapter = loadPrototypeAdapter({ id: "wechat-miniapp-runtime", version: 1 });
  const workflow = composePrototypeWorkflow({
    process: loadPrototypeProcess({ id: "runtime-analysis", version: 1 }),
    adapter,
    evidenceProfile: "runtime-only",
  });
  assert.equal(adapter.capabilities.sourceDiscovery, false);
  assert.deepEqual(adapter.capabilities.operations, [
    "pageStack", "selectorAction", "simulatorScreenshot", "traceArchive", "compileRefresh",
  ]);
  assert.match(workflow.stages.find((stage) => stage.id === "runtime-observe").agent.instructions, /页面栈/);
  assert.doesNotMatch(workflow.stages.find((stage) => stage.id === "structure-model").agent.instructions, /页面栈/);
});

test("wechat simulator adapter rejects a foreign overlay stage and a version-root escape at load time", (t) => {
  const contractRoot = copiedWechatSimulatorAdapterRoot(t);
  const contractFile = path.join(contractRoot, "wechat-miniapp-runtime", "v1", "adapter.json");
  const contract = JSON.parse(fs.readFileSync(contractFile, "utf8"));
  contract.overlays[0].stageId = "not-a-process-stage";
  fs.writeFileSync(contractFile, JSON.stringify(contract));
  assert.throws(
    () => loadPrototypeAdapter({ id: "wechat-miniapp-runtime", version: 1, root: contractRoot }),
    /wechat-miniapp-runtime@1/,
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prototype-wechat-adapter-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "prototype-wechat-adapter-outside-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "wechat-miniapp-runtime"), { recursive: true });
  fs.cpSync(
    path.join(adapterRoot, "wechat-miniapp-runtime", "v1"),
    path.join(outside, "v1"),
    { recursive: true },
  );
  try {
    fs.symlinkSync(path.join(outside, "v1"), path.join(root, "wechat-miniapp-runtime", "v1"), "dir");
  } catch (error) {
    t.skip(`symlink creation is unavailable on this platform: ${error?.code ?? "unknown error"}`);
    return;
  }
  assert.throws(
    () => loadPrototypeAdapter({ id: "wechat-miniapp-runtime", version: 1, root }),
    /目录必须位于根目录内/,
  );
});

test("ios-app-runtime@1 rejects malformed runtime capability or overlay contracts", (t) => {
  const cases = [
    ["adds another source mode", (manifest) => {
      manifest.sourceModes.push("url");
    }],
    ["enables static source discovery", (manifest) => {
      manifest.capabilities.sourceDiscovery = true;
    }],
    ["changes the required operation list", (manifest) => {
      manifest.capabilities.operations.push("cliAutomation");
    }],
    ["changes PNG evidence", (manifest) => {
      manifest.capabilities.evidence.screenshot = "jpeg";
    }],
    ["disables trace evidence", (manifest) => {
      manifest.capabilities.evidence.trace = false;
    }],
    ["adds another capability", (manifest) => {
      manifest.capabilities.cliAutomation = true;
    }],
    ["changes the allowed overlay stage", (manifest) => {
      manifest.overlays[0].stageId = "audit-accept";
    }],
    ["changes the allowed overlay Agent file", (manifest, root) => {
      const directory = path.join(root, "ios-app-runtime", "v1", "agents");
      fs.copyFileSync(path.join(directory, "runtime-observe.md"), path.join(directory, "alternate.md"));
      manifest.overlays[0].agentFile = "agents/alternate.md";
    }],
    ["adds another overlay", (manifest) => {
      manifest.overlays.push({ stageId: "structure-model", agentFile: "agents/runtime-observe.md" });
    }],
  ];

  for (const [description, mutate] of cases) {
    const root = copiedIosAppAdapterRoot(t);
    const file = path.join(root, "ios-app-runtime", "v1", "adapter.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    mutate(manifest, root);
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(
      () => loadPrototypeAdapter({ id: "ios-app-runtime", version: 1, root }),
      /ios-app-runtime@1/,
      description,
    );
  }
});

test("ios simulator overlay composes only into runtime-observe", () => {
  const adapter = loadPrototypeAdapter({ id: "ios-app-runtime", version: 1 });
  const workflow = composePrototypeWorkflow({
    process: loadPrototypeProcess({ id: "runtime-analysis", version: 1 }),
    adapter,
    evidenceProfile: "runtime-only",
  });
  assert.equal(adapter.capabilities.sourceDiscovery, false);
  assert.deepEqual(adapter.capabilities.operations, [
    "screenState", "elementAction", "simulatorScreenshot", "traceArchive", "appLaunch",
  ]);
  assert.match(workflow.stages.find((stage) => stage.id === "runtime-observe").agent.instructions, /屏幕状态/);
  assert.doesNotMatch(workflow.stages.find((stage) => stage.id === "structure-model").agent.instructions, /屏幕状态/);
});
