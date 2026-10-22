import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prototypeDevelopmentProblems, readPrototypeRevision } from "../modules/planning/impact.mjs";
import { fixture } from "../modules/prototype/tests/fixtures.mjs";

const cli = fileURLToPath(new URL("mf-dev-flow.mjs", import.meta.url));
const write = (root, relative, text) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const run = (root, ...args) =>
  spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });

function gateFixture(t) {
  // 干净的已验收原型状态（全量分析完成并 accept），sourceProblems 为空，
  // 否则原型证据门禁会把“未验收/分析要求变化”等噪音混进被测结果，proposed technical 的放行断言不可达。
  const f = fixture(t, false, true);
  f.complete();
  const status = run(f.root, "prototype", "status", "--json");
  assert.equal(status.status, 0, status.stderr);
  let revision = JSON.parse(status.stdout).items[0].semanticRevision;
  // T1-a 同源：requirement add/update 强校验 --expected-revision；此后链式用上一条命令返回的修订号。
  const accepted = run(f.root, "prototype", "accept", "--request-id", "accept", "--expected-revision", String(revision));
  assert.equal(accepted.status, 0, accepted.stderr);
  revision = JSON.parse(accepted.stdout).items[0].semanticRevision;
  const add = (id, kind, recordStatus) => {
    const file = write(f.root, `${id}.json`, JSON.stringify({ id, actor: "用户", origin: "user", text: id, groupId: "home", ...(kind ? { kind } : {}), ...(recordStatus ? { status: recordStatus } : {}) }));
    const out = run(f.root, "prototype", "requirement", "add", "--input", file, "--request-id", `add-${id}`, "--expected-revision", String(revision));
    assert.equal(out.status, 0, out.stderr);
    revision = JSON.parse(out.stdout).items[0].semanticRevision;
  };
  const map = (requirements) => ({
    schemaVersion: 2,
    prototypeBaseline: readPrototypeRevision(path.join(f.root, ".mf-dev-flow")),
    groups: [{ id: "g", title: "组", rank: 10 }],
    features: [{ id: "leaf", parentId: "g", title: "叶子", rank: 10, status: "not_started", sourceRequirementIds: requirements }],
  });
  return { root: f.root, add, map };
}

test("proposed product 阻断；proposed technical 放行；withdrawn 任意 kind 阻断；确认后放行", (t) => {
  const fx = gateFixture(t);
  const store = path.join(fx.root, ".mf-dev-flow");

  fx.add("req-prod", "product", undefined);
  assert.ok(prototypeDevelopmentProblems(store, fx.map(["req-prod"]), ["leaf"])
    .some((p) => p.includes("req-prod")));

  fx.add("req-tech", "technical", undefined);
  assert.deepEqual(prototypeDevelopmentProblems(store, fx.map(["req-tech"]), ["leaf"]), []);

  fx.add("req-wd", "technical", "withdrawn");
  assert.ok(prototypeDevelopmentProblems(store, fx.map(["req-wd"]), ["leaf"])
    .some((p) => p.includes("req-wd")));

  // 缺省无 kind → product，proposed 阻断
  fx.add("req-plain", undefined, undefined);
  assert.ok(prototypeDevelopmentProblems(store, fx.map(["req-plain"]), ["leaf"])
    .some((p) => p.includes("req-plain")));
});
