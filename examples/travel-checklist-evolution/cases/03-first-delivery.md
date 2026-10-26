# Case 03：交付第一个功能

难度：入门进阶 · 预计 8–12 分钟

## 场景说明

PRD、原型分析、功能点和三条最终验收用例已经冻结，但功能仍是 `not_started`。这一阶段真正开发“清单完成态筛选”，让默认、仅已完成和恢复三个状态都拥有自动化与浏览器证据。

本 Case 不是手工拼装完成状态：它使用 `web-product@1` 连续交付流程，依次通过方案确认、开发与自动化验证、真实浏览器端到端验收，然后由总控验证把功能投影为 `done`。

## 当前输入和前置状态

- 功能：`trip-list-filter`，状态 `not_started`。
- 写入边界：`app/`。
- 冻结 AC：默认三项、筛选后两项、关闭筛选恢复三项。
- 项目无接口、账号、持久化或外部服务。

## 如何操作

先切换到冻结里程碑并启动观察台：

```bash
node scripts/select-case.mjs case-03
node ../../scripts/mf-dev-flow.mjs dashboard
```

真实生成这份里程碑时，核心命令链是：

```bash
node ../../scripts/mf-dev-flow.mjs feature start \
  --id trip-list-filter --process web-product@1

node ../../scripts/mf-dev-flow.mjs work plan \
  --run 20261026-070829Z-行前清单筛选首轮交付 \
  --task implement-trip-list-filter --kind ui --scope product \
  --leaf-features trip-list-filter --writes app

node ../../scripts/mf-dev-flow.mjs delivery stage-artifact \
  --run 20261026-070829Z-行前清单筛选首轮交付 \
  --task implement-trip-list-filter --stage end_to_end_acceptance \
  --kind e2e_screenshot --file screenshots/case-03/app-v1-default.png \
  --caption "默认状态：完整卡片区块显示三项与 3 / 3"
```

随后对三条 AC 分别执行 `delivery acceptance`，再依次执行 `work finish`、`work merge-check`、`work verify --status passed` 和 `run set --status done`。完整、去本机路径的命令记录见 [`../generation/case-03.jsonl`](../generation/case-03.jsonl)。

应用验证：

1. 通过本地 HTTP 服务打开 `app/index.html`。
2. 确认默认显示三项和“显示 3 / 3 项”。
3. 点击“仅看已完成”，确认只显示两项和“显示 2 / 3 项”。
4. 点击“显示全部项目”，确认恢复三项和“显示 3 / 3 项”。

## 应用效果

默认状态：

![默认显示三项的完整卡片区块](../screenshots/case-03/app-v1-default.png)

仅看已完成：

![筛选后显示两项的完整卡片区块](../screenshots/case-03/app-v1-completed.png)

恢复全部：

![关闭筛选后恢复三项的完整卡片区块](../screenshots/case-03/app-v1-restored.png)

## 看板变化

功能分组区块同时显示三条 AC、所属“旅行准备”分组、完整功能卡和 `3/3` 阶段闭环：

![Case 03 功能分组与 AC 大图](../screenshots/case-03/dashboard-feature-group.png)

交付运行区块保留三阶段结论、任务状态、写入范围、开发计划与验证记录：

![Case 03 交付运行大图](../screenshots/case-03/dashboard-delivery-run.png)

## 效果说明

- 功能状态由 `not_started` 变为 `done`。
- 状态计算被拆为可测试模块，单元测试覆盖 `3/3 → 2/3 → 3/3` 可逆闭环。
- 三张 1200 × 1000 截图均来自真实浏览器，包含标题、按钮、数量反馈和整个列表卡片，而不是孤立控件截图。
- 三条冻结 AC 分别绑定对应截图；总控验证通过后才允许运行完成。
- 里程碑含 68 个经哈希清单核对的 `.mf-dev-flow` 文件。

## 下一步为什么发生

首个功能完成后，产品提出“按出行阶段分组”和“显示当前筛选结果进度”。这不是简单新增两块 UI：它会改变现有筛选的数据结构和统计口径。Case 04 将摄取 PRD v2 与原型 v2，让系统主动计算旧规划的影响范围。
