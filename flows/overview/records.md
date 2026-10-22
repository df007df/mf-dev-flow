# 记录格式与完成门槛

## 运行状态

`run.json.status` 仅可为 `pending`、`in_progress`、`blocked`、`done`、`skipped`。`blocked` 必须在对应 Markdown 中列出需要用户决定的问题；`skipped` 必须写范围和原因。

`current.json` 只保存最近未结束运行的指针。它不替代运行文档，也不能以聊天中的“完成”改状态。

每次运行的稳定标识是 `run.json.id`，同时作为 `.mf-dev-flow/<type>-runs/<运行ID>/` 目录名。它可用于跨 agent 续做：先读取 `run context --id <运行ID>`；refinement 运行默认先读取返回的 `context.defaultRead` 摘要，只有核验需要时才以 `--detail prototype|planning|development|systems|code-roots|documents --limit <1-20> --max-bytes <2048-32000> --cursor <偏移>` 获取原始分区，默认每页 5 条且最多 12000 bytes。`prototype` 与 `planning` 优先用 `--group`，`systems` 用 `--card`、`development` 用 `--run`、`code-roots` 用 `--root ... --changes` 缩小范围；禁止 `--detail all`，也不得整读原型报告、`context.json`、`previous-map.json` 或 `proposal.json`。用户未明确续做目标时，先询问目标，不得自行扩大或改变运行范围。

## 并发执行记录

项目产品代码或系统事实的运行，其 `work-plan.json` 由总 agent 建立，列出任务范围、依赖与写入范围（运行内可共享）。每个 agent 先通过 `work claim` 创建 `executions/<task-id>.json`，结束通过 `work finish` 写入摘要、状态、改动文件、测试和阻塞。`.mf-dev-flow/execution-index.json` 是汇总视图，不能手改。`mf-dev-flow` 技能、脚本、hook 适配器和 hook 配置自身的维护不属于运行，不创建这些记录，也不受任务领取、写入声明或停止门禁约束。

总 agent 在所有子任务终态后执行 `work merge-check` 与 `work verify`，再更新共享报告和运行状态。并发记录、合并记录和最终测试缺一不可。

## 原型记录

现代原型统一在 prototype/ 保存批次、已接受结论、问答/需求/说明与历史；按 [原型入口](../prototype/entry.md) 操作。遍历记录与产品修订分离；开发状态只在 planning / delivery-runs。旧 prototype-runs 为历史，不自动迁移。

开发记录状态枚举：

| 层级      | 状态             | 含义                                             |
| --------- | ---------------- | ------------------------------------------------ |
| 任务/运行 | `pending`        | 已登记，尚未开始或尚未领取。                     |
| 任务/运行 | `in_progress`    | 已开始执行，尚未达到终态。                       |
| 任务/运行 | `blocked`        | 有明确依赖、技术问题或待确认决策，当前不能继续。 |
| 任务/运行 | `done`           | 已完成对应任务/运行门槛，并留下验证结论。        |
| 任务/运行 | `skipped`        | 明确跳过本次范围，原因必须留在执行记录。         |
| 阶段      | `confirmed`      | 阶段门禁已核对通过，可进入后续阶段。             |
| 阶段      | `not_applicable` | 经记录判断该阶段不适用于当前任务。               |

阶段还可使用 `pending`、`in_progress`、`blocked`、`done`；阶段状态只描述当前门禁，不能用任务或运行 `done` 替代接口字段确认、技术方案确认、测试或截图原型回归。

## 功能演进拆解运行

`refinement-runs/<id>/` 必须包含 `context.json`、`brief.md`、`delta.json`、`proposal.json`、`analysis.md` 与 `work-plan.json`。`context.json` 是本轮开始时的只读事实快照；`brief.md` 是默认读取的派生摘要，`delta.json` 只记录与上一快照不同的分区和哈希；二者都能重建，不能替代任何原型、系统或范围真源。`proposal.json` 是待校验提案，由 `feature proposal-patch` 按业务域增量维护；每次补丁保存在 `proposal-patches/` 供审计，不要求 Agent 整读或整写提案。

新 refinement 还冻结 `previous-map.json` 和 `prototype-impact.json`，原型指纹在 `context.prototype.revision`。原型变更的 `impactReviews`、旧叶子迁移、任务处理及 `preserve/revalidate` 规则见 [prototype-change-impact.md](../planning/change-impact.md)。当前地图保存 `prototypeBaseline`，复评事件只追加；范围变化产生新的 `planningRevision`，旧任务与旧阶段不能投影为新版本完成。历史无基线记录只读保留，不自动回填。

运行只有在 `feature apply` 生成 `validation.json(status=passed)`、`application.json(status=applied)` 并更新 `planning/feature-map.json` 后才能为 `done`。门禁至少保证：全部原型入口至少关联一个叶子，每个叶子至少关联一个有有效截图的入口；允许多对多，但叶子必须表达独立验收结果、旧功能迁移完整、业务域与叶子功能 ID 唯一、功能块及组内叶子功能 `rank` 唯一且为正整数、系统卡片引用存在、优先级/状态合法、依赖引用有效无环且排在被依赖功能之前、应用时证据没有过期。

旧运行和任务记录只追加保留；拆分、合并或更名通过 `migrations` 表达，禁止修改历史任务的 `features` 来伪造新粒度。历史任务到叶子功能的可审计补充关联写入 `planning/task-leaf-links.json`；产品任务会将登记、领取、完成、阻塞、阶段更新与验证结论追加到 `planning/feature-history.json`，工程治理任务不进入产品历史。`compact build` 只能生成或刷新摘要、差量与索引，禁止删除、移动或改写原始快照。当前地图是派生执行视图，其完整格式和拆分规则见 `feature-refinement.md`。

## 开发运行

开发运行必须有 `delivery-input.json`，记录来源（`prototype`、`feature-map` 或 `manual`）、开发强度、关联原型、功能范围和所用契约。新运行使用 `generic-task`，阶段列表为空；当前不自动按 `--kind` 加载类型流程，具体阶段和记录格式后续由任务类型约定。

通用报告保留三个区块：`plan.md` 的开发计划保留开发任务输入和并发任务，后者自动同步；`implementation.md` 为实时记录，`verification.md` 为测试与回归。后两者内部格式自由，无固定章节、字段、字数或截图模板。同步只更新明确存在完整标记对的可选区块，不自动追加缺失的阶段或证据区块。

产品任务是单个叶子的交付单元；`work-plan.json` 保存任务类型、实际交付代码根、范围、依赖与验收要求。任务写入范围必须位于绑定代码根；领取/续做时以 `work delivery-brief` 为准。任务登记、领取、完成、阻塞、阶段更新和验证事件追加到 `planning/feature-history.json`，不改写原型真源。历史粒度有误时通过 `work supersede` / `delivery supersede` 追加取代说明，保留旧结论与证据。

新任务完成须有真实执行摘要、改动与测试记录；总控执行 `work merge-check`、`work verify --status passed` 后才可将运行置为 `done`。三份报告必须存在，开发任务输入和并发任务保留，实时记录、测试与回归有实际内容；具体测试范围和证据要求由任务输入、类型及项目约定决定。未解决偏差和未运行测试要记录原因，不得伪称通过。通用运行可用 `run set --status blocked --note <原因>` 记录阻塞，无须虚构阶段。

仅历史 `product-delivery` 或无契约 ID 的已有任务按 [历史交付协议](../delivery/legacy-product-delivery.md) 保留阶段、报告格式与证据门禁。阶段更新不由 `work finish` 自动代替；中间停点通过 checkpoint-gate 后，本次执行置为 done，同一任务保留未完成阶段并可创建新 attempt 续做。未闭环的历史检查点仍占用写入范围，不能被新任务绕过。

## 系统卡片运行

`system-runs/<id>/` 至少包含 `overview.md`、`cards.json`、`impact-analysis.md`、`tasks.md` 与 `work-plan.json`。每张卡片按一个外部系统聚合项目关系、权威边界、最近核验时间、来源、已知 API、当前 API 使用、技术问题、方案提示和变更记录。每个来源必须记录稳定 ID、类型、位置、事实权威、访问策略、密钥处理、状态和证据；禁止保存密钥值。

系统卡片运行完成前必须：完成来源核验；确保外部代码/配置只读、数据库仅 `SELECT`；分别写清原型、系统设计、技术方案/代码、数据模型和测试影响；把差异转成有优先级、影响区域、状态和验收证据的派生任务；完成执行记录、合并检查和总控验证。之后才能 `system update` 回写长期卡片。

`apiUsages` 只保存本项目当前确认仍使用的接口，必须有方案依据、登记时间和最近确认时间；不再使用时从当前列表删除并记录原因。明显技术问题必须有证据、影响、严重度、状态和核验时间。

## 证据等级

| 标记          | 含义                                                    |
| ------------- | ------------------------------------------------------- |
| `observed`    | 在可访问原型中实际操作或直接看到的状态；HTML 应附截图。 |
| `inferred`    | 从连线、注释、静态图或代码推断，必须说明来源。          |
| `unavailable` | 无法访问、无入口或工具限制；写原因和补证据方式。        |

## Object Ref V1（项目内全局引用）

Object Ref 是面向人和工具的稳定定位标签，格式固定为 `mf-dev-flow:<kind>:<key>`，例如 `mf-dev-flow:feature:reader-core`、`mf-dev-flow:task:delivery/20260910-090000Z-reader/fix-theme`。它在**当前工作区**内全局唯一，按现有对象的原生 ID 或路径确定性派生；不使用递增计数器，也不新增登记表、迁移或写入真源。

可引用的对象包括项目与项目卡片、原型组/入口/来源、PRD 来源/批次、系统卡片、功能组/功能、运行/任务、代码文件，以及为将来真源保留的发布（`release`）类型。当前尚无发布真源目录，因此 `release` 只能被格式化和校验，不能被猜测性定位。

需要定位时显式执行：

```bash
mf-dev-flow object locate --ref mf-dev-flow:feature:reader-core --json
```

命令返回对象摘要和当前 Truth Pointer：`storage` 是 `.mf-dev-flow` 内的相对存储位置，`path` 是工作区相对路径，`pointer` 指向文件或记录中的语义位置。看板和图谱的普通状态投影只带 `ref`，不携带 Truth Pointer、绝对路径、会话信息或证据内容。

Object Ref 与图谱内部的 Graph Ref（如 `feature:reader-core`）不是同一个协议：Graph Ref 继续用于图关系和种子选择；只有存在一一映射的对象才会投影 Object Ref。不要把一个格式替换成另一个格式，也不要将 Object Ref 当作跨仓库、跨机器的永久标识；那需要未来单独引入不可变项目 UID 的 V2。
