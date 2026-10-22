# 功能规划任务简报（feature-planning v1）

阶段契约见同目录 `process.json`；完整协议真源在 `flows/planning/protocol.md`。

- 触发：地图缺失或 `feature status` 为 stale、用户要求重组、开发暴露耦合问题。原型/PRD/系统实质变化时改走 feature-impact-review（先读 `flows/planning/change-impact.md`）。
- 读取纪律：brief.md + `run context --detail … --group …` 分页；禁止 `--detail all`、禁止整读 context.json / previous-map / proposal。
- 先业务域后叶子；叶子 = 一个可独立验收的用户或运营结果；每个叶子 `sourceEntries` 至少一个当前原型入口，rank 显式排序，依赖排在被依赖之前。
- 补丁按域拆分、单补丁 ≤64000B；删除用 remove 显式声明；迁移必须记录旧叶子→新叶子完整映射。
- `feature apply` 校验失败即修提案，不绕过门禁；发布后 `feature status` 确认 fresh 才算完成。
