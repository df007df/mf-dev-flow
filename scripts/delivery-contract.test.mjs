import assert from "node:assert/strict";
import test from "node:test";
import {
  DELIVERY_CONTRACT,
  DELIVERY_FINAL_STAGE,
  DELIVERY_STAGES,
  MINIAPP_DELIVERY_CONTRACT,
  MINIAPP_DELIVERY_STAGES,
  additionalScreenshotInstruction,
  renderDeliveryBrief,
  stageAcceptanceInstruction,
  stageDocumentation,
  stageSummaryProblems,
  visualValidationInstruction,
} from "./delivery-contract.mjs";

test("交付阶段契约是顺序、终态、报告格式的唯一结构化来源", () => {
  assert.equal(DELIVERY_CONTRACT.taskPhase, "delivery");
  assert.equal(DELIVERY_FINAL_STAGE.id, DELIVERY_STAGES.at(-1).id);
  assert.ok(DELIVERY_STAGES.every((stage) => stage.ownerRoles.length && stage.reportFields.length));
  assert.ok(DELIVERY_STAGES.every((stage) => Array.isArray(stage.evidenceGates)));
  const alignment = DELIVERY_STAGES.find((stage) => stage.id === "prototype_alignment");
  const mock = DELIVERY_STAGES.find((stage) => stage.id === "api_mock");
  assert.ok(Array.isArray(alignment.acceptanceCriteria));
  assert.ok(Array.isArray(mock.acceptanceCriteria));
  assert.ok(stageDocumentation(alignment));
  assert.ok(stageDocumentation(mock));
  assert.equal(stageDocumentation(DELIVERY_STAGES[2]), null);
  assert.deepEqual(
    Object.keys(stageDocumentation(alignment)),
    ["description", "process", "outputs"],
  );
  assert.match(stageDocumentation(alignment).description, /逐区对齐/);
  assert.match(stageDocumentation(alignment).process.at(-1).detail, /直到所有业务区块均为 passed/);
  assert.match(stageDocumentation(alignment).outputs.at(-1).detail, /差异对照/);
  assert.match(stageDocumentation(mock).outputs.at(-1).detail, /完整 JSON/);
  assert.ok(alignment.evidenceGates.includes("visual_region_review"));
  assert.match(stageAcceptanceInstruction(alignment), /同状态固定截图对/);
  assert.match(stageAcceptanceInstruction(alignment), /全部业务区块逐区通过/);
  assert.match(stageAcceptanceInstruction(mock), /完整 HTTP\(S\) Mock URL/);
  assert.match(stageAcceptanceInstruction(mock), /完整 JSON 返回契约/);
  assert.equal(DELIVERY_CONTRACT.visualValidation.primaryScreenshotCount, 2);
  assert.deepEqual(
    DELIVERY_CONTRACT.visualValidation.screenshots.map((shot) => shot.role),
    ["reference", "result"],
  );
  assert.deepEqual(
    DELIVERY_CONTRACT.visualValidation.screenshots.map((shot) => shot.sourceSystemKind),
    ["prototype-run", "ui-client-project"],
  );
  assert.equal(DELIVERY_CONTRACT.additionalScreenshots.defaultState, "empty");
});

test("阶段 brief 仅展开当前阶段，并保留顺序、停点与续做规则", () => {
  const brief = renderDeliveryBrief({
    targetPhase: "api_mock",
    completedStageIds: ["prototype_alignment"],
  });
  assert.match(brief, /prototype_alignment✓/);
  assert.ok(!brief.includes(DELIVERY_STAGES[0].objective));
  assert.match(brief, /api_mock/);
  assert.doesNotMatch(brief, /technical_implementation/);
  assert.match(brief, /本次执行置为 `done`/);
  assert.match(brief, /创建新的执行尝试/);
  assert.match(renderDeliveryBrief({ targetPhase: "end_to_end_acceptance" }), /验证截图固定为 2 份/);
  assert.match(visualValidationInstruction(), /逐区识别审查.*不计入两份验证截图/);
  assert.match(renderDeliveryBrief({ targetPhase: "end_to_end_acceptance" }), /visual compare --region-report/);
  assert.match(renderDeliveryBrief({ targetPhase: "prototype_alignment" }), /验收内容：.*同状态固定截图对/);
  assert.match(renderDeliveryBrief({ targetPhase: "prototype_alignment" }), /阶段说明：.*逐区对齐/);
  assert.match(renderDeliveryBrief({ targetPhase: "prototype_alignment" }), /阶段过程：[\s\S]*修复后重新对比/);
  assert.match(renderDeliveryBrief({ targetPhase: "prototype_alignment" }), /阶段产出：[\s\S]*差异对照与逐区结论/);
  assert.match(
    renderDeliveryBrief({
      targetPhase: "api_mock",
      completedStageIds: ["prototype_alignment"],
    }),
    /验收内容：.*完整 JSON 返回契约/,
  );
  assert.match(
    renderDeliveryBrief({
      targetPhase: "api_mock",
      completedStageIds: ["prototype_alignment"],
    }),
    /阶段产出：[\s\S]*响应截图与完整 JSON/,
  );
  assert.match(visualValidationInstruction(), /来源系统标记/);
  assert.match(additionalScreenshotInstruction(), /不自动展示为其他截图/);
});

test("阶段摘要缺少契约字段时会被精确指出", () => {
  const problems = stageSummaryProblems(DELIVERY_STAGES[0], "结论：已完成；证据：截图");
  assert.deepEqual(problems, ["阶段报告缺少“变更：”字段", "阶段报告缺少“验证：”字段", "阶段报告缺少“风险/下一步：”字段"]);
});

test("小程序产品契约以四阶段替代 API / Mock，并把方案约束冻结在第二阶段", () => {
  assert.deepEqual(
    MINIAPP_DELIVERY_STAGES.map((stage) => stage.id),
    [
      "prototype_alignment",
      "technical_solution",
      "development",
      "end_to_end_acceptance",
    ],
  );
  assert.equal(MINIAPP_DELIVERY_CONTRACT.requiredDeliveryRoles.join(","), "ui-client");
  assert.ok(!MINIAPP_DELIVERY_STAGES.some((stage) => stage.id === "api_mock"));
  const solution = MINIAPP_DELIVERY_STAGES[1];
  assert.match(solution.title, /superpowers/);
  assert.match(stageDocumentation(solution).description, /不新增接口/);
  assert.match(stageDocumentation(solution).outputs.at(-1).title, /最多三个/);
  const brief = renderDeliveryBrief({
    targetPhase: "technical_solution",
    completedStageIds: ["prototype_alignment"],
    stageDefinitions: MINIAPP_DELIVERY_STAGES,
    contract: MINIAPP_DELIVERY_CONTRACT,
  });
  assert.match(brief, /technical_solution/);
  assert.doesNotMatch(brief, /api_mock/);
  assert.match(brief, /最多三个/);
});
