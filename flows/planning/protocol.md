# 功能演进拆解

功能演进拆解位于“完整原型分析”和“开发任务生成”之间。它不改变原型事实、系统卡片或历史任务，而是把这些当前事实组织成可独立验收、有依赖和优先级的叶子功能地图。

## 触发时机

以下任一条件成立时运行 `feature refine --scope auto`：

- 用户认为当前功能块太粗，要求重新拆分、聚焦或排序；
- 准备规划下一批开发，而 `feature status` 显示地图尚未建立或 `stale`；
- 原型入口、项目文档、系统卡片或代码发生实质变化；
- 新的开发记录暴露出重复任务、耦合边界或拆分方式不合理。

普通任务状态更新不会自动改写功能地图。开发前先执行 `feature status`；过期时重新拆解，避免用旧结构继续生成任务。

原型正文、信息补充、问题回答或范围变化时，必须先读 [prototype-change-impact.md](change-impact.md)，执行 `feature impact` 并按机器计算的关联闭包复评全部子功能及依赖下游。只沿用旧提案并刷新证据游标不能通过门禁；旧地图没有原型基线时需要一次全图复评。

## 固定流程

1. 运行 `feature refine --scope auto`。脚本刷新执行索引，并把当时的事实冻结到 `refinement-runs/<id>/context.json`；同时生成默认读取的 `brief.md` 与相对上一次快照的 `delta.json`：
   - 长期原型功能块、全部原型入口和覆盖证据；
   - 未结束开发任务、最近 12 条终态任务及完整开发任务证据的内容寻址引用；
   - 系统卡片摘要、关键未解决问题及完整系统事实证据的内容寻址引用；
   - `project.json` 中各代码根的 HEAD、分支、变更计数/样本与完整未提交路径指纹的内容寻址引用；
   - 在项目根 Markdown 与常见文档目录中发现的项目文档指纹；没有文档时保持空数组，不创建固定文档。
2. 先阅读 `brief.md` 和上一步 `feature impact --json` 的分页结果；refine 后的影响清单通过 `run context --id <ID> --detail planning --collection impact` 分页复核。再按受影响分组读取：`--detail prototype --group <原型分组ID> --collection features|entries|coverage`；旧/新功能对照使用 `--detail planning --group <业务域ID> --collection features|groups|migrations|impact`。其他事实可用 `--run <开发运行ID>`、`--card <系统卡片ID>` 或 `--root <代码根> --changes` 精确选择。默认每页 5 条、12000 bytes，可用 `--limit 1-20 --max-bytes 2048-32000 --cursor <偏移>` 调整。禁止 `--detail all`，也禁止把完整原型报告、`context.json`、`prototype-impact.json`、`previous-map.json`、`proposal.json` 或完整历史快照塞进上下文；在 `analysis.md` 写清拆分判断、耦合、优先级、阻塞与历史迁移依据。
3. 按业务域创建小型补丁文件，并执行 `feature proposal-patch --run <ID> --from <patch.json>` 增量合并。补丁 `schemaVersion` 为 1，可包含 `groups`、`features`、`migrations`、`impactReviews`；需要删除时用 `remove.groups/features/migrationsFrom/impactReviews`。单个补丁最多 64000 bytes，命令只返回变更 ID、总数和审计路径，不回显整份提案。先按当前产品能力重组功能块，再在每个功能块下创建可独立验收的叶子功能；不要把页面、弹层、文件或接口数量直接当功能边界。功能块和叶子功能都必须填写 `rank`，从上到下就是当前评估与执行顺序。每个叶子功能的 `sourceEntries` 必须至少列出一个当前原型入口；原型分组、问题 ID、旧任务截图都不能替代入口关联。同一入口展示多个独立用户结果时，可关联到多个叶子功能，但每个叶子的 `analysis` 必须说明自身范围。`description` 是基于原型入口、已观察截图和原型说明归纳的概括性功能说明；`analysis` 用作详细功能分析；`developmentRequirements` 概括开发约束。补充分析和标签不授权改写交付状态、阶段或已有阻塞。
4. 执行 `feature apply --from-run <id>`。脚本验证每个叶子功能至少关联一个入口、入口覆盖、每个入口有可展示的 `observed` 来源截图、旧功能迁移、系统卡片引用、状态、概括字段、显式排序和依赖 DAG；依赖必须排在被依赖功能之前，证据已变化时拒绝应用。功能疑问从原型待确认问题与地图阻塞项派生到卡片详情，不复制为第二份事实。

   原型变更还冻结 `previous-map.json`、`prototype-impact.json`；提案必须填写 `prototypeImpactId`、`impactReviews`，具体结构唯一维护在上述复评参考。复评必须覆盖原型分组之下所有受影响旧叶子及新增功能、全部关联任务；应用前重新计算清单，不能手删影响项。`preserve` 保留交付版本，`revalidate` 建立新规划版本和待确认阶段，旧阶段留在历史，不由提案伪造。
5. 用 `feature status` 确认地图为 `fresh`。后续优先运行 `delivery start --source feature-map --intensity ...`。

每个业务域的小补丁使用以下外层结构；记录本身遵守下方完整提案字段契约。命令会按 `group.id`、`feature.id`、`impactReview.featureId` 更新，新的 migration 会替换包含相同 `from` 功能的旧迁移：

```json
{
  "schemaVersion": 1,
  "groups": [{ "id": "library-reading", "title": "书库与阅读", "rank": 10 }],
  "features": [{ "id": "reader-core", "parentId": "library-reading" }],
  "migrations": [{ "type": "split", "from": ["library-reading"], "to": ["reader-core"], "reason": "按独立用户结果拆分" }],
  "impactReviews": [{ "featureId": "reader-core", "decision": "revise" }],
  "remove": {
    "groups": [],
    "features": [],
    "migrationsFrom": [],
    "impactReviews": []
  }
}
```

## 拆分判断

一个叶子功能应表达一个可独立验收的用户或运营结果。满足以下任一条件时可以拆分：

- 用户目标、成功/失败结果或权限边界不同；
- 可以独立交付和回归，不依赖同一未冻结的 DTO、数据模型或共享状态；
- 对应不同的系统能力、开放问题、波次或优先级；
- 历史任务已证明原功能频繁被部分完成或重复领取。

以下情况保持在同一叶子功能或用依赖连接：

- 同一流程的普通视觉状态、空态或错误态；
- 共用尚未冻结的接口契约、数据库模型、全局状态或共享组件；
- 拆开后任一部分无法独立测试或无法产生用户结果。

四个原型大块可以继续作为稳定业务域；叶子功能负责开发粒度。`总体验证`、截图覆盖和跨功能回归属于质量活动，不建成产品功能。

## `proposal.json` 结构

```json
{
  "schemaVersion": 3,
  "runId": "<refinement-run-id>",
  "evidenceCursor": "<保持 context.json 原值>",
  "groups": [
    {
      "id": "library-reading",
      "title": "书库与阅读",
      "rank": 10,
      "sourceFeatureIds": ["library-reading"]
    }
  ],
  "features": [
    {
      "id": "reader-core",
      "title": "阅读器正文与播放",
      "parentId": "library-reading",
      "rank": 10,
      "outcome": "读者可以打开有权限的章节并完成正文阅读与播放",
      "description": "围绕已获访问权限的章节，提供正文阅读、播放和连续阅读的基础体验。",
      "developmentRequirements": [
        "以来源截图和可观察交互为原型对齐依据。",
        "访问权限、章节状态与阅读进度必须沿用已确认的产品边界。"
      ],
      "sourceEntries": ["reader"],
      "scopeRefs": ["F2", "F4"],
      "moduleRefs": ["catalog", "learning"],
      "codeRefs": ["src/server/modules/catalog", "../consumer-app/src/pages/reader"],
      "systemCardRefs": ["backend-service", "consumer-app", "external-platform"],
      "priority": "P0-2",
      "wave": "W0-W1",
      "status": "not_started",
      "dependsOn": ["chapter-access"],
      "blockers": [],
      "taskRefs": []
    }
  ],
  "migrations": [
    {
      "type": "split",
      "from": ["library-reading"],
      "to": ["library-discovery", "chapter-access", "reader-core"],
      "reason": "三个结果可以独立验收，且依赖和开发波次不同"
    }
  ]
}
```

`priority` 使用项目既有 `P0`–`P4`，可保留 `P0-2` 形式的子序；`status` 只能为 `not_started`、`in_progress`、`blocked`、`done`、`skipped` 或 `park`。PARK 功能仍要映射原型入口，但不会被自动提取为开发任务。`description` 与 `developmentRequirements` 是功能卡片的概括信息，均为应用门禁；每个 `sourceEntries` 必须是非空数组、指向当前原型运行中的入口，且每个入口必须有可读取的 `observed` 截图。功能疑问在看板中读取原型待确认问题和 `blockers`，依赖读取 `dependsOn`。`proposal.json` 不允许写 `stages`：功能阶段只能由关联的**产品任务**通过 `delivery stage --task <任务ID>` 更新。

`groups[].rank` 是功能大块的正整数顺序，`features[].rank` 是该功能大块内的正整数顺序；二者分别唯一。看板和开发提取按“功能块 rank → 叶子功能 rank”从上到下显示和选择，最上方表示当前最先评估/处理的功能。`priority`、`wave` 是范围和波次背景标签，不能再作为排序的替代规则。每次 `feature refine` 都允许改变分组、rank 与依赖，只要迁移、入口映射和依赖门禁仍通过。

## 功能点文档区块

功能点详情和“完整功能点详情”使用同一份功能地图、原型证据和交付记录；固定按以下九个区块展示，不在详情中复制或反写真源：

1. **功能说明**（`description`）：根据关联原型入口、原型文档中的已观察截图及其说明，归纳此功能点面向用户的概括内容。它说明“提供什么结果”，不写实现方案，也不把截图中的演示数据当作生产事实。
2. **关联原型入口**（`sourceEntries`）：保留该功能点关联的原型入口及其所属原型分组、证据数量。
3. **来源截图**：复用第 2 项入口在原型文档中已观察到的截图和操作说明；截图属于原型真源，功能地图只引用、不复制。
4. **功能分析**（`analysis`）：继续按现有“原型推导、开发项目现状、外部系统依据、范围与边界、差距与待核验项、分析来源”格式展示。
5. **P / W 标签依据**（`priority` / `wave` 及理由、历史）：继续按现有格式展示，不把 P 当完成状态，也不把 W 当交付阶段或承诺日期。
6. **依赖功能**（`dependsOn`）：只列实施前置功能，不把一般相关性写成依赖。
7. **功能疑问**（关联原型问题和 `blockers`）：记录后续开发可能受影响的问题、阻塞原因及已知结论；已解决项保留状态和处理结论，未解决项会阻断需要其结论的开发。
8. **开发要求**（`developmentRequirements`）：整理本功能点的开发范围、验收约束、依赖和限制，包括用户后续提交且已纳入本轮规划的补充；具体接口字段、实施切片和测试步骤仍在交付任务中维护。
9. **交付阶段**（关联产品任务的 `stages`）：仅在关联任务声明了阶段时显示该任务的阶段状态、验收内容与归档证据；通用任务不预设四阶段。阶段只能由 `delivery stage` 更新，不能通过功能地图提案手工写入。

## 优先级和依赖

每次分析/更新叶子功能都要维护以下字段（旧地图缺失时显示待分析，不自动编造内容）：

- `analysis.prototype`：从原型入口、截图、交互和已确认问题推导用户结果。
- `analysis.code`：核对实际开发项目，区分 Mock、planned/501、静态实现与生产实现，说明可复用点和差距。实现现状取证可先只读 `feature impl-snapshot --id <ID> --json` 拉取 `codeRefs` 的文件指纹、mock/planned 标记与 import 摘要，再打开文件确认；标记是检索线索不是结论。
- `analysis.systems`：引用外部系统卡片/代码事实，说明权威范围、复用限制与未核验部分；不因存在候选 API 就声称已经接通。
- `analysis.scope`、`analysis.gaps[]`：详细产品范围、非目标、缺口与风险；接口字段、实施切片和测试步骤仍留在交付任务。
- `analysis.sources[]`：每项包含 `kind`（`prototype` / `code` / `system`）、`ref`（具体文件/证据定位）和 `note`（支持何种结论）；三类来源都必须有定位。可附文件 SHA-256 固定本次读取版本。
- `priority` / `priorityReason`、`wave` / `waveReason`：分别说明产品优先级和相对开发批次，以及本次维持、补充或调整的原因。P 不是完成状态，W 不是交付阶段或承诺日期；不能从旧路由注释直接复制永久波次。
- `labelHistory` 由 `feature apply` 根据旧地图与新提案追加旧值、新值、理由、时间和运行 ID；提案不得伪造或覆盖旧评估历史。未改值但首次补充理由也要记录。

本次若只补充分析/标签，保留功能 ID、原型入口、依赖、顺序、当前状态及阻塞，阶段始终由关联任务管理。卡片与画板都显示同一份 P/W 值，详情提供详细分析和标签理由。

决定 `rank` 与 `dependsOn` 时，按以下证据判断，不生成脱离项目口径的隐藏评分：

1. 用户明确决定、`docs/功能流程图.md`、`docs/功能范围.md` 与 `docs/开放计划.md` 的范围、访问路径、优先级和波次；
2. 能否解除多个后续功能的关键依赖；
3. 当前在制品是否只差一个安全闭环，避免继续制造重复任务；
4. 系统卡片中的 API、数据和技术问题是否已经满足实施条件；
5. 原型证据、代码和测试是否足以独立验收。

`dependsOn` 只表达实施前置，不用来表达“相关”，并且被依赖项必须在地图中更靠上。相关但没有先后关系的功能通过 `scopeRefs`、`moduleRefs` 或 `systemCardRefs` 关联。

## 历史与应用门禁

- 每个叶子功能至少关联一个当前原型入口；每个原型入口至少映射到一个叶子功能。同一入口展示多个独立用户结果时可被多个叶子功能关联，不能因此把多个结果合并为一个大功能；同一入口的不同证据状态放在各关联功能的来源证据中。
- 每个旧功能必须出现在一条 `migrations.from` 中；迁移目标必须是当前叶子功能。
- 旧任务只保留原始 `features`，不得改写历史。能够从入口、代码范围或执行记录确认时，用 `feature link-task --scope product --leaf-features <ID>` 在 `planning/task-leaf-links.json` 追加其到当前叶子功能的关联；无法确认或仅维护技能、看板、门禁的任务用 `--scope governance` 标记，保留在运行历史中但不进入原型流程。
- 业务域与同一业务域内叶子功能的 `rank` 必须是唯一正整数；依赖必须引用当前叶子功能、无环且在地图中排在被依赖项之前；系统卡片引用必须存在。
- 看板的“扫描事实并更新功能地图”提示词收到 Agent 回答或补充后，必须重新核对截图、开放问题、范围与约定，并在同一轮 `feature refine` / `feature apply` 中同步更新受影响功能的概括字段、依赖、阻塞或拆分；不能只改看板展示。
- `feature apply` 前若证据游标变化，本轮提案作废并重新 `feature refine`，历史运行继续保留。

## 开发提取

`delivery start --source feature-map` 只提取 `not_started`、`in_progress` 或 `blocked` 的叶子功能，跳过 `done`、`skipped` 与 `park`。显式选择功能时，会自动加入仍可开发的前置依赖，并按地图从上到下的功能块与叶子功能顺序提取；依赖门禁已保证此前置项不会落在后面。

功能地图是多真源的当前执行视图，可以重建；原型交互、项目文档、系统事实和历史运行仍由各自真源负责。mf-dev-flow 不预设或创建某组项目文档，只搜索项目根 Markdown 与 `docs`、`doc`、`documentation` 等常见目录，将发现的内容作为高优先级参考证据。功能状态、临时决定与任务进度应写入系统卡片或交付运行，避免静态文档冻结演进结果。

## 功能点下马 / 暂停

用户决定既有功能点暂不开发（暂缓或确认不做）时按范围变化走复评门禁，**不删除功能记录**：

1. 先落语义真源。有对应需求时 `prototype requirement update --id <ID> --status withdrawn`（撤回保留原因与操作者）；纯产品决策用 `prototype note add` 留痕。有效需求必须带 groupId、entryIds 或 `impactScope: "global"`；缺范围的历史记录先补齐或撤回，不能用整图复评代替范围声明。需求被撤回后不得启动或续做相关产品开发。
2. `graph sync --json` 把变化显式写成受影响功能点的 open 复评触发，再 `feature impact --json` 分页核对差异与关联闭包：沿 `parentId` 递归所有后代、沿 `dependsOn` 反向递归所有下游，不按开发状态过滤（`done`/`park`/`skipped`/`blocked` 与进行中均纳入）。下游进入闭包只表示需要复核，是否跟着下马或改依赖由用户决定。
3. `feature refine --scope auto` 固定本轮事实，按受影响分组用 `run context` 分页补证。
4. 每个受影响功能写 `impactReviews`：被下马的功能 `decision: "retire"`、`deliveryImpact: "revalidate"`、`targets` 指向实际新叶子，**保留原 ID** 并将状态改为 `park`（暂缓，可恢复）或 `skipped`（确认不做），不能直接删除；`checks` 逐项说明范围、状态依据、依赖、P/W 与验收核对；`taskDecisions` 覆盖该叶子全部已关联任务，有进行中或可续任务时先按授权 `work supersede` 取代并留阻塞记录，终态任务标 `historical`。
5. `feature proposal-patch --run <ID> --from <patch.json>` 增量提交，`feature apply --from-run <ID>` 通过校验后发布新基线（`labelHistory` 自动追加旧值→新值与理由），再 `feature status` 确认 `fresh`。
6. **主动落地并确认（默认不删功能代码，优先隐藏或跳过）**：下马不只在规划层记录，还要主动检查代码暴露面并处理：
   - 先只读 `feature impl-snapshot --id <ID> --json` 扫描该功能的代码暴露面：`codeRefs` 内的 UI 入口、路由跳转、分享承接（openType=share / onShareAppMessage）、mock 占位与接口引用。
   - 形成技术方案：默认**保留功能代码**，优先隐藏（条件渲染关闭入口、路由不暴露、分享承接移除）或跳过（不展示）；明确改动文件与开关，不删除可恢复实现。
   - 执行隐藏/跳过改动并留痕：涉及代码变更时交接 [交付入口](../delivery/entry.md)，用 governance 任务或轻量交付运行记录「park/skipped 后隐藏入口」，不改功能地图状态；纯规划未开发的暴露面为空则跳过执行。
   - 确认满足用户需求：核对实际页面不再展示该功能入口（截图按视觉验收流程核验，纯渲染开关可用代码核验），与「暂不开发/不上线」决定一致；恢复上线时改回开关即可。

状态为 `park`/`skipped` 的叶子不再被 `delivery start --source feature-map` 提取为开发任务；只补充分析或标签不允许改写状态。被其他功能 `dependsOn` 的下马功能，其下游依赖与顺序应在同一轮复评中核对。下马默认规则是功能代码不删除、优先隐藏或跳过；隐藏属于发布范围调整而非新功能开发，不因下马而扩大功能范围。

## 任务关联模型

`work-plan.json` 的新任务必须写明 `scope`：每个 `product` 任务必须用 `leafFeatureIds` 关联且只关联一个当前叶子功能；`governance` 任务不得关联产品功能。前者驱动功能地图中的叶子状态、阶段和历史，后者只保留在开发运行历史。原型文档与索引只表达原型证据，不渲染或反向保存叶子功能关系、开发依赖、阶段、任务或结果摘要。

## 上下文整理

`context.json` 是不可变的审计快照，不做自动删除或覆盖；大体积证据按哈希存于 `.mf-dev-flow/evidence/`，快照仅引用它们。快照累积后使用：

```bash
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs compact audit
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs compact build
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs compact status
```

`compact build` 生成 `.mf-dev-flow/compaction/index.json`、每个 refinement 的 `brief.md` / `delta.json` 与当前 `planning/context-brief.md`。只有已完成、且不是当前功能地图来源的 refinement 才会被标记为可默认折叠；原始运行目录始终保留，可在需要历史核验时按分区打开。

## 新原型目录的来源关联

新流程读取 prototype catalog 的已接受投影和语义记录，无需 task.json / feature-index.json / coverage.json。sourceEntries 仍必须有真实 observed 截图。尚未在原型出现的用户需求通过 sourceRequirementIds 关联；问题通过 sourceQuestionIds 关联，并在 analysis.prototype 明确其来源和缺口，不伪造截图。输入中的需求/问题 ID 必须存在。需求 proposed/withdrawn 或相关问题 open 时，不得启动或续做产品开发。

## 复评解释与恢复

`feature impact` 的每项 `reasons` 保留直接来源、descendant 与 dependent 路径。逐项解释纳入原因，覆盖 done、park、skipped；preserve 同样记录理由。大幅重组先在提案中给新增、保留、拆并、迁移、需重新验收及全部旧任务处理清单，再 apply；普通重规划保留历史，历史清理不继承别的任务授权。

恢复从本运行 brief 和未完成业务域读取，记录使用的事实指纹、分页游标、已提交补丁与待办分组；续页沿用对应版本，事实变化先重新 refine。利用现有 proposal-patch 和运行上下文恢复，不整读原型／旧地图，也不重复覆盖已完成组。
