# 系统卡片

系统卡片用于长期维护本项目所依赖或参考的外部系统事实。它只登记外部参考项目或系统，不能登记本地可开发项目；本地开发项目属于项目卡片。卡片按“系统”组织，不按代码库、数据库、配置或接口拆成平级条目；这些内容都属于该系统的来源或能力。卡片只表达当前有效关系，历史由 `system-runs/`、卡片 `changeLog` 与总索引 `history` 追溯。

同一代码库路径只能对应一张系统卡片；“参考实现”“登录核验”“支付链路”等是同一系统中的来源、事实或 API，不能另建重复系统。`system update` 会按代码库路径归并；遗留重复卡片用 `system dedupe` 合并，保留 API、问题、来源和变更记录，并删去重复 Markdown 派生卡片。

## 何时读取或更新

- 收到新的外部代码库、数据库、配置、文档、接口、数据口径或运行事实时，创建 `--type system` 运行并更新卡片。
- 方案设计确认前，读取相关卡片的权威边界、已知 API、访问限制、技术问题与待确认项，再判断能否复用现有能力。
- 确认本项目使用某个现有 API 时，必须登记 API、使用方、用途、方案依据、登记时间与最近确认时间。
- 方案不再使用该 API 时，从 `apiUsages` 删除当前登记；删除原因和时间保留在卡片变更记录及总历史中。
- 调用、联调或审阅依赖系统代码时发现明显技术问题，登记证据、影响、严重度、关联 API 和状态，供依赖系统后续优化。

## 权限边界

- 外部系统的代码和配置主要用于事实核验，只读参考，不得修改、提交、切分支或推送。
- 系统卡片可补齐参考项目路径、项目定位、测试/线上配置路径和测试/线上地址；这些是参考证据，不要求或暗示该系统已在本地运行、test 或 e2e 通过。
- 外部数据库允许直接连接读取，但只能执行 `SELECT`、元数据检查和显式只读事务；禁止 `INSERT`、`UPDATE`、`DELETE`、DDL、存储过程调用或任何可能写入/加写锁的语句。
- 配置文件默认只记录路径、环境职责和变量名。连接串、主机、数据库名、账号、密码、Token、Key 等值不得进入 `.mf-dev-flow/`、命令输出或回复。用户明确要求保留明文时，使用下述“私密配置侧车”，卡片仍然只记录路径、指纹和访问规则。
- 已有 API 只能在其权威范围、身份鉴权、稳定性和数据口径满足方案时复用；“存在接口”不等于“已确认使用”。

## 固定流程

1. 运行 `system status`，再 `system query --limit 10 --json` 定位卡片。按 `--card <ID> --field record --text-limit 2048` 分段读取相关完整卡片，续页带返回 fingerprint；不调用 current 或整读所有卡片。仅查看到此结束。
2. 创建 `run new --type system --title "<系统与更新范围>"`。
3. 在运行的 `cards.json` 放入本轮涉及系统的完整当前快照。代码库优先记录 commit；数据库记录引擎/只读查询时间，不记录连接信息。
4. 读取外部代码库自身的 `AGENTS.md` 或等价约束；若有 CodeGraph，先使用 CodeGraph，不可用再做只读源码检索并记录降级原因。
5. 在 `overview.md` 写确认事实与证据；在 `impact-analysis.md` 分析原型图、系统设计、技术方案/代码、数据模型/迁移和测试影响。原型默认最小改动。
6. 在 `tasks.md` 生成有优先级、影响区域、状态和验收证据的派生任务。未获实施授权的任务保持 `pending` 或 `decision_needed`。
7. 完成执行记录、`work merge-check`、`work verify --status passed`、`check --type system`，再将运行标记 `done`。
8. 先 `system update --from-run <id> --dry-run --json` 分页审阅替换／删除及字段差异；用返回 fingerprint 执行 `system update --from-run <id> --expected-fingerprint <指纹>`。脚本按卡片 ID 替换本轮卡片，生成 `system/cards.json`、`system/系统卡片.md` 与 `system/cards/<id>.md`。

## 固定文档结构

沿用当前 `schemaVersion: 2` 与单卡文档结构。`system/cards.json` 是长期结构化真源，`system/系统卡片.md` 是总览，`system/cards/<id>.md` 是完整单卡；Markdown 由 CLI 的 `cardDocument` / `writeSystemCards` 统一生成，不单独手工维护第二份内容。更新事实或回答问题时不重排、改名或省略一级栏目；无内容也保留栏目及空态说明。

单卡以系统标题开头，紧接系统卡片 ID、状态和最近核验时间，再固定按下列顺序组织二级标题：

| 顺序 | 栏目 | 当前内容/字段 |
| --- | --- | --- |
| 1 | 项目关系与权威边界 | `relationship`、`authority`、`usageBoundary` |
| 2 | 参考项目概览 | `referenceProfile`：路径、定位、测试/线上配置和地址、运行与测试边界 |
| 3 | 当前系统事实 | `facts` |
| 4 | 来源与访问约束 | `sources` 表格及逐来源三级标题详情，含版本/指纹、密钥处理和证据 |
| 5 | 已知 API 能力 | `knownApis` 表格 |
| 6 | 本项目当前 API 使用登记 | `apiUsages` 表格与当前使用语义 |
| 7 | 已知技术问题 | `technicalIssues` 表格，保留稳定 ID、严重度、状态、标题、影响/说明、最近确认 |
| 8 | 方案设计使用提示 | `designGuidance` |
| 9 | 待确认问题 | `openQuestions` 文本列表，无待确认项时显示“无。” |
| 10 | 卡片变更记录 | `changeLog`，含时间、动作、结论摘要与来源运行 |

技术问题和待确认项保持各自字段与栏目，使用同一回答入口。看板在“待确认问题”标题右侧展示 AI 星光按钮，点击先预览，再复制统一模板；不将按钮或提示词写入 Markdown。模板携带系统卡片 ID、目标文档、事实索引、最近核验与卡片来源运行。待确认项带原问题及逐项回答占位符；技术问题默认列出所有非 `resolved` 项（包括 `monitoring`），带稳定 ID、状态、影响、证据索引与逐项回答占位符。即使待确认列表为空，也可在此回答技术问题。

## 统一回答系统问题

识别“使用 mf-dev-flow 处理系统卡片问题”后，按上面的固定流程在**同一个 system 运行**中处理两类回答，不要求用户分开提交。只有用户明确填写的内容才是回答；空白、未替换的 `<…>` 占位符和复制的问题原文均不是确认。

1. 先按卡片 ID 读取当前 JSON 和单卡文档，再核对提示词的最近核验、来源运行和原问题。`openQuestions` 仍是文本数组，按原文匹配，提示词中的序号只是旧快照位置；技术问题按 `technicalIssues[].id` 匹配。列表重排不得导致回答错配；原问题已被实质修改、删除或无法唯一定位时，保留当前状态并仅澄清该项，其余可确认的回答继续处理。
2. 从该卡完整当前快照开始修改，只处理有回答的条目。用户说明可以确认决策，但需要源码、配置、接口或数据库证据才能确认的外部事实，仍按访问边界只读核验；不能核验时保留待确认项或技术问题状态，注明缺少的证据。方案/范围决定按需要登记长期约定；回答本身不等于授权修改外部代码、数据库或实施派生开发任务。
3. 待确认项有明确结论时，将有效结论合入相应事实、设计提示或使用边界，再从 `openQuestions` 移除该已确认项。技术问题保留 ID 和记录，更新说明、证据与最近确认时间；只有证据证明问题已消除或原判断不成立才设 `resolved`，继续跟踪为 `monitoring`，仍待处理为 `open`。接受风险、决定暂缓或仅提出修复方案，不等于问题已解决。
4. 在运行 `overview.md` 按“原问题/技术问题 ID → Agent 回答 → 核验依据 → 最终结论/状态”保留完整记录，并在卡片 `changeLog` 追加对应摘要、时间与运行 ID。未回答项、未解决问题、其他来源和 API 登记保持完整，不因整卡替换而丢失。历史运行不改写。
5. 完成固定流程的影响分析、执行验证与发布步骤，用 `system update --from-run <id>` 再生固定结构文档。最后报告已确认待确认项、技术问题状态变化和仍缺的信息，并给出更新后的单卡位置；未替换任何回答占位符时不创建空运行或刷新真源。

## 私密配置侧车

仅在用户明确要求保存可直接读取的明文配置时启用：

1. 原文逐字保存到项目根 `.mf-dev-flow-private/system/<system-id>/`；不得放进可提交的 `.mf-dev-flow/`。
2. 项目 `.gitignore` 必须忽略根目录 `/.mf-dev-flow-private/`；目录权限设为 `0700`，文件权限设为 `0600`，并以 SHA-256 核对副本与用户来源一致。
3. 系统卡片新增 `configuration` 来源，只记录侧车的项目相对路径、文件指纹、配置键范围和用户授权的读取用途；不得把秘密值复制到卡片、运行文档、看板或回复。
4. 后续任务可按卡片指针读取侧车中的正确值，用于用户已授权的连接或核验；读取时禁止打印完整文件、连接串、主机、库名、账号、口令、Token 或 Key。命令参数也不得携带会进入日志或进程列表的秘密，优先使用应用原生配置加载或仅限进程的环境传递。
5. 看板和其他只读展示只能读取 `.mf-dev-flow/`，不得新增访问 `.mf-dev-flow-private/` 的路由、接口或静态文件服务。
6. 用户撤销授权、提供替代配置或项目不再依赖该系统时，更新卡片指针与指纹；删除明文副本属于破坏性操作，必须再次取得用户明确授权。

## 替换与删除语义

- `cards.json.cards` 中的每张卡片是该系统的完整当前快照。更新已有卡片时，旧卡片会被整张替换；因此从 `apiUsages`、`knownApis` 或 `technicalIssues` 省略的项目会从当前卡片删除。
- 本轮未包含的其他系统卡片保持不变。
- 整个依赖系统不再相关时，将卡片 ID 放入 `removeCardIds`；同一 ID 不能同时更新和删除。
- 历史运行不得删除或改写。当前卡片不保留“已停用 API 使用”作为活跃项，避免过期信息影响方案判断。

## cards.json 结构

```json
{
  "schemaVersion": 2,
  "runId": "<run-id>",
  "cards": [
    {
      "id": "content-system",
      "title": "内容系统",
      "relationship": "书目主数据上游",
      "authority": "决定可见书目和人工维护字段",
      "usageBoundary": "代码/配置只读；数据库仅 SELECT；API 需方案确认后登记",
      "referenceProfile": {
        "projectPath": "/path/to/repo",
        "positioning": "本项目为何参考它",
        "test": {
          "configurationPaths": ["/path/to/test-config"],
          "addresses": ["https://test.example.com"]
        },
        "online": {
          "configurationPaths": ["/path/to/production-config"],
          "addresses": ["https://www.example.com"]
        }
      },
      "status": "confirmed",
      "lastVerifiedAt": "2026-09-03T00:00:00Z",
      "facts": ["只写有证据的当前事实"],
      "sources": [
        {
          "id": "content-codebase",
          "title": "后端代码",
          "kind": "codebase",
          "location": "/path/to/repo",
          "authority": "解释业务规则与接口实现",
          "accessPolicy": "只读参考，不修改",
          "secretHandling": "不读取或记录密钥值",
          "status": "confirmed",
          "version": "main@commit",
          "evidence": ["src/path/File.java"]
        }
      ],
      "knownApis": [
        {
          "id": "sale-page",
          "method": "GET",
          "path": "/app/items/page",
          "purpose": "获取可售条目",
          "status": "observed",
          "currentConsumers": ["legacy-client"],
          "evidence": ["客户端调用与服务端控制器"]
        }
      ],
      "apiUsages": [
        {
          "id": "catalog-sale-page",
          "apiId": "sale-page",
          "consumer": "catalog",
          "purpose": "同步可售书目",
          "decisionRef": "方案文档或任务 ID",
          "registeredAt": "2026-09-03T00:00:00Z",
          "lastConfirmedAt": "2026-09-03T00:00:00Z"
        }
      ],
      "technicalIssues": [
        {
          "id": "unstable-derived-metric",
          "title": "字段包含随机派生值",
          "severity": "high",
          "status": "open",
          "summary": "不能作为真实指标导入",
          "apiIds": ["sale-page"],
          "observedAt": "2026-09-03T00:00:00Z",
          "lastConfirmedAt": "2026-09-03T00:00:00Z",
          "evidence": ["服务实现文件与方法"]
        }
      ],
      "designGuidance": ["方案判断规则"],
      "openQuestions": ["仍待确认的问题"],
      "changeLog": [
        {
          "at": "2026-09-03T00:00:00Z",
          "action": "card_created",
          "summary": "建立系统卡片",
          "runId": "<run-id>"
        }
      ]
    }
  ],
  "removeCardIds": []
}
```

允许的来源 `kind`：`codebase`、`database`、`configuration`、`document`、`api`、`other`。卡片与来源 `status`：`confirmed`、`partial`、`unavailable`。已知 API `status`：`observed`、`partial`、`unavailable`。技术问题严重度：`low`、`medium`、`high`、`critical`；状态：`open`、`monitoring`、`resolved`。

## 快速维护命令

### 公开参考地址（轻量路径）

已有系统卡片只缺一条公开测试或线上地址时，不必创建 `system` 运行。先用 `system query` 定位目标卡片，再以可复核且不含密钥值的证据直接登记：

```bash
node $D system profile-address --card <系统ID> --environment test|online \
  --address <公开HTTP(S) origin> --evidence <脱敏证据>
```

该命令只会追加或复核 `referenceProfile.test|online.addresses`，并写入卡片与总历史的时间、环境和证据摘要。地址必须是无用户名、密码、查询参数、片段或路径的 HTTP(S) origin；它不发起请求，也不代表系统已启动、连通或通过测试。

以下情况不得走轻量路径，仍按固定流程创建 `system` 运行：新增/变更代码、配置路径或变量、数据库、API、数据口径、权限、运行状态、技术问题，或证据中可能含凭据、Token、连接串和其他敏感值。

方案确认后登记或再次确认 API 使用：

```bash
node $D system api-use --card <系统ID> --api <API-ID> \
  --consumer <使用方> --purpose <用途> --decision-ref <方案或任务依据>
```

不再使用时删除当前登记：

```bash
node $D system api-remove --card <系统ID> --usage <使用登记ID> --reason <原因>
```

发现明显技术问题：

```bash
node $D system issue-add --card <系统ID> --id <问题ID> --title <标题> \
  --severity high --summary <影响说明> --evidence <逗号分隔证据> --apis <API-ID列表>
```

技术问题状态变化：

```bash
node $D system issue-set --card <系统ID> --id <问题ID> \
  --status resolved --note <状态说明>
```

这些命令直接维护长期卡片，并写入时间与变更历史；新的系统事实、来源变更、API 目录变更或批量问题整理仍必须走完整 `system` 运行。

## 明确约定

当用户已经明确一个会影响后续原型、技术方案、任务边界或开发判断的决定，但它不是需要重新核验的外部系统事实时，登记为项目长期约定：

```bash
node $D system agreement-add --id <约定ID> --title <标题> \
  --summary <约定内容> --scope <适用范围> \
  --decision-ref <用户决定或方案依据> --evidence <逗号分隔证据>
```

约定写入 `.mf-dev-flow/system/agreements.json` 与 `系统约定.md`，看板会显示当前有效约定。每条约定必须有稳定 ID、约定内容、适用范围、决策依据与可复核证据；不得包含密钥或配置明文。新决定替代旧约定时，不删除旧记录：

```bash
node $D system agreement-set --id <旧约定ID> \
  --status superseded --note <被何项决定替代及原因>
```

这不是新增外部系统信息的快捷路径。新增或变化的代码库、数据库、配置、文档、接口和数据口径，仍按上面的固定流程建立 `system` 运行并完成核验。

## 完成门槛

- `cards.json` 至少一张卡片，每张卡片有稳定 ID、项目关系、权威范围、状态、最近核验时间和至少一个来源。
- 每个来源的访问约束与密钥处理明确；代码/配置只读、DB 仅 SELECT 的边界没有被弱化。
- 参考项目路径、定位与已知测试/线上配置或地址如有证据则登记；缺失时明确为“未登记”，不以启动/test/e2e 结果替代，也不要求补跑。
- 若存在私密配置侧车，已验证 Git 忽略、`0700/0600` 权限、来源/副本指纹一致且看板无法读取；卡片只含路径、指纹和键级摘要。
- `apiUsages` 只包含当前确认使用项，并能追到方案或任务依据；引用的 API 必须存在于同卡 `knownApis`。
- 技术问题有可复核证据、影响、严重度、状态和时间，不能只写主观评价。
- 外部系统与当前原型/代码的冲突有具体证据，派生任务区分记录完成与实施完成。
- 总控验证为 `passed`，系统运行已 `done`，长期系统卡片已刷新。

完整更新与快速问题／API 更新在写入锁内重新核对读取时的指纹，发生并发变化时拒绝覆盖。完整更新的 `--expected-fingerprint` 还把用户审阅时点绑定到发布；兼容旧调用时省略此参数仅保护本次命令读取到写入之间的变化，不保护跨命令的旧快照。新流程始终传预览指纹。锁冲突后重新 query；异常退出遗留锁需核验进程后处理，不自动删除。

来源结论应分别说明：用户指定系统负责、发现候选接口、实际调用核验、本项目已接入。技术问题接受风险／暂缓仍保留状态与原 ID；仅有计划或占位响应不得写成接口已接通。
