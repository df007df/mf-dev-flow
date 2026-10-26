# 原型内部索引与公共 CLI 契约

## 输入与来源适配层

`prototype init --input input.json --request-id <ID> --expected-revision 0 [--batch <ID>]` 输入：

```json
{
  "schemaVersion": 1,
  "source": {
    "type": "html",
    "workspaceRoot": "/absolute/workspace",
    "location": "prototype/index.html"
  },
  "scope": {
    "mode": "full",
    "observableBoundary": "本地演示原型；远程支付、无限动态数据不可观察"
  }
}
```

`workspaceRoot` 可省略（默认为命令工作区），`location` 支持绝对路径。当前只实现本地 HTML 入口；入口目录内 HTML/JS/TS/CSS/JSON 文件组成保守来源集合，`.git`、`node_modules`、`.mf-dev-flow` 不进入集合。符号链接、解析失败、外部引用和未知动态依赖需要明确核对。输出固定在工作区 `.mf-dev-flow/prototype/analyses/<批次ID>/`，必须在来源树之外。

本地 HTML 项目可以整体移动或复制。目录打开后，CLI 会用初始化时 `workspaceRoot → location` 的安全相对关系在当前工作区重定位来源；只有相对入口确实存在时才使用新位置，目录外来源、缺失入口或内容变化仍按 stale 处理。持久化记录保留原始登记位置用于审计，不因重定位改写历史。

静态 HTML 的 `analysisAdapters` 与运行态 `runtimeAdapters` 分开登记。只读发现使用 `prototype process list`、`prototype adapter list` 和 `prototype adapter capabilities --adapter web-runtime@1`；流程列表只给出 ID、版本、标题、阶段 ID 和哈希，适配器只给出声明能力，均不泄露 Agent 指令文本。

`runtime-analysis@1` 配合 `web-runtime@1` 的 init 额外传 `--process runtime-analysis@1 --adapter web-runtime@1 --evidence-profile runtime-only --agent scope-snapshot`。其输入来源形状为：

```json
{
  "schemaVersion": 1,
  "source": {
    "type": "runtime",
    "adapter": "web-runtime@1",
    "locator": {"url": "https://preview.example.test/path"},
    "revision": "build-2026-09-07.1"
  },
  "scope": {
    "mode": "full",
    "observableBoundary": "仅运行态观察；未观察状态与源码不可声明完整"
  }
}
```

`revision` 必须是明确的构建／预览版本，不能缺失；URL 会移除 query 与 fragment，且拒绝凭据。也可使用 `locator.localPreview`，同样不得携带凭据、query 或 fragment。运行态输入不得填写 `candidates`、`sourceFiles`、`sourceDiscovery` 或 `sourceComplete`。它生成空的静态来源清单，因此任何通过的结论都是运行态证据边界内的结论，不是源码覆盖证明。

微信开发者工具小程序模拟器使用 `runtime-analysis@1` 与 `wechat-miniapp-runtime@1`，并以 `runtime-only` 初始化。其来源只接受不可变 compile revision，以及 `{ "mode": "wechat-devtools-simulator", "projectPath": "<安全项目路径>", "entryRoute": "pages/<入口路由>" }`；小程序 projectPath：只接受经过净化的工作区相对路径，不允许任何绝对路径。入口路由必须以 `pages/` 开头，不能含 query、URI scheme、空段或 `..`。适配器不声明静态源码发现或 `source-and-runtime` 覆盖。

小程序未知分支：不可观察页面或分支保持未完成，不得计入覆盖。它们应保留原因、影响和待确认问题，供下一次已授权模拟器观察继续处理。

iOS 原生 App 模拟器使用 `runtime-analysis@1` 与 `ios-app-runtime@1`，并以 `runtime-only` 初始化。其来源只接受不可变 build revision，以及 `{ "mode": "ios-simulator", "bundleId": "<反向 DNS 标识>", "device": "<模拟器名称或 UDID>" }`；iOS bundleId：只接受反向 DNS bundle identifier，device 只接受模拟器名称或 UDID，不允许绝对路径、家目录展开或凭据。locator 只能含 `mode`、`bundleId`、`device` 三个字段，revision 沿用有界不透明标识校验。适配器不声明静态源码发现或 `source-and-runtime` 覆盖。

iOS 未知分支：不可观察界面或分支保持未完成，不得计入覆盖。它们应保留原因、影响和待确认问题，供下一次已授权模拟器观察继续处理。

静态 HTML 适配器返回 `schemaVersion/extractorVersion`、`origin{entry,root}`、`sourceFiles[{path,sha256}]`、`candidates[{id,kind,file,line,column,snippet,outcomes}]`、`problems[]`。此形状与现有源码地图 v1 一致；HTML 实现在 `modules/prototype/core/html-source.js`。运行态网页以冻结 locator／revision 和空静态清单建立快照，不能伪造 JS 分支、源码完整性或 observed 动作。

初始化自动冻结 `source-map.json`，记录内容指纹、创建时间、随机 snapshotId 和实际抽取器签名。新来源通过 init 新建批次，先查 status 的 semanticRevision 并作为 expected-revision；只复用静态解析，不导入旧完成状态或证据。新快照即使源码完全相同也从未观察开始。

用户指定的分析方法与范围由独立 AR 台账 `.mf-dev-flow/prototype/analysis-requirements.json` 保存；详见 [分析要求](analysis-requirements.md)。公共 init 按输入来源、模式和标签选择当时适用的 active AR，并冻结为保留字段 `scope.analysisRequirements`；调用方不能注入该快照，只可用 `scope.analysisRequirementIds` 或标签显式选择。`status/next/query` 提供本批次冻结引用，要求不是原型分组，也不进入完整报告正文。

AR 台账的后续变更不使既有批次、已接受结论或规划自动过期；它只作用于之后新建的分析批次。受管批次的 freshness 只根据来源快照、抽取器和已归档证据判断，不能把全局 AR 台账指纹当成原型事实。若需要按新 AR 重做历史核对，用户明确授权后新建有范围的批次，旧批次仍保留。旧 `prototype/analysis-requirements.md` 是未分类兼容材料，永不自动应用或迁移。

功能级最终验收用例（AC）另存于 `.mf-dev-flow/planning/acceptance-cases.json`，不属于原型目录或原型语义修订。交付运行从 feature-map 创建时为每个功能冻结 active AC；仅它们进入该任务的 `end_to_end_acceptance` 阶段。后续 AC 变更不回写既有任务，不能让原型状态或旧交付任务变 stale。

## 持久化与一致性

`.mf-dev-flow/prototype/catalog.sqlite` 保存已接受的结论、问答/需求/说明和历史；`analyses/<ID>/index.sqlite` 保存该批次遍历，`records` 主键为 `(type,id)`，另有来源/节点/状态索引、幂等请求表和元数据。文件与候选的静态字段不可修改；来源变化需新快照。`put` 单批事务提交，失败整批回滚；数据库串行化写入，更新已存在条目必须提供 `expectedRevision`。这不是工作租约，多执行者仍需按文件或节点分工；冲突后重新读取条目，不覆盖他人修改。

公共命令均以 `prototype` 为前缀；`query/next/put/evidence/audit/freshness` 默认选择当前分析，可用 `--batch <ID>` 精确续做。不接受 --out。

运行态批次的写命令必须携带当前阶段的 `--agent`。`checkpoint --stage <当前阶段> --to <下一阶段> --outcome validated|gap --reason <非空理由> --request-id <ID> --expected-revision <索引revision> --agent <当前Agent>` 在 SQLite 写事务内复核阶段、图边和 revision；同一 request-id 的同载荷可重放。允许图为 `scope-snapshot → structure-model → runtime-observe → audit-accept`，其中 `runtime-observe → structure-model`、`audit-accept → structure-model` 和 `audit-accept → runtime-observe` 是显式返工环。无流程快照的旧 HTML 批次仍不要求 `--agent`，不因本契约获得新门禁。

`query/next` 返回 `schemaVersion/revision/items/nextCursor/bytes`。分页续读传 `--revision`，数据库修订变更时从 cursor 0 重新查询。默认摘要含用途、状态、是否分析、是否有截图、最多 3 个证据 ID 和引用；`--detail` 返回当前单项完整结构。未知字段不会被摘要展开。

- 筛选：`--type`、`--file`（来源根相对路径，精确匹配）、`--node`（边按 from、出现关系/盘点按 nodeId）、`--status`（有效状态）、`--id`、`--kind`。
- `--limit 1..50`，默认 20；`--max-bytes 1024..65536`，默认 16384，包含 UTF-8 和换行。超大单项只返回 ID/引用，不能绕过总字节上限。
- `--field FIELD --text-offset N --text-limit N` 返回字段序列化文本切片（1..8192 字符），带 nextTextOffset；仍受字节总上限。
- `next` 只列文件/候选/节点/边/状态空间/向量/出现关系/盘点/入口的未完成项，也保留 blocked/unavailable；动态发现仍须持续加入索引。
- `put --input batch.json --request-id UNIQUE` 最多 50 项、1 MiB，单项最多 64 KiB。相同请求 ID 与相同内容可安全重试；不同内容拒绝。内容不变的记录幂等返回，不需 revision。

```json
[
  {
    "type": "node",
    "record": {
      "id": "home-guest",
      "label": "首页·访客",
      "purpose": "查看课程并选择学习入口",
      "groupId": "learning",
      "resetAction": "全新上下文进入首页",
      "values": { "role": "guest" },
      "entryIds": ["home-guest"],
      "status": "pending",
      "evidenceIds": []
    }
  }
]
```

创建后返回 record revision。更新时提交完整当前记录及修改（不要漏掉冻结字段），在外层加 `expectedRevision`。无需手动维护 remaining/visited、数量或 evidence 内嵌对象。

误建的计划边可用 `put` 更新为 `status:"retired"`，必须带 reason/reviewer/有效 sourceIds，且该边从未观察、没有 evidenceIds。记录与撤回依据保留在索引/报告中，独立计数，不计为覆盖；仍引用该边的 candidate/occurrence 必须显式修正，否则审计继续失败。源码分支若确不可达仍需 candidate.outcomeExclusions 的逐分支依据。已观察过的边即使改回 pending 也不能撤回；不能以此省略隐藏或异常交互。

## 记录类型

| type | 关键字段与约束 |
| --- | --- |
| file | 自动创建：id/path/sha256/file；可补 purpose/status。分析状态从该文件候选闭环派生；没有候选的 CSS/JSON 等需明确 reviewed。截图通过 page 候选关联 node 的 evidenceIds 派生。 |
| candidate | 自动创建：kind/file/line/column/snippet/outcomes；补 status=mapped/excluded/reviewed、nodeIds/stateSpaceIds/edgeIds。page 对 node，state 对 space，其他对 edge；依赖 reviewed 或排除必须 reason/reviewer/sourceIds。分支排除逐 outcomeExclusions 登记。 |
| group | id/title/purpose/order/entryNodeIds；用户流程分组，非开发功能点。 |
| entry | id/feature（group ID）/status/evidenceIds；独立登记的可观察页面/状态入口。 |
| node | id/label/purpose/groupId/values/resetAction/entryIds/status/evidenceIds；每个可观察状态单列，截图不能证明其他状态。 |
| control | id/locator/event/sourceIds；定义按定位、事件和源码来源去重。省略 ID 可生成稳定 ID；相同定义不能另建重复 ID。 |
| edge | id/from/to/controlId/action/inputClass/outcomeKey/outcome/sourceIds/candidateOutcomes/status/evidenceIds；action={type,target,force:false,script:false}。身份按 from/controlId/action.type/inputClass/outcomeKey 唯一且不可更换。输入具体测试值在追踪/动作中保留。 |
| occurrence | id/nodeId/controlId/edgeIds；同一控件定义在不同状态分别出现；nodeId+controlId 唯一。有效覆盖从所有关联边派生，边必须从该节点操作该控件。 |
| sweep | id 必须等于 nodeId；complete/discoveryIds/status/evidenceIds。每次进入新状态或重新渲染，重新盘点并合入该状态的全部发现；没有控件也保存空 discoveryIds 的真实盘点追踪。 |
| space | id/sourceIds/dimensions/reductions；每个维度列有限 string/number/boolean 值，空 dimensions 为一个空向量。约简逐组合登记 values/reason/reviewer/sourceIds。 |
| vector | id/spaceId/values/resetAction/status/evidenceIds；每个保留组合独立重置并取证。 |
| question / requirement / note | 不通过 put；专用语义命令见 [问题与需求](semantics.md)。问题开放不阻止如实报告遍历完成，但关联问题阻止开发。 |
| evidence | 仅通过 evidence 命令归档，其他记录引用 evidenceIds；不接受内嵌 evidence 数组或 observedControl 重对象。 |

完整字段的 legacy v1 校验规则及排除/约简口径见 [共享图审计契约](legacy-map-contract.md) 的字段章节；原型分析时不需要加载 mf-dev-flow 交付流程。

### 证据提交

`evidence --input evidence.json` 示例（这里只是结构，不能拿示例声明已操作）：

```json
{
  "snapshotId": "从 init 结果获得的当前快照 ID",
  "path": "/absolute/browser-capture.png",
  "trace": "/absolute/actual-actions.jsonl",
  "capturedAt": "2026-09-05T12:00:00.000Z",
  "action": "访客进入首页，点击课程，出现登录提示",
  "assertion": { "expected": "登录提示可见", "actual": "登录提示可见", "passed": true }
}
```

截图和追踪必须是已存在非空文件；capturedAt 不早于本快照、不晚于当前时间 5 分钟。归档以文件内容哈希去重，证据元数据以完整语义去重，路径分别为 `screenshots/<hash>.<ext>` 和 `traces/<hash>.trace`。命令不拍图、不点击，也不能鉴定提交内容的真实性；Agent 必须实际操作、查看图片和追踪。查看截图必须通过图片分析能力（支持图像输入的大模型、图片理解技能/工具或视觉 Agent）完成，仅凭源码、DOM 或文本断言不能替代查看图片；当前环境无图像输入时先向用户确认视觉通道，用户明确坚持非视觉方式时才可继续并随批次记录。失败结果如果符合预期异常分支，可以 assertion passed=true；未验证失败保留 pending/blocked、原因和诊断引用。

## 派生结果与完成判定

`status/summary` 返回目录状态、当前/已接受批次、语义修订、内容指纹、数量和来源问题；遍历详情从 next/query 读取。`report` 生成完整 `report.md`、轻量 `brief.json`、完整 `audit.json`（只读磁盘审计产物）。报告按 group.order/entryNodeIds 及边 order 走用户流程，保留其余节点；包含页面用途、状态、路径、全部交互与截图链接、问题、文件索引及未覆盖项。状态空间、源码候选排除和撤回计划边只保留在内部索引与 `audit.json` 中用于完成门禁，不输出到面向用户的完整报告。每个页面或状态的主证据用“截图 / 操作与结果 / 证据”表格成组展示，不把截图和说明拆成相邻的独立段落。语义说明由结构化记录中的 purpose/outcome/question 等字段提供，不能手改派生报告作为新真源。章节、层级、图片表格、版本和发布校验以 [原型分析报告格式 v1](report-format.md) 为准。

`.mf-dev-flow/prototype/report.md` 是唯一当前“完整原型图流程”报告。每次分析批次形成这份报告的一次修订：合入本次新增或更正的观察、截图、问题与回答，同时保留未受影响的既有分组和证据；历史批次中的报告只是当时修订的快照。截图与证据索引只列当前节点、边、状态向量、入口与盘点仍引用的有效证据；被新证据替换的旧图继续留在批次归档中追溯，不再混入当前报告。局部分析不能产出一份替代主报告的孤立局部文档，也不能因本批次未触及某组就从当前完整报告删除该组。

`audit` CLI 仅分页返回问题，不打印大图。完成需要共享审计同时核验源码候选、反向引用、所有分支、状态笛卡尔积、全部入口与动态控件、每个节点盘点，以及当前快照证据。队列依据有效证据与依赖计算，不接受单个 clicked=true 代替这些项。结构审计无法证明未知程序域的数学穷尽，也不能验证排除理由的语义正确性；Agent 必须复核。

缓存键包含文件内容 SHA-256、路径、抽取器源码签名及固定解析器版本；内容和版本不变时复用静态解析。当前依赖图未知，所以任何来源文件集合/内容或抽取器变化都保守使整个运行态快照过期。`freshness` 显示 changedFiles、extractorChanged、失效策略与缓存命中；`query` 只返回 stale 历史条目，`next/put/evidence` 拒绝继续，audit 不能通过。新目录可复用未变文件的解析，不复用 observed 状态。

报告和审计为了对账会在脚本内物化完整图；这节省的是给 Agent 的上下文，不声称脚本端内存为常数。现代看板与规划通过 CLI 的 query/revision/document 校验和分页读取，不查 SQLite、不依赖 JSON 导出；看板打开已经校验的完整报告时可通过受限归档文件路由一次下载，避免为 UI 启动上百个分页 CLI 进程。

## 接受结论、报告与失败边界

`prototype accept --request-id <ID> --expected-revision <N>` 在完整 audit 后保存不可变投影快照，形成规划可消费结论。产品指纹包括来源与语义，不含普通 put 的进度 revision 或冻结 AR；AR 仅作为快照审计证据保存。重复接受相同的来源与原型语义不制造产品变更，即使新批次采用了新版 AR。旧接受快照与问答历史保持可追溯。

`prototype accept` 成功后自动生成主目录 report.md；已验收结论上的问题、需求或说明变更也会自动重建它。分析中的 `put/evidence` 只使报告等待下一次验收，避免把频繁的中间观察写成当前结论。`prototype report` 保留为显式重建或历史修复命令。`prototype status` 返回轻量 `reportStatus`，由语义版本和批次索引版本判断 ready/stale/generation_failed，且不加载报告正文；`prototype document --text-limit 4000` 分段读取时仍校验内容哈希，后续 cursor 要传返回的 fingerprint。`prototype revision --collection groups|entries|requirements|questions|sourceFiles` 返回版本细项，续页传 fingerprint。语义 query 使用 --collection groups|entries|nodes|edges|questions|requirements|notes|changes|snapshots|batches，与遍历 --type 查询区分。

`query --collection batches --detail` 按开始时间倒序返回分析执行历史：来源、范围、登记数量、是否验收、已记录的创建/来源登记/验收节点和当次报告路径。看板“原型图分析 → 查看历史”合并展示这些批次与已有运行记录；未验收批次不因截图数量或队列数量被标记完成。查询只读，不补造逐点击日志。

所有只读查询在目录不存在时不建库。首次 init 的输入、schema、来源与解析先在临时目录验证，成功才安装 catalog；失败不遮蔽已有历史。成功但未接受的新来源不会改写已发布地图的规划指纹：地图仍以最后一次 accept 的来源为准，但 `feature refine/apply` 会显示 `source_pending` 并拒绝发布新地图，直至新批次审计并 accept；已接受来源切换后仍按迁移门禁复评。后续命令重新检查源码集合/内容和已接受证据的哈希，不能靠缺失 hook 或手调状态绕过。初始化进程中断后若留下 .init.lock，需人工核验中断状态后处理该锁；普通查询不会自动清理或迁移目录。

运行要求 Node >=22.18；只有首次需要原型解析时在 `modules/prototype` 执行 npm ci。flow 路由、无 catalog 的状态查询不加载 SQLite/解析器/Next。
