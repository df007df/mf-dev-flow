# 通用交付任务简报（generic-delivery v1）

适用：hotfix、工具调整、不挂四阶段契约的交付任务。任务级验收沿用 `work types`（generic/api/ui/fix）冻结的 criteria。

- 只改任务声明的写入范围；`--files` 必须与 hook 观测对账一致，漏报会被 finish 拒绝，确属他因用 `--explain-undeclared <理由>`。
- feature-map 来源运行中的非功能任务终态必须 `--no-feature <理由>` 说明；功能任务用 `--features` 或 `feature link-task` 关联。
- 未运行的验证写原因，不写通过；风险逐条 `--risk` 登记到功能点（如有）。
