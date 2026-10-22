---
name: mf-dev-flow
description: Use when a project request involves prototype analysis, product clarification, system facts, feature planning, product delivery, or mf-dev-flow maintenance.
---

# mf-dev-flow

唯一入口；按本次目标选流程，只读该入口及其链接协议；续做遵守已有授权与范围。

```bash
D=.codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs
node $D flow route --session <当前会话ID> --flow <流程ID>
node $D version --json; node $D coordination status --json
```

用户直接给出实现方式时走 [技术要求补充协议](flows/planning/solution-supplement.md)（planning 阶段 A → delivery miniapp-product@3 阶段 B）；先判定要求类型（product/technical/agreement），不得跳过 intake 直接改代码。

流程 ID、入口、首条命令和交接位置由 `flow list --json` 返回，唯一登记在 [流程注册表](modules/workflow/registry.json)。路由顺序：显式 `--flow` → 本次 `--intent` → 已保存选择 → 会话绑定任务 → 指定运行。未确定时只路由，不自动扫描/建运行/领取任务。不以 `current` 作为所有流程入口。

需要跨恢复保留明确选择时，用 `flow select --session <ID> --flow <ID>`。SessionStart 的 startup/resume/clear/compact 钩子只注入短路由，不加载整份技能。有阶段契约时，阶段完成后重读当前阶段 brief。

产品写入先 claim/bind-session；跨运行声明重叠由 `work plan` 预检拒绝，收尾用 `work reconcile` 对账，异常走 fix-forward；按任务声明核验阶段证据；原型变更复评和完成门禁由命令核验。新任务只保留开发计划（输入、并发任务）、实时记录、测试与回归；阶段及内部格式由任务类型约定，不默认套用四阶段。原型流程可保存用户指定分析范围与取证要求；保存不授权分析或开发。源码观察、用户意图、开发状态各按本流程记录，不能互相冒充。查询按页，不把全量数据库、图或历史装入上下文。

截图核验与差异判定必须经图片分析完成，禁止源码/文本替代；无视觉能力时先询问用户，坚持非视觉方式除外。各流程 entry 细化。

仅维护技能、脚本、hook 或看板时进入 `maintenance`：不调用真实 current/claim，不扫描、改写或迁移真实 `.mf-dev-flow`。用户要求稍后自行分析时，到技能验证完成为止。
