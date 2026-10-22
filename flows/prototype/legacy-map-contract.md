# 共享图审计契约（legacy v1）

本文件解释共享 graph-audit 的展开视图；索引执行者使用 [契约与 CLI](contract.md) 中的记录类型和 evidenceIds，不手改完整图。mf-dev-flow 适配层在显式 export 时派生这些兼容结构。

## 三份运行文件

| 文件 | 职责 |
| --- | --- |
| `source-map.json` | 自动提取、操作前冻结的候选分母与文件指纹，不能由截图反推 |
| `source-map.md` | 上述候选的可读定位表；不是另一份真源，也不代表已操作 |
| `interaction-map.json` | Agent 整理的页面/状态图、候选映射、运行态发现和取证结果 |

源码地图用 HTML 解析与 JS/TS AST 提取静态控件、页面/弹层容器、事件绑定、动态 HTML/JSX、分支、变量/存储及依赖引用。原型入口所在目录下 HTML/JS/TS/CSS/JSON 文件都保存指纹；仅跳过 `.git`、`node_modules`、`.mf-dev-flow`，符号链接和解析失败明确报错，不当作零交互。不会执行代码或自动读取远程资源。依赖引用、动态事件名、委托事件、路由、外部脚本、CSS 条件显示等必须由 Agent 复核和运行态补充。

候选 ID 在相同源码快照内稳定，由相对文件路径、源码偏移和类别生成；它不是长期业务分组 ID。源码变化需新运行并记录迁移，不要求编辑后仍保持同一候选 ID。生成器保守纳入候选，变量与条件不一定是用户交互，不能把候选数量直接显示成按钮数量。

地图一经生成，`run.json.sourceMap` 保存 SHA-256 和时间。再次生成不会覆盖；已经截图后也不能补造分母。完成对账会重新提取当前登记原型，比较完整文件集合、哈希及候选集合，因此新增文件/按钮、删掉候选或换到同名目录都不能被空队列掩盖。旧记录无此地图时保持原样，仅视为历史证据，不能补写 `verified` 冒充新门禁通过。

## interaction-map.json 字段

生成命令只创建未开始的骨架，以下内容由 Agent 在浏览操作前规划、随后补证：

- `schemaVersion: 1`、`sourceMapHash`：保持生成值。
- `status`：`not_started` / `in_progress` / `converged`。仅对账和人工复核均完成时收敛。
- `nodes[]`：`id`、`label`、`resetAction`、`entryIds[]`、`evidence[]`。节点代表页面/弹层/可观察状态，不是开发功能点。`entryIds` 引用 `coverage.sourceInventory.entries`；所有覆盖入口都须挂到节点。
- `edges[]`：`id`、`from`、`to`、`sourceIds[]`、`action`、`outcome`、`status`、`candidateOutcomes`、`evidence[]`。一条边是特定前置状态下的一次用户操作及可见反馈；状态不变的帮助/提示也可以是自环，不能只因没跳页面就忽略。
- `action`：`type`、`target`、`force: false`、`script: false`；支持 click/fill/select/check/press/scroll/drag/hover/long-press/back/navigate/wait。目标保存可复现定位，输入值在复现动作/追踪中记录，敏感信息使用测试值。
- `candidateReviews[]`：每个源码候选 ID 必须且只能有一条核对记录。`mapped` 的 page 用 `nodeIds`，state 用 `stateSpaceIds`，其他交互用 `edgeIds`；边须通过 `sourceIds` 反向关联候选。一个事件处理函数可服务多个控件，但不同参数/条件导致不同可见结果时必须拆边。
- 分支候选的 `outcomes` 全部逐项对应 `edge.candidateOutcomes[候选ID]`，例如 true/false、short-circuit/right、case-0/default/no-match。不能同一条无结果说明的截图同时宣称两个相反分支通过。确不可达的单个分支用该候选核对记录的 `outcomeExclusions[分支名]` 解释。
- `excluded` 候选以及 `reviewed` 依赖引用必须有 `reason`、`reviewer`、`sourceIds[]`。只用于有可定位源码依据的非交互、重复绑定或不可达分支；不能用“次要”“隐藏”“不方便点击”排除真实入口。动态/外部内容无法观察时保留未验证，不以 reviewed 消除缺口。
- `stateSpaces[]`：`id`、`sourceIds[]`、`dimensions`、`reductions[]`。按有源码依据的页面上下文拆状态空间；每个维度显式列出有限 string/number/boolean 值，例如 `{"role":["parent","member"],"pay":["pay","code","hide"]}`。无状态页面可使用空 dimensions，对应一个空向量；不是用空数组省略验证。
- `runtimeDiscoveries[]`：`id`、`nodeId`、`locator`、`event`、`edgeIds[]`。收集运行态实际发现的交互，匹配源码候选后纳入图；没有源码候选的动态元素先追到创建器/绑定器，不直接丢弃。
- `runtimeSweeps[]`：每个节点一次完整盘点汇总，包含 `nodeId`、`discoveryIds[]`、`evidence[]`。每次新状态/重新渲染都扫描并合并发现。空列表只用于确实没有交互的页面，保留 DOM/事件盘点追踪，不能作为未做盘点的默认值。
- `remainingCandidateIds`、`remainingEdgeIds`：保留实际待办；完成时为空。对账仍从候选、边、分支和状态空间重新计算缺口，不信任空队列本身。

状态变量与默认值的提取只是线索。Agent 必须沿赋值和判断补齐取值域；全局角色、权益、开关、错误/空态、localStorage/sessionStorage、模拟/演示选项都在范围内。不能仅取首页的角色组合替代阅读器、复习题和交易弹层各自的状态。

## coverage.json 与逐项证据

沿用原型分组和入口结构；`sourceInventory.sourceFiles` **完整复制源码地图的列表与顺序**，不手写兄弟目录或大括号路径。`sourceInventory.entries` 独立登记状态入口，不能用 `captures.map(...)` 同时生成分母和分子。每个 ID 一一对应 coverage 记录，遍历 visited 列表也必须完全相等。

`sourceInteractionInventory.controls` 继续作为分组摘要，但不替代地图逐边校验。`stateVectors[]` 每项增加 `spaceId`、`resetAction`，`values` 必须与关联 stateSpace 的维度完全匹配，证据使用下面格式。对账计算各空间的笛卡尔积，不接受少一个向量或重复向量。等价约简逐组合放入 `stateSpace.reductions[]`，包含 `values`、`reason`、`reviewer`、`sourceIds`，不能与已验证向量重复计数。超过 10,000 组合时按实际独立上下文拆分并解释，不截断、不随机抽样后声称穷尽。

节点、边、状态向量和运行态盘点的每条 `evidence`：

```json
{
  "level": "observed",
  "path": "screenshots/reader-translation-on.png",
  "action": "新上下文进入阅读器，打开设置，点击翻译开启，返回正文",
  "capturedAt": "2026-09-05T12:00:00.000Z",
  "trace": "traces/reader-translation-on.zip",
  "assertion": {
    "expected": "正文中文出现，翻译开启处于选中状态",
    "actual": "可见中文段落，开启按钮选中",
    "passed": true
  }
}
```

截图必须是当前运行 screenshots 内非空真实图片，追踪文件必须在当前运行内，符号链接不能越界；证据时间晚于源码地图。trace 可为浏览器原生 trace，或保存真实操作、前后 DOM/状态及断言的 JSONL，不得事后手写成功日志充当实际执行。命令检查结构、路径与引用，不能鉴定日志真实性或语义充分性；Agent 必须实际查看并复核证据。查看截图必须通过图片分析能力（支持图像输入的大模型、图片理解技能/工具或视觉 Agent）完成，仅凭源码、DOM 或结构化摘要不能替代；当前环境无图像输入时先向用户确认视觉通道，用户明确坚持非视觉方式时才可继续并随批次记录。历史截图可以作为对照，不计入本轮 observed。

浏览操作遵守正常可见性、可用性、遮挡检查：先展开/滚动/满足前置条件，再点击。`force: true`、`evaluate(() => element.click())`、直接调用处理函数只能诊断，不能算用户可操作证据。重置上下文时可以种入明确测试存储状态，但种入会员态不代表点过会员切换按钮，必须分别取证。每条边验证结果，不能仅等待后拍照。

覆盖包含返回、关闭、遮罩、键盘/系统返回、输入与校验、列表筛选、长按、滚动加载、成功/失败/取消反馈。对动态列表可按同一渲染器和等价数据归组，但锁定/可读、正确/错误、空/非空等不同结果不等价。遇到真实支付、消息、提交等外部副作用，停在原型演示或隔离环境边界；全量目标不扩大权限。

## 完整性表达

分别报告页面/弹层、操作边、分支、状态组合、运行态待办及排除/约简项。截图数量是证据数量，不是交互覆盖率。地图只表达原型的页面状态与用户操作，不挂开发依赖、阶段、P/W。

只能声明“相对已固定来源、已复核取值域与排除依据的覆盖闭环”。静态解析、运行态发现、追踪及 Agent 复核互相补充，都不是任意动态程序绝不遗漏的数学证明。现有看板历史 52/52 一类统计只代表已登记入口；未经过新地图对账不得解读为按钮/分支全覆盖。
