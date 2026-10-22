# 产品交付与回归

触发：用户要求按功能地图开发、修复差异或续做指定任务。输入是当前规划、任务、目标项目卡片与系统约束；产出为产品代码与可核验交付记录。带未确认技术要求（kind=technical、proposed）的功能点可建运行：technical_solution 阶段内 brainstorming 到用户确认后完成复评收敛（preserve/revalidate）再确认本阶段；关联技术要求未确认或基线未刷新时阶段确认被门禁拒绝。

指定运行/任务先 `run context --id <ID>`；准备新功能先 `feature status`，过期交回 [规划](../planning/entry.md)。已有进行中任务优先续做；没有时默认只选一个可开发叶子，`feature start --id <ID>` 使用 focused。多功能或并发须有用户明确范围。

读 [交付协议](protocol.md) 和实际目标项目卡片。产品写入前 work claim 或 work bind-session 绑定当前会话；跨运行声明重叠由 `work plan` 预检拒绝，收尾用 `work reconcile` 对账并按结论 fix-forward，未确认的跨运行触碰用 work conflict-status 查看后确认。之后 `work delivery-brief --run <ID> --task <ID>` 获取本任务要求。

从功能地图启动的本项目小程序产品任务默认使用 `miniapp-product@3`：原型对齐、技术方案（superpowers 确认链+数据系统流转图+dev_plan 登记）、开发（风险登记功能点，默认 subagent-driven-development）、端到端验收（本阶段截图门禁）。用 `feature start --id <ID> --process <流程ID>@<版本>` 或 `delivery start ... --process <流程ID>@<版本>` 可为功能点显式选择版本化流程；流程和阶段 agent 的目录规则见 [流程模板](../../modules/delivery/processes/README.md)。每个阶段只加载自己的 agent 指令；已验证检查点后才可把同一任务交接给下阶段 agent。技术方案只复用既有接口，不创建 API / Mock 阶段，但阶段结论必须配至少一张数据系统流转 SVG（系统+数据+对应接口，可多张），经 `delivery stage-artifact --kind dataflow_svg` 登记后才可发布审查；阶段总结"风险/下一步"中的每条留项必须用 `delivery stage --risk` 逐条登记为功能点独立台账（下一次该功能交付运行自动作为输入注入）；端到端验收必须在本阶段用 `delivery stage-artifact --kind e2e_screenshot` 登记真实截图，并用 `delivery acceptance` 逐条填写任务创建时冻结的 AC 结论才可确认。AC 是功能级最终验收，不是原型分析要求；后续调整只影响新建交付任务。阶段产出中的未决问题最多三个，且必须直接影响实施。手工或工程治理任务仍使用其自身任务类型，不自动套用该产品契约。一个任务交付一个叶子，绑定本次实际涉及的项目。

完成工作后执行 work finish、merge-check、verify；真实验证范围由任务输入和类型约定决定。截图与验收对比按 [视觉验收双维度](visual-acceptance.md) 选择 vision（图片理解，缺省）或 dom（开发期两侧 DOM 可得时）；涉及视觉判定先按 [能力加载](visual-acceptance.md) 用 `capability show/list` 按需加载 visual-compare 判定简报，字段结构一律由协议 schema 定义，能力不定义字段结构。开发期快速回归可用 `visual validate-report` 独立校验，但阶段门禁只认 `visual compare` 归档。已有阶段契约的任务按原约定续做；仅这种情况按需读取 [历史交付协议](legacy-product-delivery.md)，有明确中间停点时使用 checkpoint-gate。并发时才读 [协作协议](parallel.md)。新的原型事实、回答或需求变化仍会在续做、写入与完成命令处阻断旧规划；单纯新增或修订 AR／AC 台账不会反向阻断已经冻结的原型批次或交付任务。
