import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadDeliveryProcess,
  parseDeliveryProcessSpecifier,
} from "../modules/delivery/processes.mjs";

const digest = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const V2_ROOT = new URL("../modules/delivery/processes/miniapp-product/v2/", import.meta.url);

const processRoot = (directory, manifest, agents = {}) => {
  const root = path.join(directory, "demo", "v1");
  fs.mkdirSync(path.join(root, "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, "process.json"), JSON.stringify(manifest));
  for (const [file, content] of Object.entries(agents))
    fs.writeFileSync(path.join(root, "agents", file), content);
  return directory;
};

const manifest = (agentFile = "agents/align.md") => ({
  schemaVersion: 1,
  id: "demo",
  version: 1,
  title: "测试流程",
  stages: [
    {
      id: "alignment",
      title: "对齐",
      objective: "核验原型",
      ownerRoles: ["ui-client"],
      agentFile,
      reportFields: ["结论"],
      evidenceGates: [],
      terminal: true,
    },
  ],
});

test("加载器冻结阶段 agent 指令与摘要，防止源文件变更改写新快照", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-process-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  processRoot(root, manifest(), { "align.md": "只核验原型差异。\n" });

  const loaded = loadDeliveryProcess({ id: "demo", version: 1, root });

  assert.equal(loaded.id, "demo");
  assert.equal(loaded.version, 1);
  assert.match(loaded.sha256, /^[a-f0-9]{64}$/);
  assert.equal(loaded.stages[0].agent.id, "alignment");
  assert.equal(loaded.stages[0].agent.instructions, "只核验原型差异。\n");
  assert.match(loaded.stages[0].agent.sha256, /^[a-f0-9]{64}$/);

  fs.writeFileSync(path.join(root, "demo", "v1", "agents", "align.md"), "被修改的指令。\n");
  assert.equal(loaded.stages[0].agent.instructions, "只核验原型差异。\n");
});

test("加载器拒绝缺少 agent 文件和逃逸流程目录的引用", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-process-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  processRoot(root, manifest());

  assert.throws(
    () => loadDeliveryProcess({ id: "demo", version: 1, root }),
    /agent 文件不存在/,
  );

  const escaped = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-process-"));
  t.after(() => fs.rmSync(escaped, { recursive: true, force: true }));
  processRoot(escaped, manifest("../outside.md"));
  assert.throws(
    () => loadDeliveryProcess({ id: "demo", version: 1, root: escaped }),
    /agentFile 必须位于流程目录内/,
  );
});

test("阶段同名 agent profile 支持既有阶段 ID 中的下划线", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-process-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = manifest();
  source.stages[0].id = "technical_solution";
  processRoot(root, source, { "align.md": "编写可实施方案。\n" });

  const loaded = loadDeliveryProcess({ id: "demo", version: 1, root });

  assert.equal(loaded.stages[0].agent.id, "technical_solution");
});

test("流程选择器只接受显式的 id@版本 格式", () => {
  assert.deepEqual(parseDeliveryProcessSpecifier("miniapp-product@12"), {
    id: "miniapp-product",
    version: 12,
  });
  assert.throws(
    () => parseDeliveryProcessSpecifier("miniapp-product"),
    /id@版本/,
  );
});

test("v3 流程加载且保留阶段结构；v2 公开脱敏版本不可变", (t) => {
  const v3 = loadDeliveryProcess({ id: "miniapp-product", version: 3 });
  assert.equal(v3.version, 3);
  assert.deepEqual(v3.stages.map((s) => s.id),
    ["prototype_alignment", "technical_solution", "development", "end_to_end_acceptance"]);
  const tech = v3.stages.find((s) => s.id === "technical_solution");
  assert.ok(tech.evidenceGates.includes("technical_requirement_confirmed"));
  assert.ok(tech.evidenceGates.includes("dev_plan_evidence"));
  assert.equal(tech.agent.instructions.includes("superpowers:brainstorming"), true);
  assert.equal(v3.stages.at(-1).terminal, true);

  const expected = {
    "process.json": "469db15cd5b8a0335dba3bb710b5f43d1e3bca92fbf79e4982ee7ef8d8dbb458",
    "agents/development.md": "60897f1d96c20ea75341a05cac2c8af0002390be704dd54453053f3eb43cf9e5",
    "agents/e2e-acceptance.md": "1d490d8abf3f07b7822815b5ef5a58242e9bbc752da453b7f33ed6b8e430ce29",
    "agents/prototype-alignment.md": "c52ffdc8ea6c111d0d2337fd06d5ed61c480df869a8f033ffa7dbc148d422030",
    "agents/technical-solution.md": "55d8270a1418e605b2343ac356cecc8cadd187c45dc61ff4f6b36ec5c10942c0",
  };
  for (const [rel, hash] of Object.entries(expected))
    assert.equal(digest(new URL(rel, V2_ROOT)), hash, `v2 ${rel} 被修改；已发布版本不可变`);
});

test("默认 feature-map 运行解析到 @3，显式 @2 仍可选", () => {
  const parsed = parseDeliveryProcessSpecifier("miniapp-product@3");
  assert.deepEqual(parsed, { id: "miniapp-product", version: 3 });
  assert.deepEqual(parseDeliveryProcessSpecifier("miniapp-product@2"), { id: "miniapp-product", version: 2 });
  assert.equal(loadDeliveryProcess(parseDeliveryProcessSpecifier("miniapp-product@2")).version, 2);
});

test("web-product@1 提供普通 Web 项目的连续交付与真实截图门禁", () => {
  const web = loadDeliveryProcess({ id: "web-product", version: 1 });

  assert.equal(web.title, "Web 产品三阶段交付流程");
  assert.deepEqual(
    web.stages.map((stage) => stage.id),
    ["solution_design", "development", "end_to_end_acceptance"],
  );
  assert.deepEqual(
    web.stages.at(-1).evidenceGates,
    ["e2e_screenshot_evidence", "risk_ledger"],
  );
  assert.equal(
    web.stages.some((stage) =>
      stage.evidenceGates.includes("miniapp_ui_evidence"),
    ),
    false,
  );
});
