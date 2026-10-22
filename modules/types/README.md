# modules/types — TaskType 注册表（M1）

跨流程任务类型的统一登记处。`registry.json` 是清单，`registry.mjs` 做加载、版本解析与契约校验，CLI 入口 `tasktype list|show`（只读）。

已收编 7 类 9 版本：`prototype-analysis`（别名复用 `modules/prototype/processes/runtime-analysis`）、`prd-analysis`、`feature-planning`、`feature-impact-review`、`feature-development` v1/v2（superseded）/v3（别名复用 `modules/delivery/processes/miniapp-product`）、`generic-delivery`、`system-verification`。旧契约文件零改写，别名登记用条目上的 `legacyProcessId`；新旧两种契约按最小公共集校验（schemaVersion/id/version/stages[].{id,agentFile} 存在）。

防风暴约束由校验器强制（有负向测试）：`dispatch` 规则必须 `autoCreate:false` + `batching:"per-trigger"`，whenDirty/affects 限 kernel `NODE_KINDS`，openTaskType 必须已注册。协议全文仍以 `flows/*` 文档为真源，agent 简报只做浓缩并指向协议。
