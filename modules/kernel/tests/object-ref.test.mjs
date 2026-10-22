import assert from "node:assert/strict";
import test from "node:test";

import {
  GRAPH_REF_PREFIXES,
  OBJECT_KINDS,
  formatObjectRef,
  graphRefKind,
  objectRefOrNull,
  objectRefFor,
  parseObjectRef,
  toGraphRef,
} from "../object-ref.mjs";

test("Object Ref：V1 全部公开 kind 可格式化并解析回原生键", () => {
  const expected = {
    project: "project",
    "project-card": "consumer-app",
    "prototype-group": "reading group",
    "prototype-entry": "entry/first",
    "prototype-source": "prototype/index.html",
    "prd-source": "prd α",
    "prd-batch": "batch/2026-09",
    "system-card": "system-main",
    "feature-group": "reading",
    feature: "reader-core",
    run: "delivery/20260910-094549Z",
    task: "delivery/20260910-094549Z/theme-fix",
    release: "release-1",
    "code-file": "src/pages/阅读/index.tsx",
  };

  assert.deepEqual([...OBJECT_KINDS].sort(), Object.keys(expected).sort());
  for (const [kind, key] of Object.entries(expected)) {
    const ref = formatObjectRef({ kind, key });
    assert.match(ref, new RegExp(`^mf-dev-flow:${kind}:`));
    assert.equal(/[^\x00-\x7f]/.test(ref), false, `${kind} 引用必须是 ASCII`);
    assert.deepEqual(parseObjectRef(ref), {
      schemaVersion: 1,
      kind,
      key,
      ref,
    });
  }
});

test("Object Ref：分段构造会规范转义，解析拒绝非规范或危险输入", () => {
  const ref = objectRefFor("task", "delivery", "20260910-094549Z", "主题 修复");
  assert.equal(ref, "mf-dev-flow:task:delivery/20260910-094549Z/%E4%B8%BB%E9%A2%98%20%E4%BF%AE%E5%A4%8D");
  assert.equal(parseObjectRef(ref)?.key, "delivery/20260910-094549Z/主题 修复");

  for (const value of [
    "mf-dev-flow:unknown:x",
    "mf-dev-flow:feature:",
    "mf-dev-flow:feature:reader core",
    "mf-dev-flow:feature:reader%2fcore",
    "mf-dev-flow:feature:reader%",
    "mf-dev-flow:feature:reader//core",
    "mf-dev-flow:feature:%2E%2E/core",
    "mf-dev-flow:feature:reader\ncore",
  ]) assert.equal(parseObjectRef(value), null, value);

  assert.throws(() => formatObjectRef({ kind: "unknown", key: "x" }), /未知 Object Ref kind/);
  assert.throws(() => objectRefFor("feature", ".."), /非法 Object Ref 键分段/);
  assert.throws(() => objectRefFor("feature", "reader\ncore"), /非法 Object Ref 键分段/);
  assert.equal(objectRefOrNull("feature", "reader core"), "mf-dev-flow:feature:reader%20core");
  assert.equal(objectRefOrNull("feature", ".."), null);
  assert.equal(objectRefOrNull("unknown", "x"), null);
});

test("Object Ref：Graph Ref 只映射图兼容子集，并包含 feature-group", () => {
  assert.ok(GRAPH_REF_PREFIXES.includes("feature-group"));
  assert.equal(toGraphRef("mf-dev-flow:feature:reader-core"), "feature:reader-core");
  assert.equal(toGraphRef("mf-dev-flow:feature-group:reading"), "feature-group:reading");
  assert.equal(toGraphRef("mf-dev-flow:prototype-entry:e1"), "prototype:e1");
  assert.equal(toGraphRef("mf-dev-flow:prototype-source:prototype/index.html"), "source:prototype/index.html");
  assert.equal(toGraphRef("mf-dev-flow:run:delivery/r1"), null);
  assert.equal(graphRefKind("feature-group:reading"), "feature-group");
  assert.equal(graphRefKind("prototype:e1"), "prototype");
  assert.equal(graphRefKind("run:r1"), null);
});
