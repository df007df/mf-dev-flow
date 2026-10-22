# 内部结构与验证

只有根 SKILL.md 可被发现为技能；flows 是渐进阅读入口，modules 是内部实现。

| 位置 | 职责 |
| --- | --- |
| scripts/mf-dev-flow.mjs | 公共 CLI，先路由再按需 import |
| modules/workflow/registry.json | 流程与命令路由的唯一清单 |
| modules/workflow/route.mjs | 明确意图/会话绑定、恢复与 ≤2048 UTF-8 字节 hook 上下文 |
| modules/runtime/ | project / system / planning / delivery / archive / prototype-legacy / content 命令与共享门禁；按命令加载一个家族。delivery 逐区报告支持 `dimension: vision|dom`（缺省 vision 兼容旧报告）：`visual compare` 交付门禁归档，`visual validate-report` 独立校验不依赖运行/截图，供 e2e 与开发期等场景组合使用。delivery 命令家族已拆为 runtime/delivery/ 子模块，同路径 barrel 导出保持命令路由不变 |
| modules/delivery/contract.mjs | 通用任务结构与历史阶段契约；任务要求及历史阶段 brief |
| modules/prototype/ | 批次索引、内容缓存、语义目录、历史、公共 CLI 与分页客户端 |
| modules/runtime/prd.mjs | PRD 只读取证家族：来源冻结（file/dir/docx/snapshot）、findings 逐字引文门禁 check 与派生会议文档 render；自包含，不加载产品运行库；checkFindings 可用 `options.sourceText` 注入快照读取（看板按 workspace 绑定，不依赖 cwd）；`prd check --source <ID> --against <候选文件>` 在候选快照上重算逐字门禁，只输出候选下新失效的 `impactedItems`（在线来源会前重取的结论影响面）；CLI 永不联网，钉钉在线来源由 Agent 经用户级「钉钉文档」MCP 只读工具取全文后 `--snapshot` 登记，端点密钥只在 `~/.zcode/cli/config.json` |
| modules/planning/impact.mjs | 差异、全集遍历、关联闭包、逐项复评与开发阻断 |
| dashboard/ | 页面与只读 HTTP 适配；现代原型数据只经 public CLI；PRD 卡片经 server/readers/prd.js 复用 prd.mjs 同一 checkFindings 门禁实时重算核验状态（只读，不写 `.mf-dev-flow/prd`） |
| .codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.mjs | 真实生命周期协议适配，复用既有产品门禁 |

旧大 CLI 已按静态调用依赖拆分。shared.mjs 保留跨家族公共校验，仍较大；没有声称全部按函数动态加载。Next 仅由 dashboard 命令启动；flow 和未初始化 prototype status 不加载解析器、SQLite 或 Next。旧 server 文件是少量重导出，历史 prototype 命令只显式分流，不参与新目录链路。

通用 helper 能力（如内容指纹/变更对比 `content hash|compare`）作为自包含命令模块经 registry 路由暴露，由 Agent 在流程层组合调用；命令实现模块之间不做 import 复用（各域保留自己的最小实现），避免扩展点耦合进业务代码。逐区审查的双维度选择、模板与提示词固定在 flows/delivery/visual-acceptance.md。

新主数据：`.mf-dev-flow/prototype/catalog.sqlite`；批次：`prototype/analyses/<ID>/`。catalog 保存当前已接受结论、来源、问答/需求/说明、事件与不可变接受快照；批次保存冻结源码、候选、节点/边/控件出现关系、状态组合、真实证据引用与进度。报告是可重建产物。客户端分页传输，不直接打开 SQLite；脚本内部为审计和规划可聚合全量记录，不承诺常量内存。

目录锁仅用于首次成功安装；输入、schema、来源解析失败不得留下可识别 catalog。进程异常退出若留下锁，需人工核验后处理，不能在只读命令中自动迁移/删历史。后续语义写入用 SQLite 事务、expected-revision、request-id；来源初始化用确定性批次 ID 和完成目录恢复。命令失败有明确错误，开发门禁在无法核验时拒绝；hook 保留既有 adapter 故障 fail-open 行为，不能声称拦截任意手工写入。

所有验证命令必须在隔离 fixture 中运行被测 CLI，禁止借真实项目读取/写入 `.mf-dev-flow`：

```bash
node --test .codex/skills/mf-dev-flow/modules/workflow/tests/*.test.mjs
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/*.test.mjs
node --test .codex/skills/mf-dev-flow/modules/prd/tests/*.test.mjs
node --test .codex/skills/mf-dev-flow/scripts/*.test.mjs
node --test .codex/skills/mf-dev-flow/dashboard/tests/*.test.js
node --test .codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.test.mjs
```

看板类型检查从 dashboard 目录执行 `node_modules/.bin/tsc --noEmit --incremental false`；不需要启动 Next 或真实浏览器。复杂技能行为由独立审查者在临时项目验证正向路径与门禁失败。合成 fixture 图片/追踪仅证明工具行为，不能作为真实原型观察。

测量入口、对应流程、当前 brief、hook 与分页输出的实际 UTF-8 字节；缓存验证冷读、同内容重读、内容/版本变化。结果见 [本轮验证](validation.md)。
