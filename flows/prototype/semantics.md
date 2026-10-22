# 问题、回答、需求与补充说明

先 `prototype status --json` 得到当前 semanticRevision，再按 `query --collection questions|requirements|notes --id <ID> --detail` 读取目标。未建原型目录时需明确来源并成功 init；只读不会建库。语义命令都接收 `--input <JSON文件> --request-id <唯一ID> --expected-revision <N>`，单项最多 64 KiB，输入最多 1 MiB。

| 命令 | 输入 |
| --- | --- |
| `prototype question add` | id、question、actor；可选 impact、groupId、entryIds、origin、suggestedDefault |
| `prototype question answer` | id、actor、answer、conclusion；status 为 resolved（默认）或 open |
| `prototype question update` | id、actor 及问题说明/影响/关联字段；不能写 answer、conclusion 或 status |
| `prototype requirement add/update` | id、actor、text；有效（非 withdrawn）需求必须三选一声明影响范围：groupId、非空 entryIds，或 `impactScope: "global"`；可选 impact、status、kind |
| `prototype note add/update` | 同 requirement；用于用户说明或有来源的分析补充 |

add 的 origin 默认 user，可为 user / observed / inferred；只有 observed 必须提供当前 batch 与有效 evidenceIds。用户新增需求无需伪造原型截图；推断不能自动标为已观察。origin / evidenceIds 不能通过 update 改名。需求和说明 status 为 proposed（默认）/ confirmed / withdrawn；不删除原记录。撤回保留原因（text/impact）和操作者。

```json
{"id":"requirement-reader","actor":"用户","origin":"user","text":"阅读进度应跨设备保存；原型尚未展示","status":"confirmed","groupId":"reading","impact":"复评阅读器、账户与数据同步能力"}
```

三种范围互斥：groupId 影响整个分组，entryIds 只影响列出的入口及其依赖闭包，`impactScope: "global"` 仅用于确实跨全部功能的需求；不要同时填写它们。已有 accept 结论时，groupId/entryIds 必须指向其中真实存在的分组/入口；不能用未来或猜测的 ID 伪造局部范围。普通 requirement update 不得将已有 groupId 或非空 entryIds 的局部需求改为 impactScope: "global"。用户确实决定扩成全局时，先撤回原记录并保留原因，再新增一条明确说明全局影响的需求；不能把找不到局部目标当成升级理由。历史上缺少范围的有效需求不会被猜测成全局：它会显示为 `scope_required`，并阻止 `feature refine/apply`，直到补齐范围或撤回；不会把已发布地图无依据地扩成全量复评。

```json
{"id":"question-reader","actor":"用户","answer":"离线进度在恢复网络后同步","conclusion":"保留本地队列，恢复网络时合并；需复评冲突规则","status":"resolved"}
```

事务校验修订并原子保存原文、旧/新回答、结论、时间、操作者与请求 ID。相同请求/内容幂等返回，重用 ID 改内容或过期 expected-revision 被拒绝；冲突先重新 query。回答更正仍走 answer，历史用 `query --collection changes --subject <ID> --detail` 按页读取。接受分析的完整历史投影可从 `query --collection snapshots --id <快照ID> --field record` 分段读取，ID 在变更记录中。

semanticRevision 是成功事务的历史顺序；产品 fingerprint 由来源与实际语义决定，排除遍历进度、纯更新时间和证据重归档。重复同一回答可留下历史，但不应单凭历史计数触发规划失效。报告用 `prototype report` 派生；不要直接改 report.md、SQLite 或旧 JSON。

成功回答/补充后先 `graph sync --json` 把变化显式写成受影响功能点的 open 复评触发（写 feature-map 真源、同指纹幂等），再运行只读 `feature impact --json`。规划用 sourceQuestionIds / sourceRequirementIds 关联记录；关联的开放问题、未确认/已撤回需求和未复评变更会阻止继续开发。没有组/入口归属的疑问按全局处理，不能通过漏写关联逃过门禁；需求则必须在写入时明确范围，不能依赖遗漏归属。用户只要求补充时保留待复评；只有既有授权覆盖规划/开发才继续。

## 面向用户的问题与回答结果

问题先描述具体角色、触发操作和可见结果，再指出缺少的决定与影响；必要时给成功、明确失败、结果未知的具体例子和推荐处理。避免只问“恢复策略”等抽象术语。

更正先 query 稳定问题 ID 和当前修订，核对旧／新答案，不覆盖未回答项。提交后按“问题 ID → 用户决定 → 核验事实 → 受影响功能 → 剩余阻塞”说明结果。用户指定由某系统提供接口，只证明责任约定；候选路由、已核验接口和已接入状态仍各自需要证据。只补充／回答的任务到保存与影响说明结束。

## 走查后功能提问（实现取证）

用户在页面走查中就某功能提问（如“开始读的 5 本书怎么确定、数据现在怎么获取”）时，按以下顺序取证与留痕；记录只写原型语义真源，功能点通过 `sourceQuestionIds` 引用，不复制正文：

1. `prototype query` 定位功能点关联的分组、入口与既有问题；用 `run context --detail planning --collection features` 读取目标功能点的 `codeRefs` 与 `analysis.code`。
2. 只读 `feature impl-snapshot --id <功能点ID> --json`：返回 codeRefs 当前文件清单、SHA-256 指纹、mock/planned 启发式标记与 import 摘要。标记是检索线索不是结论；打开实际文件核对数据流后再回答，快照的 sha256 固定本次取证版本。
3. 回答用 `prototype question add` + `question answer` 留痕（question、actor、answer、conclusion），结论引用 impl-snapshot 输出与实际文件路径；同一问题被多个功能点引用时保持一条记录。走查中用户直接提的问题 `origin=user`，不需要伪造截图。
4. 回答中发现当前实现与 PRD、功能点 `analysis` 或已记录说明不一致时，属于实现漂移，不能只口头回答：登记 `note add`（origin=observed，附实际代码证据路径），在关联功能点 `blockers` 挂冲突说明，再 `graph sync --json` → `feature impact --json` 让复评门禁阻断相关开发，直到用户决定。
5. 用户要求按自己的方案调整时走需求链路：实现方式变更用 `requirement add`（kind=technical，见规划 [技术要求补充协议](../planning/solution-supplement.md)）；功能行为变更用普通 `requirement add` 或更新问题结论。之后 `graph sync` → `feature impact` → 规划复评 → 交付新任务；本流程不直接改产品代码。
