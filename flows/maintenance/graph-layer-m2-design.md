# M2 设计稿：变更传播图层（graph 层）与默认过程数据（hooks）

状态：已评审并实施 M2 v1（`modules/graph/`，见其 README"已知边界"）。范围只覆盖 M2（图层 + 过程数据接线）；kernel/TaskType 注册表见 M1，能力注册表见 M3，看板与 SVG 渲染见 M4，真实割接见 M5。已确认决定：`evidence/` 保留；planning 拆为 `feature-planning` 与 `feature-impact-review` 两个任务类型；hook 采集的过程数据默认开启、hook 强制安装，缺失只降级不破坏结构。

## 1. 目标

把 `change-impact.md` + `impact.mjs` 中"原型变动 → 反查闭包 → 逐项复评 → 显式状态更新"的原型专用闭环，泛化为类型无关的变更传播层，使以下三类场景成为同一机制的实例：

1. 原型重分析使分组变脏 → 反查受影响功能点 → 派功能点复评任务 → 结论写回功能点。
2. PRD 分析结论映射到原型分组 → 分组脏 → 与 1 同管道（两段边的传递闭包自动成立）。
3. 未来发布类型：`release → feature` 边登记后，功能点变脏可派回归/再发布任务。

设计约束（继承既有原则，不可让渡）：

- 边与闭包**由命令登记、代码计算**，不靠 Agent 手选；提示词只做节点上的判断与产出内容。
- 依赖对象的复评状态**显式落盘**在对象真源上（如 feature-map 的功能点），看板不得用 join 查询推导状态。
- 影响计算**只读、不自动创建运行**；分派是建议清单，开任务需要显式授权。
- 反查闭包不按开发状态过滤（done/blocked/执行中都纳入）。
- 图是**可重建的索引**，不是第二真源；节点内容真相仍在各自目录（catalog.sqlite、feature-map.json、prd/、system/）。

## 2. 数据布局

```
.mf-dev-flow/
  graph/
    graph.json            # 节点摘要 + 边表（命令构建，可全量重建）
    rebuild-report.md     # 最近一次构建的未解析引用与告警
  process/
    <sessionKey>.json     # hook 逐会话观测的写文件清单（现为 hook 状态文件，收编路径）
    reconcile-<runId>-<taskId>.json  # 观测与声明对账结果（kernel 记录引用）
```

真源目录不变。`graph.json` 丢失或不一致时用 `graph build` 从真源 + kernel 任务记录重建，安全性等同 `execution-index.json`。

## 3. 结构定义（schemaVersion 1）

### 3.1 节点

```json
{
  "ref": "prototype:g1",
  "kind": "prototype-group",
  "truthPointer": "prototype/catalog.sqlite#group/g1",
  "fingerprint": "sha256:…",
  "fingerprintsAt": "…",
  "label": "分级与选书",
  "dirty": false,
  "reassessment": [
    {
      "triggerRef": "prd:reading-prd-v3",
      "triggerKind": "prd-source",
      "triggerFingerprint": "sha256:…",
      "dirtyAt": "…",
      "status": "open",
      "viaEdges": ["edge:0194…"],
      "clearedByTask": null
    }
  ]
}
```

- `kind` 为封闭集合，v1：`prototype-group`、`prototype-entry`、`prototype-source-file`、`prd-source`、`feature`、`feature-group`、`system-card`、`code-file`、`project`。新 kind = 代码 + 版本。`code-file` 专指 UI 工程源码；原型 HTML/资产是 `prototype-source-file`，两者不得混用（影响"文件列表→影响范围"判断的边走向）。
- 指纹规范按 kind 定义在 `graph/fingerprints.mjs`：prototype 沿用 impact.mjs 现行口径（结论、问答、说明、当前来源、登记源码与截图内容）；prd-source 用 `content hash` 能力；feature 为影响复评后的内容指纹；code-file 为路径存在性 + 内容哈希。
- `reassessment` 存于节点真源（feature 节点即 feature-map 的功能点字段），graph 投影展示。旧单字段 `prototypeFingerprint` 迁移为一条 `{triggerRef:"prototype:<baseline>", …}`。

### 3.2 边

```json
{
  "id": "edge:0194…",
  "from": "feature:reader-core",
  "to": "prototype:g1",
  "kind": "scope-ref",
  "declaredBy": "task:20260907-075204Z/account-trial-entry/apply",
  "basisFingerprint": "sha256:<声明时 to 的指纹>",
  "at": "…"
}
```

v1 边 kind 与合法 (from→to) 组合（`graph/edge-kinds.mjs` 表驱动校验）：

| kind | 合法组合 | 含义 |
|---|---|---|
| `scope-ref` | feature→prototype-group/entry, feature→prd-source, feature→system-card | 功能规划声明的证据来源 |
| `evidence-for` | prd-source→prototype-group, system-card→feature, release→feature | 产出结论指向被影响实体 |
| `parent` | feature→feature, prototype-entry→prototype-group | 层级 |
| `depends-on` | feature→feature | 实施前置（反向传播仅表示需复核） |
| `implements` | task→feature, task→prototype-group | 任务对来源的作用（来源↔任务索引即此类边） |
| `observed-change` | task→code-file | 过程数据登记的改动文件（见 §5） |
| `sourced-from` | prototype-group/entry→prototype-source-file | 分组/入口的证据取自哪些原型源文件；`prototype-source-file` 节点由来源登记时创建，git 变动文件沿本边反查分组 |

- 边的唯一写入方是 apply/finish 类命令（内核记录校验 `touchedRefs` 后落图）；Agent 不能直接编辑 graph.json。
- `basisFingerprint` 是"声明时对方是什么样子"，闭包比较用（替代现在新旧两侧 feature-map 快照对比的专用实现）。

### 3.3 闭包接口（impact.mjs 泛化）

```
closure(dirtyRefs, {depth|all, edgeKinds, stopKinds}) ->
  [{node, reason, viaPath: [edge…], originRef}]
```

- 算法保持现行语义：新旧两指纹 diff → 按边反查 → 沿 `parent` 后代与 `depends-on` 反向下游递归至不动点 → 不因状态过滤。
- `feature impact` 变为薄封装：`closure(变动的 prototype refs)`，输出冻结进 `feature-impact-review` 任务记录（不再落 refinement-runs 散件）。
- 新增 `graph impact --from prd:x --json` 供任意来源使用；分页约束沿用"查询按页，禁止全量装上下文"。

### 3.4 分派规则（登记在 TaskType，不在 graph 层）

```json
"dispatch": [{
  "whenDirty": "prototype-group",
  "affects": "feature",
  "openTaskType": "feature-impact-review",
  "autoCreate": false,
  "batching": "per-trigger",
  "reportSlot": "feature.reassessment + impactReview"
}]
```

M2 只定义字段与消费方（`graph impact` 输出附建议任务清单）；执行发生在 M1 已就绪的 flow route/claim 授权下。

`batching: "per-trigger"` 是防扇出爆炸的粒度约定：同一 trigger（同一轮真源合入）产生的全部脏对象**聚合成一个任务建议**（一轮 refine，逐对象一条结论，一次 apply），不是一个对象一个任务。数据扇出（N 条结论）是业务要求的台账，不算广播；任务扇出必须经 batching 聚合。

### 3.6 防传播风暴（结构性熔断，四道）

1. `autoCreate: false`：闭包只产建议清单，不自动创建运行；任务级放大链不存在。
2. batching per-trigger：脏集合同任务批量处理，任务数 = trigger 数，不是命中对象数。
3. **传播源封闭**：仅证据性节点（prototype-group/entry、prd-source、system-card、prototype-source-file）可作 trigger；feature 等派生节点被复评改写**不再引发新闭包**。`depends-on` 反向递归只在单次闭包内展开（有界不动点），无派生→派生的循环触发。
4. 幂等收敛：同 triggerFingerprint 不重复置脏；keep 结论亦闭环 clear；真源再变则旧提案作废并入下一轮；git 高频提交在未 accept 前只累积"来源过期"，天然批处理为一次合入一轮复评。

复评的顺序依赖同样是熔断的一部分：先 `prototype-analysis` 更新真源（分组指纹实变），后 `feature-impact-review` 以合入结论为输入；同一时刻只有一个触发点在图上展开。

### 3.5 场景走查：原型 git 变更（读写两向必须分离）

读向（只读反查，不改状态）：`capability git-diff --repo <原型源> --base <登记commit>`（M3 已落地的 `git-diff` 能力，content-diff 家族）→ 变动文件沿 `sourced-from` 反查分组/入口 → 沿 `scope-ref` 反查功能点 → 沿 `implements` 反查历史任务。命令 `graph impact --from <file refs> --reverse`；原型分析任务用它圈定本轮重观察范围，看板用它做下钻。

写向（置脏，受门禁）：git 变动本身**不置功能点脏**，只更新 `prototype-source-file` 的来源新鲜度信号（现状 `catalog.js` freshness 的泛化）。功能点 `reassessment` 置脏仅发生在分析结论 audit/accept 合入真源、分组指纹实际变化之后——对应现行协议"未更新真源的源码变化不能直接刷新规划基线"。若允许 git 一动即置脏，任何提交都会误伤整串功能点复评任务。

## 4. 命令面

| 命令 | 职责 | 门禁 |
|---|---|---|
| `graph build [--check]` | 从真源+kernel 记录重建索引；`--check` 只校验 | 未解析 ref → 报告列出、**不猜**、退出码非 0 |
| `graph node <ref>` | 节点+边+reassessment 分页查看 | 只读 |
| `graph impact --from <refs>` | 只读闭包 + 建议分派清单 | 不创建运行 |
| `graph clear --trigger <ref> --by task:<…>` | 复评任务 apply 后代为清除对应 trigger 项 | 只能由登记了结论的任务触发 |
| `work finish` / 各 apply 命令（M1 已有） | 接收 `touchedRefs`，落边、置脏、写 basisFingerprint | schema 校验 + 边组合校验 |

## 5. 默认过程数据（hooks）接入

现状事实：PostToolUse/after-file-edit 已把逐会话 `files[{path,observedAt}]` 落盘并用于 Stop 门禁（`gate --for-stop --session-files`），但执行记录的 `changedFiles` 仍是 agent 手工 `--files` 声明（delivery.mjs `work record`），两路数据未对账。本层将其升级为**默认过程数据源**。

宿主覆盖（M1-2 实际落地口径）：**cursor、codex、zcode 三个宿主**。`.cursor/hooks/mf-dev-flow.mjs` 为策略引擎，`.codex/skills/mf-dev-flow/integrations/codex/hooks/mf-dev-flow.mjs` 同时适配 Codex 与 ZCode（线格式兼容；ZCode 支持 7 事件——SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/Stop，无 Subagent 事件与会话结束事件，故 zcode 下子代理检查点门禁不适用，子代理执行按 declared-only 降级）。状态目录按宿主族分两份（`mf-dev-flow-cursor-gate` / `mf-dev-flow-codex-gate`，env 可覆写），kernel `readHookObservations` 合并读取两族候选；健康记录按真实宿主命名（`zcode-*`/`codex-*`/`cursor-*`）。`.zcode/config.json`、`.zcode/hooks/` 属技能工具面，豁免于产品改动观测。

1. **强制安装核验**：`flow route` 与 `work claim` 时执行 hook 健康检查（现 `hook-health.mjs` 已记录 ok/degraded 事件）；未安装或 degraded 时返回 `[hooks_degraded]` 告警并写入任务记录 `processData.hookHealth`。产品门禁不因 hook 缺失而放行文件类证据（见 3）。
2. **对账而非替代**：`work finish` 时命令读取本会话 hook 观测文件清单，与 agent 声明的 `changedFiles` 求并集/差集：
   - 一致 → `provenance: "reconciled"`；
   - 观测有、声明无 → 拒绝完成，列出遗漏文件（agent 须补声明或解释为非本任务改动，解释进 notes）；
   - 声明有、观测无 → 允许但标 `provenance: "declared-only"`（subagent/远程执行拿不到 hook 的正常降级路径）。
3. **落图**：对账后的文件清单以 `observed-change` 边登记（task→code-file），成为 `codeRefs` 影响判断与"文件列表→影响范围"的准确输入。
4. **准确性分级**：kernel 记录带 `processData: {source:"hook"|"declared"|"none", complete:true|false}`。凡消费方需要文件级准确性的（如按 codeRefs 算影响、源码指纹），对 `complete:false` 记录**降级为提示 + 人工确认**，不静默当作完整。框架逻辑对两种情况同构，满足"缺失不影响结构、只损失准确性"。
5. hook 事件清单（SessionStart/SubagentStart/PreToolUse/PostToolUse/Stop/SubagentStop/SessionEnd）与 timeout 由安装脚本写入 `.codex/hooks.json`、`.cursor/hooks.json`；新增 `flow hooks install|verify` 子命令，M5 割接与 `project init` 均调用 verify。

## 6. Fixture 验证计划（隔离工作区，不碰真实 `.mf-dev-flow`）

- A（回归等价）：复刻 change-impact 场景——原型指纹变 → closure 结果与现 `impact.mjs` 输出逐条一致（新旧双跑对比）。
- B（组合传递）：PRD 边 → 分组脏 → 两段闭包命中功能点；`graph clear` 后 dirty 归位。
- C（对账三态）：reconciled / 声明缺失被拒 / declared-only 降级标记；`--check` 对未解析 ref 报错不猜。
- D（重建幂等）：删 graph.json → `graph build` 两次结果字节一致。
- 现有 `node --test scripts/*.test.mjs` 与 route.test.mjs 全绿为底线。

## 7. 明确不做（本里程碑）

- 不做图数据库、不引入新依赖；单 JSON 索引 + 分页读取，规模上限沿用"查询按页"约束。
- 不动无限层级 feature 地图 schema（现行"业务域+叶子"约束保持）。
- 不实现看板/SVG（M4 消费 graph.json 契约）；不在 M2 里迁移真实数据（M5）。
- runtime-analysis、miniapp-product 的 stage 契约不在本文改写，只在 M1 注册表里挂 dispatch 槽。
