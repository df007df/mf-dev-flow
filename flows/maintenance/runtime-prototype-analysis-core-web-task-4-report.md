# Task 4 验证报告：运行态审计与验收

## 范围与上下文

本任务实现运行态原型的证据等级感知审计、`audit-accept` 验收门禁和诚实的报告覆盖边界。本次仅补交本报告；未修改实现、计划、看板、真实 `.mf-dev-flow`，也未提交或暂存。

相关实现与回归路径：

- `.codex/skills/mf-dev-flow/modules/prototype/core/graph-audit.js`
- `.codex/skills/mf-dev-flow/modules/prototype/core/report.js`
- `.codex/skills/mf-dev-flow/modules/prototype/core/report-format.js`
- `.codex/skills/mf-dev-flow/modules/prototype/catalog.js`
- `.codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs`
- `.codex/skills/mf-dev-flow/modules/prototype/tests/unified.test.mjs`

## RED / GREEN

- RED（任务简报记录）：新增验收/报告回归应先失败，原因是验收尚未要求 `audit-accept` 的 Agent 所有权，且报告尚未声明运行态证据的边界。本次文档收口不回退现有实现来重现这一历史失败。
- GREEN（当前复核）：`runtime-only acceptance refuses source-coverage claims and writes its limit into the report` 通过。它验证错误的 `runtime-observe` 验收 Agent 被拒绝；正确的 `audit-accept` 验收返回 `evidenceProfile: runtime-only`；生成报告包含“运行态覆盖”和“不声明源码、隐藏分支或未观察状态的完整性”，且不包含源码候选全覆盖声明。

## 已核验契约

- `graphProblems` 在 `workflow.evidenceProfile === 'runtime-only'` 时走运行态最小证据检查，不接受源码清单覆盖主张。
- `Catalog.accept` 先经工作流命令门禁，再要求当前阶段为 `audit-accept`、审计完成、来源与需求未过期；成功时冻结 process、adapter 与 evidenceProfile 标识，并把工作流置为 `accepted`。
- 报告固定使用：`证据等级：运行态覆盖。本报告只描述已实际观察并归档证据的行为；不声明源码、隐藏分支或未观察状态的完整性。` 报告格式常量与生成器共用该声明。
- 语义指纹排除运行证据字段；验收元数据保留冻结的工作流标识，避免把流程元数据误当作产品语义变更。

## 验证

以下命令在本次文档交付前实际通过：

```sh
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/runtime-workflow.test.mjs
# 14 passed, 0 failed

node --test .codex/skills/mf-dev-flow/modules/prototype/tests/*.test.mjs
# 47 passed, 0 failed

node --check .codex/skills/mf-dev-flow/modules/prototype/core/graph-audit.js
node --check .codex/skills/mf-dev-flow/modules/prototype/core/report.js
node --check .codex/skills/mf-dev-flow/modules/prototype/core/report-format.js
node --check .codex/skills/mf-dev-flow/modules/prototype/catalog.js
git diff --check -- .codex/skills/mf-dev-flow
```

## 自审

- 已从当前实现、Task 4 简报和覆盖该行为的测试核对上述事实。
- 本报告未夸大为源码完整性结论；运行态分析仍只陈述已观察并归档的行为。
- 本任务无可操作差异；仅新增本报告文件。

## 审查修复与最终复核

- 审查发现运行态分支虽已在 `graph-audit.js` 定义，但此前真实 `audit/accept` 路径仍走了并行的 `runtimeOnlyProblems`。修复后，`AnalysisStore.audit` 统一调用带 `workflow` 的 `graphProblems`；运行态最小门禁保留分组、节点、控件/发生记录、扫描和已归档证据校验。
- 新增回归证明：运行态快照伪造源码清单会阻止验收；缺失已记录分组会阻止验收；归档证据在验收前发生变化会阻止验收；报告格式仅在 `runtime-only` 时要求覆盖边界声明，`source-and-runtime` 不会被错误要求该声明。
- 最终完整命令于本次修复后执行并通过：`node --test .codex/skills/mf-dev-flow/modules/prototype/tests/*.test.mjs`，结果为 **51 passed, 0 failed, 0 skipped**。其中 Task 4 的运行态验收与四项负向/报告边界回归均通过。
- 语法检查通过：`core/store.js`、`core/graph-audit.js`、`core/report.js`、`core/report-format.js`、`catalog.js`、`tests/runtime-workflow.test.mjs`、`tests/unified.test.mjs`。
- 差异卫生通过：已执行 `git diff --check -- .codex/skills/mf-dev-flow`，并对 Task 4 涉及的未跟踪实现与测试文件逐个执行 `git diff --no-index --check /dev/null <file>`；均无空白错误。
- 最终自审：验收现在实际执行与证据等级相匹配的图审计，运行态结论仍严格限定于可回放的已观察证据；本次最终复核未修改任何实现、计划、看板、真实 `.mf-dev-flow`，未提交或暂存。
