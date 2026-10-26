# Case 02：分析原型并拆出第一个功能

难度：入门进阶 · 预计 5–8 分钟

## 场景说明

PRD v1 要求旅行清单支持“仅看已完成”。Agent 需要先在真实浏览器中观察默认、筛选和恢复三个状态，再把它们收敛为一个用户结果，而不是按页面状态拆成三个伪功能。

## 如何操作

```bash
node scripts/select-case.mjs case-02
node ../../scripts/mf-dev-flow.mjs dashboard
```

真实生成过程包含：PRD 引文核验、原型截图与 trace 登记、`prototype audit`、`prototype accept`、`feature refine`、分组 proposal patch、`feature apply`，以及三条最终 AC 的登记。完整记录见 [`../generation/case-02.jsonl`](../generation/case-02.jsonl)。

## 原型证据

默认状态：

![v1 默认态完整原型卡片](../screenshots/case-02/prototype-v1-default.png)

仅看已完成：

![v1 筛选态完整原型卡片](../screenshots/case-02/prototype-v1-completed.png)

恢复全部：

![v1 恢复态完整原型卡片](../screenshots/case-02/prototype-v1-restored.png)

## 效果说明

- 原型状态由 `stale` 变为 `ready`。
- 三个页面状态被拆为一个叶子功能 `trip-list-filter`，而不是三个按钮级任务。
- 功能状态是 `not_started`；三条 AC 已冻结，但没有提前声称实现完成。
- 功能地图、原型入口和 observed 截图形成可追溯关系。

下一步：Case 03 使用 Web 交付流程真正实现这个功能，并把三条 AC 逐条绑定到浏览器证据。
