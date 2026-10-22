# 外部系统核验任务简报（system-verification v1）

阶段契约见同目录 `process.json`；完整协议真源在 `flows/system/protocol.md`（权限边界与卡片结构以其为准）。

- 只登记外部参考系统；本地可开发项目走项目卡片。同一代码库路径只有一张卡（按路径归并，遗留重复用 dedupe）。
- 访问边界：代码/配置只读，不提交不切分支；外部数据库仅 SELECT/元数据/只读事务；连接串、账号、Token 等值不得进入 `.mf-dev-flow/`、命令输出或回复。
- 取证顺序：读外部仓库自身 AGENTS.md 约束 → CodeGraph 优先 → 只读检索并记录降级原因。
- cards.json 整卡替换语义：本轮快照省略的 apiUsages/knownApis/technicalIssues 即删除；未含卡片保持不变；删除走 removeCardIds，不得既改又删。
- 发布：先 `--dry-run` 分页审阅 diff，再用返回 fingerprint 执行正式发布；"存在接口"≠"已确认使用"，apiUsages 必须能追到方案或任务依据。
- 历史运行不改写；回答待确认项/技术问题只有用户明确填写的内容算回答，占位符与原文不算。
