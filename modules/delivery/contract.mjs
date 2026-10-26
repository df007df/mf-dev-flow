/**
 * Generic task structure, historical product-delivery contract, and the
 * current mini-program product-delivery contract.
 *
 * Keep historical stage names, order, ownership, evidence gates, checkpoint policy and
 * the agent-facing reporting prompt here. Consumers should import this file
 * or invoke `work delivery-brief`; they must not copy the phase list.
 */
// Historical product-delivery contract. Existing runs keep these requirements;
// it must not be rewritten when the default product flow changes.
export const DELIVERY_CONTRACT = {
  schemaVersion: 2,
  version: 4,
  id: "product-delivery",
  title: "产品任务连续交付契约",
  taskPhase: "delivery",
  closedStatuses: ["confirmed", "done", "not_applicable"],
  statuses: [
    "pending",
    "in_progress",
    "confirmed",
    "blocked",
    "not_applicable",
    "done",
  ],
  reportFiles: [
    {
      file: "plan.md",
      sections: ["实施切片", "技术方案与实施决策"],
      label: "开发计划",
    },
    {
      file: "implementation.md",
      sections: ["关键技术方案", "实际改动与行为", "未完成项和风险"],
      label: "实现记录",
    },
    {
      file: "verification.md",
      sections: ["测试执行记录", "逻辑复核与原型对照", "截图证据与偏差处理"],
      label: "测试与原型回归",
    },
  ],
  visualValidation: {
    title: "逐区视觉验收截图对",
    primaryScreenshotCount: 2,
    screenshots: [
      {
        role: "reference",
        title: "参考图",
        source: "prototype",
        sourceSystemKind: "prototype-run",
        requirement: "必须来自关联原型运行的 screenshots/，用于说明期望状态。",
      },
      {
        role: "result",
        title: "结果图",
        source: "ui-client",
        sourceSystemKind: "ui-client-project",
        requirement:
          "必须来自本次交付运行中绑定 ui-client 项目的实际界面，用于说明实现结果。",
      },
    ],
    derivedArtifact: {
      role: "region_review",
      title: "逐区识别审查",
      requirement:
        "由图像分析分别识别参考图与结果图的从上到下区块，再按语义、状态和布局逐区匹配；审查记录是这对主截图的派生证据，不计入两份验证截图。",
    },
  },
  additionalScreenshots: {
    title: "其他归档截图",
    defaultState: "empty",
    requirement:
      "固定验证截图对、接口 Mock 响应、模拟器取证和逐区识别审查均通过各自证据记录追溯，不自动展示为其他截图。只有异常、偏差或额外状态需要单独说明时，才显式登记补充截图。",
  },
  stages: [
    {
      id: "prototype_alignment",
      title: "原型对齐（逐区 UI 与交互）",
      ownerRoles: ["ui-client"],
      objective: "在实际 UI 项目复刻原型的页面、样式、交互、状态与展示字段。",
      documentation: {
        description:
          "以同一业务状态的原型图与真实 UI 截图逐区对齐，持续修复差异，直到所有业务区块通过。",
        process: [
          {
            id: "pair-screenshots",
            title: "建立一一对应的截图对",
            detail:
              "为每个待验收业务状态归档一张原型参考图和一张真实 UI 结果图；小程序结果图必须来自微信开发者工具 simulator_screenshot。",
          },
          {
            id: "review-regions",
            title: "按区块识别并比对差异",
            detail:
              "从上到下核对每个业务区块的存在性、顺序、布局、文案、视觉和交互，明确记录 failed 或 uncertain 的差异。",
          },
          {
            id: "repair-and-repeat",
            title: "修复后重新对比",
            detail:
              "依据差异修复 UI，重新采集同状态截图并逐区审查；循环执行，直到所有业务区块均为 passed。",
          },
        ],
        outputs: [
          {
            id: "paired-screenshots",
            title: "原型图 / UI 图一一对应",
            detail:
              "每个业务状态输出一组固定截图对，页面中并排展示原型图与 UI 图，并保留状态、复现动作和来源。",
          },
          {
            id: "difference-comparisons",
            title: "差异对照与逐区结论",
            detail:
              "发现差异时，在同一截图对旁展示差异对照和逐区审查结论；已修复项须由新的截图对与 passed 结论替代，不能只写文字说明。",
          },
        ],
      },
      acceptanceCriteria: [
        {
          id: "same-state-screenshot-pair",
          title: "同状态固定截图对",
          detail:
            "必须归档一张关联原型的参考截图，以及一张绑定 ui-client 项目实际产出的结果截图；两图须是同一业务状态。小程序项目的结果图必须来自微信开发者工具 simulator_screenshot，不能以 H5、接口页面或原型演示图替代。",
        },
        {
          id: "all-business-regions-passed",
          title: "全部业务区块逐区通过",
          detail:
            "先从上到下识别两图的业务区块，再逐块核对存在性、顺序、布局、文案、视觉与交互；所有业务区块均为 passed 才可确认。仅原生状态栏、宿主胶囊、Home Indicator 与原型演示工具可排除，业务底部导航必须保留。",
        },
      ],
      evidenceGates: [
        "miniapp_ui_evidence",
        "visual_validation_pair",
        "visual_region_review",
      ],
      reportFields: ["结论", "证据", "变更", "验证", "风险/下一步"],
    },
    {
      id: "api_mock",
      title: "接口 Mock（契约、字段与可替换响应）",
      ownerRoles: ["api-provider"],
      objective:
        "建立可替换的服务端 Mock 契约，客户端通过适配层消费而不在页面散落造数。",
      documentation: {
        description:
          "为客户端确认可调用、可替换且字段完整的 Mock API 契约，并把实际响应作为可审阅产出归档。",
        process: [
          {
            id: "define-call",
            title: "确定可调用的 Mock 请求",
            detail:
              "明确请求方法、完整 HTTP(S) Mock URL、预期 HTTP 状态码与复现动作，并在实际调用中核验。",
          },
          {
            id: "freeze-response",
            title: "冻结完整响应数据",
            detail:
              "保存完整 JSON 响应，而非局部字段或页面造数；由完整 JSON 自动生成字段路径和类型定义。",
          },
          {
            id: "capture-response",
            title: "归档响应并供客户端对照",
            detail:
              "归档实际响应截图、请求上下文与完整 JSON，确认客户端只经适配层消费该契约。",
          },
        ],
        outputs: [
          {
            id: "mock-call-contract",
            title: "Mock 调用契约",
            detail:
              "输出请求方法、完整 HTTP(S) URL、HTTP 状态码和复现动作。",
          },
          {
            id: "mock-response-evidence",
            title: "响应截图与完整 JSON",
            detail:
              "输出实际响应截图、完整 JSON 数据及由其生成的字段路径与类型定义；看板展开后可直接审阅。",
          },
        ],
      },
      acceptanceCriteria: [
        {
          id: "callable-mock-url",
          title: "可调用的 Mock API URL",
          detail:
            "必须登记实际请求方法、完整 HTTP(S) Mock URL、HTTP 状态码与复现动作，并归档该请求的实际响应截图。仅写接口名称、相对路径或代码片段不构成验收。",
        },
        {
          id: "complete-json-contract",
          title: "完整 JSON 返回契约",
          detail:
            "必须归档并展示该 Mock 响应的完整 JSON 数据；系统从完整响应生成字段路径与类型定义。确认前不得只提供局部字段、伪代码或页面中的散落造数。",
        },
      ],
      evidenceGates: ["api_mock_evidence"],
      reportFields: ["结论", "证据", "变更", "验证", "风险/下一步"],
    },
    {
      id: "technical_implementation",
      title: "技术实现（方案、真实后端与功能 e2e）",
      ownerRoles: ["ui-client", "api-provider"],
      objective: "确认技术边界并完成真实后端、客户端接通和功能级 e2e。",
      evidenceGates: [],
      reportFields: ["结论", "证据", "变更", "验证", "风险/下一步"],
    },
    {
      id: "end_to_end_acceptance",
      title: "全链路测试（真实 UI 与后端验收）",
      ownerRoles: ["ui-client"],
      objective: "在真实 UI 与后端上验收，完成同状态截图逐区审查及长期真源回写。",
      evidenceGates: [
        "miniapp_ui_evidence",
        "visual_validation_pair",
        "visual_region_review",
      ],
      reportFields: ["结论", "证据", "变更", "验证", "风险/下一步"],
      terminal: true,
    },
  ],
};

export const DELIVERY_STAGES = DELIVERY_CONTRACT.stages;
export const GENERIC_DELIVERY_CONTRACT = {
  id: "generic-task",
  version: 1,
  title: "通用任务",
  stages: [],
  reportFiles: [
    { file: "plan.md", label: "开发计划", sections: ["开发任务输入"] },
    { file: "implementation.md", label: "实时记录", sections: [] },
    { file: "verification.md", label: "测试与回归", sections: [] },
  ],
};

// Default contract for product leaves delivered only in the WeChat mini-program.
// It deliberately has no api-provider role or API/Mock stage: callers reuse
// confirmed existing interfaces and keep newly required client-only state local.
export const MINIAPP_DELIVERY_CONTRACT = {
  schemaVersion: 1,
  version: 1,
  id: "miniapp-product-delivery",
  title: "小程序产品任务连续交付契约",
  taskPhase: "delivery",
  requiredDeliveryRoles: ["ui-client"],
  closedStatuses: DELIVERY_CONTRACT.closedStatuses,
  statuses: DELIVERY_CONTRACT.statuses,
  reportFiles: DELIVERY_CONTRACT.reportFiles,
  stages: [
    {
      ...DELIVERY_CONTRACT.stages[0],
      id: "prototype_alignment",
      title: "原型对齐（逐区 UI 与交互）",
      ownerRoles: ["ui-client"],
    },
    {
      id: "technical_solution",
      title: "技术方案（superpowers）",
      ownerRoles: ["ui-client"],
      objective:
        "用 superpowers 形成可实施的小程序技术方案，固定既有接口复用边界与本地状态策略。",
      documentation: {
        description:
          "在不新增接口、不改动后端的约束下，先用 superpowers 组织技术方案，再把可影响实施的未决点限定为最多三个最相关问题。",
        process: [
          {
            id: "inspect-existing-boundaries",
            title: "核对已有客户端与接口边界",
            detail:
              "仅引用当前小程序已有登录、数据与导航能力；明确哪些状态必须保存在 Taro localStorage，不能以 Mock 或候选接口替代事实。",
          },
          {
            id: "write-superpowers-plan",
            title: "使用 superpowers 编写方案",
            detail:
              "输出页面承接、状态迁移、失败与恢复路径、文件改动范围和验证方法；不把方案拆成后端或新增接口工作。",
          },
          {
            id: "record-focused-questions",
            title: "收敛最相关的问题",
            detail:
              "只有确实影响实现的事项才记录，最多三个；每项说明影响、默认处理和需要的决定，并更新到本阶段产出。",
          },
        ],
        outputs: [
          {
            id: "implementation-plan",
            title: "小程序技术方案",
            detail:
              "列出既有接口调用点、页面与回跳、持久化状态版本/迁移/清理、错误恢复、写入范围和验证路径。",
          },
          {
            id: "focused-questions",
            title: "最相关问题（最多三个）",
            detail:
              "没有会阻断实施的问题时明确写“无”；不得以泛泛问题替代可执行方案。",
          },
        ],
      },
      acceptanceCriteria: [
        {
          id: "superpowers-plan",
          title: "superpowers 技术方案已落盘",
          detail:
            "方案明确沿用的已有接口、客户端状态边界、实现范围和验证方式，不包含新增接口或后端改造。",
        },
        {
          id: "focused-questions-limit",
          title: "问题已收敛",
          detail:
            "阶段产出中的未决问题不超过三个，且每项都与本功能实施直接相关。",
        },
      ],
      evidenceGates: [],
      reportFields: ["结论", "证据", "变更", "验证", "风险/下一步"],
    },
    {
      id: "development",
      title: "开发（既有接口与小程序本地状态）",
      ownerRoles: ["ui-client"],
      objective:
        "在小程序中实现已确认方案，只调用既有接口，并完成相关自动化和手工验证。",
      documentation: {
        description:
          "实现页面、登录承接、回跳和本地状态；不得新增后端接口、服务端 Mock 或把临时数据散落到页面。",
        process: [
          {
            id: "implement-client-flow",
            title: "实现客户端流程",
            detail:
              "按方案改动小程序页面、服务适配和持久化状态，保证中断后可恢复且重复动作幂等。",
          },
          {
            id: "verify-existing-api-paths",
            title: "核验既有接口路径",
            detail:
              "验证现有登录与数据调用的成功、失败和回跳分支；接口不可用时记录真实阻塞，不新增替代接口。",
          },
        ],
        outputs: [
          {
            id: "implemented-client-flow",
            title: "可运行的小程序流程",
            detail:
              "实现改动、实际测试结果和已知风险记录在本运行内。",
          },
        ],
      },
      evidenceGates: [],
      reportFields: ["结论", "证据", "变更", "验证", "风险/下一步"],
    },
    {
      ...DELIVERY_CONTRACT.stages.at(-1),
      id: "end_to_end_acceptance",
      title: "端到端验收（真实小程序）",
      ownerRoles: ["ui-client"],
      objective:
        "在真实小程序界面和既有接口路径上验收完整用户流程，完成同状态截图逐区审查。",
      terminal: true,
    },
  ],
};

export const MINIAPP_DELIVERY_STAGES = MINIAPP_DELIVERY_CONTRACT.stages;

// Browser products share the continuous delivery semantics without inheriting
// WeChat-only screenshot sources, local-storage constraints, or API rules.
// The selected versioned process remains the source of truth for frozen stages.
export const WEB_DELIVERY_CONTRACT = {
  schemaVersion: 1,
  version: 1,
  id: "web-product-delivery",
  title: "Web 产品任务连续交付契约",
  taskPhase: "delivery",
  requiredDeliveryRoles: ["ui-client"],
  closedStatuses: DELIVERY_CONTRACT.closedStatuses,
  statuses: DELIVERY_CONTRACT.statuses,
  reportFiles: DELIVERY_CONTRACT.reportFiles,
  stages: [],
};

export function isGenericDelivery(input) {
  return input?.deliveryContract?.id === GENERIC_DELIVERY_CONTRACT.id;
}

export function isMiniappDelivery(input) {
  return input?.deliveryContract?.id === MINIAPP_DELIVERY_CONTRACT.id;
}

export function isWebDelivery(input) {
  return input?.deliveryContract?.id === WEB_DELIVERY_CONTRACT.id;
}

export function deliveryContractForInput(input) {
  if (isWebDelivery(input)) return WEB_DELIVERY_CONTRACT;
  if (isMiniappDelivery(input)) return MINIAPP_DELIVERY_CONTRACT;
  if (isGenericDelivery(input)) return GENERIC_DELIVERY_CONTRACT;
  return DELIVERY_CONTRACT;
}

export function deliveryStagesForInput(input) {
  return deliveryContractForInput(input).stages ?? DELIVERY_STAGES;
}

export function stagedDeliveryStages(contract) {
  return (contract.stages ?? []).map((stage) => ({
    ...stage,
    status: "pending",
    summary: null,
    updatedAt: null,
  }));
}

// An empty declaration is intentional. Only historical tasks without a
// declaration fall back to the original four-stage contract.
export function taskStageDefinitions(task) {
  return task?.stageDefinitions ?? DELIVERY_STAGES;
}

export function renderGenericDeliveryBrief(task) {
  return [
    `# ${task.taskType?.title ?? "通用任务"}执行要求${task.taskType ? " v" + task.taskType.version : ""}`,
    "",
    `任务：${task.title}（${task.id}）；任务类型：${task.kind ?? "未声明"}。`,
    `验收要求：${task.verification ?? "按任务输入约定"}。`,
    ...(task.validationProfile ? [
      `验证档位：${task.validationProfile.requested}（v${task.validationProfile.version}；计划风险为 ${task.validationProfile.risk}）。`,
      "完成时根据实际 --files 与任务级 Git 对账生成 validationDecision；只有命中页面局部白名单、且 claim 后没有同一运行其他任务或未归属产品改动混入时，才会记录可跳过的全量测试。快速路径还必须在 acceptance.validation.checks 为每项 required 检查附本运行证据。视觉通道不可用时，在 acceptance.validation.visual 写 pending_user_review 或 unavailable 并说明原因，不能写成 passed。",
    ] : []),
    ...(task.taskType?.fallback ? [`类型 ${task.kind} 未注册，使用通用契约；没有额外类型门禁。`] : []),
    ...(task.taskType?.criteria ?? []).map(item => `- ${item.id}：${item.title}`),
    ...(task.taskType?.criteria?.length ? ['完成时通过 --acceptance <JSON文件> 提交本类型、版本与逐项 checks（id、status:passed、evidence 路径数组）。证据保存在本运行内；格式详见 flows/delivery/task-types.md。'] : []),
    "本任务没有预设阶段。具体流程、阶段和记录格式由任务类型约定，不自动套用四阶段。",
    "开发计划保留开发任务输入和并发任务；实时记录、测试与回归保留区块，内部格式由任务类型声明。",
    "按输入完成工作并记录实际结果、相关测试及未完成原因；未执行的验证不能写为通过。",
    "完成后执行 work finish --status done，提供实际 --summary、--files 与 --tests，再由总 agent 执行 work merge-check 和 work verify。",
    "存在阻塞时记录事实与影响，不得标记完成。",
  ].join("\n");
}
export const VISUAL_VALIDATION_EVIDENCE = DELIVERY_CONTRACT.visualValidation;
export const ADDITIONAL_SCREENSHOT_EVIDENCE =
  DELIVERY_CONTRACT.additionalScreenshots;
export const DELIVERY_TASK_PHASE = DELIVERY_CONTRACT.taskPhase;
export const DELIVERY_STAGE_STATUSES = new Set(DELIVERY_CONTRACT.statuses);
export const DELIVERY_STAGE_CLOSED_STATUSES = new Set(
  DELIVERY_CONTRACT.closedStatuses,
);
export const DELIVERY_FINAL_STAGE = DELIVERY_STAGES.find(
  (stage) => stage.terminal,
);

export function deliveryStageById(id) {
  return DELIVERY_STAGES.find((stage) => stage.id === id) ?? null;
}

export function deliveryStageIndex(id) {
  return DELIVERY_STAGES.findIndex((stage) => stage.id === id);
}

export function stageSummaryTemplate(stage) {
  return stage.reportFields
    .map(
      (field) =>
        `${field}：<${field === "结论" ? "本阶段是否达成" : "实际结果或链接"}>`,
    )
    .join("；");
}

export function stageAcceptanceInstruction(stage) {
  return (stage.acceptanceCriteria ?? [])
    .map((criterion) => `${criterion.title}：${criterion.detail}`)
    .join("；");
}

export function stageDocumentation(stage) {
  const documentation = stage.documentation;
  if (!documentation) return null;
  return {
    description: documentation.description ?? stage.objective,
    process: documentation.process ?? [],
    outputs: documentation.outputs ?? [],
  };
}

export function stageSummaryProblems(stage, summary) {
  const text = String(summary ?? "");
  return stage.reportFields
    .filter((field) => !new RegExp(`${field}\\s*[:：]`).test(text))
    .map((field) => `阶段报告缺少“${field}：”字段`);
}

export function visualValidationInstruction() {
  const shots = VISUAL_VALIDATION_EVIDENCE.screenshots
    .map(
      (shot) =>
        `\`${shot.role}\`（${shot.title}）：${shot.requirement.replace(/[。；]+$/, "")}`,
    )
    .join("；");
  return `验证截图固定为 ${VISUAL_VALIDATION_EVIDENCE.primaryScreenshotCount} 份：${shots}；每张图必须记录来源系统标记。${VISUAL_VALIDATION_EVIDENCE.derivedArtifact.title}：${VISUAL_VALIDATION_EVIDENCE.derivedArtifact.requirement}`;
}

export function additionalScreenshotInstruction() {
  return ADDITIONAL_SCREENSHOT_EVIDENCE.requirement;
}

export function renderDeliveryBrief({
  targetPhase,
  completedStageIds = [],
  stageDefinitions = DELIVERY_STAGES,
  contract = DELIVERY_CONTRACT,
  agentProfile = null,
  carriedRisks = [],
} = {}) {
  const target =
    stageDefinitions.find((stage) => stage.id === targetPhase) ??
    stageDefinitions.at(-1) ??
    DELIVERY_FINAL_STAGE;
  const targetIndex = stageDefinitions.findIndex((stage) => stage.id === target.id);
  const completed = new Set(completedStageIds);
  const currentStage = stageDefinitions.slice(0, targetIndex + 1).find(stage => !completed.has(stage.id));
  const stageLines = (currentStage ? [currentStage] : []).flatMap(
    (stage, index) => [
      `### ${index + 1}. \`${stage.id}\` · ${stage.title}${completed.has(stage.id) ? "（已确认，仅核验）" : ""}`,
      `- 目标：${stage.objective}`,
      `- 负责代码根：${stage.ownerRoles.join("、")}`,
      ...(stageDocumentation(stage)
        ? [
            `- 阶段说明：${stageDocumentation(stage).description}`,
            "- 阶段过程：",
            ...stageDocumentation(stage).process.map(
              (item, processIndex) => `  ${processIndex + 1}. ${item.title}：${item.detail}`,
            ),
            "- 阶段产出：",
            ...stageDocumentation(stage).outputs.map(
              (item) => `  - ${item.title}：${item.detail}`,
            ),
          ]
        : []),
      ...(stage.acceptanceCriteria?.length
        ? [`- 验收内容：${stageAcceptanceInstruction(stage)}`]
        : []),
      `- 交付记录：\`delivery stage --stage ${stage.id}\` 的 \`--summary\` 使用：${stageSummaryTemplate(stage)}`,
      ...(stage.evidenceGates.length
        ? [`- 门禁证据：${stage.evidenceGates.join("、")}`]
        : []),
      ...(stage.evidenceGates.some((gate) =>
        [
          "miniapp_ui_evidence",
          "visual_validation_pair",
          "visual_region_review",
        ].includes(gate),
      )
        ? [
            `- 截图约定：${visualValidationInstruction()}`,
            "- 截图归档：先执行 `visual archive --run <运行ID> --task <任务ID> --state <状态> --reference <原型图> --result <ui-client 图> --ui-project <代码根> --action <复现动作>`；再由图像分析生成逐区报告，并执行 `visual compare --region-report <报告 JSON>` 归档审查结论。",
          ]
        : []),
      ...(stage.evidenceGates.includes("dataflow_svg_evidence")
        ? [
            "- 数据流转门禁：技术方案结论必须配至少一张数据系统流转 SVG（节点=系统，连线=数据+对应接口，可多张）；保存到运行目录后执行 `delivery stage-artifact --run <运行ID> --task <任务ID> --stage technical_solution --kind dataflow_svg --file <svg> --caption <系统与接口说明>` 登记，未登记不得确认本阶段。",
          ]
        : []),
      ...(stage.evidenceGates.includes("technical_requirement_confirmed")
        ? [
            "- 技术要求确认门禁：本阶段关联的每条 technical 技术要求必须已与用户确认（`prototype requirement update --input <确认JSON> --request-id <ID> --expected-revision <修订号>` 置为 confirmed），并完成复评收敛（graph sync → feature impact → feature refine → feature apply）；存在未确认技术要求时不得确认本阶段。",
          ]
        : []),
      ...(stage.evidenceGates.includes("dev_plan_evidence")
        ? [
            "- 开发计划门禁：writing-plans 产出的 plan.md 必须保存到运行目录，并经 `delivery stage-artifact --run <运行ID> --task <任务ID> --stage technical_solution --kind dev_plan --file <md> --caption <计划说明>` 登记为本阶段门禁证据；未登记 plan 仅凭文字描述不得确认本阶段。",
          ]
        : []),
      ...(stage.evidenceGates.includes("e2e_screenshot_evidence")
        ? [
            "- 验收截图门禁：端到端截图证据必须登记在本阶段：`delivery stage-artifact --run <运行ID> --task <任务ID> --stage end_to_end_acceptance --kind e2e_screenshot --file <截图> --caption <流程与状态说明>`；早期阶段的截图登记不继承为本阶段证据。",
          ]
        : []),
      ...(stage.evidenceGates.includes("risk_ledger")
        ? [
            "- 风险台账门禁：总结“风险/下一步”中的每条留项必须在闭环命令中用 `delivery stage ... --risk \"<条目>\"` 逐条登记到关联功能点（可多个 --risk）；确无留项时该字段写“无”。未登记的留项会阻断本阶段确认。",
          ]
        : []),
      "",
    ],
  );
  const terminal = target.terminal;
  return [
    `# ${contract.title} v${contract.version}`,
    "",
    `本次硬停点：\`${target.id}\`。从上一已确认阶段后的下一阶段顺序推进，不得越过停点。`,
    "",
    `阶段顺序：${stageDefinitions.slice(0, targetIndex + 1).map(stage => `${stage.id}${completed.has(stage.id) ? "✓" : ""}`).join(" → ")}。`,
    "阶段完成后重新运行 work delivery-brief 获取下一阶段说明。",
    ...(carriedRisks.length
      ? [
          "## 功能点携带的开放风险/下一步（本次运行输入）",
          "",
          ...carriedRisks.map(
            (risk) =>
              `- \`${risk.id}\` · ${risk.featureId}：${risk.text}（来源：阶段 ${risk.source?.stageId ?? "历史登记"} @ 运行 ${risk.source?.runId ?? "手工登记"}）`,
          ),
          "- 处理规则：每条要么在本次运行中落实并用 `feature risk-resolve` 关闭，要么在阶段闭环时继续用 `delivery stage --risk` 重新登记为留项；不得静默丢失继承条目。",
          "",
        ]
      : []),
    "## 当前阶段提示词",
    "",
    ...stageLines,
    ...(agentProfile
      ? [
          "## 当前阶段 Agent",
          "",
          `- Profile：\`${agentProfile.id}\``,
          `- 冻结摘要：\`${agentProfile.sha256}\``,
          "- 阶段指令：",
          agentProfile.instructions,
          "",
        ]
      : []),
    "## 执行与结束规则",
    "",
    "- 只操作父 agent 指定的同一个任务；每阶段写入真实结论与证据。",
    terminal
      ? "- 当前目标为终态：完成全部阶段后执行 `work finish --status done`，再由主 agent 做 merge-check 与 verify。"
      : `- 当前目标是中间检查点：到达 \`${target.id}\` 后停止；checkpoint-gate 会将本次执行置为 \`done\` 并释放租约。阶段契约仍保持可续做，后续必须绑定同一任务并创建新的执行尝试。`,
    "- 阻塞必须写明证据、影响、可选方案与需要的决定；不得用完成状态掩盖未验证项。",
    "",
    "## 运行报告格式",
    "",
    "- 阶段结论：使用上面的固定字段写入 `delivery stage --summary`。",
    "- 运行报告：`plan.md` 写实施切片与技术决策；`implementation.md` 写实际行为/文件/风险；`verification.md` 写命令、结果、原型对照与截图证据。",
  ].join("\n");
}
