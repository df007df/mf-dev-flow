# Codex / ZCode hooks：项目代码的 mf-dev-flow 流程与并发写入门禁

每个消费项目的 Codex 生命周期配置位于项目根 `.codex/hooks.json`，并通过
`.codex/skills/mf-dev-flow` 消费入口调用本目录的
[`codex/hooks/mf-dev-flow.mjs`](codex/hooks/mf-dev-flow.mjs)；
[`codex/hooks/policy-engine.mjs`](codex/hooks/policy-engine.mjs) 是内部策略引擎。

若某个消费项目仍启用 ZCode，它的 bridge 与 `.zcode/config.json` 属于该项目的兼容层，
不属于独立 mf-dev-flow 核心的发布物；迁移或移除时应在该消费项目单独处理。历史多宿主实测见
[`host-gate-findings.md`](host-gate-findings.md)。

## 生命周期映射

| 事件 | Codex | ZCode | 作用 |
| --- | --- | --- | --- |
| `SessionStart` | ✅ | ✅ | 注入会话路由、当前流程入口和下一条命令（UTF-8 ≤2048字节） |
| `SubagentStart`（`mf-dev-flow_delivery`） | ✅ | ❌ | 注入同任务续做、目标阶段检查点与阶段契约读取约束 |
| `PreToolUse`（`apply_patch` / `Edit` / `Write`） | ✅ | ✅（`Edit` / `Write` / `ApplyPatch`） | 记录文件触碰（不拒绝）：调用 `work lease` 写全局触碰台账，永远返回 `permission: allow` |
| `PostToolUse`（`apply_patch` / `Edit` / `Write`） | ✅ | ✅（`Edit` / `Write` / `ApplyPatch`） | 记录实际代码文件并刷新触碰台账 |
| `Stop` | ✅ | ✅ | 检查 checkpoint 与终态完成门禁；未通过时 `decision: block` |
| `SubagentStop`（`mf-dev-flow_delivery`） | ✅ | ❌ | 核验目标阶段 checkpoint；中间阶段通过后允许结束，契约终态要求任务 `done` |
| `SessionEnd` | ✅（advisory） | ❌ | 会话退出提示；租约释放已降为无操作（当前模型不持有文件租约），该事件在 Codex 中是 advisory，不负责续跑对话 |

Codex hook 输入使用 `session_id`、`cwd`、`hook_event_name` 和 `tool_input`。适配层从
`apply_patch` patch 文本以及 Edit/Write 的 `file_path` / `path` 提取目标文件。mf-dev-flow
技能、`.codex/hooks.json` 和 ZCode 插件声明属于工具自身维护面，直接豁免触碰记录和改动观测；
门禁脚本故障保持 fail-open，但会写入可观测的 degraded 状态。

## 并发与 git 对账

产品任务必须先 `work claim` 或 `work bind-session`。claim 会记录 `baseCommit` 和当时
工作区脏文件（含内容 SHA-256）。同一 delivery run 内的任务可以并发并共享文件。

写入范围**声明**由主 agent 在拆解任务时下达（`work plan --writes`，目录或文件前缀粒度）；
子 agent 不声明、不需要 hook 或运行 ID。跨运行声明重叠由 `work plan` / `work replan`
预检强制：相交默认拒绝，`--allow-overlap <理由>` 显式放行并留审计——这是全链路唯一的
硬保证。写入点不再拦写入：`PreToolUse` 调用 `work lease --for-write`，永远返回
`verdict: "allow"`，只把"谁在何时触碰了哪个文件"记进全局 `.mf-dev-flow/file-touches.json`；
旧版每运行的 `file-leases.json` 已不再写入，仅为读取历史运行保留兼容。

对账是归因基准：`work plan` / `work claim|bind` / `work finish` 各记一次全树 SHA-256
快照（`delivery-runs/<run>/tree-snapshots.json` 增量链），`work reconcile --run <ID>` 把当前树
改动分入三桶——`attributed`（落在恰好一个运行/任务声明内，`basis: declaration-scope`）、
`inferred`（无声明但快照区间内只有一个活跃任务，`basis: snapshot-interval`，证据级）、
`unattributed`（无声明又无区间证据，显式标未知，绝不默认算作本次改动）。同时报告
`declaredUnchanged`（声明过宽信号）与 `shared`（落在 2 个以上运行声明内），并对
`unattributed` / 共享项生成 `repairPrompts` 供 fix-forward（依 `run context`、
`implementation.md` 与当前 diff 重建内容，不还原字节）。

`work finish` 和 `work merge-check` 另用 git 基线和 hook 观测生成归属审计数据：未声明、
未观测、声明但未观测、越界登记都输出审计提醒，默认不因登记缺失硬失败，由主 agent 复核
实际改动。例外是 `gitPostFinishReverted`：完成时登记的有效文件若在之后消失或回到 claim
基线（HEAD 或当时已有脏内容），`merge-check`、`verify --status passed` 与最终 `done` 都会硬失败。`mergeAuditReminders` 还会对触碰台账中未确认的跨运行触碰给出非阻塞提醒；
`work conflict-status` 查看本运行触碰与 `crossRunTouches`，`work conflict-resolve
--conflict touch-<序号>` 确认一条触碰（记录确认人与时间）——它不再释放锁，因为当前模型
不持有文件租约。任务终态、依赖、验收仍是硬门禁。

触碰台账仍然只是辅助证据：Codex 的 Bash/脚本写盘不经过编辑工具 hook；ZCode 的子代理、
Bash、脚本和 MCP 写盘也可能绕过登记。全树级破坏性 git 命令（`git stash` / `git checkout
-- .` / `git reset --hard` / `git clean`）同样绕过声明预检，会回退运行范围之外的文件；并发期间
应改用 `git worktree`。**声明范围 + 快照区间是归因基准**，其中 `gitReverted`
专门检测 claim 基线脏文件被回退或丢弃（内容已不等于快照且不再出现在 diff 清单），补上"静默
蒸发"这一缺口；它只报告不回滚。`gitPostFinishReverted` 则在最终门禁重新比对 finish 指纹，
阻断完成后才发生的回退或丢失；物理隔离仍然是最强的并发写保护。

## 开发约定

新任务先 claim/bind-session，再 delivery-brief；通用及当前 api/ui/fix 类型都不预设阶段，
省略 target-phase。三份报告保留计划、实时记录和测试回归。带 target-phase 的示例只适用于
声明了历史阶段契约的旧任务：

```bash
D=.codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs
node $D run context --id <运行ID>
node $D work claim --run <运行ID> --task <任务ID> --agent mf-dev-flow_delivery --session <session_id> --target-phase <中间阶段ID>
node $D work delivery-brief --run <运行ID> --task <任务ID>
node $D work bind-session --run <运行ID> --task <任务ID> --agent mf-dev-flow_delivery --session <session_id> --target-phase <契约终态阶段ID>
```

中间检查点由 `SubagentStop` 验证并释放本次并发执行；连续任务可重新 bind 续做。中间阶段不得
调用 `work finish`。契约终态完成后回写：

```bash
node $D work finish --run <运行ID> --task <任务ID> --agent <agent-id> \
  --status done --summary "<结果>" --files "src/<文件>" --tests "<实际命令与结果>"
```

历史阶段交付进入验收前，必须补全运行目录的 `plan.md`、`implementation.md` 与
`verification.md`。全链路验收还要把真实 E2E 截图放入 `screenshots/` 并在 verification 中引用；
`work verify --status passed` 与 `run set --status done` 会拒绝空模板或缺图记录。

Codex 项目钩子仅在信任该项目 `.codex` 配置后运行；首次使用在 Codex `/hooks` 审核并信任。ZCode 首次使用按插件 / workspace hook 信任流程确认。
自动化验证可临时使用 `--dangerously-bypass-hook-trust`。适配器故障 fail-open，但
`flow health --json` 能看到最近事件、degraded 状态和安全错误码；unknown/observed 都不是业务
门禁通过证明。

## ZCode Hooks

非插件 project-level bridge 只登记 ZCode 当前支持的四个事件。没有
`SubagentStart` / `SubagentStop` / `SessionEnd`，因此没有自动子代理观测和会话退出清租约
（当前模型也不持有文件租约）；Stop 仍会调用一次租约释放，但已降为无操作。bridge 和配置片段属于 mf-dev-flow 工具维护面，编辑这些文件不需要产品
任务声明或触碰记录。
