# 开发闭环

通用任务保留开发计划、实时记录、测试与回归三个区块。开发计划中保留开发任务输入和并发任务。通用模板不声明固定阶段、阶段 Todo、实施切片、技术方案子标题或测试表格；具体内容和格式由任务类型约定。从功能地图启动的小程序产品任务例外：它使用冻结的四阶段产品契约。

## 启动与任务输入

1. 先运行 `feature status`。地图不存在或过期时交回规划流程；地图新鲜时通过 `delivery start --source feature-map --intensity <强度>` 提取可开发叶子。指定单一叶子使用 `feature start --id <ID>`，已有任务优先续做。兼容来源仍支持 `--source prototype` 和 `--source manual --task`。
2. 读取 `delivery-input.json`、相关叶子规划及实际交付项目卡片。`focused`、`standard`、`high` 只影响范围和并发安排，不改变任务验收要求。
3. 用 `work plan` 登记任务类型 `--kind`、输入范围、写入范围（运行内可共享）、依赖与 `--verify` 验收要求。产品任务仍只关联一个叶子功能；`--projects` 绑定实际涉及的代码根，不统一要求同时涉及前后端。无阶段任务省略 `--phase` 和 `--target-phase`。
4. 从功能地图创建的小程序产品运行登记 `miniapp-product-delivery` 契约：`prototype_alignment` → `technical_solution` → `development` → `end_to_end_acceptance`。它只绑定 `ui-client`，沿用已有接口，不生成 API / Mock 阶段。`technical_solution` 必须使用 superpowers；输出中的相关未决问题最多三个。创建运行时会为每个功能冻结当时 active 的功能级最终验收用例（AC），并只注入其 `end_to_end_acceptance` 阶段；后续 AC 修改不回写既有任务。手工运行登记 `generic-task` 契约与空阶段列表。`--kind generic|api|ui|fix` 从类型注册表冻结版本与验收项；其他标签明确兜底通用类型。使用 `work types --json` 和 [类型协议](task-types.md) 查看当前能力。
5. 领取或绑定当前会话后执行 `work delivery-brief --run <运行ID> --task <任务ID>`，按输入与验收要求持续交付。涉及系统边界时读取相关系统卡片并记录决策；阻塞需说明事实、影响和需要解决的问题。

## 记录与验证

- `plan.md` 保留开发任务输入及并发任务；并发任务状态持续自动同步。类型需要其他计划内容时按该类型约定记录。
- `implementation.md` 对应实时记录，`verification.md` 对应测试与回归。只固定区块，不固定内部章节、字段、表格、字数或截图格式。
- 执行相关测试并记录实际结果；未执行的验证说明原因，不得写为通过。测试范围、回归方式和证据要求服从具体任务及项目约束，不把 UI、Mock 或小程序截图要求附加到所有任务。
- 对冻结的 AC，先在最终阶段归档真实 `end_to_end_acceptance/e2e_screenshot` 证据，再逐条执行 `delivery acceptance --run <运行ID> --task <任务ID> --case <AC-ID> --status passed|failed|not_applicable --summary <结论>`。确认最终阶段前，每条 AC 都必须有通过或不适用结论；通过项必须引用本阶段截图，失败项保持阻塞而不伪装为完成。
- 新任务的可选同步区块只有在文档明确包含完整标记对时才更新，不自动追加缺失区块。通用模板不生成阶段 Todo 或专项证据模板。
- 完成后执行 `work finish --status done`，记录真实摘要、改动和测试；总 agent 执行 `work merge-check` 与 `work verify --status passed`，再将运行标记完成。已注册专项类型还须提交匹配创建时版本的 `--acceptance` 清单，逐项通过并引用本运行内非空证据；旧任务没有该字段时不追加载新要求。三份报告必须存在，实时记录、测试与回归需要实际内容；不校验固定子标题或阶段摘要字段。
- 产品源码观察、用户意图、开发状态分别记录；功能状态通过任务命令回写，不把开发/测试状态写入原型真源。

仅在用户授权并发时读取 [协作协议](parallel.md)。写入范围（运行内可共享，跨运行重叠在 `work plan` 登记时预检拒绝）、依赖、规划新鲜度与会话完成记录仍按公共命令校验。

已有 `product-delivery` 或未登记契约 ID 的历史运行保留原阶段、记录及门禁；续做时按 [历史交付协议](legacy-product-delivery.md) 执行。本次技能维护不迁移或改写真实任务数据。
