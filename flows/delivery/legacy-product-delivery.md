# 历史产品交付契约说明

仅用于已有 `deliveryContract.id: product-delivery` 或未登记契约 ID 的历史任务续做。以下阶段、格式与证据要求不适用于新建通用任务；不得将其自动附加到新任务。

# 开发闭环

本运行由统一开发任务输入驱动。输入优先来自功能演进地图的叶子功能，也可兼容长期原型真源的粗功能块提取，或由用户手工给出任务；三者都必须完成同一闭环：分析、方案确认、计划、实现、测试、原型回归和功能状态回写。不要把“提取完成”或“写完计划”当作完成。

## 启动与规划

1. 选择开发强度：`focused` 为单一安全范围串行，`standard` 为正常安全并发，`high` 为在 agent 容量和耦合边界内尽量并发；强度不改变完成门槛。
2. 先运行 `feature status`。地图不存在或过期时按 `../planning/protocol.md` 重新拆解；地图新鲜时用 `delivery start --source feature-map --intensity <强度>` 提取可开发叶子功能，显式选择时自动补齐前置依赖。用户明确指定一个叶子功能并要求完整开发完成时，使用 `feature start --id <叶子功能ID>`：它只创建该功能的 `focused` 运行，并拒绝地图过期、非 `not_started` 状态、地图阻塞、未解决功能疑问、未完成前置功能或已有进行中任务；已有任务必须续做，不能重复创建。尚未建立地图的兼容流程可使用 `--source prototype`；手工任务使用 `--source manual --task`。读取 `delivery-input.json`、`planning/feature-map.json`、`prototype document` 的分页报告 与相关系统卡片。
3. 每个功能由**同一个产品任务**连续执行[阶段交付契约](../../modules/delivery/contract.mjs)。每个产品任务只能关联一个叶子功能；一次开发运行选中的每个叶子功能至少要有一个产品任务，禁止用“全功能聚合任务”替代逐功能追踪，也不得按阶段新建重复任务。在创建产品任务前，必须读取 UI 与 API 目标项目的 `.mf-dev-flow/projects/<project-id>.json`：先核对 `deliveryRoles`，再核对其 E2E 运行器、截图方式和禁止替代方式，然后使用 `work plan --projects <ui代码根,api代码根>` 同时绑定实际交付项目。所有 `--writes` 必须位于任一已绑定代码根。若 UI 项目卡片规定 `wechatide`，必须读取并使用该项目的 `wechatide-skill`，以 `simulator_screenshot`、模拟器断言与 console/network 取证；H5 只可调试，不能确认阶段。
4. 领取或续做时先执行 `work delivery-brief --run <运行ID> --task <任务ID> [--target-phase <阶段ID>]`。它是主 agent 与 sub agent 共用的阶段提示词：给出顺序、代码根职责、阶段证据、`delivery stage --summary` 格式、检查点与终态规则。技术实现涉及系统边界时仍须读取相关系统卡片，确认 API 复用后立即登记，发现问题登记并保持阻塞。
5. 阶段的顺序、名称、前置关系、证据门禁和报告字段不得在本文件或 agent 提示词重复定义；需要调整阶段时只维护 `modules/delivery/contract.mjs`，再运行自动测试。小改动可将契约阶段设为 `not_applicable`，但必须写明原因。
6. 正常的技术问题自行选择最适配原型的方案并记录理由；仅在安全/合规、数据不可恢复、已发布接口或数据迁移的破坏性兼容冲突时向用户确认。任何阻塞都要附原型、代码或系统卡片证据、影响和可选方案。

用户可把本轮目标设为契约中的任一中间阶段。到达该阶段并完成证据后，`checkpoint-gate` 会将本次并发执行写为 `done` 并追加 checkpoint；阶段契约仍保持可续做，等待用户验证。后续必须通过相同任务 ID 绑定新会话并创建新的执行尝试，禁止为后续阶段建立新任务。目标为契约终态阶段时，才走任务最终终态与总控合并验证。

仅在用户授权并发时，读取 [协作协议](parallel.md) 评估功能块耦合。无共享功能/代码/接口/状态写入的切片可以并行；有任一耦合的切片必须由同一 agent 完成。并行子 agent 只维护各自执行记录，总 agent 在 `work merge-check` 后才更新本运行的 `implementation.md` 与 `verification.md`。

## 实现、测试和回归

每个切片执行“客户端逐区复刻 + 后端 Mock 字段 → 后端/接口真实实现 → 针对性测试 → 原型回归”循环：

1. 在 `plan.md` 写明实施切片与技术方案决策；任务/阶段 Todo 会由 mf-dev-flow 自动同步。随后在 `implementation.md` 记录关键技术方案、改动文件、原型功能块、行为和未完成项。
2. 执行项目基线里的相关测试命令；涉及用户操作时优先跑真实 e2e。若命令或环境不可用，记录未执行原因，不能标为通过。
3. **每一次测试后**更新 `verification.md`，至少包含：命令、时间、结果摘要/失败原文位置、关联功能块、最近改动的逻辑复核、与原型流程/文案/状态的逐项对照、偏差及处理结果。每个接口 Mock 任务确认前，必须把实际响应截图和完整 JSON 响应一并存入 `screenshots/api-mock/`，并通过 `api-mock evidence` 登记请求方法、完整 HTTP(S) Mock URL、状态码、完整 JSON 与复现动作；工具会从完整 JSON 生成字段路径和类型定义。这证明 Mock 契约可观察，不能替代 UI 截图。项目卡片规定 `wechatide` 的 UI 任务，阶段 1 和阶段 4 确认前必须用 `simulator_screenshot` 将真实模拟器截图存入 `screenshots/wechatide/`，并登记页面、选择器/状态、复现动作与 console/network 结论；H5 截图不可登记。每个 UI 验证状态都必须用 `visual archive` 归档固定两份主截图：参考图只能来自关联原型运行，结果图只能来自绑定的 `ui-client` 项目；每张图自动记录来源系统标记，具体系统 ID 由运行或任务绑定决定。随后使用图像分析能力分别识别两图从上到下的区块，并将匹配结果写为 `visual compare --region-report <报告 JSON>`：报告必须声明同一业务状态、设备/缩放基准、排除的原生或演示区块，以及每个业务区块的存在性、顺序、布局、文案、视觉和交互结论。原生状态栏、宿主胶囊、Home Indicator 与原型演示工具必须作为排除区，而业务底部导航必须保留为业务区。不得使用全图像素阈值、差异像素比例、红色差异图、连通块或边缘条带作为通过/失败依据。图像模型对文案的识别必须由原型 HTML 与实现源码交叉核实；状态不一致或模型不确定时保持受阻并补采同状态截图。接口项目页面或接口测试截图不能替代结果图。

   逐区报告固定为 `schemaVersion: 1`：填写 `analyzer.provider/model`；`capture` 中填写 `comparable: true`、`baseline.device/scale/canvas` 与 reference/result 的 `state/source`；`excludedRegions` 的每项填写唯一 `id/reason`；`regions` 按屏幕从上到下以严格递增的 `order` 声明 `id`、`scope: "business"`、两侧摘要及六项唯一检查 `presence`、`order`、`layout`、`copy`、`visual`、`interaction`。每项检查给出 `passed`、`failed`、`uncertain` 或 `not_applicable` 和简短 `detail`；文案检查除 `not_applicable` 外必须是 `sourceVerified: true`。任一 `failed` 或 `uncertain` 均不得确认全链路验收。报告缺省为 `vision`（图片理解逐区）；开发阶段原型 HTML 与运行时 DOM 两侧可得时可用 `"dimension": "dom"` 按结构抽取逐区（每块附两侧 `domEvidence.locator/excerpt`，`visual` 可 `not_applicable`、`interaction` 未实测必须 `uncertain`），验收收口仍以 vision 截图对为准。双维度模板、场景矩阵与填报告提示词见 [视觉验收双维度](visual-acceptance.md)。
4. 主 agent 将代码证据、测试证据、偏差、未完成原因和更新时间写入关联开发运行；功能状态和阶段通过任务命令投影到 `planning/feature-map.json` 与 `planning/feature-history.json`。不得回写 原型 catalog 或其派生报告 中的开发/测试状态。原型真源只在扫描、补证或确认原型说明时更新。
5. 测试通过仍需检查：是否跳过原型中的分支、成功/错误/空态是否一致、返回与状态保存是否一致、文案/权限/边界条件是否冲突。偏差要么在本轮修复，要么列为受阻问题；不可静默接受。

开发运行只能在每个方案阶段有确认、完成或明确不适用结论，计划项全部完成/跳过/受阻，三份报告通过内容门禁，且最后一次截图原型回归已记录后标记 `done`。`work verify --status passed` 与 `run set --status done` 会校验该条件；Stop gate 只校验当前会话改动是否已有覆盖它的终态任务记录，并优先按会话记录解析，避免因其他运行的 `current` 指针误判。用户已明确要求“完整开发完成”时，Agent 必须持续推进至四阶段闭环、`work merge-check` 和 `work verify --status passed`，不能仅创建计划、完成 Mock 或停在任一中间阶段。Mock 阶段通过不等于后端或 e2e 完成；未做 e2e 的功能不能称为 e2e 已完成，只能在功能块中标注实际测试级别。
