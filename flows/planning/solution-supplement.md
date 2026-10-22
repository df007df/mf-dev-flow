# 技术要求补充协议（solution-supplement）

触发：用户直接给出实现方式（"这个书签就存本地"），要求按固定流程处理而不是现场理解。

## 三类要求判定（intake 唯一入口）
1. 能否落到某个功能点的影响？能 → requirement（走复评，无豁免）；不能、跨功能长期生效 → agreement。
2. 是否改变产品范围/用户结果/验收边界？是 → `kind: "product"`；否（只规定实现方式/技术边界/接口复用策略）→ `kind: "technical"`。
3. 犹豫时归 technical 绑定功能点走复评（保守方向）。已确认方案被新决定替代时保留旧记录，用 withdrawn / superseded 标记。

## 技术要求主流程
阶段 A（planning）：
1. `prototype requirement add --input <file> --expected-revision <当前修订号>`（kind=technical，逐字冻结用户原话，status 缺省 proposed；输入必须同时声明 groupId、entryIds 或 `impactScope: "global"`；当前修订号先 `prototype status --json` 取得）；
2. `graph sync --json` → `feature impact --json`（依赖闭包，done/park 不豁免）；
3. 评估三要素写入功能点 `analysis.code` / `analysis.gaps[]`：可行性（对照 codeRefs、系统卡片、既有接口复用边界）、改动大小（按 project.json 代码根 HEAD 与未提交变更实算）、边界情况（对照原型入口失败/恢复分支）；
4. 绑既有功能点（sourceRequirementIds）；无支撑时经 refine + proposal-patch migrations 新建/拆并；不可行 → requirement update --status withdrawn 收尾；
5. `feature apply` 刷新基线。

阶段 B（delivery，miniapp-product@3）：
1. feature start → work plan → work claim（proposed technical 放行，product 维持阻断）；
2. technical_solution 阶段：brainstorming 一次一问直到用户确认开发计划 → 一次 `prototype requirement update --expected-revision <当前语义修订号>` 写最终方案摘要并置 confirmed（当前修订号以 add 返回的 semanticRevision 为基准链式递增）→ 复评收敛（graph sync → feature impact → feature refine → impactReviews preserve/revalidate → feature apply）→ writing-plans 产 plan.md 经 `delivery stage-artifact --kind dev_plan` 登记 → SVG 经 --kind dataflow_svg 登记；
3. development 阶段默认 subagent-driven-development，逐切片回写 summary/--risk/changedFiles；
4. end_to_end_acceptance 沿用 v2；完成后 work finish → graph clear --by-task。

## 收敛规约
- 方案修订合并为一次 requirement update（单次漂移、单次 planning 往返），禁止每问一句改一次；
- preserve 仅刷新基线、不杀任务；revalidate 显式作废旧任务重开；
- 确认后任何阶段写入前必须完成复评收敛，否则命令阻断（门禁由命令核验，不依赖提示词）。

## 与明确约定的边界
能落到功能点影响的不是约定；约定（system agreement-add）只用于跨功能、即时生效、无需逐功能点确认的长期协作/工作约定，不进功能点门禁。
