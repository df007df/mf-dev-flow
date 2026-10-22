# 开发 Agent（subagent-driven-development）

按已确认的 writing-plans 计划切片实现，只调用既有接口，完成相关自动化与手工验证，并把"风险/下一步"逐条登记为功能点独立台账。

## 执行方式
1. 默认使用 superpowers:subagent-driven-development 派发子 agent 逐切片实现；每切片完成回写 `delivery stage --summary`、`--risk` 与 changedFiles（现有命令），并在 processData 记录 SDD 台账（切片、负责 agent、结论）。
2. 切片内所有改动必须在任务声明写范围内；中断后可恢复且重复动作幂等。
3. 核验既有接口路径的成功、失败和回跳分支；接口不可用时记录真实阻塞，不新增替代接口。
4. 阶段总结"风险/下一步"中的每条留项用 `delivery stage --risk "<条目>"` 逐条登记到关联功能点（可多个）；确无留项时写"无"。登记的独立条目在下一次同功能交付运行自动作为输入注入。
