import assert from "node:assert/strict";
import test from "node:test";
import {
  featureAnalysisProblems,
  labelAssessmentHistory,
} from "../server/feature-analysis.js";

const assessed = () => ({
  id: "feature",
  priority: "P0",
  wave: "W0",
  priorityReason: "核心入口，维持优先级",
  waveReason: "无前置，补充首批",
  analysis: {
    prototype: "截图与路径推导",
    code: "实际项目仍为 Mock",
    systems: "外部只读参考",
    scope: "只实现入口",
    gaps: ["真实接入待确认"],
    sources: ["prototype", "code", "system"].map((kind) => ({
      kind,
      ref: `${kind}.md`,
      note: "本次核对依据",
    })),
  },
});

test("功能分析要求三类来源及 P/W 依据，旧地图不虚构默认值", () => {
  assert.deepEqual(featureAnalysisProblems({ id: "old" }), []);
  assert.deepEqual(featureAnalysisProblems(assessed()), []);
  const missing = assessed();
  missing.analysis.sources.pop();
  missing.waveReason = "";
  assert.ok(featureAnalysisProblems(missing).some((p) => p.includes("system")));
  assert.ok(
    featureAnalysisProblems(missing).some((p) => p.includes("waveReason")),
  );
});

test("标签历史记录维持与新增，连续评估不覆盖历史或接受伪造历史", () => {
  const feature = assessed();
  const first = labelAssessmentHistory(
    feature,
    { priority: "P0" },
    { at: "time1", runId: "run1" },
  );
  assert.deepEqual(first[0].from, { priority: "P0", wave: null });
  assert.deepEqual(first[0].to, { priority: "P0", wave: "W0" });
  const previous = { ...feature, labelHistory: first };
  assert.deepEqual(
    labelAssessmentHistory(feature, previous, { at: "time2", runId: "run2" }),
    first,
  );
  const changed = {
    ...feature,
    wave: "W1",
    waveReason: "前置变化，延后一批",
    labelHistory: [],
  };
  const next = labelAssessmentHistory(changed, previous, {
    at: "time3",
    runId: "run3",
  });
  assert.equal(next.length, 2);
  assert.deepEqual(next[0], first[0]);
  assert.equal(next[1].from.wave, "W0");
  assert.equal(first.length, 1);
});
