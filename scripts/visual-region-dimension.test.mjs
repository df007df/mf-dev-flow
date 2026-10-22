// 逐区报告双维度与独立校验命令回归：validate-report 不依赖开发运行/截图归档。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const skill = fileURLToPath(new URL("../", import.meta.url));
const CLI = path.join(skill, "scripts/mf-dev-flow.mjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-region-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function cli(root, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch { /* caller asserts */ }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

const checks = (overrides = {}) => [
  { kind: "presence", status: "passed", detail: "两侧都存在" },
  { kind: "order", status: "passed", detail: "顺序一致" },
  { kind: "layout", status: "passed", detail: "布局一致" },
  { kind: "copy", status: "passed", detail: "文案一致", sourceVerified: true, ...(overrides.copy ?? {}) },
  { kind: "visual", status: "passed", detail: "配色字号一致", ...(overrides.visual ?? {}) },
  { kind: "interaction", status: "passed", detail: "已实测", ...(overrides.interaction ?? {}) },
];

const baseReport = (extra = {}) => ({
  schemaVersion: 1,
  analyzer: { provider: "test-provider", model: "test-model" },
  capture: {
    comparable: true,
    baseline: { device: "iphone-14", scale: "3x", canvas: "390x844" },
    reference: { state: "home-default", source: "prototype" },
    result: { state: "home-default", source: "ui-client" },
  },
  excludedRegions: [{ id: "status-bar", reason: "原生状态栏" }],
  regions: [{
    id: "greeting", order: 1, scope: "business",
    reference: { summary: "问候卡" }, result: { summary: "问候卡" },
    checks: checks(extra.regionOverrides ?? {}),
  }],
  ...extra.fields,
});

const reportFile = (root, name, report) => {
  fs.writeFileSync(path.join(root, name), JSON.stringify(report));
  return name;
};

test("validate-report 缺省 dimension 视为 vision 并输出完整结论", (t) => {
  const root = fixture(t);
  const file = reportFile(root, "r.json", baseReport());
  const result = cli(root, ["visual", "validate-report", "--region-report", file]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.command, "visual validate-report");
  assert.equal(result.json.dimension, "vision");
  assert.equal(result.json.status, "passed");
  assert.equal(result.json.state, "home-default");
  assert.equal(result.json.regions[0].domEvidence, undefined);
});

test("validate-report dom 维度要求两侧 domEvidence，缺失即拒绝", (t) => {
  const root = fixture(t);
  const domReport = baseReport({
    fields: {
      dimension: "dom",
      regions: [{
        id: "greeting", order: 1, scope: "business",
        reference: { summary: "div.hero" }, result: { summary: "view.hero" },
        domEvidence: {
          reference: { locator: "body > div.hero", excerpt: "今天也要加油读" },
          result: { locator: "view.hero", excerpt: "今天也要加油读" },
        },
        checks: checks({ visual: { status: "not_applicable", detail: "DOM 维度不判断像素外观" } }),
      }],
    },
  });
  const good = cli(root, ["visual", "validate-report", "--region-report", reportFile(root, "good.json", domReport)]);
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.json.dimension, "dom");
  assert.equal(good.json.regions[0].domEvidence.reference.locator, "body > div.hero");
  const missing = JSON.parse(JSON.stringify(domReport));
  delete missing.regions[0].domEvidence;
  const bad = cli(root, ["visual", "validate-report", "--region-report", reportFile(root, "bad.json", missing)]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /domEvidence\.reference\.locator/);
  const half = JSON.parse(JSON.stringify(domReport));
  delete half.regions[0].domEvidence.result.excerpt;
  const halfBad = cli(root, ["visual", "validate-report", "--region-report", reportFile(root, "half.json", half)]);
  assert.equal(halfBad.status, 1);
  assert.match(halfBad.stderr, /domEvidence\.result\.excerpt/);
});

test("validate-report 拒绝非法 dimension 与 failed/uncertain 结论（退出码 1）", (t) => {
  const root = fixture(t);
  const bogus = cli(root, ["visual", "validate-report", "--region-report", reportFile(root, "bogus.json", baseReport({ fields: { dimension: "pixel-diff" } }))]);
  assert.equal(bogus.status, 1);
  assert.match(bogus.stderr, /dimension 只能是 vision/);
  const uncertain = baseReport({
    fields: {
      regions: [{
        id: "greeting", order: 1, scope: "business",
        reference: { summary: "问候卡" }, result: { summary: "问候卡" },
        checks: checks({ interaction: { status: "uncertain", detail: "未触发绑定核验" } }),
      }],
    },
  });
  const result = cli(root, ["visual", "validate-report", "--region-report", reportFile(root, "unc.json", uncertain)]);
  assert.equal(result.status, 1);
  assert.equal(result.json.status, "uncertain");
});

test("validate-report 状态一致性：缺省从报告推断，冲突拒绝", (t) => {
  const root = fixture(t);
  const mismatch = JSON.parse(JSON.stringify(baseReport()));
  mismatch.capture.result.state = "home-empty";
  const inferred = cli(root, ["visual", "validate-report", "--region-report", reportFile(root, "mm.json", mismatch)]);
  assert.equal(inferred.status, 1);
  assert.match(inferred.stderr, /同为状态|不一致/);
  const explicit = cli(root, ["visual", "validate-report", "--region-report", reportFile(root, "r.json", baseReport()), "--state", "other"]);
  assert.equal(explicit.status, 1);
  assert.match(explicit.stderr, /必须同为状态 other/);
});
