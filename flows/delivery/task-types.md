# 新任务类型与版本

`work types --json` 只读列出当前通用任务类型和可选验证档位，唯一实现在 [类型注册表与验收器](../../modules/delivery/types.mjs)。当前任务类型支持 generic、api、ui、fix，验证档位支持 auto、standard、style-token、local-ui-structural；通用类型均不预设阶段。类型只细化任务验收，不统一规定三份报告内部格式，也不要求每类任务都提供截图。

从功能地图启动的小程序产品任务不使用上述通用类型阶段，而是冻结 `miniapp-product-delivery` 契约：原型对齐、技术方案（superpowers）、开发、端到端验收。其技术方案只准复用已有小程序接口和客户端本地状态；不创建 API / Mock 阶段；最多记录三个与实施直接相关的问题。

`work plan --kind <类型>` 把当前类型版本、验收项和空阶段列表保存到任务的 taskType。新通用任务还会冻结 `validationProfile`：默认 `auto`，也可显式传 `--validation-profile standard|style-token|local-ui-structural`。其中 version 是完成时选择 resolver 的规则版本；后续新增或调整规则必须新增版本，不能追溯修改已计划任务。被手改、未知或不支持的冻结记录一律回退 `standard`，绝不默认授权快速档。未知任务类型保留原 kind 并明确兜底 generic。既有任务没有 taskType/validationProfile 时继续标准验证，不会被新规则追溯降级；历史四阶段继续使用原契约。

`auto` 只在实际 `--files` 满足以下白名单、且任务级 Git 基线与声明文件精确对账时才降级：

- `style-token`：同一个 `src/pages/<page>/index.(scss|css|less|wxss)`，外加可选的 `tests/` 或 `e2e/` 定向检查；跳过全量测试，仍需类型验收和定向运行态检查。
- `local-ui-structural`：同一个页面入口的 `index.(tsx|jsx|scss|css|less|wxss)`，外加可选的 `tests/` 或 `e2e/` 定向检查；跳过全量测试，但仍需类型验收、定向运行态检查和 typecheck。

任何服务、hook、共享组件、数据、路由、配置、跨页面文件，或 Git 对账不完整，都会回退 `standard`。同一运行在当前任务 claim 后出现其他任务的产品改动时，也会保守回退，避免用运行级声明掩盖实际范围；不能以置信度分数自行越过该规则。`work finish` 把实际结论保存到 `executions/<任务>.json` 的 `validationDecision`，其中包括 `risk`、`classificationConfidence`、依据、必做项、跳过项与视觉状态；对应的 `processData.taskGitReconciled`、`taskGitExtra`、`taskGitUnobserved` 保存任务级 Git 对账事实。

读取 `work delivery-brief` 获取本任务需要的验收项。专项类型完成时提供 `work finish ... --acceptance <JSON文件>`；blocked 或 skipped 仍只记录实际原因。清单例子（这里只展示一个项，实际须包含 brief 列出的全部项）：

```json
{
  "type": "fix",
  "version": 1,
  "checks": [
    {"id": "reproduction", "status": "passed", "evidence": ["verification.md"]},
    {"id": "resolution", "status": "passed", "evidence": ["verification.md"]},
    {"id": "regression", "status": "passed", "evidence": ["logs/regression.log"]}
  ],
  "validation": {
    "checks": [
      {"id": "targeted-runtime-check", "status": "passed", "evidence": ["evidence/calendar-tag.log"]},
      {"id": "typecheck", "status": "passed", "evidence": ["evidence/typecheck.log"]}
    ],
    "visual": {
      "status": "pending_user_review",
      "reason": "当前会话无图像分析通道，已留下模拟器截图供人工确认。"
    }
  }
}
```

证据路径相对当前运行目录，也可传该目录内绝对路径；文件必须非空且真实路径位于本运行内。不得借符号链接引用运行外文件。清单必须匹配冻结的类型与版本，不得缺项、重复、使用未知 ID 或将未通过项标完成。快速路径还必须在 `validation.checks` 中提供 `validationDecision.required`（除 `task-type-acceptance` 外）的全部检查和证据；标准路径不要求此字段。`validation.visual.status` 只能为 `not_required`、`passed`、`pending_user_review` 或 `unavailable`；后两者必须有 `reason`，`passed` 必须有本运行内截图或审查证据。CLI 检查结构、状态和文件可读性，Agent 和总控仍负责验证结果真实性；声明 passed 或放入任意非空文件不能替代实际验收。

新类型的扩展同时添加版本、面向用户的 brief 条目、验收器和隔离正反向用例。需增加阶段时再实现完整阶段执行能力；当前注册表的空阶段不得通过手改任务变成未支持流程。
