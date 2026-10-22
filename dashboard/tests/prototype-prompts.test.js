import assert from "node:assert/strict";
import test from "node:test";
import { prototypeDocumentPrompts } from "../server/prototype-prompts.js";

test("两类原型模板包含稳定定位并区分回答与主动信息补充，不串分组", () => {
  const input = {
    features: [{ id: "a", title: "同名标题" }, { id: "b", title: "同名标题" }],
    task: { source: { prototypeRun: "proto-1", prototypeVersion: "v1" } },
    location: "prototype/index.html",
    questions: [{ id: "a.question", featureId: "a", status: "resolved" }],
    questionsVerified: true,
  };
  const before = JSON.stringify(input);
  const [a, b] = prototypeDocumentPrompts(input);
  for (const item of [a, b]) {
    for (const prompt of [item.answer, item.supplement]) {
      for (const source of [input.location, "v1", "proto-1", item.groupId, ".mf-dev-flow/prototype/原型图流程.md", "sourceEntries"])
        assert.ok(prompt.includes(source));
    }
    assert.match(item.answer, /问题回答内容：<[^>]+>/);
    assert.match(item.supplement, /信息补充内容：<[^>]+>/);
    assert.doesNotMatch(item.supplement, /问题回答内容|问题补充|完整开发功能点/);
  }
  assert.ok(a.answer.includes("a.question（已解决）"));
  assert.ok(!b.answer.includes("a.question"));
  assert.ok(b.answer.includes("当前分组未登记问题"));
  assert.equal(JSON.stringify(input), before);
  const unverified = prototypeDocumentPrompts({ ...input, questionsVerified: false });
  assert.ok(unverified[0].answer.includes("尚未通过校验"));
  assert.ok(!unverified[0].answer.includes("a.question"));
});
