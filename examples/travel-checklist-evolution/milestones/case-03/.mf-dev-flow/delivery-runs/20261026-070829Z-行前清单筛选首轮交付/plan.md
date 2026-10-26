# 行前清单筛选首轮交付 · 开发计划

## 开发任务输入

- 来源：从功能演进地图提取
- 开发强度：focused
- 功能块：trip-list-filter
- 任务要求：指定单一叶子功能 trip-list-filter 完整开发；按任务输入与类型约定完成交付及总控验证。
- 详细输入见 `delivery-input.json`。

## 实施切片

1. 以 `app/index.html` 为唯一产品写入范围，补齐可见数量的 `aria-live` 反馈与稳定的事项选择器。
2. 保持默认 3 项；开启筛选后隐藏待完成项并显示 2 / 3；关闭后恢复 3 / 3。
3. 用真实浏览器依次验证默认、筛选、恢复三个状态，每个状态保留包含标题、控件、结果说明和列表区块的大图。

## 技术方案与实施决策

- 页面继续使用无依赖 HTML/CSS/JavaScript，不引入持久化、接口或远程服务。
- 筛选状态以按钮 `aria-pressed` 为唯一状态源；每次切换后统一刷新项目可见性、按钮文案和结果数量。
- 自动化断言聚焦用户可观察结果，端到端验收逐条绑定冻结的三条 AC。
- 本阶段无未决问题；用户已确认按该连续演进计划继续执行。

## 并发任务

<!-- mf-dev-flow:task-todo:start -->
- [x] `implement-trip-list-filter` · 实现清单筛选与可见数量（delivery / done）
<!-- mf-dev-flow:task-todo:end -->

<!-- mf-dev-flow:stage-todo:start -->
- [x] `solution_design` · 方案确认（范围、状态与验证）（confirmed）：结论：采用单页无依赖方案补齐可见数量并统一筛选状态更新；证据：冻结的PRD、原型三个状态与app/index.html现状；变更：限定写入app/index.html并新增行为测试；验证：自动化检查加真实浏览器默认、筛选、恢复三态；风险/下一步：无
- [x] `development` · 开发与自动化验证（confirmed）：结论：筛选状态、可见数量与恢复路径已实现；证据：app/filter-state.test.mjs通过且真实页面三态可复现；变更：app/index.html、app/filter-state.mjs、app/filter-state.test.mjs；验证：node--test覆盖3/3到2/3再回3/3；风险/下一步：无
- [x] `end_to_end_acceptance` · 端到端验收（真实浏览器 + 截图）（confirmed）：结论：默认、仅已完成、恢复三个真实浏览器旅程全部通过；证据：本阶段登记三张1200x1000完整区块截图并绑定三条冻结AC；变更：无新增产品改动；验证：Playwright三态与控制台零错误且逐条AC为passed；风险/下一步：无
<!-- mf-dev-flow:stage-todo:end -->
