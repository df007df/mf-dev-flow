# 运行态原型分析：版本化流程与来源适配器设计

## 目标与范围

将当前的原型分析从“共享流程文档 + HTML 静态发现”演进为可版本化的运行态分析体系。首批支持浏览器网页和微信开发者工具中的小程序模拟器，并允许只有可访问运行态、没有本地源码的分析。

本设计保留现有原型索引、证据归档、问题/需求、完整报告、`feature impact` 与规划交接；不创建第二套原型数据模型，也不改变交付流程的定义。

非目标：首批不实现 Figma、图片、视频或远程真机适配器；不把任意用户流程配置成无约束的工作流引擎；不迁移或重写已有 HTML 分析批次。

## 架构

```text
运行态来源 ──> 来源适配器 ──> 运行态分析流程 ──> 原型索引与证据归档
  网页 / 小程序       能力与标准工件       阶段图与 Agent            报告 / impact
       │                    │                    │                     │
       └──── 可选本地源码 ──┴────── 冻结到同一分析批次 ────────────────┘
```

体系分为两个独立的版本化维度：

1. **分析流程（process）** 定义如何分析：阶段、阶段转移、进入/退出门禁、阶段 Agent 和阶段简报。
2. **来源适配器（adapter）** 定义如何观察：来源定位、环境预检、导航、控件操作、截图、动作追踪及可选的源码发现能力。

两者不得互相复制职责。流程不知道微信页面栈或浏览器 URL 的细节；适配器不决定某条交互是否已经构成完整分析结论。

## 目录与版本规则

```text
modules/prototype/
├─ processes/
│  └─ runtime-analysis/
│     └─ v1/
│        ├─ process.json
│        └─ agents/
│           ├─ scope-snapshot.md
│           ├─ structure-model.md
│           ├─ runtime-observe.md
│           └─ audit-accept.md
└─ adapters/
   ├─ web-runtime/
   │  └─ v1/adapter.json
   └─ wechat-miniapp-runtime/
      └─ v1/adapter.json
```

目录版本不可变。修改流程图、阶段 Agent、适配器能力或适配器附录时创建新版本，而非改写已发布版本。新分析批次只能引用 `id@version` 形式的流程与适配器选择。

## 分析批次快照

`prototype init` 创建批次时，除了既有来源快照和分析要求外，还写入下列不可变快照：

```json
{
  "process": {"id": "runtime-analysis", "version": 1, "sha256": "..."},
  "stages": [{"id": "runtime-observe", "agent": {"id": "runtime-observe", "sha256": "...", "instructions": "..."}}],
  "adapter": {"id": "wechat-miniapp-runtime", "version": 1, "sha256": "...", "capabilities": {"...": "..."}},
  "evidenceProfile": "runtime-only"
}
```

阶段 Agent 指令是“通用阶段指令 + 当前适配器的阶段附录”的合并快照。后续修改文件不会影响已经启动的批次、证据判断或报告可追溯性。

`evidenceProfile` 只有两种合法值：

- `runtime-only`：只声明已实际观察到的入口、状态、操作和结果；不声明源码候选、分支或全量源码覆盖。
- `source-and-runtime`：运行态证据加上有效来源发现，允许执行既有候选、分支和状态空间审计。

来源、分析要求、流程或适配器能力与快照不一致时，批次进入 `stale`；不能继续取证、审计或接受，必须新建批次。

## 流程图与阶段职责

`runtime-analysis@1` 是受限阶段图，而非单向清单：

```text
scope-snapshot → structure-model ⇄ runtime-observe → audit-accept
                         ↑               │                 │
                         └───────────────┴──── 缺口回退 ────┘
```

| 阶段 | Agent 责任 | 出口门禁 | 回退目标 |
| --- | --- | --- | --- |
| `scope-snapshot` | 检查来源、适配器可用能力、可观察边界、分析要求和证据等级，创建快照 | 必需输入、适配器预检及快照完整 | 无 |
| `structure-model` | 有源码时处理候选/分支；无源码时建立分组、入口、页面、状态、控件和待观察路径 | 下一批运行态工作项有清晰目标和断言 | `runtime-observe` |
| `runtime-observe` | 以正常用户路径操作来源，保存截图与真实追踪，执行受管 `capture`，盘点状态 | 每项观察有已归档且有效的证据 | `structure-model`、`audit-accept` |
| `audit-accept` | 分页处理审计结果，人工复核证据和排除理由，验收并生成报告 | audit 完整、快照新鲜、人工复核已记录 | `structure-model`、`runtime-observe` |

当前最先未关闭阶段是唯一可领取和可写入的阶段。交接必须经验证检查点，记录前后 Agent、阶段、时间和缺口类别；不能通过指定后续阶段跳过前置工作。

问题、需求和补充说明继续是跨阶段语义操作：它们维持现有 revision/历史/`feature impact` 语义，不被强制放入某个阶段。开放问题可作为报告中的未决事实，但会按既有规则阻断受影响功能的开发。

## 适配器契约

每个 `adapter.json` 至少声明：

- `id`、`version`、摘要与哈希；
- 接受的来源定位方式，例如网页 URL、网页本地预览、小程序项目与模拟器会话；
- 是否具备导航、选择器操作、截图、原始动作追踪、可选静态来源发现能力；
- 可以合并进哪些阶段 Agent 的环境指令附录；
- 能力缺失时的明确阻断信息与安全边界。

所有适配器把操作结果归一为现有的“截图 + 动作追踪 + 断言”证据形状。小程序附录可解释页面栈、selector、模拟器刷新与页面跳转；网页附录可解释 URL、DOM 定位与浏览器导航。二者都不能把脚本点击、伪造日志或空截图标记为真实观察。

适配器预检只证明环境可用，不增加观察覆盖。无法存档截图或动作追踪时必须 `blocked`；能力不支持源码发现时只能选择 `runtime-only`。

## CLI 与运行时集成

保持 `prototype init` 入口，仅增加显式参数：

```bash
prototype init \
  --process runtime-analysis@1 \
  --adapter wechat-miniapp-runtime@1 \
  --evidence-profile runtime-only \
  --input <input.json>
```

新增的只读命令包括 `prototype process list`、`prototype adapter list` 和 `prototype adapter capabilities --adapter <id@version>`。`prototype next`、`query` 和当前阶段 brief 返回当前阶段、适配器能力摘要、冻结 Agent 哈希以及受字节上限保护的当前指令；绝不预加载未来阶段全文。

阶段状态、检查点与交接记录写入批次元数据/索引。现有 `put`、`capture`、`audit`、`accept` 仍是唯一的结构化状态与证据写入边界；它们在执行前检查当前阶段、流程快照和适配器能力。

## 兼容与迁移

- 历史 HTML 批次维持当前读取、报告和审计逻辑；它们没有 retroactive 的 process/adapter 快照，也不伪称采用新流程。
- 新流程只用于显式选定 `--process` 的新批次。默认行为在完成迁移和兼容测试前保持不变。
- 当前本地 HTML 静态发现可成为 `source-and-runtime` 的来源增强，但不是网页或小程序运行态适配器的前提。
- 初期仅注册 `web-runtime@1` 与 `wechat-miniapp-runtime@1`；其他格式必须先提供自身适配器与隔离 fixture。

## 失败处理与安全

- 任意流程/适配器/Agent 文件缺失、路径逃逸、哈希不匹配或不支持的版本：在写入批次前失败。
- 分析要求、来源、可用能力或源码快照变化：标记 stale，保留旧证据为历史，但要求新批次。
- 审计缺口按类型回退到建模或运行态观察；不得用手工改报告、直接改 SQLite 或标记状态绕过。
- 真正会造成外部副作用的操作仍仅限用户已授权的演示/隔离环境。

## 验证策略

1. 进程加载器测试：版本解析、目录边界、快照冻结、Agent 附录合并和未来阶段不泄漏。
2. 适配器契约测试：网页与小程序能力、无源码降级、缺失截图/追踪失败、无效能力组合拒绝。
3. 阶段图测试：初始阶段不可跳过、经验证检查点才可交接、audit 缺口只能回到允许目标、完成后不可续写。
4. 证据等级测试：`runtime-only` 报告不得出现源码全覆盖结论；`source-and-runtime` 缺来源审计时不可验收。
5. 兼容测试：旧 HTML 批次的 status、query、report、document、accept 历史读取保持不变。
6. 每个新适配器提供隔离 fixture，使用真实产生的截图与追踪验证归档和报告，不依赖真实产品数据。
