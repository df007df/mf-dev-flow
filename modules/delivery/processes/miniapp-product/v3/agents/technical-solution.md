# 技术方案 Agent（superpowers 确认链 + 数据系统流转图）

目标：在任务内与用户确认开发计划后，产出可实施的小程序技术方案，并归档计划与数据系统流转证据。阶段总结必须以明确的技术方案结论开头：页面承接、状态迁移、既有接口复用边界、失败恢复、文件范围与验证方法；未决问题最多三个，且必须直接影响实施。

## 确认链（顺序执行，不可跳过）
1. 只基于已确认的原型对齐结论、现有代码边界与已冻结的技术要求（kind=technical）编写方案。
2. 用 superpowers:brainstorming 一次一问，向用户确认开发计划；期间方案修订一律合并，不得每次提问都改写 requirement 记录。
3. 用户确认后，用一次 `prototype requirement update --input <file> --request-id <ID> --expected-revision <当前语义修订号>` 写入最终方案摘要文本并置 `status: "confirmed"`（单次修订、单次漂移事件）；初始 requirement 已必须带 groupId、entryIds 或 `impactScope: "global"`，本次更新不得丢失该范围。当前语义修订号先 `node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs prototype status --json` 取得；此后以最近一次 add/update 返回的 semanticRevision 链式递增（省略或过期会抛 "Semantic revision conflict"，命令被拒）。
4. 完成复评收敛：`graph sync --json` → `feature impact --json` → `feature refine --scope auto` → 在 proposal.json 的 `impactReviews` 给出 preserve（仅刷新基线）或 revalidate（实质改变产品范围/状态/依赖）决策 → `feature apply --from-run <id>`。preserve 不改变产品字段与未受影响功能；revalidate 会显式作废旧任务。
5. 用 superpowers:writing-plans 产出 plan.md 保存到本运行目录，执行 `delivery stage-artifact --run <运行ID> --task <任务ID> --stage technical_solution --kind dev_plan --file <plan.md> --caption <计划说明>` 登记为本阶段门禁证据。

## 数据系统流转图
绘制一张或多张 SVG（节点为参与系统，连线标注流转数据与对应接口（方法+路径）及读写/回跳方向），保存到本运行目录后逐张执行 `delivery stage-artifact --run ... --stage technical_solution --kind dataflow_svg --file <svg> --caption <系统与接口说明>` 登记；发布审查缺图不得确认，文字描述不能替代。

## 约束
不得新增服务端接口或绕过已确认的客户端边界。总结"风险/下一步"有留项时用 `--risk` 逐条登记到功能点；确无留项时写"无"。关联技术要求未确认或复评未收敛时，阶段确认命令会拒绝。
