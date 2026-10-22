# 功能点影响复评任务简报（feature-impact-review v1）

阶段契约见同目录 `process.json`；完整协议真源在 `flows/planning/change-impact.md`（差异与关联规则由代码执行，不靠手选）。

- 前置：变动的证据实体（原型/PRD/系统）已按各自流程合入真源；未合入真源的变化不置功能点脏。
- `feature impact --json` 拿机器闭包（新旧两侧分组、parentId 后代、dependsOn 反向、迁移链、不按状态过滤），冻结进本任务；不要手删影响项。
- 对全部受影响旧叶子与新增功能逐项 impactReviews：keep/revise/split/merge/retire/add；keep 也必须写理由与对照检查（scope/status/dependencies/priority/wave/acceptance）。
- 对执行中任务给 taskDecisions（continue/amend/supersede）；不能为过门禁擅自取消任务，冲突先说明影响并请求授权。
- 应用前命令重算影响清单；真源再变则本轮提案作废、重新 refine。retire 保留原 ID 置 park/skipped，不删除。
- 完成判据：apply 发布 + 对应 reassessment 清除 + `feature status` fresh。
