# modules/graph — 变更传播图层（M2）

`graph.json` 是**可重建索引，不是第二真源**：节点内容真相在 feature-map、prd/、system/、tasks/ 与工程源码；删除后 `graph build` 即可恢复（字节确定，无墙钟字段）。

- `graph.mjs`：构建（节点分类、封闭边组合校验 EDGE_COMBOS、内容指纹、reassessment legacy→trigger 列表投影）、漂移比较、原子落盘与 `rebuild-report.md`。未解析引用逐条列出，不猜。legacy refinement 写入的 `reassessment.status:"reviewed"`（已被该 run 复核处理）迁移为 `cleared`（`clearedByTask=runId`）；未复核漂移（`stale`）保持 `open`。task 层以 `.mf-dev-flow/tasks/`（kernel 记录）为真源，`execution-index` 仅对 kernel 未覆盖的历史运行兜底 implements，已覆盖者不产平行边（单一真源）。
- `closure.mjs`：泛化闭包。传播边方向统一"依赖方→被依赖方"，`evidence-for` 数据方向相反（来源→被支持实体）遍历时对调；`task`/`code` 是记录终点不置脏；dependents 方向（谁受影响）与 sources 方向（看板下钻/git 圈范围）共用同一索引器。
- `prototype-fingerprints.mjs`：分组/入口内容指纹（M3b）——对 `planningPrototype` 视图的纯函数；行序无关，`updatedAt/revision` 不计入；无法归属或指向已不存在分组的需求/问题按协议口径保守计入全部分组（"不可安全归属→整图复评"）。
- CLI（`modules/runtime/graph.mjs`）：`graph build [--check]`、`graph node --ref`、`graph impact --from <refs> [--direction]`、`graph sync [--dry-run]`、`graph flag --feature --trigger [--kind --fingerprint --source]`、`graph clear --by-task <runId/taskLeaf>`、`graph render --focus [--depth --out]`。build/render/impact 只读或重建索引；impact 仅输出闭包+建议分派（来自 TaskType dispatch，autoCreate=false + batching per-trigger），开任务仍需 flow route/claim 授权；sync/flag/clear 写 feature-map 真源后自动重建索引。

- `dispatch.mjs`：分派建议单一实现（CLI graph impact 与看板 reader 共用），读 TaskType 注册表规则，只建议不建运行。
- `render.mjs`：焦点闭包 → 确定性 SVG（无时间戳，同输入字节一致），CLI `graph render --focus [--depth] [--out]` 与看板 `/api/graph?svg=` 共用。
- 看板（M4-1）：`dashboard/server/readers/graph.js` 只读复用本模块（buildGraph 纯读不落盘，HTTP 只读契约保持）；`/api/graph`（snapshot / ?impact= / ?svg=）；画布区 `components/graph-board.tsx`（kind 分列布局、种子追踪高亮、dispatch 建议展示、SVG 下载）。

M5 割接（已完成）：真实仓库 `graph build` 接入 `.mf-dev-flow/tasks/` 后，15 个历史交付运行经 `kernel backfill` 回填为 15 run + 18 task 内核记录；task 节点、observed-change（touchedRefs→code）与 implements 边的 declaredBy 实时登记为 `kernel:<id>`，execution-index 兜底跳过 kernel 已覆盖任务；历史 `refinement-runs/system-runs`（39 项）已删、`feature-history` 只清理引用已删除运行的悬垂事件（丢 47 条 planning_reassessed，保留 137 条指向存活 delivery 运行的 task/stage/verification 溯源）、execution-index 重建为 15 delivery。真实图割接后 178 节点 / 267 边、两次 build 字节一致、0 problem。

复评触发闭环（M6）：真源为 `feature-map` 的 `features[].reassessment`（`reassessment` 在 `FEATURE_VOLATILE` 内，写它不动节点指纹、不破坏 build 确定性），graph.json 只投影。`graph sync [--dry-run]` 是漂移→脏的自动写入口：只读复用 `prototypeImpact`（不重造 diff），把受影响功能按 sourceEntries/sourceFeatureIds/sourceRequirementIds/sourceQuestionIds 精确落成 open 触发，继承型（descendant/dependent/migration）或不可归属（global/无 baseline）落一个 `prototype:drift` 兜底，触发指纹取新 revision，同 triggerRef+同指纹幂等。规划流 `start` 已接 `graph sync`（在只读 `feature impact` 之前），原型接受/回答/需求变化后由流程文档指示运行。`graph flag` 是同层显式手工置脏；`graph clear --by-task <runId/taskLeaf>` 按内核任务授权清脏（仅终态 completed/superseded 可清，范围限定该任务 sourceRefs 内的 feature:，只翻 open→cleared 并记 clearedByTask/clearedAt；无内核记录先 kernel backfill）。三者写 feature-map 后自动 rebuild 索引。旧形制 `{status:reviewed,…}` 迁移为 cleared 触发并把原对象留存到 `reassessment.legacy` 保审计。

已知边界：`clear` 只把存储触发翻成 cleared，功能点持久"变干净"要靠 `feature apply` 前进 `prototypeBaseline`（否则同指纹漂移下次 `sync` 会再置脏一次）——apply 是持久清除、clear 是任务态标记；`prototype` 命令自身不内联调用 `sync`（由流程/Agent 按文档显式运行，保持 feature impact 只读、prototype 模块不反向依赖 planning/graph）；catalog 存在时 prototype 分组/入口指纹已接入，读失败逐条进报告不猜；`sourced-from`（分组→原型源文件）边仍待 catalog 归属字段接线。
