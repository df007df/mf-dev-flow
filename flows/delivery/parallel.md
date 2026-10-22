# 并发编排与合并门禁

本章只适用于项目产品代码、原型或系统事实的并发交付。维护 `mf-dev-flow` 技能本身、其脚本、hook 适配器或 hook 配置不创建运行、任务或执行记录，也不适用领取、声明预检、合并或停止门禁。

并发沿用用户已授权的范围；默认单功能 focused，不因强度、恢复或候选数量自行扩大范围。只有明确允许并发时，才派发任务。当前并发模型以 delivery run 为默认所有权单位：同一运行内的任务可以共享文件并由总 agent 最终合并判断；不同运行之间不得有写入范围交集。登记时的跨运行声明范围预检是开工前唯一会拒绝范围重叠的硬约束；写入点只记触碰、不拦截，任务终态、依赖、验收仍按公共门禁处理。总 agent 必须先完成工作计划，并在每次派发前读取运行边界判断；子 agent 不能自行创建任务、查询全局运行后自行改变范围，或直接改共享汇总文件。

## 任务索引与执行记录

采用 work 编排的交付／系统运行使用以下记录；现代原型批次使用自身索引事务，不套用这些运行文件：

```text
<run>/
├── work-plan.json                 # 总 agent 唯一可写：任务、依赖、功能范围、读写范围、耦合理由、跨运行放行审计
├── executions/<task-id>.json      # 领取该任务的 agent 唯一可写
├── tree-snapshots.json            # plan / claim / bind / finish 的整树 sha256 快照链，脚本维护
├── reconcile-resolutions.json      # 总 agent 对 shared / unattributed 文件的逐项裁决
└── integration.json                # 总 agent 的合并与验证结果

.mf-dev-flow/file-touches.json        # 全局触碰台账：hook 观测到的写入记录（只记不拦）
.mf-dev-flow/execution-index.json     # 从所有 executions 生成的只读汇总视图
```

`execution-index.json` 不是锁，也不是事实写入点；它可由 `work index` 重建。真正的占用锁是 `executions/<task-id>.json` 的原子创建：同一任务第二次领取必须失败。这样并行 agent 不会竞争同一个记录文件。旧版每运行的 `file-leases.json` 已不再写入，仅为读取历史运行保留兼容。

## 总 agent 的拆分规则

先按原型功能块、用户流程和优先级列任务；每个任务必须声明：功能块 ID、任务类型、读范围、写入范围、依赖、耦合判断和预期验证。运行的实际可写边界是全部任务写入范围的并集；同一运行内的任务可以共享这个并集中的文件。跨运行时，写入范围并集必须互不相交。

`work plan` 会在登记新任务时用其余进行中运行的写入并集做预检：相交即默认拒绝，并列出冲突运行与相交范围。只有显式传 `--allow-overlap <理由>` 才放行，理由与相交运行写入 `work-plan.json` 的 `overlaps` 审计。这是全链路唯一的硬保证——因为写入点不再拦截，声明预检成为唯一在开工前生效的强制约束。它拦的是"声明范围"层面的重叠，比逐文件的运行时判断更早、更保守；两个运行声明同一大目录但实际改不同子文件也会被拦，此时要么缩小声明范围，要么用 `--allow-overlap` 记录你是知情的。

可以并行的条件是同时满足：

- 没有先后数据依赖，或依赖已经完成；
- 不同运行之间的写入范围没有交集；
- 总 agent 接受同运行共享文件的最后写入/合并风险，并负责最终验证。

高耦合改动（同一 API/DTO/数据库模型、同一状态容器、共享组件、同一交互语义）仍优先合并到一个任务；若总 agent 明确拆成同运行并发任务，必须在合并验证中复核组合结果。

用户明确只做一个功能、页面或问题时，不拆分、不派发；若用户明确要求串行，也关闭并发。总 agent 还应受当前运行环境的 agent 容量限制，按 P0→P3 和依赖顺序调度。

## 共享工作树的 git 操作

多个并发运行通常共用同一个 git 工作树。全树级破坏性 git 命令（`git stash`、`git checkout -- .`、`git reset --hard`、`git clean`、`git stash pop` 等）会一次性改动或回退**运行范围之外**的文件，直接破坏其他运行正在进行的未提交改动；声明预检只约束开工边界、触碰台账只观测 hook 写入，都拦不住 Bash，事后也难恢复。

因此：并发运行期间禁止在共享工作树上执行全树级破坏性 git 命令；需要隔离或暂时收起改动时使用 `git worktree`（每运行独立工作树）或只对已声明范围内的单文件操作，不使用全树命令。只读的 `git status` / `git diff` / `git stash list` 不受限制。

`work finish` 的 git 对账会把"claim 时已存在的脏文件现在既不在变更清单里、内容又已不等于 claim 快照"识别为 `gitReverted` 并输出审计提醒——这正是回退或丢弃留下的痕迹。它只报告，不回滚；主 agent 必须在合并验证中人工判断这些文件是否被误伤。

此外，`work finish` 会为任务实际登记且相对 claim/HEAD 有效变化的文件记录 finish Git 对象指纹。`work merge-check`、`work verify --status passed` 及最终 `done` 都会重新核验：若文件在 finish 后消失，或又回到 claim 基线（HEAD 或当时已有脏内容），则以 `gitPostFinishReverted` **阻断**；后续合法集成把文件改成新的内容不会被当成回退。这个门禁只能防止静默验收，不能拦截 Bash 执行全树 Git 命令本身，隔离仍优先使用 `git worktree`。

## 执行协议

1. 总 agent 使用 `work plan` 登记全部任务；同运行任务允许写入范围重叠，但同一叶子功能仍不能拆成多个产品任务。`work plan` / `work replan` 会用其余进行中运行的写入并集做跨运行预检，相交默认拒绝（开工前唯一的范围硬约束）。
2. 每次把任务交给子 agent 前，总 agent 运行 `work delivery-brief --run <运行ID> --task <任务ID> --dispatch`。它只读取其他 delivery run 的声明范围、任务执行状态/时间/已报改动和当前工作树脏文件，不依赖 PreToolUse。结果为 `clear` 才可派发；`review` 时总 agent 必须阅读 `relatedRuns`、`dirtyFiles` 和已登记的 `overlapApprovals`，确认范围或脏文件归属后再派发；`block` 表示存在未经 `--allow-overlap` 审计、且相交任务仍未终态的进行中范围重叠，必须先缩小/重排范围、等待对方结束，或由总 agent 显式登记共享理由，不能派发给子 agent 碰运气。
3. 子 agent 开始前执行 `work claim`。在 Codex 共享工作区中必须附 `--session "$MF_DEV_FLOW_CODEX_SESSION_ID"`；已领取任务由新会话接手时用 `work bind-session`。领取/绑定成功后才可修改其声明范围。
4. 写入点不再拦任何写入：`work lease` 降级为触碰台账，只记录"谁在何时触碰了哪个文件"（`file-touches.json`），永不拒绝。它只覆盖经过 hook 的写入（主会话 Edit/Write），子 agent、Bash/脚本、MCP 写盘都不产生条目，因此是辅助证据，不是归因基准。并发保护由三件事承担：登记时的声明不重叠预检、派发前的主 agent 边界判断，以及收尾时的声明并集对账。
5. 台账里出现未确认的跨运行触碰时，运行 `work conflict-status --run <运行ID>` 查看本运行的触碰与 `crossRunTouches`（带 `cross-run-scope` 且未确认的项）；这不再是"被拒绝后的排障"，而是事后核对。`mergeAuditReminders` 也会对未确认的跨运行触碰给出非阻塞审计提醒。
6. 总 agent 用 `work conflict-resolve --run <运行ID> --conflict touch-<序号> --summary <结论>` 确认一条触碰（记录确认人与时间），它不是释放锁——当前模型不持有文件租约。未被确认的跨运行触碰保留在台账中，供收尾复核。
7. 子 agent 用 `work finish` 写 `done`、`blocked` 或 `skipped`。`done` 必须有摘要、实际改动文件和测试结果；未运行测试要写原因，不得伪称通过。
8. 总 agent 运行 `work merge-check`：所有依赖完成、没有未结束/受阻任务，且已完成任务登记的文件没有在 finish 后回退或消失，才可进入合并验证；同运行多任务声明同一文件不是错误。未声明、未观测或超出运行写入并集只输出非阻塞审计提醒，主 agent 复核后再 verify。
9. 总 agent 运行 `work reconcile --run <运行ID>` 对账当前树改动（见「声明与对账」），对每个 `shared` / `unattributed` 项运行 `work reconcile --run <运行ID> --resolve <shared|unattributed> --file <文件> --summary <裁决结论> [--by <agent>]` 留下裁决；然后合并阅读执行记录，更新共享开发报告与功能状态，执行跨任务的单测/e2e/原型回归，并用 `work verify` 记录实际命令和结果。

## 声明与对账

声明由主 agent 在拆解任务时一次性下达（`work plan --writes`，目录或文件前缀粒度）；子 agent 不声明、不需要 hook、不需要运行 ID。运行级可写边界是全部任务写入范围的并集。跨运行声明不重叠由 `work plan` / `work replan` 预检强制（默认拒绝，`--allow-overlap <理由>` 显式放行并把理由与相交运行写入 `work-plan.json.overlaps` 审计）。

保护不靠写入点拦截（子 agent 与 Bash 能绕过），而靠收尾对账：`work plan` / `work claim|bind` / `work finish` 各记一次全树快照（`delivery-runs/<run>/tree-snapshots.json` 的增量链），`work reconcile --run <ID>` 把当前树改动分入三桶——

- `attributed`：落在恰好一个运行/任务的声明内，`basis: declaration-scope`；
- `inferred`：无声明但快照区间内只有一个活跃任务，`basis: snapshot-interval`（证据级）；
- `unattributed`：无声明又无区间证据，显式标为未知，**绝不默认算作本次任务改动**。

对账同时给出 `declaredUnchanged`（声明了但没改动，是范围过宽的信号）与 `shared`（同一文件落在 2 个以上运行声明内，需人工确认）。`unattributed` 与跨运行共享项会生成修复提示词（`repairPrompts`），交主 agent 执行 fix-forward：依据 `run context` 的 tasks/summary/attempts 时间窗、`implementation.md` 与当前 diff 重建内容，**不还原字节**（被覆盖且未被捕获的版本无法找回）。主 agent 完成判断后，必须用 `work reconcile --resolve shared|unattributed --file <文件> --summary <裁决结论>` 写入运行内的 `reconcile-resolutions.json`；shared 裁决还绑定当时参与冲突的运行 ID，后续参与者变化会重新变成待裁决项。

两类缺口必须分开：**越界写入**（任务存在、意图可查，可 fix-forward）与**无来源写入**（匹配不到任何任务声明，如 Bash 直写，意图不可读，只能标 `unattributed`）。后者才是真正的盲区。

触碰台账（全局 `.mf-dev-flow/file-touches.json`，条目含 `at` / `file` / `runId` / `taskId` / `sessionId` / `agent` / `observations`，`observations` ∈ `no-active-run` / `out-of-scope` / `cross-run-scope` / `concurrent-same-file` / `prototype-reassessment-required`）只覆盖经过 hook 的写入（主会话 Edit/Write），是辅助证据，**不是**归因基准；归因基准是声明范围与快照区间。`work lease` 仍然被写入点调用，所以 hook 只是观测者。

## 合并验证门禁

总 agent 的最终验证必须覆盖：

- `work reconcile` 的 `unattributed` 与 `shared` 是否已逐条人工判断，并处理对应的 `repairPrompts`（fix-forward 或确认归属）；每项必须已写入 `reconcile-resolutions.json` 的裁决。`work verify --status passed` 会硬性拒绝任何未裁决项；
- `declaredUnchanged`（声明过宽）是否需要收窄声明或说明；
- 审计提醒中的未登记/越界改动是否已人工判断；跨任务的共享改动是否已人工合并复核；
- `gitReverted` 提醒中的文件是否确属其他运行被误伤，而不是本任务正常收尾；
- 不存在 `gitPostFinishReverted`：任何已完成任务登记的文件均未在 finish 后消失或回到 claim 基线（HEAD 或当时已有脏内容）；该项是阻塞门禁，需先恢复内容或按新的任务结论 fix-forward；
- 触碰台账中未确认的跨运行触碰是否已用 `work conflict-status` / `work conflict-resolve` 查看与确认；
- 子任务测试与跨任务测试是否都已真实记录；
- 组合后的主路径、异常路径、共享状态、接口契约与文案是否仍符合原型；
- 每个受影响功能块的实现状态、未完成原因和更新时间是否已回写；
- 任一失败、冲突或未测项是否保留为问题，而非标为完成。

`work verify --status passed` 既表示总 agent 已写入一次合并验证结论，也会硬性检查未裁决的 shared / unattributed 改动；运行的最终 `done` 状态仍由总 agent 在核对上述门禁后设置。
