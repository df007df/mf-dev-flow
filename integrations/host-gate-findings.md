# 宿主 hooks 与写门禁：实测结论（2026-09-09）

> 当前决策：本仓库 mf-dev-flow hooks 已收敛为 **Codex-only**。Cursor/ZCode 公开适配面已移除；
> 策略引擎迁到 `.codex/skills/mf-dev-flow/integrations/codex/hooks/policy-engine.mjs`。本文保留四宿主实测事实，仅作历史基线。
>
> 2026-09-10 更新：delivery 并发模型改为以运行为写入所有权单位。同运行任务/会话可共享文件；
> 跨运行写入范围交集由 `CROSS_RUN_FILE_CONFLICT` 拒绝。本文第 1 节的串行与独占范围描述不再是当前行为。
>
> 2026-09-10 二次更新（并发模型进一步演进）：写入点进一步降级为**只记不拦的触碰台账**
> （全局 `.mf-dev-flow/file-touches.json`，`work lease --for-write` 永远返回 allow，`PreToolUse`
> 不再返回 deny）；并发保护改为三件套——`work plan --writes` 的**跨运行声明重叠预检**（这是
> 唯一硬保证，相交默认拒绝、`--allow-overlap <理由>` 显式放行并留审计）、`work plan` /
> `work claim|bind` / `work finish` 的**全树快照**、以及 `work reconcile` 的**事后按声明范围
> 与快照区间归因**（三桶 `attributed` / `inferred` / `unattributed`，附 `declaredUnchanged` /
> `shared` 与 `repairPrompts`）。第 1 节"写范围重叠在 work plan 登记时即拒绝"的结论仍成立，
> 且是当前唯一的硬保证。

本文汇总 Codex / Cursor / ZCode / pi 四个宿主下 mf-dev-flow 写门禁的实际能力边界，
以及由此确定的并发编排约束。给后续优化（含 Codex 会话）当事实基线，避免重新考古。

## 1. 门禁机制链路（内核层，宿主无关）

- 写前检查：`work lease --for-write --session <ID> --file <F>`（`modules/runtime/delivery/work.mjs` 的 `workLeaseForWrite`）。
- 判据：`runningSessionTaskCandidates` 按 **execution.json 的 `sessionId` 精确匹配 + `status:in_progress`** 找任务，再 `taskCoversFile` 核文件是否在任务 `writes` 独占范围内。
- 拒绝码：`SESSION_NOT_BOUND`（无候选）/ `AMBIGUOUS_SESSION_BINDING`（多候选未指定 --run/--task）/ `WRITE_OUTSIDE_TASK_SCOPE`（越界）。
- 冲突登记：按任务对（waitingTaskId/ownerTaskId）写入 `file-leases.json`；**跨运行的 heldElsewhere 检查已存在**（work.mjs:729）——租约保护本来就是全局的。
- 写范围重叠在 `work plan` 登记时即拒绝（work.mjs:164-181），不依赖钩子，这是全链路仅存的硬保证。
- 关键结论：**PreToolUse 事件不携带运行/任务信息，sessionId 是 hook 反查任务的唯一键**。要改成"只认 run+task"，必须给 hook 注入 run/task 通道，或把 sessionId 从硬前置降级为显式键缺失时的回退。

## 2. 各宿主事件支持矩阵

| 事件 | Codex | Cursor | ZCode (v3.11.2) | pi (v0.74.2) |
|---|---|---|---|---|
| SessionStart | ✓ | ✓ | ✓ | `session_start` |
| PreToolUse（Edit/Write/apply_patch） | ✓ | ✓ | ✓ 仅主会话、仅 3 工具 | `tool_call` **覆盖全部工具含 bash** |
| PostToolUse | ✓ | ✓ | ✓ 仅主会话 | `tool_execution_end` |
| Stop | ✓ | ✓ | ✓ | `agent_end`/`agent_settled` |
| SubagentStart/SubagentStop | ✓（mf-dev-flow_delivery） | 部分 | ✗ | 无需——子代理是 pi 子进程，加载同一扩展 |
| SessionEnd | ✓ | ✓ | ✗ | `session_shutdown` |
| 其他 | — | — | UserPromptSubmit / PermissionRequest / PostToolUseFailure | `tool_result`（可改写结果）、`user_bash`（可接管 `!` 命令）、`context`（模型请求前注入）、`before_provider_request` |

ZCode 官方（zcode.z.ai）hooks 文档只有 7 事件；changelog 无扩展时间表（v3.8.1 加入的仅是工作区级 hooks 配置执行）。Subagents 文档未提钩子。

pi 的 `tool_call`：可 block（返回 `{block:true, reason}`）、`event.input` 可原地改写；handler 是进程内 async TS（jiti 直载，`.pi/extensions/*.ts`，需 project trust；无头模式默认不信任，用 `--approve` 或 `defaultProjectTrust`）。

## 3. ZCode 实测（2026-09-09，探针实验）

前提：存在 in_progress 运行（有活跃 work-plan），本会话未绑定任务。

| 执行者 | 动作 | 结果 |
|---|---|---|
| 主会话 Write `src/*.ts` | 编辑工具 | **拦截**：SESSION_NOT_BOUND，文件未落盘；`flow health` 有 zcode/PreToolUse 记录 |
| general-purpose 子代理 Write 同目录 | 编辑工具 | **直接成功落盘**，无任何门禁字样，`flow health` 无新记录 → 宿主不为子代理派生钩子 |

推论（已确认，非猜测）：

1. ZCode 下写门禁**只覆盖主会话自己的、经 Edit/Write/ApplyPatch 的写入**。
2. 即使在主会话内，Bash（`cat >`、`git apply`、脚手架）改文件也不触发 matcher——**无法控制所有文件改动都经主会话工具**，这是编排纪律也补不全的洞。
3. 事后审计同样是自报的：`mergeProblems` 核对 `execution.changedFiles`（agent 自填）对 task.writes；claim 时**没有记录 git 基线**（代码中无 `git rev-parse`），子代理写过的文件若不申报，记录上一片干净（实例：wordbook-store.ts 出现非申报改动）。

## 4. 并发编排结论

- **"一会话一 in_progress 任务"过严**：`assertSessionAvailable`（work.mjs:305）是唯一拦点；租约内核（scoped 路由 + heldElsewhere）本就支持一会话多任务。放宽该限制是低风险小改。
- **放宽后必须配"写后全量对账"才成立**：唯一不可绕过的记录源是 git。目标形态 = claim 记基线（HEAD + 脏文件快照）→ finish 用 `git diff <base>` + untracked 对账替代/校验自报 → merge-check 做跨任务/跨运行文件归属交集裁决。写前租约降级为尽力而为（主会话工具写仍拦），**事后判断只检测不恢复**——同文件并发覆盖需 worktree/分支物理隔离才能保住内容，否则接受"靠 git 历史找回"的残余风险。
- Codex 拓扑（子代理 mf-dev-flow_delivery 自行 claim+写代码，`--session <父会话ID>`）在 Codex 成立是因为子代理工具事件带父会话 ID；**勿照搬进 ZCode**：绑定身份与触发身份对不上 → 处处被拒，或不绑定 → 裸奔。
- ZCode 现存的两个安全形态都有前提缺口：形态 A（多主会话并行）保护"工具写"，挡不住 Bash 写；形态 B（子代理不落盘）同样依赖形态 A 的主会话纪律。结论：**ZCode 上唯一全量方案是 git 对账三件套，钩子只作快速反馈**。
- pi 是四宿主中唯一在架构上做到"子代理写入必过门禁"的（扩展在被保护进程内加载）；迁移面小：`.agents/skills/mf-dev-flow` 被 pi 原生发现、AGENTS.md 原生读、`.mf-dev-flow/` 状态零迁移，需重写的只有 hook 适配层（→ 一个 `.pi/extensions/mf-dev-flow.ts`，事件映射见 §2）与 `.zcode/commands`（→ prompt templates）。可作为后续 PoC 方向，非当前必选项。

## 5. 实施建议排序（给 Codex 会话）

1. execution.json 增加 `baseCommit` + 基线脏文件快照（claim/bind-session 时写入）。
2. `work finish` 用 git diff 对账 changedFiles，出入即 fail/blocked；`mergeProblems` 增加跨任务文件归属交集检查。
3. 放宽 `assertSessionAvailable`（一会话多任务），补 lease/delivery-processes 回归用例。
4. hooks README 与 parallel.md 的宿主差异句已就位，若做 pi PoC 再单开适配文档。

## 参考锚点

- 内核：`.codex/skills/mf-dev-flow/modules/runtime/delivery/work.mjs`（lease/claim/bind/stop）
- 适配层：`.codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.mjs`（Codex/ZCode 共用）、`.cursor/hooks/mf-dev-flow.mjs`（策略引擎）
- 配置：Codex 用 `.codex/hooks.json`；ZCode 用技能内插件 `.agents/skills/mf-dev-flow/integrations/zcode/.zcode-plugin/plugin.json`，不使用项目根 `.zcode/config.json`
- 并发协议：`.codex/skills/mf-dev-flow/flows/delivery/parallel.md`
- pi 调研文档本地缓存：`/tmp/pi-docs/`（extensions.md/rpc.md/skills.md/subagent 示例等，重装系统后会丢，来源 `github.com/earendil-works/pi`）
