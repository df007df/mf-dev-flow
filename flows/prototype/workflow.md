# 实际分析与证据方法

仅在用户授权分析指定原型后执行。先确认来源、范围与批次，不猜同名兄弟目录；保留用户先前确认的说明、问题回答和信息补充。没有真实可执行来源时声明可观察边界，不以图片模拟已点击。

## 运行中的网页

`web-runtime@1` 适用于一个可访问的网页或本地预览。先运行 `prototype process list` 与 `prototype adapter capabilities --adapter web-runtime@1`，确认适配器只支持运行态观察、选择器导航、PNG 截图和追踪归档；它不声明源码发现或源码全覆盖。运行态 Agent 使用当前可用的浏览器自动化，CLI 不控制浏览器。

运行态 init 必须绑定明确的构建／预览 revision。revision 是本次实际构建或预览的不可变标识（例如构建号或提交 SHA）；重新构建、重新部署或切换预览后必须使用新的 revision 建批，不能只复用 URL。运行态来源输入只声明 `type: "runtime"`、`adapter: "web-runtime@1"`、无凭据的 `locator.url` 或 `locator.localPreview` 和 revision；不提交静态候选、源码文件或“源码完整”结论。

```bash
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs prototype init \
  --process runtime-analysis@1 --adapter web-runtime@1 \
  --evidence-profile runtime-only --agent scope-snapshot \
  --input input.json --request-id web-analysis-001
```

该批次的图是 `scope-snapshot → structure-model → runtime-observe → audit-accept`。`runtime-observe` 可因新发现回到 `structure-model`；`audit-accept` 发现缺口可回到 `structure-model` 或 `runtime-observe`。阶段转换必须由当前阶段 Agent 提交非空理由和当前索引 revision：

```bash
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs prototype checkpoint \
  --stage structure-model --to runtime-observe --outcome validated \
  --reason "结构模型已核对" --agent structure-model \
  --request-id web-checkpoint-001 --expected-revision <当前索引revision>
```

`runtime-only` 只陈述实际观察并归档证据的行为；它不声称源码、隐藏分支或未观察状态已完整覆盖。每次运行态截图和追踪必须在 `runtime-observe` 阶段通过 [capture 受管提交](capture.md) 归档，之后才可 checkpoint 到审计。既有未指定 `--process` 的 HTML 批次不获得这些 Agent／阶段门禁，继续按原有 HTML 流程运行。

1. 先用 `prototype capabilities` 查看适配器能力，并确认当前浏览器可访问指定来源、可保存原生截图与实际动作追踪；访问预检不计观察覆盖。先按 [分析要求](analysis-requirements.md) 读取适用于本次来源、模式和标签的 active AR，建立角色与适用页面的矩阵、准备步骤及截图条件。首次浏览和截图前 `init` 固定来源分母与 AR 快照。通过 `next --type file/candidate` 和按文件/类型筛选，分批理解页面、事件、隐藏容器、动态生成器、引用、分支与状态变量；候选数量不是业务交互数量。
2. 在索引登记 group、entry、node、control、edge、space。候选先映射到具体状态和预期操作。沿赋值、判断、存储和输入校验补齐状态取值域；未知域保持待办，不以默认值替代。
3. 通过正常用户路径抵达状态，逐状态重新盘点运行态控件。发现先登记 occurrence 与预期 edge，再操作。使用浏览器工具原生截图、真实动作追踪及结果断言；首个真实状态先完成截图＋追踪落盘与归档引用核验，再展开批量遍历；优先用 [capture 受管提交](capture.md) 同时归档和回填 node/edge/vector/entry/sweep。
4. 重复小批 `next` 和 `query`；源代码引用/动态控件/新状态继续扩充。每次盘点都保留当前状态发现的关系并更新 sweep 的 discoveryIds，不因定义重复丢掉不同状态的出现。
5. `audit` 按页处理源码候选、分支、空间组合与运行态缺口。队列为空仍需审计；审计通过后人工看证据与排除依据、核对说明和用户结论，再 accept；成功后自动生成报告，仅派生报告需要修复时显式 report。

在用户指定范围内，节点包括主页面、深链、覆盖层、弹窗、空态、错误态、成功反馈、登录/会员/角色状态。边包括点击、输入/校验、选择、长按、滚动加载、返回/关闭/遮罩、键盘/系统返回、成功/失败/取消分支；没有跳页面的业务提示也记录自环。演示面板、隐藏开关、浮动控件和存储先分类为业务操作或场景准备，记录用途与影响；依用户要求和来源依据限定适用页面，不机械展开所有页面与开关的组合。没有依据时不能仅因“次要”而排除。

每条边保存可复现目标、输入类别、结果分支和预期/实际断言。先展开、滚动、满足前置，再按真实可见性/遮挡/启用状态操作。强制点击、脚本 `.click()`、直接调处理函数只能诊断，不能作为用户可操作覆盖。独立重置可以准备测试存储，但种入会员状态不代表已点击会员切换按钮。

同渲染器的动态数据只有有源码依据且结果等价时才可约简；锁定/可读、正确/错误、空/非空等结果不能合并。状态空间超过 10,000 组合需按有源码依据的独立上下文拆分并说明，不截断或抽样后称穷尽。截图相似不是源码等价证据。

报告按用户目标组织流程分组，登记 order 和 entryNodeIds；标题变动不随意更换稳定组 ID，拆分/合并保留旧新映射。页面用途、输入、可见结果、状态变化、问题与 Agent 回答都进入结构化记录。每次分析把变化合入同一份完整报告，未触及的分组继续保留；历史只保存执行记录与当时快照。每个页面或状态的主证据以“截图 / 操作与结果 / 证据”表格展示，使图片、说明、证据 ID 与追踪保持在同一行；图片数量不当作按钮覆盖率。冻结 AR 只控制本次取证，不作为报告分组或正文内容；后来修改 AR 不反向改变这一批的事实或证据门禁。

命令只做确定性来源发现、归档、索引、队列、统计和审计。Agent 负责当前小批源码语义、实际浏览操作和结果解释。截图/日志时间和哈希只校验记录一致性，不能代替查看实际证据。不得事后手写成功日志冒充操作追踪。

查看实际证据必须通过图片分析能力完成：使用支持图像输入的大模型（当前会话或委托的视觉 Agent）、图片理解技能/工具，或专门的多模态分析通道；仅凭源码、DOM、结构化摘要或断言文本推断截图内容，不视为已核验。当前环境无图像输入能力时，先向用户确认视觉通道（切换视觉模型、调用图片分析技能、或派发视觉 Agent）；用户明确坚持非视觉方式时才可继续，并随批次记录该选择与影响，该批次不得登记为视觉级已核验。

真实支付、发消息或其他外部副作用只在已授权的原型演示或隔离环境边界内观察。无法观察的内容记录原因、影响与待确认问题，保留为未覆盖。可以交付完整分析报告并明确未完成范围，不能把不可观察项计为全量 verified。

## 微信开发者工具小程序模拟器

小程序 runtime-only 限制：结论仅覆盖已实际观察并归档的行为，不覆盖源码、隐藏分支或未观察状态。

在用户授权的模拟器中，先由 `scope-snapshot` 和 `structure-model` 固定范围与结构，再进入观察。小程序阶段门禁：只能在 runtime-observe 阶段完成 capture，并在每次转换时提交 checkpoint。审计发现缺口时按流程图返回建模或观察阶段，不跳过 checkpoint。

小程序交互取证必须核对操作前后页面栈，使用 selector-action，并归档 trace 证据。观察 Agent 只将用户可见、按正常路径发生的操作记为业务交互；强制点击、脚本调用和绕过页面栈的跳转只能诊断，不能形成覆盖结论。

小程序场景准备：compile/refresh 与角色或数据准备只是 scenario preparation，不是已观察的业务交互。准备动作需在 trace 中与随后实际用户操作区分，不能用它们证明页面、按钮或分支已经覆盖。

## iOS 原生 App 模拟器

iOS runtime-only 限制：结论仅覆盖已实际观察并归档的行为，不覆盖源码、隐藏分支或未观察状态。

在用户授权的 iOS 模拟器中，先由 `scope-snapshot` 和 `structure-model` 固定范围与结构，再进入观察。iOS 阶段门禁：只能在 runtime-observe 阶段完成 capture，并在每次转换时提交 checkpoint。审计发现缺口时按流程图返回建模或观察阶段，不跳过 checkpoint。

iOS 交互取证必须核对操作前后屏幕状态，使用 element-action，并归档 trace 证据。观察 Agent 只将用户可见、按正常路径发生的操作记为业务交互；坐标盲点、私有 API 调用和绕过界面状态的跳转只能诊断，不能形成覆盖结论。

iOS 场景准备：build/install/launch 与角色或数据准备只是 scenario preparation，不是已观察的业务交互。准备动作需在 trace 中与随后实际用户操作区分，不能用它们证明界面、按钮或分支已经覆盖。

## 截图范围与失败恢复

截图前记录实际缩放、设备像素比、目标容器及完整可见性，按用户指定尺寸核验输出。去外框、裁切或去背景首先属于截图操作，不能据此修改原型 HTML/CSS；来源确需变更时须在已有源码修改授权范围内处理并重新冻结批次。尺寸按当前项目要求，不能照搬历史项目的 390×844。

预览成功与文件归档分别确认，返回截图及追踪的实际路径。任一环节不可用时记录具体工具缺口、当前完成数量和可继续工作；不得用手写成功日志、强制操作或换来源冒充取证。来源切换沿用用户明确选择。

`status` 的 `recovery` 区分来源／证据缺口与派生报告；`reportStatus.reason` 标明未生成、文件缺失、语义变化、遍历变化或批次不可读。只有派生物不同步时重建 report；真实证据失效需按原授权范围补证、审计和接受。
