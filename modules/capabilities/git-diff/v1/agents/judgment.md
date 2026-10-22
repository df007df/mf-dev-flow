# Git 变更清单判定简报（git-diff v1）

命令给原事实：`capability git-diff --repo <路径> --base <ref> [--head <ref>] [--include-untracked]`，输出 base→工作区（或指定 head）的 name-status 清单与两侧 commit。

- 本能力**不判断影响**。changed files 只是输入：把文件映射回图节点用 `graph`——`source:<文件>` 沿 `sourced-from` 入边反查分组，再 dependents 闭包得受影响功能点（M2 §3.5 读方向）。
- 基线取"上次已接受分析登记的 commit"，不是随手 HEAD~1；没有登记基线就先补登记再比较。
- 未跟踪文件默认不计入（新文件未 commit 属未定稿）；确需观察加 `--include-untracked` 并在结论里单列。
- 重命名按 R 记录读旧新两路径；删除的文件仍要反查其历史归属，不因消失而跳过。
