# 原型、问题与需求

触发：分析指定原型、续做遍历、指定分析要求、回答问题、补充说明或需求。输入是明确来源/批次，或问题与用户说明；产出保存在 `.mf-dev-flow/prototype/`，不会自动授权开发。

## 视觉证据强制要求

原型截图核验、页面观察结果解释、以及与实现/V2 页面的对比判定必须通过图片分析能力完成：优先使用支持图像输入的大模型（当前会话或委托的视觉 Agent）、图片理解技能/工具，或专门的多模态分析通道。仅凭源码、DOM、选择器、截图元数据或结构化文本描述推断视觉内容，不视为已核验截图；源码/DOM 只能作为文案等事实的交叉核实，不能替代对截图的视觉查看。

涉及截图对比判定时，按需从能力索引加载 `visual-compare` 判定简报后再执行；字段结构一律由协议 schema 定义，能力只给判定口径、不定义字段结构：

```bash
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs capability show --id visual-compare --version 1  # 判定口径
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs capability list --json                              # 全量能力索引
```

当前执行环境不具备图像输入能力时，必须先向用户确认可用的视觉通道（切换视觉模型、调用图片分析技能、或派发视觉 Agent），得到选择后再继续对比或判图；用户明确坚持使用非视觉方式时方可继续，且该选择及其影响必须随批次记录，该批次不得登记为视觉级已核验。命令只核验文件存在与尺寸，不能鉴定图片内容，也不代表已完成视觉核验。

先 `prototype status --json`。未初始化只报告该状态；用户已授权分析时才按 [索引契约](contract.md) 执行 init。续做用 `prototype next --limit 10 --json`，需要指定历史批次时加 `--batch <ID>`。不新建 prototype-run，不执行 map/export/publish 链。

运行态来源先只读查看 `prototype process list`、`prototype adapter list`，再用 `prototype adapter capabilities --adapter web-runtime@1` 核验环境契约；这些命令只返回版本化清单和声明能力，绝不返回 Agent 指令。网页运行态批次由当前阶段 Agent 使用可用浏览器自动化完成，Node CLI 只保存和核验已经产生的截图、追踪与结构化观察，不能代替浏览器操作。

## 微信开发者工具小程序模拟器

小程序运行态适配器唯一选择：wechat-miniapp-runtime@1。先只读查看 `prototype adapter capabilities --adapter wechat-miniapp-runtime@1`，确认用户已授权的模拟器环境可由观察 Agent 使用；命令输出只包含声明能力，不输出项目定位、凭据、session 或 Agent 执行指令。

```bash
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs prototype init \
  --process runtime-analysis@1 --adapter wechat-miniapp-runtime@1 \
  --evidence-profile runtime-only --agent scope-snapshot \
  --input input.json --request-id miniapp-analysis-001
```

输入的运行态来源必须声明 `type: "runtime"`、该适配器、不可变 compile revision，以及 `wechat-devtools-simulator` 的安全项目路径和 `pages/` 开头的入口路由；具体字段和校验见 [索引契约](contract.md)。实际模拟器操作、截图和 trace 由当前阶段 Agent 完成，命令仅保存并核验已产生的证据。

## iOS 原生 App 模拟器

iOS 运行态适配器唯一选择：ios-app-runtime@1。先只读查看 `prototype adapter capabilities --adapter ios-app-runtime@1`，确认用户已授权的 iOS 模拟器环境可由观察 Agent 使用；命令输出只包含声明能力，不输出设备定位、凭据、session 或 Agent 执行指令。

```bash
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs prototype init \
  --process runtime-analysis@1 --adapter ios-app-runtime@1 \
  --evidence-profile runtime-only --agent scope-snapshot \
  --input input.json --request-id ios-analysis-001
```

输入的运行态来源必须声明 `type: "runtime"`、该适配器、不可变 build revision，以及 `ios-simulator` 的 bundle identifier 与模拟器 device 名称或 UDID；具体字段和校验见 [索引契约](contract.md)。实际模拟器操作、截图和 trace 由当前阶段 Agent 使用可用的设备自动化环境完成，命令仅保存并核验已产生的证据。

用户指定角色、页面、演示开关或截图要求时，按 [分析要求](analysis-requirements.md) 维护独立 AR 记录；未初始化也可登记，不因此开始分析。新建分析批次时才选择并冻结适用 AR。续做已有批次只能读取其冻结快照，不能因当前 AR 台账变化而把旧批次标为 stale；若要按新 AR 重核，需用户明确授权新建范围化批次。

- 实际分析：读 [操作方法](workflow.md)，每次只理解和操作当前小批。源码发现与缓存由脚本负责，真实操作、截图和解释由 Agent 负责。
- 问题回答或补充需求：只读 [语义命令](semantics.md)，用 query 定位，再用 question answer / requirement add / note add 留修订与历史。用户需求尚未在原型中出现时保留 user 来源。走查页面后针对某功能的提问（如数据来源、方案取舍）按 [走查后功能提问](semantics.md) 的取证序列处理：先只读 `feature impl-snapshot --id <功能点ID> --json` 拉取 codeRefs 当前实现快照，再回答留痕；发现实现与 PRD/功能点记录不一致时登记 observed 证据并触发复评。
- 完成：audit 为完整且人工核验证据后 `prototype accept --request-id <ID> --expected-revision <N>`；命令会自动生成流程报告。局部分析批次不得通过 accept 替换全产品基线；必须另行完成 full 范围分析后才能发布。局部批次仍可完成自身 audit、报告和问题记录，但不得把不完整投影发布到全局产品语义。若历史 bug 已错误接受 partial 批次、且用户明确确认原型内容未变，只能用 `prototype recover --from-snapshot <旧 full 快照> --source-equivalence <确认理由> --restore-scopes --request-id <ID> --expected-revision <N>` 恢复该不可变完整快照；它保留错误快照与事件、恢复被错误放大的局部范围，不生成新的观察证据，实际原型有改动时不得使用。`prototype report` 仅用于显式重建或修复历史报告。缺口与不可观察项保持未完成。

命令返回带字节上限的分页结果；进度 revision 与产品语义指纹分离。接受结论、问题回答、需求或说明变化后先 `graph sync --json` 把漂移显式写成受影响功能点的 open 复评触发（写 feature-map 真源并重建图索引，同指纹幂等），再执行只读 `feature impact --json`，查看所有状态功能及依赖闭包；需要重规划时交接 [规划入口](../planning/entry.md)。用户只要求更新原型时保留待复评，不自行开发。
