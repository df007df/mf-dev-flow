# 并发写入的声明与归因：从"锁"转向"声明 + 快照对账"

## 背景

9/10 那次三个会话同写 `src/pages/v2` 暴露的缺口，经只读复盘与历史考古后，结论比"门禁太松"更本质：

1. **写入点门禁在子 agent 场景下天然失效。** `integrations/host-gate-findings.md` 实测记载：ZCode 不为子代理派生钩子，`general-purpose` 子代理 Write 直接落盘、无任何门禁记录；即使派发钩子，绑定身份（父会话 ID）与触发身份也对不上。Bash / 脚本写盘同样绕过 matcher。文件级租约（`work lease --for-write`）因此实际只拦主会话的 Edit/Write。
2. **声明级判断是唯一的宿主无关硬保证。** 运行级写入范围重叠在 `work plan` 登记时即可拒绝，纯 CLI 读 plan，不依赖任何 hook、不依赖子 agent 配合——历史文档原话："不依赖钩子，这是全链路仅存的硬保证"。
3. **`gitUndeclared` 在并发下方向性错误。** 它拿单个任务的 `--files` 自报去比整棵树的 diff，导致运行 B 收尾时把运行 A 改的文件全算成 B 的未声明改动。实例：`20260910-090456Z/review-wordbook-defect-fix` 的 `gitUndeclared` 是整整 39 个 v2 主题文件，全部属于同时段主题运行。
4. **归因信息实际足够，缺的是对账入口。** `run context --id <运行ID>` 返回 run → tasks → attempts 与 summary；`implementation.md` 有 3770 字节级别的成因/文件/验证叙述。主 agent 靠"内容 + 查询并发运行的任务范围"已成功做过一次归因（`miniapp-verify-and-theme-fix.summary`："reader 的 themeClass 作用域编译错误经查属并发活动运行 20260910-094549Z 的任务范围，本任务未触碰"）。
5. **内容恢复只能是 fix-forward。** 被覆盖且从未被任何机制捕获的那一版字节不在工作树里；恢复靠 agent 依据任务记录中的意图重建，而非从 git 找回。约束：不允许为归因增加提交纪律。

## 目标

1. 主 agent 在**拆解任务时一次性下达声明**（目录/文件前缀粒度），子 agent 不声明、不需要 hook、不需要运行 ID。
2. 支持一个运行下多任务并发；跨运行声明不重叠。
3. **取消写入点拒绝（"锁粒度"）**：hook 降为触碰台账——只记录谁触碰了哪个文件，永不拒绝任何写入。
4. 声明 / 领取 / 收尾各记一次**全树快照**，形成时序区间。
5. 收尾前输出**对账视图**：树里每个改动是否落在某个声明内；给三桶归属；为异常生成**修复提示词**交主 agent fix-forward。
6. 修正 `gitUndeclared` 的比对基准为"声明并集"。

## 非目标

- 不提供写入点的内容保护；同文件并发写接受 last-write-wins（缓解见"风险与边界"）。
- 不做逐运行的确定性写入者归因；并发窗口完全重叠时归因退化为 `inferred` / `unattributed`。
- 不新增提交纪律，不依赖 hook 覆盖，不还原字节。

## 模型

### 声明（declaration）—— 唯一所有权记录

- **claimer 是主 agent**（实测依据：同一运行簇的所有任务共享同一 `sessionId`，如 `090040` 三个任务全是 `sess_7036694e…`；`agent` 字段是控制者标签或阶段 profile 名）。`work claim` 的实质是原子创建 `executions/<task-id>.json`（`openSync 'wx'`），记录 agent / sessionId / `baseCommit` + 脏文件快照。
- **子 agent 不可能 claim**：`SubagentStart` 注入只挂在 `mf-dev-flow_delivery` 这一种 Codex agent 类型上，且是 Codex 独有事件；ZCode 只登记四事件（`SessionStart` / `PreToolUse` / `PostToolUse` / `Stop`），无 `SubagentStart`，子 agent 既无注入也无钩子。因此"声明由主 agent 一次下达"不只是选择，而是唯一可能。
- 主 agent 用 `work plan --writes` / `work replan --writes` 下达声明，粒度到目录或文件前缀；同一运行内多任务可共享。
- 运行级写入并集 = 该运行所有任务 `writes` 的并集（已有 `runWriteScopes`）。
- **保留**跨运行不重叠预检（9/10 改动 2）：`work plan` / `work replan` 在落盘前用其余进行中运行的并集做相交判断，默认 `fail`，`--allow-overlap <理由>` 显式放行并写入 `work-plan.json.overlaps` 审计。这是唯一的硬保证。
- 不做：不要求子 agent 声明，不要求文件级声明（子 agent 事先无法枚举具体文件）。
- **连带结论**：一个运行簇里所有任务共享同一 `sessionId`，sessionId 无法区分任务，归因只能靠"声明范围 + 快照时序"，不能靠会话身份。

### 写入点降级为触碰台账（lease → touch ledger，只记录、永不拒绝）

保留 `work lease` 命令与 PreToolUse 注册，但**取消其一切拒绝语义**：写入点门禁降级为一份"谁在何时触碰了哪个文件"的台账，作为 git 快照之外的第二观测源。

- **永不拒绝**：`workLeaseForWrite` 所有 `deny` 分支（`SESSION_NOT_BOUND` / `WRITE_OUTSIDE_RUN_SCOPE` / `CROSS_RUN_FILE_CONFLICT` / `FILE_LEASE_HELD` / `FILE_LEASE_ACQUISITION_IN_PROGRESS` / `PROTOTYPE_REASSESSMENT_REQUIRED`）全部改为记录，返回 `verdict: "allow"` 并附 `observations[]`。`handleBeforeWrite`（`integrations/codex/hooks/policy-engine.mjs`）与 `.zcode` bridge 保留调用，但**不再产出 `permission: deny`**；`refreshLease` 读到的也只是观测。
- **记录内容**：每次触碰条目 `{ at, file, runId, taskId, sessionId, agent, observations[] }`，`observations ∈ { no-active-run, out-of-scope, cross-run-scope, concurrent-same-file }`。`cross-run-scope` 现只标记碰撞本身，不附相交运行 ID（如需附 ID 属未来扩展）。这正好为对账提供"有意触碰"的细粒度时间点，与快照区间互为佐证。
- **台账存储**（落地形态）：全局 `.mf-dev-flow/file-touches.json`（schemaVersion 1），不按运行分文件。旧的每运行 `file-leases.json` 只读兼容，不做迁移脚本。文件级的原子追加锁（`acquireLeaseLock` / `releaseFileLeaseLock` 模式的 touch 锁）**保留**——它们保护的是台账自身并发写，与"拒绝写入"无关。
- **取消的语义**：TTL 过期（`DEFAULT_FILE_LEASE_TTL_SECONDS` 的租约寿命）、`heldElsewhere` 抢占判断、`leaseIsActive` 的"是否仍持有"含义、以租约为前提的 `releaseTaskLeases` / `releaseSessionLeases` 释放逻辑（落地形态：两者均为无操作，会话只是不再产生新触碰，不写 `session-closed` 标记、不删历史）。
- **命令面**：`work conflict-status` 保留，语义改为"报告未确认的跨运行触碰"；`work conflict-resolve` 保留，语义改为"确认并标注该触碰"（不再解除锁，因为已无锁）。`mergeProblems` 不再把未决触碰当硬阻断，降为审计提醒（与 `mergeAuditReminders` 同层）。registry 路由不变。
- **明确局限（必须写进协议，否则会被误当全量记录）**：台账只记录**经过 hook 的写入**，即主会话 Edit/Write。子 agent 写盘、Bash/脚本写盘、MCP 写盘都不产生条目。因此它是**辅助证据**，不能单独作为归因基准；归因仍以声明范围 + 快照时序为主，台账用于在两者都模糊时提供"谁曾试图触碰"的线索。
- **会失去什么、由什么替代**：写入点不再拦任何写入（含主会话自己的 Edit/Write）。9/10 那次事故是三个并发**主会话**（形态 A），门禁当时确实拦到了（`CROSS_RUN_FILE_CONFLICT` 告警）。替代是声明预检：那三个运行各自声明了重叠目录（一个声明整个 `src/pages/v2`），新预检会在**登记时**就拒绝，覆盖同一场景且更早。区别是拦截点从"写入瞬间"前移到"计划时刻"，代价是计划后新出现的越界写入不再被即时拦下，改由对账发现。
- 测试：租约拒绝用例改写为"同样场景返回 allow 且 observations 含对应码"；新增跨运行触碰被记录为 `cross-run-scope` 且不阻断的用例。

### 全树快照（snapshot）

- 扩展 `gitSnapshot(root)`：从"仅脏文件"改为**全树产品文件 sha256**（tracked + untracked，用文件系统遍历，排除 `.git/`、`.mf-dev-flow/`、技能目录及其他 `GIT_PROCESS_PREFIXES`）；`baseCommit` 仍记录。
- 记录时机：`work plan`（声明时）、`work claim` / `work bind-session`（领取时）、`work finish`（收尾时）。
- 存储：`delivery-runs/<run>/tree-snapshots.json`，append-only 数组，每条 `{ at, taskId, kind, baseCommit, files: { path: sha256 } }`。为控制体积，除首条外仅存与前一条的差异（`added` / `changed` / `removed`），读取时按链重建；`kind ∈ {plan, claim, bind, finish}`。
- **相关运行**（对账参与集合）定义为：声明范围与本次对账运行的声明并集相交的全部运行，含已终态但仍有未提交改动的运行。对账时合并这些运行的快照，按 `at` 排序得到统一时间线。

### 区间归因（interval attribution）

- 时间线上每两个相邻快照之间，活跃任务集合 = 在区间内 `claim` 或 `bind` 过、且尚未 `finish` 的任务。
- 某文件在区间 `[k, k+1]` 内哈希变化：
  - 区间内只有**一个**活跃任务 → 归该任务，`basis: "snapshot-interval"`（证据级）；
  - 多个活跃任务或跨运行重叠 → 歧义，降级为 `unattributed` 候选，交主 agent 推断。
- 边界：改动后又还原成同一哈希 → 不可见；无 execution 记录的写入 → 无匹配对象，只能进 `unattributed`。

### 对账（reconciliation）

新增 `work reconcile --run <ID>`（并接入 `work merge-check` 与 `work verify` 的输出）：

- 计算当前树相对各相关运行 `baseCommit` 的全部改动（tracked diff + untracked）。
- 每个改动文件分类到三桶：
  - `attributed`：落在**恰好一个**运行/任务的声明范围内（`basis: "declaration-scope"`）；
  - `inferred`：落在零个声明内但有区间证据，或落在多个声明内但区间唯一（`basis: "snapshot-interval"`，附引用的运行/任务）；
  - `unattributed`：无声明、无区间证据（无来源改动，显式标记未知，绝不默认算作本次任务改动）。
- 另输出两类提示：
  - **声明但未改动**（范围过宽的信号）；
  - **跨运行共享**（落在多个声明内），要求 `--allow-overlap` 记录或人工判断。
- **修复提示词**：为 `unattributed` 与跨运行重叠项生成一段携带来源引用的提示词——引用相关运行的 `run context`、`implementation.md`、`execution.summary`、`attempts` 时间窗与当前 diff——交主 agent 执行 fix-forward 重建。

### `gitUndeclared` 基准修正

`workFinish` 中 `gitUndeclared` 的比对基准从"本任务 `--files` 自报"改为"**本运行的声明并集**"。同运行内任务共享声明，不互相误报；跨运行的改动不再算进本运行。这消除 `review-wordbook-defect-fix` 那类 39 文件误报。

## 落地路径

### Phase 1：对账基准与声明并集（修误报，最小可用）

- `workFinish` 的 `gitUndeclared` 改按运行声明并集比对。
- 新增对账计算（声明并集 → 三桶分类的最简版：只 `attributed` / `unattributed`，先不做区间归因）。
- 测试：修正现有 `mf-dev-flow.git-diff.test.mjs` 的基准断言；新增"运行内共享声明不误报"用例。

### Phase 2：全树快照与区间归因

- `gitSnapshot` 扩为全树；`tree-snapshots.json` 差异链存储与读取。
- 区间归因算法 + `inferred` 桶。
- 测试：单活跃任务区间归因正确；多活跃任务区间降级；哈希还原不可见；无记录写入进 `unattributed`。

### Phase 3：对账视图与修复提示词

- `work reconcile` 命令 + registry 路由；接入 `merge-check` / `verify` 输出。
- 三桶 + 两类提示 + 修复提示词生成。
- 测试：视图字段完整；提示词携带来源引用；空对账与全认领两类边界。

### Phase 4：写入点降级为触碰台账

- 取消 `workLeaseForWrite` 全部拒绝分支与 `handleBeforeWrite` 的 deny 输出；租约改为触碰台账（`file-touches.json`）；`conflict-status` / `conflict-resolve` 语义改为确认触碰。hook 的 PostToolUse 观测与文件级原子锁保留。
- 协议与 hook 文档同步重写；把"同样场景返回 allow + observations"改写租约测试，更新 hook 测试。
- 该阶段放在对账能力可用之后，避免出现"既无写入点保护、又无对账"的空窗。

## 与既有协议的一致性

- `flows/delivery/parallel.md`：重写并发模型——声明由主 agent 下达、写入点降为触碰台账（只记不拦）、快照与对账、三桶归属与 fix-forward、残余风险；保留 9/10 新增的「共享工作树的 git 操作」与 `gitReverted` 复核项。
- `integrations/README.md`：hook 只观测；对账是兜底审计源。
- `integrations/host-gate-findings.md`：更新"并发模型"结论段，指向本设计。
- `flows/maintenance/validation.md`：追加本轮隔离验证记录。
- `SKILL.md`：并发句由"冲突先 work conflict-status"改为"冲突走声明预检 + 对账"；触碰台账为辅助证据而非硬门禁。

## 风险与边界

- **写入点无内容保护**：同文件并发写为 last-write-wins。缓解：声明不重叠（硬保证）+ 真并发改同批文件时用 `git worktree` 物理隔离；不指望事后审计恢复被覆盖的字节。
- **两类不同性质的缺口，必须分开**（修正早期把两者混为一谈）：
  - **越界写入**：改动落在某个运行/任务的记录之外，但该任务存在 → 有意图可读，可用 `run context` / `implementation.md` 做 fix-forward，归入 `attributed`/`inferred` 并提示越界。
  - **无来源写入**：改动**匹配不到任何任务声明**（Bash 直写、未登记会话、无对应任务）→ 无意图可读，只能进 `unattributed`，fix-forward 缺来源。这才是唯一真缺口，设计显式标记，不假装可解。
  - 注意：子 agent 越界写**不属于**无来源写入——claim 由主 agent 做，任务记录本就在，意图可查。
- **全树快照体积**：数千产品文件 × 多次边界会增长；用差异链 + 仅相关运行参与对账控制。这是可优化项，不是正确性依赖。
- **意图记录的持久性**：fix-forward 的燃料是 `.mf-dev-flow` 运行目录里的叙述（`implementation.md` / `execution.summary`）；运行目录被清理则燃料消失。长期可恢复性依赖这些叙述的保留策略，本轮不改，仅记录。
- **归因置信度分层不可省略**：`inferred` 结论绝不能写成事实；审计记录必须区分 `basis`，否则一个推断错误会被后续读者当成证据。

## 落地状态

- 已实施（工作树未提交），详见 validation.md 2026-09-10 并发声明与归因 一节。
