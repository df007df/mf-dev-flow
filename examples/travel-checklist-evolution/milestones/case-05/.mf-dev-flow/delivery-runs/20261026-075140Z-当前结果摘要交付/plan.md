# 当前结果摘要交付 · 开发计划

## 开发任务输入

- 来源：从功能演进地图提取
- 开发强度：focused
- 功能块：visible-progress-summary
- 任务要求：指定单一叶子功能 visible-progress-summary 完整开发；按任务输入与类型约定完成交付及总控验证。
- 详细输入见 `delivery-input.json`。

## 实施切片

1. 从当前可见事项集合派生 `visibleCount`、`completedCount` 和总数，不复制业务数据。
2. 在页面标题与分组之间增加“当前结果 / 已完成”双指标摘要区。
3. 用单元测试和真实浏览器分别核对默认 4/3 与筛选 3/3。

## 技术方案与实施决策

- 摘要与筛选使用同一次 `deriveFilterView` 结果，避免按钮、列表和数字短暂不一致。
- 摘要通过 `aria-live` 向辅助技术同步变化，视觉上使用完整宽度双指标卡。
- 不增加百分比、趋势、历史统计或持久化，保持 PRD v2 最小范围。

## 并发任务

<!-- mf-dev-flow:task-todo:start -->
- [x] `add-visible-progress-summary` · 增加当前结果进度摘要（delivery / done）
<!-- mf-dev-flow:task-todo:end -->

<!-- mf-dev-flow:stage-todo:start -->
- [x] `solution_design` · 方案确认（范围、状态与验证）（confirmed）：结论：从当前可见集合统一派生可见数与完成数；证据：PRD-v2和两个原型状态；变更：状态模块新增summary并在页面展示双指标卡；验证：默认4/3与筛选3/3；风险/下一步：无
- [x] `development` · 开发与自动化验证（confirmed）：结论：摘要区已随筛选即时更新当前项与完成项；证据：filter-state测试通过3/3；变更：app/index.html、filter-state模块和测试；验证：默认4/3、筛选3/3；风险/下一步：无
- [x] `end_to_end_acceptance` · 端到端验收（真实浏览器 + 截图）（confirmed）：结论：默认与筛选后的进度摘要均通过真实浏览器验收；证据：两张1200x1000完整卡片截图绑定两条冻结AC；变更：无；验证：4/3与3/3即时更新；风险/下一步：无
<!-- mf-dev-flow:stage-todo:end -->
