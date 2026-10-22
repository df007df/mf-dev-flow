# 单技能重整验证记录

本轮完成单一 mf-dev-flow：原独立原型能力移入内部 modules/prototype；新业务使用统一 CLI 与 prototype/ 主目录。只修改技能、hook、测试和看板工具；没有读取/扫描/修改/迁移真实 `.mf-dev-flow`，没有启动真实原型、Next、浏览器、产品项目、部署或 PR。

## 结构与入口

```text
mf-dev-flow/
  SKILL.md                     唯一技能入口
  flows/{prototype,planning,delivery,system,project,overview,maintenance}/
  modules/workflow/            注册表与会话路由
  modules/prototype/           缓存、批次、语义目录、CLI 和客户端
  modules/planning/            全集影响与复评门禁
  modules/delivery/            唯一阶段契约
  modules/runtime/             按命令加载项目/系统/规划/交付/归档实现
  scripts/mf-dev-flow.mjs         公共入口
  dashboard/                  只读界面和 HTTP 适配
```

`flow list` 返回当前流程入口；`flow route --flow <ID>` 只定位。SessionStart 的实际 startup/resume/clear/compact 生命周期注入短路由，不宣称平台自动加载技能全文。普通 Edit/Write 与 patch 使用同一租约门禁；维护路径继续豁免。

新原型：`prototype init → next/query → put/evidence → audit → accept → report`，均为 mf-dev-flow 子命令，存储固定在 `.mf-dev-flow/prototype/`。问题、需求和说明使用 `question add/answer/update`、`requirement add/update`、`note add/update`，不手改数据库/大图。内容变化后 `graph sync --json → feature impact --json → refine → apply`，只在授权范围继续开发。

## 自动回归

2026-09-05 最后一轮合并执行 **109/109 通过**，没有跳过项：

| 测试范围 | 数量 | 验证内容 |
| --- | ---: | --- |
| 内部原型核心与统一目录 | 16 | 缓存、来源失效、有效完成、分支/状态/出现关系、真实证据引用约束、原子批次、幂等、语义历史、初始化失败、查询不写、超大记录分页 |
| 路由与加载边界 | 4 | 未知/明确意图、会话阶段恢复、维护不读 current、无 SQLite/解析器/Next 时路由与空状态可用 |
| 原有命令运行回归 | 38 | 功能规划、项目检查、租约、交付阶段、完成门禁与系统处理 |
| 看板服务端回归 | 34 | 状态、原型证据/地图/影响/提示词、文件路径、系统问题与功能分析 |
| Codex / Cursor 策略钩子 | 17 | 生命周期上下文、维护豁免、写入租约、普通 Edit/Write、记录、检查点及停止门禁 |

另外通过看板 TypeScript 无输出检查与 skill-creator quick_validate；所有相对文档链接和注册表目标存在，只有一个 SKILL.md。看板原型 API 的只读 allowlist、16KiB 限制、失败可见性、report 分页、超大记录回读使用真实 CLI + 临时 fixture 验证。未做浏览器视觉验收。

独立审查者在全新临时目录使用明确标注 SYNTHETIC 的图片和追踪，跑通实际 CLI 的 accept → feature refine → apply → feature start；复验 prototype 提取、manual 默认来源与截图归档/来源门禁。已完成、暂缓、阻塞及依赖下游全部进入影响清单，无关功能保持不受影响；work merge-check 与 work verify passed 实际被未复评变更拒绝。合成证据仅证明工具行为，不证明产品原型已操作。

关键负向检查包括：缺失输入、错误 schema、缺失来源与 JS 解析失败不产生可识别 catalog；已有历史字节不变；后续失败 init 不推进修订；不同来源不能借旧批次 accept。开放问题与未确认需求阻止关联开发，question update 不能绕过专用回答。来源文件增加/变化或截图损坏即失效，不依赖 hook 提醒。

## 上下文与缓存测量

原始结果：[上下文字节](../../modules/workflow/tests/context-metrics.json)、[大图基准](../../modules/prototype/tests/benchmark-results.json)。复跑脚本：[measure-context.mjs](../../modules/workflow/tests/measure-context.mjs)、[benchmark.mjs](../../modules/prototype/tests/benchmark.mjs)，均只使用工具文件和自动清理的临时合成数据。

| 项目 | UTF-8 字节 |
| --- | ---: |
| 原技能入口 | 15,634 |
| 当前技能入口 | 1,672（减少 89.3%） |
| 入口 + 原型流程入口 | 3,169 |
| 入口 + 规划流程入口 | 2,947 |
| 入口 + 交付流程入口 | 3,131 |
| 全部流程的 list 输出 | 1,717 |
| 绑定交付任务的 hook 上下文 | 629（硬上限 2,048） |
| 当前阶段 brief | 1,518–2,287 |
| 大图默认20条查询 | 5,214（上限16,384） |
| 筛选7条查询 | 1,879（上限2,048） |

合成图有7个来源文件、2,651个候选、808个节点、1,654条边、28,406个控件出现关系。冷读解析7个文件；同内容重读7命中/0解析；抽取版本改变后重新解析7个。控件定义与出现关系分开存储，避免重复内嵌；报告、审计和完整规划仍可在脚本内聚合全量数据。

这些是字节与合成数据测量，不是实际 tokenizer 计费或真实历史迁移的节省比例。进入具体操作仍会读取它自己的协议，不把入口字节误报为全过程上下文。

## 保留边界

- 当前来源适配器仅支持本地 HTML 及其目录内相关源码。截图、远程页面和任意动态程序域没有自动操作/穷尽保证；Agent 必须真实操作并审阅证据。
- 旧运行读取/导出代码为显式历史分支，新目录不需要兼容导出；没有对任何现存数据执行迁移。
- shared.mjs 仍承载跨流程公共门禁；优化是按流程加载及有界传输，不是所有代码都按函数加载或常量内存。
- 首次安装异常中断可能留下初始化锁，需核验后处理；普通只读命令不自动删锁/历史。适配器保留原 hook 故障 fail-open 策略，产品 CLI 在无法核验原型时拒绝推进。
- 没有要求或创建后续自动分析任务，真实项目由用户之后主动使用流程。

## 2026-09-07 通用任务流程简化

新建交付运行使用 `generic-task` 与空阶段列表。开发计划保留开发任务输入和并发任务；实时记录、测试与回归只保留区块，不预置固定内部格式。可选同步区块仅在文档声明完整标记对时更新。任务类型流程尚未扩展，`--kind` 不自动加载阶段。已有 `product-delivery` 和未登记契约 ID 的历史任务保留原阶段与门禁，未迁移真实数据。

本轮隔离回归：**134 通过、0 失败、1 跳过**（原有历史像素回归审计用例）；看板 `tsc --noEmit --incremental false` 通过。运行命令：

```bash
node --test .codex/skills/mf-dev-flow/scripts/*.test.mjs .codex/skills/mf-dev-flow/modules/workflow/tests/*.test.mjs .codex/skills/mf-dev-flow/modules/prototype/tests/*.test.mjs .codex/skills/mf-dev-flow/dashboard/tests/*.test.js .codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.test.mjs
```

新增验证覆盖：生成文档无固定阶段/子标题；仅 API 项目的通用任务领取、brief、finish、merge-check、verify、run done 全链路；错误目标阶段拒绝；空报告拒绝而简短自由格式通过；同步不补回阶段/截图模板；无阶段运行可用原因记录 blocked；历史检查点与通用任务共存时不提前完成叶子、不丢旧阶段证据，旧任务仍可恢复并完成。SubagentStart 和总览文档同步去除通用任务的目标阶段与固定报告要求。

独立审查者在临时 fixture 复验混合任务状态投影和历史门禁。全部运行只读写临时 fixture；没有读取、扫描、改写或迁移真实 `.mf-dev-flow`。未启动真实产品或浏览器；本轮验证证明工具流程行为，不代表产品功能验收。

## 2026-09-07 流程审阅建议落地

对应用户审阅稿的升级：路由以本次 intent 覆盖旧偏好，返回目标范围并支持 clear；统一并发、系统单卡入口、入口多对多、报告版本和自动生成说明；新任务冻结 generic/api/ui/fix 类型版本与验收项；原型新增 capabilities 与 capture；系统卡片新增 query、dry-run 与版本冲突保护；Codex hook 增加安全健康记录；报告缺口按层说明。

验证基线为 **141 通过、0 失败、1 跳过**，跳过项仍为原有历史像素审计用例。完整运行使用本文件既有隔离命令；看板类型检查、skill-creator quick_validate、内部 Markdown 链接检查通过。入口 2,039 UTF-8 bytes，绑定任务 hook 629 bytes，仍低于 2,048 bytes；这是字节测量，不是模型 token 消耗。

| 原始问题或建议 | 本次保护与隔离验证 |
| --- | --- |
| 旧流程覆盖本次明确目标 | 保存 maintenance 后 prototype intent 正确切换；显式 flow 仍优先；损坏的产品 current 不妨碍独立流程；route 不改保存偏好；clear 不改产品绑定 |
| 预览截图未落盘、裁切误改源码、半幅图片 | 首图访问/归档预检协议；capture 校验 PNG 尺寸、来源快照、截图/追踪哈希、原子记录引用；缺文件、尺寸不符、记录冲突、异内容 request-id 和归档丢失均拒绝；公开 CLI 拒绝混入开发状态 |
| 固定阶段不适合全部任务 | 新类型不预设阶段，创建时保存版本；brief 展示对应要求，finish 和 merge-check 检查验收项及非空运行内证据；保留通用自由格式、旧阶段和检查点混合回归；地图说明从阶段契约派生并明确历史范围 |
| 系统全卡读取与覆盖风险 | 单卡/字段分页和指纹续页；预览不写；发布拒绝过期指纹；真源临时文件替换；未涉及卡片保留；预览包括按来源归并卡片的影响 |
| hook 故障静默 | fail-open 仍保留，故障明确提示未核验；flow health 分事件记录最近结果与历史故障，恢复不抹掉故障时间；不保存原始异常消息或输入 |
| 报告加载/图表历史回归 | 保留已有缓存、30 秒不重叠轮询、节点/交互图片表格与 v1/v2 兼容回归；浏览器兼容集合引用同一版本常量；审阅稿 11 图在隔离浏览器全部解析和渲染 |

独立审查在临时项目复验 71 项既有测试，发现正常并发冲突时锁内 fail/process.exit 跳过 finally，造成持续锁住。已改为抛出异常、经过 finally 清锁；新增两个实际 public CLI 进程的同步复现：第二进程提交后第一进程拒绝旧版本，锁不存在，重新读取后重试可同时保留两者 API 使用记录。不是仅靠文字审阅判定已修复。

能力限制：capture 不驱动浏览器，完整性/缩放等声明仍需 Agent 真实核验；尺寸门禁当前支持 PNG，失败事务可能留下不计覆盖的无引用内容寻址文件。任务类型验收验证结构和文件可读性，不自动证明文件内容或测试真实性。其他原型来源适配器、自动规划检查点存储、环境检查缓存及全量结论来源 UI 留作有具体需求后的扩展。系统完整更新应始终传预览指纹；旧调用省略时只保护单次命令读写之间的并发变化。异常进程被强杀仍可能留下写锁，需先核验进程；健康记录不证明 hook 当前安装完整或拦截了任意手工操作。

本轮没有读取、扫描、写入或迁移真实 `.mf-dev-flow`，也没有执行真实产品取证、规划或开发。fixture 日志/图片均不是产品验收证据。

收尾补充：系统预览按实际归并结果显示受影响卡片和移除项，功能地图明确区分新任务与历史阶段后，相关 **20 项回归全部通过**。独立审查者沿原双 CLI 时序再次验证冲突后无残留锁、重新 query 后可重试、最终保留 A/B 使用项，原 P1 已关闭。

## 2026-09-08 PRD 阅读与取证流程

按用户需求注册第八个流程 `prd`（flows/prd/entry.md + protocol.md，registry.json 流程与 `prd ingest/status/check/render` 四条命令路由）。目标：全量本地读取 PRD（.md/.txt/.docx、目录递归、在线文档快照），不修改 PRD，产出业务矛盾/歧义清单与核心原则红线证据索引供会议依赖。

门禁为命令核验：来源以内容哈希冻结在 `.mf-dev-flow/prd/sources/`，`prd check` 要求每条 contradiction/ambiguity/principle/redline 携带逐字引文且引文必须存在于冻结快照（空白折叠与整删双匹配，拒绝转述与编造）；`prd render` 内嵌同一核验，未通过拒绝写会议文档；`prd status` 重算原件哈希报 `clean/modified/missing/unverifiable` 漂移。docx 经 `unzip -p word/document.xml` 提取标题、实体与表格行，缺 unzip 或非 zip 明确拒绝，不落半成品。

统一隔离验证 **219 项：218 通过、0 失败、1 跳过（既有历史像素审计）**，含 9 项新增 PRD 回归：路由与只读 intent 分流、文本冻结幂等与漂移三态、目录收集与不支持扩展 fail-closed、docx 提取与损坏拒绝、钉钉快照登记与 URL 校验、逐字/转述/幽灵来源/空证据/重复 ID/坏 kind/悬空关联六类拒绝与通过、缺 summary 仅 warning、render 拒绝未核验批次后确定性派生两份会议文档、批次 ID 越界不写盘。上下文测量同步重生成：入口+PRD 流程 3,899 bytes，flow list 3,146 bytes（<5,000 上限），PRD hook 上下文 474 bytes（<2,048）。本轮只读写临时 fixture 与技能目录；没有读取、扫描、改写或迁移真实 `.mf-dev-flow`，未执行真实 PRD 取证。

能力边界：check 只证明"引文逐字来自冻结快照"，不证明快照完整（在线文档须滚读全文再存快照）、不证明结论正确；背景/方向与判断由 Agent 全量阅读完成，共识由会议确认。在线快照无法核验原文后续变化；本流程不授权开发，交接规划时随附批次与两份会议文档。

同日追加：钉钉输入通道按用户决定改为「钉钉文档」MCP——服务安装在用户级 `~/.zcode/cli/config.json` 的 `mcp.servers`（streamable-http 端点含密钥，密钥只存该本机配置，不写入仓库任何文件/流程文档/快照）；entry/protocol 同步改写为 MCP 取证路径并禁止该服务的写/权限/回滚类工具。随后以匿名 PRD 文件夹进行只读取证：`get_document_content` 取全文、`prd ingest --snapshot` 冻结来源（kind=dingtalk、drift=unverifiable），`prd check` 逐字核验引文，`prd render` 生成会议文档；PRD 原件全程只读。此段为流程真实使用记录，取证结论仍待会议人工确认。

## 2026-09-08 iOS 原生 App 运行态适配器

按 [iOS 实施计划](runtime-prototype-analysis-ios-impl-plan.md) 注册第三个运行态适配器 `ios-app-runtime@1`：manifest 与共享加载器精确锁定（sourceModes 仅 `ios-simulator`、operations `screenState/elementAction/simulatorScreenshot/traceArchive/appLaunch`、单 runtime-observe overlay）；运行态来源只接受 `{mode, bundleId, device}`  locator，bundleId/device/revision 全部 fail-closed 校验；公共 list/capabilities 输出声明能力但不含 Agent 指令；五份 prototype 流程文档各新增一段，并由文档声明测试把十句 iOS 契约钉为全文恰好一次。

统一隔离验证 **210 项：209 通过、0 失败、1 跳过（既有历史像素审计）**；看板类型检查 `tsc --noEmit` 通过。本轮开始时 `scripts/mf-dev-flow.project-check.test.mjs` 有两条既有红（core-web task 5 与 miniapp task 4 报告均登记为独立既存问题）：`discoverProjectDocumentEvidence`（2026-09-07 18:26 变更）已改为数组形状 `{path, sha256, updatedAt}` 且文档不再作为门禁，而测试仍断言旧对象形状与旧拒绝行为。经用户确认后在同一维护会话内对齐：用例一改断言 documents 数组含路径与 sha256 指纹；用例二重写为"任意命名或缺失文档都不判失败"的正向回归（含删除全部文档后卡片显示"未发现 Markdown 项目文档（仅观察结果，不影响状态）"）。实现侧未改动。本轮只读写临时 fixture 与技能目录；没有读取、扫描、改写或迁移真实 `.mf-dev-flow`；合成截图/追踪仅证明工具行为，不是产品取证。

能力边界：iOS 适配器只声明模拟器运行态契约，CLI 不操控 iOS 模拟器；真机（USB iPhone）与 iOS 源码发现均不在 v1 范围，未声明的形态保持 fail-closed。

## 2026-09-08 PRD 分析接入看板

按用户要求在看板新增与「原型图分析」平级的独立「PRD 分析」区块（位于原型图分析之上，浏览器用例钉住区块顺序）：「矛盾与不清楚清单」「核心原则与红线证据索引」两张卡片，展示条数、高中低严重度分布、逐字引文数、关联来源数、批次 ID 与文档/批次更新时间；状态徽标不是缓存结论——服务端每次读状态时用 `prd check` 同一门禁对冻结快照逐条重算（证据核验通过 · N 条逐字引文 / 证据核验未通过 · N 项 / 核验通过 · 会议材料未生成 / 核验异常），核验失败的条目路径直接列在卡片上并附修复提示词；会议文档点击卡片按钮弹窗阅读，「核验并更新分析 / 生成会议材料」提示词携带当前批次 ID 交给 Agent。同一轮按用户布局反馈：原挂在「原型图分析」区块头部的「分析需求」「分析历史」两张概览卡移入「完整原型图流程」报告卡片内部（native 目录与 legacy 报告两个分支一致）。

实现边界：`modules/runtime/prd.mjs` 的 `checkFindings` 增加可选 `options.sourceText(id)` 注入快照读取（看板按当前 workspace 的 `.mf-dev-flow/prd/sources` 绑定，不依赖 process.cwd()；快照缺失记为 `sources[<id>]` 问题而不是崩溃；默认行为不变，9 项既有 PRD 回归仍全绿）。新增 `dashboard/server/readers/prd.js` 只读摘要（多批次取 findings.json mtime 最新），接入 `dashboardState.prd`；前端 `components/prd-analysis.tsx` 导出 `PrdSection` 含未冻结/未分析空态引导，`page.tsx` 独立挂载，原型图分析两个分支各自内嵌需求/历史概览。

统一隔离验证通过（含既有历史像素审计跳过项），新增看板 PRD reader 回归覆盖空库、统计与核验、转述引文定位、缺失快照、未生成会议文档和非法 manifest；`tsc --noEmit` 通过。真实运行核验显示 PRD 批次 `check.ok=true`，引文逐字核验与会议文档均已生成；新增浏览器用例覆盖独立 PRD 区、需求/历史卡、计数徽标与会议文档预览。布局改版后的 Playwright 存量失败集合与改版前基线一致；本轮只向该文件追加新用例，浏览器运行只读真实 `.mf-dev-flow/prd`，未写入。

能力边界：看板徽标是读取时的实时重算，不替代 `prd render` 前的命令核验；钉钉来源 drift=unverifiable，会议前仍需重新取全文快照后 `prd check` 复核。

## 2026-09-08 内容对比与视觉验收双维度 CLI

按用户要求落地两方向，并遵循用户定的复用原则：helper 能力一律经 CLI 路由暴露、由 Agent 在流程层组合，命令实现模块之间不做 import 复用（各域保留最小实现，拒绝代码层耦合）。

方向一：新增 `modules/runtime/content.mjs`（`content hash` / `content compare`）——sha256 字节精确判定；缺省归一化对比（CRLF、行尾空白、纯空白行差异视为未变，`--strict` 按字节，`--fail-on-changed` 供脚本阻断）；有实质差异时输出行级分块 diff（公共前后缀剥离 + LCS 精确对齐，规模超限退化 32 行粗块，块带 op/两侧 1 基行号与摘录，二进制只比哈希）。`prd check` 扩展 `--source <ID> --against <候选文件>`：在候选文本上重算逐字引文门禁（其余来源仍按冻结快照），与基线双跑取差集，只把候选下新失效项计为 `impactedItems`（`snapshotChanged/baselineOk/candidateOk/newlyFailed`），在线来源会前复核组合链固化为「重取全文 → content compare → prd check --against → 受影响则重摄改 findings 重跑」。各模块既有本地哈希复制按用户原则不再收拢为共享库。

方向二：验收对比扩为双维度。逐区报告新增 `dimension: "vision"|"dom"`（缺省 vision，旧归档报告向后兼容）；dom 维度每个业务区块强制两侧 `domEvidence.{locator,excerpt}`，`visual` 允许 not_applicable、`interaction` 未实测必须 uncertain；归档 review 记录 dimension。新增 `visual validate-report --region-report <json> [--state <s>]`：复用同一校验器但不依赖开发运行/任务/截图归档，`--state` 缺省从报告推断、参考/结果冲突拒绝，供 e2e、开发期 DOM 自查等场景自由组合；阶段门禁证据仍只认 `visual compare`。新流程文档 `flows/delivery/visual-acceptance.md`：两维度共同硬要求、场景矩阵（门禁/自查/e2e/最终验收×维度×命令）、维度专属规则、schemaVersion 1 双模板与两条 Agent 填报告提示词；delivery entry/legacy 与 prd entry/protocol、architecture 同步接线。

统一隔离验证 **240 项：239 通过、0 失败、1 跳过（既有历史像素审计）**；新增 9 项：content 4（hash 形状与 crypto 一致/缺失文件拒绝、字节一致+空白折叠+strict+fail-on-changed、changed 相邻编辑合并为单块与 added/removed 块及行号、二进制 note），validate-report 4（vision 缺省维度推断、dom 完整通过且 domEvidence 规范化、缺 domEvidence/非法 dimension/uncertain 结论分别拒绝，状态从报告推断与显式 state 冲突拒绝），prd check --against 1（候选等价零影响、改一句仅对应条目进影响面、未受影响引文不得计入、缺 --source 与不存在来源拒绝）。`tsc --noEmit` 通过；dashboard 前后端本轮零改动。真实 .mf-dev-flow 未读未写；新命令冒烟全部在临时目录执行。

能力边界：content compare 的"未变"是归一化口径（行内空格与语义字符保留差异），需要字节判据用 --strict；validate-report 是纯报告校验，不核验截图真实性、不产生门禁证据；dom 维度证明结构/顺序/文案等价，不证明像素外观，验收收口仍以 vision 截图对或人工看屏为准；prd check --against 的影响面以基线通过为前提（baselineOk:false 时先修基线再复核）。

## 2026-09-08 requirement.kind 维度补充流程维护验证记录

本次改动清单（sdd 2026-09-08-requirement-kind-solution-supplement，Task 1-5）：
- requirement 增加 kind(product|technical) 维度（catalog 写入口校验，缺省 product）并参与修订哈希（Task 1）；
- miniapp-product@3 流程与双门禁：`technical_requirement_confirmed` + `dev_plan_evidence`（Task 2 声明 / Task 4 在 deliveryStage 落地校验），types 注册表新增 feature-development v3（v2 标 superseded）；（Task 2）
- 默认流程 v2→v3 切换（shared.mjs 默认值），显式 `--process miniapp-product@2` 仍可用（Task 2）；
- proposed technical 要求放行任务规划/领取，withdrawn 与 product 行为不变（Task 3）；
- 技术要求补充协议文档 flows/planning/solution-supplement.md + SKILL.md / planning entry / delivery entry 三类要求判定路由句（Task 5）。

隔离声明：本轮及前序任务只读写临时 fixture 与技能目录；没有读取、扫描、改写或迁移真实 `.mf-dev-flow`，没有启动真实产品、浏览器或交付运行；合成证据仅证明工具流程行为，不代表产品功能验收。`dashboard/tests/integration/dashboard-smoke.test.mjs` 依赖未安装的 `@playwright/test`（既有环境缺依赖，非本次改动导致），全量回归排除该集成文件并注明，未尝试安装 playwright。

回归统计（Task 6 Step 1 复跑，Node v22 需 glob 引号写法，逐套执行取总数；数字为修复轮 02d8bb3 之后的实况）：

| 测试范围 | 通过 | 总数 | 失败 | 跳过 |
| --- | ---: | ---: | ---: | ---: |
| scripts（\*.test.mjs） | 103 | 104 | 0 | 1 |
| modules/prototype/tests | 70 | 70 | 0 | 0 |
| modules/types/tests | 6 | 6 | 0 | 0 |
| modules/graph/tests | 17 | 17 | 0 | 0 |
| modules/kernel/tests | 16 | 16 | 0 | 0 |
| modules/workflow/tests | 6 | 6 | 0 | 0 |
| modules/capabilities/tests | 5 | 5 | 0 | 0 |
| dashboard/tests 服务端（\*.test.js，不含 integration） | 49 | 49 | 0 | 0 |
| hooks（.codex/.cursor mf-dev-flow） | 22 | 22 | 0 | 0 |

合计 **294 通过 / 295 总数 / 0 失败 / 1 跳过**（排除 dashboard-smoke 集成文件）。spec §12 覆盖的新增测试全部通过：kind 校验、门禁正反、确认→漂移→收敛→续做闭环、双门禁阶段门禁、@3 流程加载与默认解析、delivery-processes / types-registry / kernel sync 回归。跳过项为既有历史像素审计用例（仅保留迁移审计，不再作视觉验收）。

回归发现与修复（原 2 失败，已在修复轮解决，实况复跑全绿）：
- 原红用例："技术方案缺少数据流转 SVG 时不得确认，登记后通过"、"开发阶段留项风险必须 --risk 登记到功能点，否则不得确认"，栈在 `delivery.mjs` 的 `technical_requirement_confirmed` 门禁 `semanticRows` → "Prototype catalog not initialized"。
- 根因：Task 2 默认流程切到 miniapp-product@3 后该文件首用例已同步断言 frozen version=3（默认注入路径），其 fixture 仍是 legacy 原型形态（无 catalog.sqlite）；Task 4 门禁按 spec 字面直接 `semanticRows` 读要求行，legacy 形态下抛原生 catalog 错误而非友好门禁文案（Task 4 报告疑虑 1 已预判该设计边界）。该问题只影响既有 v2 测试文件 fixture 形态，不影响本轮新增 §10 测试（solution-gates fixture 已初始化 catalog）。
- 修复（提交 02d8bb3）：`delivery.mjs` 门禁加 `hasPrototypeCatalog(path.dirname(STORE))` 守卫，无 catalog 时 requirements 行读为空集、门禁空过（与 impact.mjs readPrototypeRevision 同模式）；同提交对 `miniapp-product-v2.test.mjs` 夹具校准：PASS_TECH 与 SVG 正例补登 plan.md（--kind dev_plan，默认流程已是 @3，dev_plan 门禁对所有 v3 运行生效），artifacts 断言改为按 kind 计数（dataflow_svg=1、dev_plan=1）。复评结论 F1 ADDRESSED，无新破坏。
- 修复后全量复跑：scripts 103 通过 / 0 失败；指定范围合计 223 通过 / 224 总数 / 0 失败 / 1 跳过；全范围（含 dashboard 服务端 49 与 hooks 22）294 通过 / 295 总数 / 0 失败 / 1 跳过。

已记录实现偏差（评审移交，逐条）：
- (a) Task 1 M3：requirement kind 读侧缺省落在 `rows()` 归一化为 product，而非 spec 字面"写入口缺省"；观测契约一致（存量无 kind 记录读出即 product）。
- (b) Task 2 M1：`modules/capabilities/registry.json` kernelGates 新增 `technical_requirement_confirmed`、`dev_plan_evidence` 两个归属条目（必要连带，防止"全部任务类型 evidenceGates 都有归属主"交叉校验红）。
- (c) 默认流程 v2→v3 后，`modules/delivery/processes/README.md`、`flows/delivery/entry.md`、`modules/types/README.md` 已同步修正为 @3 与"7 类 9 版本"统计口径。

## 2026-09-09 delivery.mjs 拆分记录

纯结构重构（无行为变更声明）：`modules/runtime/delivery.mjs` 原 3521 行按内聚家族拆为 `modules/runtime/delivery/` 下 5 个子模块，原路径保留为 barrel（re-export），命令路由、外部 import 与导出名集合不变。

- helpers.mjs 285 行 / 24 导出：常量与通用助手（DELIVERY_INTENSITIES、GATE_SCHEMA_VERSION、rootPath、taskDeliveryTargets、executionIsResumableCheckpoint、featureDependencyClosure 等）。
- evidence.mjs 1026 行 / 17 导出：截图/Mock/视觉验收证据家族（miniapp/api-mock evidence、visual archive/compare/validate-report、正常化逐区报告）。
- gates.mjs 418 行 / 14 导出：门禁机械（parseGateSince/Session、gateForStop、runForStopSessionEvidence 等）。
- commands.mjs 688 行 / 8 导出：交付命令（deliveryStart/Stage/StageArtifact/Supersede、implementation/mock/acceptance problems、STAGE_ARTIFACT_KINDS）。
- work.mjs 1371 行 / 36 导出：任务生命周期（workPlan/Claim/BindSession/Finish、文件租约锁族、buildKernelRecords/kernelBackfill 与 kernelSync）。

barrel 内容：

```js
export * from "./delivery/helpers.mjs";
export * from "./delivery/evidence.mjs";
export * from "./delivery/gates.mjs";
export * from "./delivery/commands.mjs";
export * from "./delivery/work.mjs";
```

全量回归（命令与拆分前相同）：`scripts/*.test.mjs` + modules/prototype/types/graph/kernel/workflow/capabilities 测试 = 224 总数 / 223 通过 / 0 失败 / 1 跳过（跳过项为既存历史像素审计用例）。`miniapp-product-v2.test.mjs` 覆盖 delivery start/stage/stage-artifact 全链路 6/6 通过；workflow route 测试确认 26 条命令路由仍解析到真实模块与导出；导出面比对 98=98 完全一致。

纯结构、无行为变更：仅搬代码与补 import，未改动任何函数体；未触碰 `shared.mjs`；未改动 v1/v2/v3 流程文件、dispatch/registry、路由注册，未新增/删除导出名。

## 2026-09-09 死调试脚本删除记录

- 删除 `scripts/mdbg-tmp.mjs`（3377 行）与 `scripts/mf-dev-flow-debug.mjs`（2073 行）：M0/M1 时代各仅提交一次、此后从未改动、全库零引用（无 import、无命令路由、无文档指向），为纯死代码；删除前已 grep 复核。
- 不影响任何测试/路由/文档；git 历史可恢复。

## 2026-09-10 并发写入门禁补漏

起因：真实并发场景下三个会话同写 `src/pages/v2`，只读复盘暴露两处门禁缺口——跨运行写入范围重叠没有开工前检查，工作树级 git 操作（含误用的 `git stash`）既无纪律约束也检测不到。

改动清单：

- 跨运行预检（`modules/runtime/delivery/work.mjs`）：新增 `runWriteScopes` / `crossRunOverlap` / `overlapFailure`，`work plan` 与 `work replan` 在落盘前用其余进行中运行的写入并集做相交判断（复用既有 `scopesOverlap`）。相交默认 `fail`，显式 `--allow-overlap <理由>` 放行并把相交运行、范围、理由、`via` 写入 `work-plan.json` 的 `overlaps` 审计。补检 `replan` 是必要的：否则先登记小范围、再重排成大范围即可绕过 `plan` 的门禁。
- 回退检测（同文件 `workFinish`）：新增 `gitReverted` —— claim 基线脏文件中，既不再出现在 `git diff` 清单、内容又已不等于 claim 时快照的项。被 `git stash` / `checkout` / `reset` 回退的文件正是这个形态，原对账会静默漏掉；现纳入 `gitReconciled` 判定。`modules/runtime/shared.mjs` 的 `mergeAuditReminders` 增加对应提醒。只报告不回滚。
- 纪律条款：`flows/delivery/parallel.md` 新增「共享工作树的 git 操作」（并发期间禁止全树级破坏性 git 命令，需要隔离用 `git worktree`，只读命令不受限），合并验证门禁增加 `gitReverted` 复核项；`integrations/README.md` 并发与 git 对账章节同步说明，并修正"跨运行写入交集仍由租约硬拦"为"预检 + 租约"。

隔离声明：只读写临时 fixture 与技能目录；未读取、扫描、改写或迁移真实 `.mf-dev-flow`（`git status --porcelain .mf-dev-flow/` 为空），未启动真实产品、浏览器或交付运行。回归中新建的 fixture 仓库与目录均在 `afterEach`/`after` 清理。

回归统计（本轮复跑，逐套执行取总数）：

| 测试范围 | 通过 | 总数 | 失败 | 跳过 |
| --- | ---: | ---: | ---: | ---: |
| scripts（\*.test.mjs） | 139 | 140 | 0 | 1 |
| modules/runtime/tests | 3 | 3 | 0 | 0 |
| modules/workflow/tests | 6 | 6 | 0 | 0 |
| modules/prototype/tests | 70 | 70 | 0 | 0 |
| modules/prd/tests | 10 | 10 | 0 | 0 |
| modules/types/tests | 6 | 6 | 0 | 0 |
| modules/graph/tests | 17 | 17 | 0 | 0 |
| modules/kernel/tests | 20 | 20 | 0 | 0 |
| modules/capabilities/tests | 6 | 6 | 0 | 0 |
| dashboard/tests 服务端（\*.test.js） | 55 | 55 | 0 | 0 |
| hooks（codex mf-dev-flow.test.mjs） | 12 | 12 | 0 | 0 |

合计 **344 通过 / 345 总数 / 0 失败 / 1 跳过**（跳过项为既有历史像素审计用例）。看板 `tsc --noEmit --incremental false` 通过。

新增回归 5 项：lease 3（跨运行重叠拒绝登记且不落半成品任务、`--allow-overlap` 放行并保留审计理由与相交范围、不重叠范围直接登记）+ git-diff 1（claim 基线脏文件被回退时报告 `gitReverted`、不被误报为未观测）+ replan 1（重排不能绕过预检，`--allow-overlap` 后 `overlaps.via === "replan"`）。既有 `跨运行写入范围重叠时直接拒绝文件租约` 等 13 项 lease 用例与 `work claim 记录 git 基线` 用例不变仍绿，确认文件级硬拦与新增声明级预检并存、未互相干扰。

能力边界：预检拦的是"声明范围"层面的重叠，比 `work lease` 的文件级拦截更早更保守，两个运行声明同一大目录但实际改不同子文件也会被拦（需缩小声明或 `--allow-overlap` 记录知情）。`gitReverted` 只检测 claim 时已存在的脏文件被回退，检测不到"claim 前就未被记录"的内容，也不回滚；Bash 写盘与全树 git 命令仍绕过编辑工具租约（`git worktree` 的物理隔离仍是唯一强保护）。`--allow-overlap` 是显式知情放行，不是冲突解决记录；文件级冲突仍走 `work conflict-status` / `work conflict-resolve`。

## 2026-09-10 并发声明与归因

起因：上一轮（见 `## 2026-09-10 并发写入门禁补漏`）用声明预检 + 文件租约双层保护，但复核发现写入点硬拦只覆盖主会话 Edit/Write，子 agent、Bash/脚本、MCP 写盘都能绕过，且"拒绝即暂停"会让协作者误判并制造无谓等待。本轮把保护模型整体换成**声明预检（唯一硬保证）+ 全树快照区间归因 + 只记不拦的触碰台账**。

改动清单（Task 1.1–4.2）：

- 声明预检保留并成为唯一硬保证：`work plan` / `work replan` 用其余进行中运行的写入并集做跨运行相交判断（默认拒绝，`--allow-overlap <理由>` 显式放行并写入 `work-plan.json.overlaps` 审计）。
- 写入点降级为触碰台账（Task 4.1）：`work lease --for-write` 永远返回 `verdict: "allow"`，`PreToolUse` 不再返回 `permission: deny`；旧每运行 `file-leases.json` 不再写入，仅为读取历史保留；租约释放族改为无操作。触碰写入全局 `.mf-dev-flow/file-touches.json`，条目含 `at` / `file` / `runId` / `taskId` / `sessionId` / `agent` / `observations`，`observations` ∈ `no-active-run` / `out-of-scope` / `cross-run-scope` / `concurrent-same-file` / `prototype-reassessment-required`。
- 全树快照 + 区间归因（Task 2.x）：`work plan` / `work claim|bind` / `work finish` 各记一次整树 sha256 到 `delivery-runs/<run>/tree-snapshots.json` 增量链；`work finish` / `work merge-check` 输出区间归因。
- `work reconcile --run <ID>`（Task 3.2/3.3）：三桶 `attributed`（`basis: declaration-scope`）/ `inferred`（`basis: snapshot-interval`）/ `unattributed`（显式未知），附 `declaredUnchanged`（范围过宽信号）与 `shared`（跨运行共享），并为 `unattributed` / 共享项生成 `repairPrompts` 供主 agent fix-forward。
- `gitUndeclared` 基准修正（Task 1.1）：从任务自报 `--files` 改为**运行声明并集**，同运行共享声明的任务不再互相误报。
- 冲突命令重语义（Task 4.1）：`work conflict-status` 报告本运行触碰与未确认 `crossRunTouches`；`work conflict-resolve --conflict touch-<序号>` 确认/标注一条触碰（记录确认人与时间），不再释放锁；`mergeAuditReminders` 对未确认跨运行触碰输出非阻塞提醒。
- 文档同步（Task 4.2）：`flows/delivery/parallel.md` 重写执行协议第 3–5 条并新增「声明与对账」与门禁项；`integrations/README.md` 生命周期表与并发章节；`integrations/host-gate-findings.md` 2026-09-10 二次更新段；`SKILL.md` 并发句；`integrations/codex/hooks/policy-engine.mjs` SessionStart 上下文。

隔离声明：本轮只读写临时 fixture 与技能目录；未读取、扫描、改写或迁移真实 `.mf-dev-flow`（`git status --porcelain .mf-dev-flow/` 为空），未启动真实产品、浏览器或交付运行。回归新建的 fixture 仓库与目录均在 `afterEach`/`after` 清理。

回归统计（本轮最终全量复跑，命令见下）：

```bash
node --test .codex/skills/mf-dev-flow/scripts/*.test.mjs
node --test .codex/skills/mf-dev-flow/modules/*/tests/*.test.mjs
node --test .codex/skills/mf-dev-flow/dashboard/tests/*.test.js
node --test .codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.test.mjs
```

| 测试范围 | 通过 | 总数 | 失败 | 跳过 |
| --- | ---: | ---: | ---: | ---: |
| scripts（\*.test.mjs） | 150 | 151 | 0 | 1 |
| modules/\*/tests（capabilities 6 / graph 17 / kernel 20 / prd 10 / prototype 70 / runtime 3 / types 6 / workflow 6） | 138 | 138 | 0 | 0 |
| dashboard/tests 服务端（\*.test.js） | 55 | 55 | 0 | 0 |
| hooks（codex mf-dev-flow.test.mjs） | 12 | 12 | 0 | 0 |

合计 **355 通过 / 356 总数 / 0 失败 / 1 跳过**（跳过项为既有历史像素审计用例）。文档改动未破坏任何测试。

能力边界（必须与本轮模型一起读）：

- 触碰台账只覆盖**经过 hook 的写入**（主会话 Edit/Write）；子 agent、Bash/脚本、MCP 写盘都不产生条目，因此它是辅助证据，不是归因基准。归因基准是声明范围 + 快照区间。
- 唯一硬保证是登记时的声明预检。写入点不拦，越权写入只能靠收尾对账发现。
- `unattributed` 是真缺口：匹配不到任何任务声明（如 Bash 直写）时意图不可读，只能显式标未知、绝不默认算作本次改动；`inferred` 是证据级（`basis: snapshot-interval`），比 `attributed`（`basis: declaration-scope`）置信度低。
- fix-forward 依 `run context` 的 tasks/summary/attempts 时间窗、`implementation.md` 与当前 diff 重建内容，**不还原字节**；依赖运行目录叙述存活，被覆盖且未捕获的版本无法找回。
- 遗留运行目录若仍带有 open 状态的 `file-leases.json` 冲突记录，`work merge-check` 仍会硬阻断，且现无 CLI 解除路径（`work conflict-resolve` 已改为确认触碰台账，不再写 `file-leases.json`）；需人工编辑该文件处理（历史遗留面，新运行不产生此情况）。
- 全树级破坏性 git 命令仍绕过声明预检与台账，`git worktree` 的物理隔离仍是唯一强保护。

## 2026-09-10 Object Ref V1

目标：为 mf-dev-flow 已有对象提供可复制、可程序化定位的**项目内**稳定引用，不改写原生 ID、JSON/SQLite 主键或历史记录。格式为 `mf-dev-flow:<kind>:<key>`；key 由现有真源确定性派生，因而不引入递增编号、全局登记表或迁移写入。

改动清单：

- 新增 kernel `object-ref` 协议：严格的格式化、解析和规范化校验；支持 project、project-card、prototype-group、prototype-entry、prototype-source、prd-source、prd-batch、system-card、feature-group、feature、run、task、release、code-file。
- `record` / 图谱投影接入兼容映射，补齐原先已经产出但 kernel 不接受的 `feature-group` Graph Ref；Graph Ref 仍是图关系协议，Object Ref 只作为可选投影，二者不互相替换。
- 新增只读命令 `mf-dev-flow object locate --ref <ObjectRef> --json`：按真源返回摘要与 Truth Pointer。现代原型目录通过既有 public CLI transport 读取，不直接查询 catalog SQLite；代码文件路径校验工作区边界与软链逃逸。
- 看板状态只投影 `ref`，详情处提供复制入口；没有向页面状态泄露 Truth Pointer、绝对路径、会话或证据原文。
- 覆盖 legacy JSON fixture、现代 catalog 原型、项目/PRD/系统/功能/运行/任务/代码文件，以及未知、畸形和越界引用的拒绝路径。运行与任务的摘要、详情两个看板读取路径均断言生成同一确定性 Ref。

隔离声明：本轮只读写技能目录与 `os.tmpdir()` fixture；未读取、扫描、改写或迁移真实 `.mf-dev-flow`，也未启动产品或交付运行。

回归：

```bash
node --test --test-reporter=dot .codex/skills/mf-dev-flow/scripts/*.test.mjs .codex/skills/mf-dev-flow/modules/*/tests/*.test.mjs .codex/skills/mf-dev-flow/dashboard/tests/*.test.js .codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.test.mjs
pnpm exec tsc --noEmit --incremental false
git diff --check
```

以上三项均已通过：全量集合以 exit 0 结束，TypeScript 无诊断，补丁没有空白错误。已知边界：`release` 已保留协议格式但当前没有可验证的发布真源，定位会明确返回 `not_found`，不会凭目录名猜测；V1 的唯一性范围只限当前工作区，跨仓库或跨机器引用需未来由不可变 project UID 的 V2 解决。

## 2026-09-12 coordination seam 隔离维护验证

本轮只验证本地 coordination seam 与既有隔离 fixture；不是产品验收。新增文件为 `modules/coordination/{contracts.mjs,local-outbox.mjs,null-publisher.mjs,publisher.mjs}`、其三个 `tests/{boundaries,contracts,local-outbox}.test.mjs`，以及 `modules/kernel/{local-file-sink.mjs,projection.mjs,publish.mjs}` 和两个新增对应 kernel 测试 `tests/{projection,publish}.test.mjs`。已修改的既有技能/测试文件为 `modules/kernel/sync.mjs`、`modules/kernel/tests/sync.test.mjs`、`modules/runtime/delivery/work.mjs`、`scripts/mf-dev-flow.process-data.test.mjs` 与 Dashboard `prototype-impact` fixture；规格与计划文件位于 `docs/superpowers/{specs,plans}/2026-09-12-mf-dev-flow-coordination-seam-*`。范围检查还会保留显示 `modules/prototype/catalog.js` 的外部变更：它在本计划启动前已经存在，本轮未触碰，也不属于本计划改动。

Dashboard fixture compatibility repair：`prototype-impact.test.js` 的合成 CLI 输入补齐了已必填、但此前 fixture 遗漏的 `--kind ui`。根因是 fixture 与既存 CLI 必填参数契约不一致；此修复不改变 coordination 运行时行为。

过程记录：首次完整隔离回归因上述 fixture 缺参失败；随后一次修复后的运行虽输出完全部子测试但主进程退出延迟，均未作为通过记录。以下是经过最终审阅修复后的最终复跑结果。

实际命令与结果：

| 命令 | 结果 |
| --- | --- |
| `node --test .codex/skills/mf-dev-flow/modules/kernel/tests/sync.test.mjs .codex/skills/mf-dev-flow/modules/kernel/tests/projection.test.mjs .codex/skills/mf-dev-flow/modules/kernel/tests/publish.test.mjs .codex/skills/mf-dev-flow/modules/coordination/tests/contracts.test.mjs .codex/skills/mf-dev-flow/modules/coordination/tests/local-outbox.test.mjs .codex/skills/mf-dev-flow/modules/coordination/tests/boundaries.test.mjs .codex/skills/mf-dev-flow/scripts/mf-dev-flow.process-data.test.mjs` | exit 0；67 通过，0 失败，0 跳过。 |
| `node --test .codex/skills/mf-dev-flow/scripts/*.test.mjs .codex/skills/mf-dev-flow/modules/*/tests/*.test.mjs .codex/skills/mf-dev-flow/dashboard/tests/*.test.js .codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.test.mjs` | exit 0；444 总数，443 通过，0 失败，1 跳过。跳过项为既有历史像素审计用例；本轮未新增跳过。 |
| `cd .codex/skills/mf-dev-flow/dashboard && node_modules/.bin/tsc --noEmit --incremental false` | exit 0；无输出。 |
| `git diff --check -- <本计划已跟踪目标路径>` | exit 0；无输出。 |
| `git diff --no-index --check /dev/null <每个新增目标文件>` | 每项原始 exit 1 均为与 `/dev/null` 比较的预期新增差异；无空白诊断，归一化检查 exit 0。 |
| `git status --short` | exit 0；记录本计划技能/测试/规格/计划文件与工作树其他既有改动。计划启动前已存在的外部变更 `modules/prototype/catalog.js` 仍保留显示，本轮未触碰。 |

未改边界：未读取、扫描、写入或迁移当前工作区真实 `.mf-dev-flow`；未启动产品、浏览器、中心服务或网络同步器；未对当前工作区真实 `.mf-dev-flow` 调用 current/claim/init/scan/map/refine/apply，所有这些命令调用仅发生在 `os.tmpdir()` 合成 fixture；未执行 `git add`、`git commit` 或 `git push`。所有涉及工作区状态或 mf-dev-flow 命令调用的回归均使用 `os.tmpdir()` 合成 fixture；纯 projection 单测仅在内存中执行，因而只证明技能与隔离契约行为，不证明产品功能。

## 2026-09-12 version 与 coordination status 隔离维护验证

本轮只新增技能版本可见性与本地协同的**只读**状态投影，不启用 Outbox、不接入 Hook 发布器、不增加网络或中心服务。静态发行信息位于 `modules/workflow/version.mjs`，命令为 `node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs version --json`；新会话 Hook 上下文会包含相同的 `mf-dev-flow@<版本>` 标签。`coordination status --json [--limit 1..50]` 只读取既有 `.mf-dev-flow/coordination`：目录不存在时返回 `not-enabled` 且不创建目录；只输出 event ID、时间、迁移和任务摘要，不输出 actor、evidence、origin、原始错误或本机路径。identity 校验抽到纯 `modules/coordination/identity.mjs`，供既有 Outbox 写入与新读取器共用，避免两套格式漂移。

实际命令与结果：

| 命令 | 结果 |
| --- | --- |
| 新增 RED 集合（version CLI、coordination status、Hook 标签） | 如预期因新模块与新 CLI 分支尚未存在而失败，之后再实现。 |
| `node --test .codex/skills/mf-dev-flow/modules/workflow/tests/route.test.mjs .codex/skills/mf-dev-flow/scripts/mf-dev-flow.coordination.test.mjs .codex/skills/mf-dev-flow/modules/coordination/tests/contracts.test.mjs .codex/skills/mf-dev-flow/modules/coordination/tests/local-outbox.test.mjs .codex/skills/mf-dev-flow/modules/coordination/tests/status.test.mjs .codex/skills/mf-dev-flow/modules/coordination/tests/boundaries.test.mjs .codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.test.mjs` | exit 0；54 通过，覆盖版本输出、未启用不写目录、公开摘要排序/limit、损坏 JSON、无效 identity、软链接、Hook 版本标签和既有 Outbox 契约。 |
| `node .codex/skills/mf-dev-flow/modules/workflow/tests/measure-context.mjs` | exit 0；入口 2477 UTF-8 bytes（仍低于 2500），Hook 最长测量 635 bytes（低于 2048）。已更新 metrics 快照。 |
| `cd .codex/skills/mf-dev-flow/dashboard && node_modules/.bin/tsc --noEmit --incremental false` | exit 0；无诊断。 |
| 首次完整 `node --test ...` | 450 总数中 448 通过、1 跳过、1 失败；失败为既有 `project-check` 临时端口复用 fixture，断言 `reusedExistingServer` 未出现。该路径不导入本轮版本/coordination 模块。 |
| `node --test --test-name-pattern='占用端口的 Next 风格监听进程按工作目录复用' .codex/skills/mf-dev-flow/scripts/mf-dev-flow.project-check.test.mjs` | exit 0；1/1 通过。 |
| 第二轮完整 `node --test --test-reporter=dot ...` | exit 0；用于排除首轮并行端口时序波动。 |
| `git diff --check -- <本轮已跟踪技能目标>` | exit 0；无空白错误。 |

未改边界：所有新增状态测试都使用 `os.tmpdir()` fixture；没有手动调用真实工作区的 `current/claim/init/scan/map/refine/apply`，没有创建或读取真实 coordination Outbox，没有执行 git 暂存、提交或推送。该维护只证明离线技能契约与隔离回归；它不证明任何产品运行、多人中心同步或远端 collector 行为。

## 2026-09-12 skillRoot / projectRoot 解耦隔离维护验证

本步只为未来“项目通过软链消费独立 mf-dev-flow”的布局抽出路径边界，**没有移动现有技能目录，也没有在真实工作区创建软链**。`mf-dev-flow.mjs` 现在从自身物理位置解析 `skillRoot`，只用它定位 Hook 策略引擎和 `scripts/mf-dev-flow.mjs`；项目状态、触碰台账、路由上下文、健康记录和子进程 `cwd` 均以 Hook 输入的规范化 `cwd` 作为 `projectRoot`。子进程显式继承 `MF_DEV_FLOW_HOME=<物理技能根>` 与 `MF_DEV_FLOW_PROJECT_ROOT=<消费者项目根>`。`policy-engine.mjs` 也优先使用绝对 `MF_DEV_FLOW_HOME` 定位 CLI，未配置时才由其物理位置回退，仍以自身进程 `cwd` 操作项目数据。

新增两个行为测试，全部在 `os.tmpdir()` 下建立合成消费者项目和外部物理技能目录：

- 消费者项目的 `.codex/skills/mf-dev-flow` 为目录软链时，SessionStart 必须读取该消费者项目自己的 `symlink-run/symlink-task` 绑定，不能误读技能所在目录的父项目。
- 即使临时移除消费者入口软链，直接运行外部物理技能目录的策略引擎，在提供 `MF_DEV_FLOW_HOME` 后仍必须在消费者项目写入触碰台账；这钉住“找脚本”和“读写项目状态”两条根不能重新耦合。

TDD 记录：先只加入上述测试，旧实现按预期失败（上下文为“流程未选定”，策略引擎未返回 `allow`）；实现后两项通过。首次全量 Hook 回归还发现 `mf-dev-flow.mjs` 将旧项目根的六层上溯误用于技能根，导致本地子命令降级；已改为从 `integrations/codex/hooks` 上溯三层到物理 `mf-dev-flow` 目录，最终 Hook 回归恢复全绿。

实际验证结果：

| 命令 | 结果 |
| --- | --- |
| `node --test --test-name-pattern='a project consuming\|an external physical' .codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.test.mjs` | RED 后复跑 exit 0；两个新隔离行为测试通过。 |
| `node --test .codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.test.mjs` | exit 0；14/14 通过，覆盖既有生命周期、维护豁免、触碰台账、停止与健康记录。 |
| `node --test --test-reporter=dot .codex/skills/mf-dev-flow/scripts/*.test.mjs .codex/skills/mf-dev-flow/modules/*/tests/*.test.mjs .codex/skills/mf-dev-flow/dashboard/tests/*.test.js .codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.test.mjs` | exit 0；完整隔离集合通过。 |
| `pnpm --dir .codex/skills/mf-dev-flow/dashboard exec tsc --noEmit --incremental false` | exit 0；无诊断。 |
| `python3 <skill-validator>/quick_validate.py <skill-root>` | exit 0；`Skill is valid!`。 |

本步未读取、扫描、写入或迁移真实 `.mf-dev-flow`；未执行真实 `current/claim/init/scan/map/refine/apply`，未启动产品、浏览器、中心服务或同步器，也未执行 `git add`、提交或推送。测试中的外部技能目录、消费者项目和全部状态文件均在临时目录，清理后不保留真实项目状态。该验证证明路径解耦与本地 Hook 契约，不等同于已完成独立仓库迁移或中心化协作产品。

## 2026-09-12 独立核心目录与项目软链消费验证

在上一节 `skillRoot / projectRoot` 解耦通过后，mf-dev-flow 的物理核心已从消费项目移动到同级目录：

```text
<skill-root>/                                                 # 物理核心，单独维护
<consumer-project>/
  .codex/skills/mf-dev-flow -> <relative-path-to-skill-root> # 项目消费入口（相对软链）
```

项目内 `.codex/hooks.json` 未改，仍经消费入口调用 Hook，因此既有 Codex 信任与调用路径保持稳定。核心内所有物理脚本位置已由前一节的 `skillRoot` 解析；所有项目状态仍从 Hook 的 `cwd` / 子进程 `cwd` 解析。`mf-dev-flow.test.mjs` 的测试源定位也从消费项目祖先改为自身 `mf-dev-flow` 根，确保测试随物理核心迁移而非依赖旧目录层级。

消费项目 `.gitignore` 同步增加无尾随斜杠的 `!/.codex/skills/mf-dev-flow` 例外。原有仅目录形式的例外不匹配软链本身，会让 Git 把入口继续当作 `/.codex/skills/*` 忽略；修复后入口显示为 `?? .codex/skills/mf-dev-flow`，未来保存时能明确纳入消费项目，而不是只记录旧核心文件删除。

`.agents/skills/mf-dev-flow/SKILL.md` 现为指向 `.codex/skills/mf-dev-flow/SKILL.md` 的相对软链，消除两份不同技能说明；其 `integrations/zcode` bridge 与项目 `.zcode/config.json` 暂保留为消费项目兼容层，未被移动或执行。独立核心的 integrations 文档明确这层兼容代码不属于核心发布物，后续是否退役需在消费项目单独决定。

实际验证：

| 命令 / 检查 | 结果 |
| --- | --- |
| `node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs version --json` | exit 0；项目软链可达外部物理核心，返回 `mf-dev-flow@1.1.0`。该命令只读静态版本信息。 |
| `node --test .codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.test.mjs` | exit 0；14/14 通过，实际以项目软链加载外部核心。 |
| `node --test --test-reporter=dot .codex/skills/mf-dev-flow/scripts/*.test.mjs .codex/skills/mf-dev-flow/modules/*/tests/*.test.mjs .codex/skills/mf-dev-flow/dashboard/tests/*.test.js .codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.test.mjs` | 第二次运行 exit 0；迁移后的完整隔离集合通过。首次运行在临时 `mf-dev-flow-solution-*` fixture 写入时遇到本机磁盘 `ENOSPC`，进程退出后系统自动回收临时空间；未清理任何用户文件，恢复空间后重跑通过。 |
| `pnpm --dir .codex/skills/mf-dev-flow/dashboard exec tsc --noEmit --incremental false` | exit 0；无诊断。 |
| `python3 <skill-validator>/quick_validate.py <skill-root>` | exit 0；`Skill is valid!`。 |
| `.agents` / `.codex` 入口比较 | 两个 `SKILL.md` 解析到同一核心文件；项目 `.codex/skills/mf-dev-flow` 为相对软链。 |
| `git check-ignore` 软链回归 | 先由 `/.codex/skills/*` 规则命中（RED）；增加软链例外后不再被忽略，`git status --untracked-files=all` 显示 `?? .codex/skills/mf-dev-flow`（GREEN）。 |

边界：本轮没有初始化新的 Git 仓库、没有 `git add`、提交或推送；因此外部核心现在是独立物理目录，但其独立版本库与远端仍应在用户要求“保存/提交”时再建立。没有读取、扫描、写入或迁移消费项目真实 `.mf-dev-flow`，也没有调用真实 `current/claim/init/scan/map/refine/apply`。完整测试的状态文件只在临时 fixture 中创建并清理；本记录证明目录与消费入口可用，不证明产品业务流程或 ZCode bridge 已被退役。

## 2026-09-12 独立核心本地保存

用户随后明确要求“保存”。外部物理核心已初始化为本地 Git 仓库，`main` 的首个基线直接采用消费项目已提交的 `HEAD:.codex/skills/mf-dev-flow` 树；这避免用当前工作目录盲目全量暂存，也让旧技能历史在新仓库中可追溯。初始化时临时读取本地消费项目的 Git 对象，完成后已移除临时 remote；新核心仓库没有配置远端，也没有执行推送。

本次核心提交只包含路径根解耦、版本与只读 coordination status、相应 Hook/测试/文档变更。计划启动前已存在的 `modules/prototype/catalog.js` 修改明确不暂存、不提交，继续保留为独立本地改动；TypeScript 检查生成的 `dashboard/next-env.d.ts` 也不作为源码纳入。消费项目的保存范围独立为 `.gitignore` 的软链例外、`.agents` 唯一入口软链，以及旧内嵌核心树替换为 `.codex/skills/mf-dev-flow -> ../../../mf-dev-flow`；不混入任何业务文件、`.codex/hooks.json` 或真实 `.mf-dev-flow` 状态。

本节的本地保存不改变技能运行语义：消费入口仍由原 Hook 配置调用，核心仍以物理 `skillRoot` 找脚本、以消费者 `projectRoot` 处理项目状态。保存完成后应复验静态 `version --json` 能穿透项目软链；该命令不读取或写入真实 `.mf-dev-flow`。
