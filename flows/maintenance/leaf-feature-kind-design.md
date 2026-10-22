# 叶子功能 kind 化：产品 vs 技术

## 背景

`feature-map.json` 的叶子功能目前隐式全是"产品功能"，每个叶子都带 `outcome`、`sourceEntries`、`prototypeCoverage` 这些用户可感知语义。9/9 那次"统一后端迁移后功能地图复核"被迫把一个纯技术工作塞进了 `store-config-backend`（名字本身就已是后端工作），印证了缺口。

更典型的反例：某次“统一后端能力收口”运行把 9 个功能 ID 写进 `delivery-input.json` 的 `featureIds`，但 7 个任务全登记为 governance；merge-check 报 9 条"叶子功能缺少独立产品任务"。这是结构性矛盾——技术底座工作需要"在地图上有户口"，但产品功能模型不肯给它。

并行还发现两个相关痛点：

1. **N:N 影响无处表达**：六关复习依赖后台改道（技术活），但 `dependsOn` 字段没区分 kind；技术改动的变更通知要靠手动。
2. **复评触发源单一**：现在 `prototypeImpact` 只扫描原型变化触发 `feature impact` → `feature refine`；技术侧发布（如后端改道完成）不会触发产品功能复评，缺口可能漏检。

## 目标

1. 给叶子功能加 `kind: "product" | "technical"`，默认 `product`，保留向后兼容；
2. 复用现有 `dependsOn` 表达 N:N 影响（产品可依赖技术、技术可依赖产品），不引入新的关系表；
3. 复用现有 `impactReviews` 词表（`decision: preserve | revalidate | re-scope`）做变更处置；
4. 复评触发源扩展为"产品侧发布"与"技术侧发布"两类，缺处置即阻断该叶子下次交付；
5. merge-check 按 kind 与运行来源分级，feature-map 派生保留硬门禁、manual/原型 降为审计提醒。

## 模型

### 叶子功能 kind

`feature-map.json.features[].kind`：

- `product`（默认）：用户可感知的产品功能。约束不变——必须有 `outcome`、`sourceEntries`、`prototypeCoverage`、接受 `prototypeDevelopmentProblems` 复评门禁；任务必须按 product 1:1 绑、走后端契约+视觉验收；
- `technical`：技术收口点（迁移、重构、契约、底座）。可缺 `outcome` 与 `prototypeCoverage`，但需声明 `systemCardRefs` 与 `description`；任务 governance / technical 1:N；不触发产品侧复评门禁。

`featureMapProblems` 在第 3 版基础上：

- 强制 `kind ∈ {"product", "technical"}`；
- `kind === "product"` 时保留现有 `sourceEntries`、`developmentRequirements`、`outcome` 强制；
- `kind === "technical"` 时 `sourceEntries: []` 允许、`developmentRequirements` 可空、`outcome` 替为 `description`，但 `systemCardRefs` 必填；
- 已有 24 个叶子在不传 `kind` 时按 `product` 兼容；
- `featureApply` 写入时按 kind 分流默认值。

### 任务绑定

`taskLeafLink.scope` 从 `{product, governance}` 扩到 `{product, technical, governance}`：

- `product`：1:1 绑 `kind === "product"` 叶子；
- `technical`：1:1 绑 `kind === "technical"` 叶子，与 product 同路径（参与 feature-map 硬门禁、参与产品阶段复评），但跳过 `--projects required` 校验（不强制 ui-client 代码根）；
- `governance`：可选 `--related-features`（信息性 N:N），不再硬绑 leaf；`mergeProblems` 不再因 governance 任务未绑 feature 而阻断。

`taskRelatedFeatureIds(run, task)` 读 `task.relatedFeatureIds`，写进 `execution.relatedFeatures` 与 `appendFeatureHistory` 事件，便于审计与看板按相关查询。

### N:N 影响与处置

复用 `dependsOn`：

- 产品叶子 `dependsOn: ["backend-migration"]` → 该产品端到端验收需 backend-migration done；
- 技术叶子 `dependsOn: ["login"]` → 后端迁移工作需登录先发。

复用 `impactReviews`：

- 复评运行对受影响叶子产出决策块（与 9/9 那次同形），由 `featureMapProblems` 校验完整性；
- 技术叶子发布需对所有"产品侧被依赖它的"叶子产出 `decision: preserve | revalidate | re-scope`；缺决策即阻断这些产品的下次交付。

### 复评触发源扩展

`prototypeImpact` 之外新增 `deliveryImpact`：扫描 `deliveryDevelopmentRecords` 中 `taskStatus === "done"` 且 `task.scope ∈ {product, technical}` 的记录，按叶子 kind 决定影响闭包：

- `task.scope === "product"` 发布：影响所有 `dependsOn` 该产品叶子的技术叶子 + 同级产品叶子（现状已经隐式做）；
- `task.scope === "technical"` 发布：影响所有 `dependsOn` 该技术叶子的产品叶子 + 同级技术叶子。

`feature impact --trigger delivery` 启动一次复用 `impactReviews` 词表的复评，缺处置即在 `mergeProblems` 拒绝这些叶子相关的新任务。

### merge-check 分级

`mergeProblems` 第 2697 行的"叶子功能缺少独立产品任务"按来源分级：

- `source === "feature-map"`：保持阻塞；
- `source === "manual" | "prototype"`：转入 `mergeAuditReminders`（不阻塞、仅打印）。

历史上多个 `manual` 输入把 featureIds 当参考范围，把这条降级能消除误报。`feature-map` 的强制保持不变以保住可信度。

## 落地路径

### Phase 1（最小可用，先救活 manual 合并门禁）

- `mergeProblems` 按 source 分级：manual/prototype 降为提醒、feature-map 保持强制；
- `taskLeafLink` 增加 `technical` scope 占位（暂不接 technical 叶子——地图上还没有）；
- `taskRelatedFeatureIds` 落地；
- `work plan` 与 `feature link-task` 接受 `--scope technical`（仅 schema 校验通过，逻辑等同 product）；
- 新增 `scripts/mf-dev-flow.technical-feature.test.mjs` 隔离测试 4 个用例。

### Phase 2（地图 kind 化与影响声明）

- `FEATURE_MAP_SCHEMA_VERSION` 3 → 4；
- `featureMapProblems` 按 kind 分流必填字段；
- `featureApply` 写入按 kind 决定默认值；
- 已有 24 个叶子以 `kind: "product"` 默认应用，不需手工重审；
- `featureMapMarkdown` 加 kind 列；
- 看板按 kind 着色。

### Phase 3（影响触发与复评扩面）

- `deliveryImpact` 函数与 `feature impact --trigger delivery` 命令；
- `impactReviewProblems` 增加"技术发布需对受影响产品叶子有处置"的校验；
- `featureMapProblems` 校验收尾：每个被影响的叶子必须有 `reassessment.reviews` 决策块。

### Phase 4（接入既有 migration）

- 将 `store-config-backend` 拆分或改为 `kind: "technical"`（决策留待规划流程）；
- 历史 `delivery-input.json` 的手动 featureIds 列表在看板标注"参考范围，未承诺交付"。

## 落地状态

| Phase | 状态 | 落地位置 |
| --- | --- | --- |
| 1 · merge-check 分级 / technical scope / related | 已落地 | `modules/runtime/shared.mjs`、`modules/runtime/delivery/work.mjs` |
| 2 · kind 化 / schema v4 / markdown 列 / 看板着色 | 已落地 | `modules/runtime/planning.mjs`、`modules/runtime/shared.mjs`、`dashboard/app/components/feature-analysis.tsx`、`dashboard/app/components/feature-board.tsx` |
| 3 · deliveryImpact / `--trigger delivery` / 复评扩面 | 已落地 | `modules/planning/impact.mjs`、`modules/runtime/planning.mjs` |
| 4 · 看板参考范围标注 | 已落地 | `dashboard/server/readers/runs.js`、`dashboard/app/components/run-history.tsx` |
| 4 · `store-config-backend` kind 迁移 | 待规划流程决策 | 代码路径已备（`feature apply` 支持写入 `kind`）；实际改写须走 `feature refine` + `impactReviews`，不能手改地图 |

Phase 4 的 `store-config-backend` 迁移是规划流程动作而非代码缺陷：`featureApply` 已能在应用提案时写入并规范化 `kind`，但把一个已验收的产品叶子改成技术叶子会改变它的交付语义（不再要求 `outcome`/`sourceEntries`、不再接受产品侧复评门禁），必须伴随一次正式的 `feature refine` 与复评处置，因此本轮只提供能力、不擅自改写真源。

补充约束（实现期发现）：`reassessment` 在 feature-map 里有两种形制——复评流程写入的 `{ status, runId, prototypeFingerprint, reviews }` 与 graph 侧 `graph sync/flag/clear` 落盘的 `{ triggers: [...] }`。`featureMapProblems` 的收尾校验只在 `reviews` 键存在时介入，避免把 graph 形制误判为空壳。

## 风险与边界

- **不互相冒充**：技术任务不能回写产品叶子状态，技术叶子本身有独立状态账本；
- **不改变 1:1**：产品叶子"一个产品任务"不变量保持；技术叶子允许 1:N 但每个 governance 任务只归属于一个技术叶子（或仅 related）；
- **不引入隐式 N:N**：任务绑定保持稀疏；N:N 影响走 `dependsOn` 与 `impactReviews`，二者均可在地图直接观测。

## 与既有协议的一致性

- `flows/delivery/protocol.md` 关于"产品源码观察、用户意图、开发状态各按本流程记录，不能互相冒充"的边界在本设计中保留为硬约束；
- `flows/maintenance/architecture.md` 关于"verification 命令必须在隔离 fixture 中运行被测 CLI，禁止借真实项目"的约束在 Phase 1 起就遵守，所有新增测试都基于 `os.tmpdir()` 临时目录；
- 看板数据访问仍只通过公共 CLI（`feature status` / `feature map`），不在 dashboard 直查 `feature-map.json`。
