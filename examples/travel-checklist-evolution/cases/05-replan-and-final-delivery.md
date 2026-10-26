# Case 05：重规划并完成复杂版本

难度：完整闭环 · 预计 12–20 分钟

## 场景说明

影响分析确认 v2 不是一次局部样式修改。旧 `trip-list-filter` 被复评为结构性拆分：

1. `trip-stage-groups`：建立两个阶段和四项清单。
2. `trip-list-filter`：升级为保留分组语义的可逆筛选。
3. `visible-progress-summary`：基于当前筛选结果显示可见数和完成数。

依赖顺序是“分组 → 筛选 → 摘要”，三个功能分别走 `web-product@1` 的方案、开发、端到端验收和总控验证。

## 如何操作

```bash
node scripts/select-case.mjs case-05
node ../../scripts/mf-dev-flow.mjs dashboard
```

真实生成过程先执行 `feature impact` 与 `feature refine`，通过 `feature proposal-patch` 写入三个功能、迁移和逐项 `impactReviews`。第一次 `feature apply` 因缺少原型业务块迁移被门禁拒绝；补齐后才发布新地图。随后三次 `feature start --process web-product@1` 按依赖顺序交付。完整记录见 [`../generation/case-05.jsonl`](../generation/case-05.jsonl)。

## 最终应用效果

默认态显示两个分组、四项内容和 4/3 摘要：

![最终默认态完整应用卡片](../screenshots/case-05/app-v2-final-default.png)

筛选态保留两个分组，并把摘要同步为 3/3：

![最终筛选态完整应用卡片](../screenshots/case-05/app-v2-final-completed.png)

## 最终看板效果

旧三条 AC 明确标记“已替代”，五条 v2 AC 生效；三个功能卡全部 `done`、阶段均为 `3/3`：

![最终 AC 与三个功能卡完整区块](../screenshots/case-05/dashboard-final-feature-group.png)

依赖画板展示三个功能从上到下的演进关系：

![三个功能的依赖画板](../screenshots/case-05/dashboard-final-dependency-board.png)

## 效果说明

- 功能地图重新回到 `fresh`，三个叶子功能全部 `done`。
- v1 三条 AC 保留历史但标记 `superseded`；v2 五条 AC 全部生效。
- 每个功能都有独立方案、自动化测试、1200 × 1000 浏览器大图和总控验证。
- 最终里程碑包含 161 个经 SHA-256 清单核对的 `.mf-dev-flow` 文件。

这就是示例要表达的完整价值：需求变化不会覆盖旧事实，而会触发影响分析、范围重组、依赖排序、重新交付和新的验收证据。
