# 旅行阶段分组交付 · 开发计划

## 开发任务输入

- 来源：从功能演进地图提取
- 开发强度：focused
- 功能块：trip-stage-groups
- 任务要求：指定单一叶子功能 trip-stage-groups 完整开发；按任务输入与类型约定完成交付及总控验证。
- 详细输入见 `delivery-input.json`。

## 实施切片

1. 把固定清单补齐为四项，并为每项登记 `before` 或 `during` 阶段。
2. 状态模块派生两个分组的可见事项，页面渲染“出发前”和“旅途中”完整区块。
3. 用行为测试核对 3+1 分组结构，再用真实浏览器保存整张卡片截图。

## 技术方案与实施决策

- 保持无依赖 HTML/CSS/JavaScript，不增加接口、持久化或编辑能力。
- 分组归属来自事项数据，页面分组 DOM 与状态模块使用相同稳定 ID。
- 本功能只验收默认分组态；跨分组筛选和进度摘要由后续依赖功能分别交付。

## 并发任务

<!-- mf-dev-flow:task-todo:start -->
- [x] `implement-trip-stage-groups` · 实现出发前与旅途中分组（delivery / done）
<!-- mf-dev-flow:task-todo:end -->

<!-- mf-dev-flow:stage-todo:start -->
- [x] `solution_design` · 方案确认（范围、状态与验证）（confirmed）：结论：先把扁平四项建模为出发前与旅途中两个分组；证据：PRD-v2与原型默认态；变更：限定app状态模块和页面分组结构；验证：单元测试加真实浏览器整卡截图；风险/下一步：无
- [x] `development` · 开发与自动化验证（confirmed）：结论：页面已按两个阶段展示四项并保留完成状态；证据：filter-state测试通过1/1；变更：app/index.html与filter-state模块测试；验证：默认态得到两个分组和4/4；风险/下一步：无
- [x] `end_to_end_acceptance` · 端到端验收（真实浏览器 + 截图）（confirmed）：结论：真实浏览器默认态完整展示两个阶段与四项；证据：1200x1000整卡截图并绑定冻结AC；变更：无；验证：页面文本与分组数量符合PRD-v2；风险/下一步：无
<!-- mf-dev-flow:stage-todo:end -->
