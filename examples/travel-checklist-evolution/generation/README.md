# 演示数据如何产生

本目录记录旅行清单演进案例的真实生成过程。里程碑中的 `.mf-dev-flow` 不是手工拼装的数据，而是在中性临时工作区实际执行 `mf-dev-flow` 工作流后冻结的原样状态。

## 边界

- 用户输入：`prd/` 中的需求文档，以及 `prototype/` 中的 HTML 原型。
- Agent 分析：PRD findings、原型观察记录、功能 proposal 与影响复评说明。这些文件只放在技能协议指定的位置。
- CLI 生成或核验：项目登记、来源冻结、PRD check/render、原型 audit/accept、功能 refine/apply、交付任务、阶段、验收、功能历史与影响状态。
- 开发与取证：`app/` 中的实现由交付任务产生；截图来自真实浏览器运行。
- 里程碑：`snapshot-case.mjs` 只复制已通过门禁的活动状态并计算 SHA-256，不生成或修改业务结论。
- 发布隐私：真实执行发生在固定的中性临时目录；命令日志留在仓库，最终快照按字节复制回来。原型目录可整体移动，CLI 会按安全相对路径在当前工作区重定位本地 HTML 来源。

## 准备干净工作区

从本示例目录执行：

```bash
node scripts/demo-workspace.mjs
```

该命令只把 `prd/`、`prototype/` 和 `app/` 复制到专用临时目录，不复制已有 `.mf-dev-flow`，因此不会把预制结论带进重放。再次执行会清空并重建这一个专用目录。

## 命令记录

每个 `case-0N.jsonl` 都由 `run-recorded.mjs` 在执行公开 CLI 时追加。记录只包含相对参数、退出码、执行时间和标准输出/错误的哈希，不保存可能包含本机路径的原始输出。

```bash
node scripts/run-recorded.mjs --scratch case-01 -- project status
node scripts/run-recorded.mjs --scratch case-01 --gate -- prototype status --json
node scripts/snapshot-case.mjs --scratch case-01
```

`--scratch` 只切换到专用中性工作区，仍调用仓库公开的 `scripts/mf-dev-flow.mjs`；`--gate` 只标记该成功命令是当前 Case 的最终门禁，不会改变 `mf-dev-flow` 的行为。

五个 Case 的记录覆盖真实的项目初始化、PRD 摄取与引文核验、原型 evidence/audit/accept、功能 refine/proposal-patch/apply、影响复评、验收用例版本管理，以及三次 `web-product@1` 交付。失败的门禁尝试也保留在 JSONL 中，便于验证流程不是“只记录成功结果”。

Case 03–05 还保留了以下可核查事实：

- 每个交付任务的方案、开发和真实浏览器端到端阶段。
- 通过 `stage-artifact` 登记的大截图与逐条 AC 结论。
- `work finish`、`work merge-check`、`work verify` 和最终 `run set --status done`。
- PRD v2 到来后第一次 `feature apply` 因迁移不完整被拒绝，补齐后才发布。

## 验证已冻结里程碑

```bash
node scripts/verify-example.mjs case-01 case-02 case-03 case-04 case-05
```

验证器会核对完整文件清单与 SHA-256、最终 gate、相对命令参数，并在全新的临时位置读取 PRD、原型、功能规划、AC 与影响状态，以证明快照离开原生成路径后仍可用。
