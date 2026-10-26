# 五分钟最小闭环：从功能点到真实浏览器验收

仓库自带的旅行清单示例用于回答一个问题：`mf-dev-flow` 是否能让一次 Agent 开发变得更可控、可续做、可核查？

## 先理解使用方式

实际开发时，你先把目标和约束告诉 Agent，而不是手工执行整条命令链：

> 开始开发第一个功能。完成后告诉我改了什么、测试是否通过，并给我看最终页面。

Agent 会读取已经确认的功能、验收标准和项目规则，建立交付运行、修改业务代码、执行测试和浏览器验收。`mf-dev-flow` 保存计划、写入范围、阶段、AC 与证据；看板只读展示结果。用户仍然负责确认需求、范围和验收标准。

完整的“需求 → Agent 分析 → 功能与 AC → 代码实现 → 验收 → 需求变化与重规划”流程图见[示例 README](../examples/travel-checklist-evolution/README.md)。

## 五分钟观察已完成结果

以下命令不会重新执行开发，只会切换到 Case 03 的冻结状态并启动只读看板：

```bash
cd examples/travel-checklist-evolution
npm --prefix ../../modules/prototype ci
pnpm --dir ../../dashboard install
node scripts/select-case.mjs case-03
node ../../scripts/mf-dev-flow.mjs dashboard
```

打开 <http://127.0.0.1:4173/>，重点查看：

1. “功能点分组列表”：一个用户结果、三条最终 AC、一个完整功能卡。
2. “运行历史”：方案确认、开发、真实浏览器验收和总控验证。
3. `app/index.html`：点击“仅看已完成”，再恢复全部项目。

![最小闭环的功能、AC 与三阶段状态](../examples/travel-checklist-evolution/screenshots/case-03/dashboard-feature-group.png)

这个 Case 的 `.mf-dev-flow` 由实际命令产生，三张浏览器截图也登记在交付阶段中。它展示的是“真的完成了什么”，而不是一份预先写好的看板 mock。

## 五分钟后继续看什么

- 想看最初如何从 PRD 和原型拆出功能：读 [Case 01](../examples/travel-checklist-evolution/cases/01-prd-and-prototype-baseline.md) 和 [Case 02](../examples/travel-checklist-evolution/cases/02-prototype-analysis-and-planning.md)。
- 想看需求变化后的主动影响分析：读 [Case 04](../examples/travel-checklist-evolution/cases/04-prd-change-impact.md)。
- 想看一个旧功能如何演进为三个有依赖关系的新功能：读 [Case 05](../examples/travel-checklist-evolution/cases/05-replan-and-final-delivery.md)。

完整索引与快照切换命令见 [示例 README](../examples/travel-checklist-evolution/README.md)。

## 什么时候值得用

| 场景 | 建议 |
| --- | --- |
| 需求会跨多轮、多人或多个 Agent 继续 | 使用：范围、状态和证据不会只留在聊天记录里 |
| PRD、原型、功能与实现必须可追溯 | 使用：来源和验收可以冻结并复评 |
| 已完成能力会被后续需求改动 | 使用：影响分析会阻止沿用过期结论 |
| 一次性小脚本或一行样式修改 | 不必展开完整闭环 |
