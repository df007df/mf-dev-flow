# Case 04：PRD 调整后主动分析影响面

难度：进阶 · 预计 6–10 分钟

## 场景说明

v1 筛选已经交付完成，产品随后提出 PRD v2：清单要按“出发前 / 旅途中”分组，并显示当前筛选结果的进度摘要。这个变化会同时影响旧数据结构、筛选口径和验收标准，不能直接在 `done` 功能上继续堆代码。

## 如何操作

```bash
node scripts/select-case.mjs case-04
node ../../scripts/mf-dev-flow.mjs dashboard
```

真实生成时摄取 `prd/v2.md`，在真实浏览器中登记 v2 默认、筛选、恢复三态，完成新原型批次验收，然后执行：

```bash
node ../../scripts/mf-dev-flow.mjs feature impact --json
```

结果为 `review_required`，旧功能仍保留 `done` 历史状态，但规划状态被阻断，必须先复评。完整记录见 [`../generation/case-04.jsonl`](../generation/case-04.jsonl)。

## 变化后的原型

![v2 原型默认态完整卡片](../screenshots/case-04/prototype-v2-default.png)

## 看板影响区块

![PRD 与原型变化、旧 AC 和受影响功能同屏](../screenshots/case-04/dashboard-impact-review.png)

## 效果说明

- 系统识别 2 个原型分组、4 个入口变化和 1 个受影响旧功能。
- 旧交付证据没有被删除，也没有被错误套用到 v2。
- 看板同时展示变化告警、旧 AC、受影响功能卡及“待复评”原因。
- 在复评完成前，旧规划不能继续进入开发。

下一步：Case 05 将旧功能拆为三个有依赖顺序的新范围，并逐个重新交付。
