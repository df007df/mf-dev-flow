# 原型变更 → 功能全集复评门禁

当原型正文、信息补充、问题回答、入口/分组、交互证据或源码范围变动后，必须读取本章。目标是**找到全部关联功能并重新评估是否需要修改**，不是无条件重写所有功能，也不是把历史完成状态清零。

## 固定闭环与权限

1. 按原型流程核对补充内容、保留旧回答与结论，再合入长期真源。可观察交互变化须先补证；未更新真源的源码变化不能直接刷新规划基线。
2. 先 `graph sync --json`：只读复用同一漂移算法，把原型/问题/需求变化**显式写成受影响功能点的 open 复评触发**（写 feature-map 真源并重建图/看板索引；同 triggerRef+同指纹幂等，不重复置脏）。随后 `feature impact --json` 按页只读计算差异和关联闭包，不启动浏览器、不生成源码地图、不写执行索引，不自动创建运行。返回旧/新指纹、变动分组/入口、每个受影响功能 ID、原状态和纳入原因。
3. 正常的原型更新闭环应继续 `feature refine --scope auto`，读取 `brief.md`，并用 `run context --detail planning --collection impact` 分页读取冻结的影响清单；再用 `--detail prototype|planning --group <ID>` 分组读取原型和旧/新功能对照，按需分页读取代码和外部系统证据。不要整读 `prototype-impact.json`、`previous-map.json` 或 `proposal.json`。逐项评估**所有受影响功能及新增功能**；每个业务域用 `feature proposal-patch --run <ID> --from <patch.json>` 增量更新范围、方向、说明、详细分析、状态判断、依赖、P/W 与理由、验收边界及迁移。保持不变也要说明为什么。
4. `feature apply --from-run <ID>` 校验全部结论与实时证据后统一发布整张地图，并保留复评与旧规划快照（`reassessment` 落 reviewed → 图上投影为 cleared，同时前进 `prototypeBaseline`）。再用 `feature status` 确认 fresh。若复评任务已终态但未整图 apply，可 `graph clear --by-task <runId/taskLeaf>` 授权把该任务 sourceRefs 内功能点的 open 触发落为 cleared。只有通过门禁后才能继续开发。

用户明确只更新原型、只优化技能、稍后手动分析/重规划时，不擅自执行后续链路；说明待复评范围，门禁继续保持。补充信息不是产品代码开发授权。遇到冲突决策或需要取代执行中的任务，先说明影响并按用户授权处理；不能为了通过复评门禁擅自取消任务。

## 差异与关联规则（代码执行，不靠 Agent 手选）

`modules/planning/impact.mjs` 维护统一算法；现代原型经公共 CLI 读取。看板和运行命令复用该算法。

- 指纹包含已接受原型结论、问题原文/回答/状态、已声明范围的需求与说明、当前已接受来源；同时核对已登记的本地源码文件及覆盖证据中的截图内容。只补文字、不改版本号或更新时间，也会失效。
- 现代记录按 groupId/entryIds 归属；`impactScope: "global"` 的需求、已接受来源切换、无法安全归属的原型事实才保守要求整图复评，不用标题猜测范围。有效需求漏写范围不会假装成全局变化：状态显示 `scope_required`，先补 groupId/entryIds 或显式 global，`feature refine/apply` 才能继续。
- 新来源尚未 `prototype accept` 时，已发布地图继续以已接受来源计算，不因活动批次的空文件清单变成 stale；`feature status` 会报告发布门禁，`feature refine/apply` 被拒绝，直到新来源完成核验。已接受来源切换后仍按全局迁移处理。
- 用**旧、新两侧**的分组和入口关联，覆盖新增、删除、改属、重命名。由功能的 `sourceRequirementIds`、`sourceQuestionIds`、`sourceEntries`、功能组的 `sourceFeatureIds` 以及迁移链找到既有功能；沿 `parentId` 递归所有后代，再沿 `dependsOn` 的反向关系递归所有下游，直到集合不再增长。
- 不按开发状态过滤：`done`、`park`、`skipped`、`blocked` 和执行中功能都要纳入。`dependsOn` 是实施前置，反向传播只表示需要复核，不意味着必然修改。
- 现行可发布地图仍是“业务域 + 叶子功能”，算法不限制后代深度；不要为此擅自把地图 schema 改成无限层级。
- 旧地图没有 `prototypeBaseline` 时，不能证明它已经评估过当前补充内容：要求一次全图复评。旧记录仍可读，不自动回填历史 baseline。
- 本地源码指纹仅核验登记位置与覆盖清单内文件，不是新的完整源码/运行态扫描；外部 URL 内容变化需按原型流程重新取证登记。未知动态交互的完整性仍由 `prototype init/next/audit/accept` 流程负责，不由本门禁冒充。

## 新增记录与提案字段

每个新 refinement 冻结 `previous-map.json`（当时整张功能地图或 null）和 `prototype-impact.json`（机器计算的差异清单）；`context.prototype.revision` 是本轮原型内容指纹。应用时重算影响，不信任 Agent 删减后的清单；前一张地图或本轮原型/其他证据再次变化，提案作废，重新 refine。

提案在原有结构上增加 `prototypeImpactId`（沿用生成值）与 `impactReviews`。示例是一条保持不变的结论，不能批量复制示例文本充当实际分析：

```json
{
  "featureId": "reader-core",
  "decision": "keep",
  "deliveryImpact": "preserve",
  "targets": ["reader-core"],
  "reason": "补充说明明确了已有返回路径，当前范围与代码证据已覆盖，保持原规划",
  "checks": {
    "scope": "逐项对照新说明与当前用户结果，说明范围是否变化",
    "status": "核对已有任务及实际实现，说明保留/调整当前状态的依据",
    "dependencies": "核对前置与全部受影响下游，说明维持/调整原因",
    "priority": "说明 P 旧值、新值与理由",
    "wave": "说明 W 旧值、新值与理由",
    "acceptance": "核对新增成功/异常路径与旧验收，说明是否需要重新验证"
  },
  "evidence": [
    { "kind": "prototype", "ref": "prototype/report.md#分组ID/入口ID", "note": "本次补充支持的判断" },
    { "kind": "code", "ref": "开发项目实际文件与符号", "note": "区分已有、Mock、未实现" },
    { "kind": "system", "ref": "system/cards.json#实际卡片ID", "note": "系统依据或明确没有已核验依据" }
  ],
  "taskDecisions": [
    { "runId": "实际开发运行ID", "taskId": "实际任务ID", "action": "continue", "reason": "当前任务契约和验收范围不变，可以继续" }
  ]
}
```

- `decision`：`keep` 保持、`revise` 修改、`split` 拆分、`merge` 合并、`retire` 退役、`add` 新增。每个受影响旧叶子和新增叶子必须恰有一条复评；`targets` 指向实际新叶子。退役保留原 ID 为 `park/skipped`，不能直接删除。拆分/合并可有新 ID，但必须完整迁移。
- `migrations` 不仅迁移原型分组，还必须记录受影响的**旧叶子 ID → 新叶子 ID**。漏任何子功能、未知目标、删除无关功能或把无关重组混入本轮原型复评，均拒绝应用；无关重组另开 refinement。
- 每个目标叶子必须补齐完整 `analysis`、三类可定位来源、`priorityReason`、`waveReason`。来源不足时明确缺口，不编造外部系统已核验事实。
- `deliveryImpact: preserve` 保留原交付版本。`keep` 不能暗改规划字段；`revise + preserve` 仅允许 P/W、rank 或分析理由调整，不得改变范围、依赖、状态等验收输入。
- `deliveryImpact: revalidate` 用于真实范围/结构变化。发布新 `planningRevision`，新版本的阶段变为待确认，当前状态只能待开发/阻塞/暂缓（退役为 park/skipped）。旧状态和阶段完整留在 `previous-map.json` 与历史任务中。后续任务绑定新版本；旧任务不能把新版本再次投影为 done。
- `taskDecisions` 必须覆盖该旧叶子的**全部已关联任务**，不只最近几项。`continue` 仅允许仍在执行且保留交付版本的任务；终态任务为 `historical`，已实际取代的任务为 `superseded`。没有任务时为空数组。
- 若真实范围变化影响进行中、blocked 或可续检查点任务，不能直接发布并让其继续旧范围。先记录阻塞、按授权使用既有 `work supersede` 保留旧记录并取代任务，再重新 refine；不要把普通中间阶段续做误判成新任务，也不要用 `work replan` 的写范围调整冒充语义重规划。

## 开发门禁与展示

`feature start`、`delivery start`、产品 `work plan/claim/bind-session`、写前 `work lease --for-write`、推进/确认 `delivery stage`、`work finish done`、完成检查点、合并验证、运行完成检查共用原型复评约束。已领取任务同样检查；更换会话不能解除复评门禁。确认未受影响的现有任务可继续，但新地图提取在整轮复评发布前保守阻止。

允许读取、诊断、留阻塞记录和按授权取代旧任务，不能让门禁妨碍安全停止。治理任务不受产品原型门禁约束。门禁只覆盖工具管理的生命周期与写前 hook，不声称可阻止用户手工编辑所有文件。

看板只读派生 `planningStatus: review_required` 与原型复评阻塞说明；不把它写成开发状态。功能自身状态、原阶段与原历史仍可查看。复评后在功能历史追加 `planning_reassessed`，新地图保留 `reassessment` 定位与结论。算法保证关联清单与字段完整，不能替代 Agent 对证据真实性、功能含义、迁移合理性与取值理由的审阅。

分页影响输出含 assessedCount / affectedCount 和 revision，续页传 --cursor 与 --revision；完整清单由脚本保存在本轮 prototype-impact.json。遍历进度和同内容回答的纯历史追加不改变规划新鲜度。
