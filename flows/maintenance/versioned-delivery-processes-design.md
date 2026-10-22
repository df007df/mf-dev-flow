# 版本化功能点交付流程模板

## 决策

将“会话流程路由”和“功能点交付流程”分为两层。`flow route` 仍只选择 mf-dev-flow 的工作域；功能点在创建交付运行时选择一个版本化的 `deliveryProcess`。流程定义四个有序阶段，且每个阶段引用一个独立、可单独演进的 agent Markdown 文件。

首个流程为 `miniapp-product@1`，阶段依次为：`prototype_alignment`、`technical_solution`、`development` 与 `end_to_end_acceptance`。

## 文件与冻结模型

流程目录为 `modules/delivery/processes/<process-id>/v<version>/`：

- `process.json`：流程身份、版本、阶段顺序、阶段契约与 `agentFile` 引用。
- `agents/<stage>.md`：该阶段唯一的执行指令。

加载器校验流程 ID、版本、阶段 ID、唯一终态、agent 文件相对路径、文件大小和阶段字段。它计算清单及每个 agent 文件的 SHA-256，并把指令文本、路径与摘要写入交付输入的阶段快照。后续修改源文件只影响新建运行；历史运行和任务继续使用已冻结的快照。

## 执行与交接

任务保留现有单一功能点、阶段顺序、证据与文件租约门禁。`work claim` 和从检查点恢复的 `work bind-session` 必须使用目标阶段的 agent profile ID。中间阶段 checkpoint 后，新的 agent profile 可以绑定下一阶段；系统在 execution 的 attempts/handoffs 中留下来源 agent、目标 agent、阶段及时间。进行中的 attempt 仍不允许换 agent。

`work delivery-brief` 仅渲染当前阶段，并附带已冻结的 agent profile 与指令；它不预加载其余三份 agent 文本，避免把流程拆分变成上下文膨胀。

## 兼容性与失败策略

- 没有 `deliveryProcess` 的历史任务继续沿用既有 `stageDefinitions` 与身份规则。
- 手工交付运行继续使用 generic 契约。
- 仅 feature-map 新交付运行使用 `miniapp-product@1`。
- 无法加载、哈希不一致、路径逃逸、缺少 agent 文件或 agent 名称不匹配时拒绝创建/领取/续做，不降级为通用流程。

## 验证

Node fixture 测试覆盖：流程文件校验与路径安全、四阶段快照与摘要、已有运行的不可变性、brief 只展示当前 agent、错误 agent 被拒绝、checkpoint 后交接给下一 agent、同一 attempt 内换 agent 被拒绝、历史契约无回归。维护验证只运行 mf-dev-flow 隔离 fixture，绝不读取或写入真实 `.mf-dev-flow`。
