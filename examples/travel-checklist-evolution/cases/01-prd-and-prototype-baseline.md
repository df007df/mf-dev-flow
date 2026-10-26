# Case 01：从 PRD 与原型基线开始

难度：入门 · 预计 3–5 分钟

## 场景说明

团队只有一份 PRD v1 和一个可交互 HTML 原型，还没有功能地图，更没有“已完成”的开发结论。本 Case 先登记项目、冻结 PRD 来源和原型位置，让后续分析始终知道自己依据的是哪一版输入。

## 如何操作

```bash
node scripts/select-case.mjs case-01
node ../../scripts/mf-dev-flow.mjs dashboard
```

真实生成时依次执行 `init`、`prd ingest` 与 `prototype init`。完整命令、退出码和输出哈希见 [`../generation/case-01.jsonl`](../generation/case-01.jsonl)。

重点检查：

1. PRD 来源已经冻结，但 findings 尚未验收。
2. 原型处于待分析状态，没有伪造入口、截图或功能点。
3. 功能地图不存在，表示流程没有跳过分析直接进入开发。

## 大截图

![Case 01 PRD 来源冻结与未分析状态](../screenshots/case-01/dashboard-prd-analysis.png)

## 效果说明

- 建立“输入是什么”的可追溯基线。
- 明确区分“已收到文档”和“已经理解并验收文档”。
- 后续原型、功能和交付都能追溯到这份冻结来源。

下一步：进入 Case 02，用实际浏览器证据完成原型分析，再拆出第一个可交付功能。
