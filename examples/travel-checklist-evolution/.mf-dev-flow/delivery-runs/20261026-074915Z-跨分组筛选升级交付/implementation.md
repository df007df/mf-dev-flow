# 跨分组筛选升级交付 · 实时记录

<!-- 内容与格式由任务类型声明。执行时持续记录实际进展。 -->

## 关键技术方案

- `deriveFilterView` 在同一分组模型上过滤可见 ID，按钮仅切换 `completedOnly`。
- 页面每次渲染同时更新事项可见性、按钮状态和 3 / 4 或 4 / 4 结果。

## 实际改动与行为

- `app/filter-state.test.mjs`：新增跨分组筛选与恢复测试，覆盖 2+1 已完成项。
- 现有页面逻辑经 v2 数据验证，无需复制或分叉筛选实现。

## 未完成项和风险

无。当前结果的已完成数摘要将在依赖本任务的后续功能中交付。

<!-- mf-dev-flow:task-outcomes:start -->
- `upgrade-cross-group-filter` · done：跨分组完成态筛选和恢复已通过自动化与浏览器验收；改动：app/index.html、app/filter-state.mjs、app/filter-state.test.mjs。
<!-- mf-dev-flow:task-outcomes:end -->
