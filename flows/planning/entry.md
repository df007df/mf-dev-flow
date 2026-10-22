# 功能规划与变更复评

触发：拆分功能、调整范围与顺序，或原型/回答/需求变化后的复评。输入是已接受的原型结论、用户需求、代码与系统事实；输出为 refinement 快照、校验提案和功能地图。用户直接指定实现方式（技术要求）时走 [技术要求补充协议](solution-supplement.md)：先 requirement add（kind=technical）→ 评估 → 绑定功能点 → apply，再交 [交付入口](../delivery/entry.md)。用户决定既有功能点暂不开发（下马/暂停）也属范围变化：先落需求撤回或说明留痕，再按 [规划协议](protocol.md) 的「功能点下马 / 暂停」一节完成复评，并在最后主动落地——默认不删功能代码、优先隐藏或跳过入口，执行后确认页面不再展示该功能。

先 `graph sync --json`：只读复用漂移判定，把原型/需求/问题的变化**显式写成受影响功能点的 open 复评触发**（写 feature-map 真源并重建图索引；同指纹幂等，不重复置脏）。随后 `feature impact --json` 只读核对差异与闭包。执行规划前读 [规划协议](protocol.md)；有原型变化再读 [复评门禁](change-impact.md)。用 `feature refine --scope auto` 固定本轮事实，默认只读返回的 brief；按受影响分组执行 `run context --id <ID> --detail prototype|planning --group <ID>`，其他事实也只按分区分页补证。默认每页 5 条、最多 12000 bytes；不得整读原型报告、`context.json`、`prototype-impact.json`、`previous-map.json` 或 `proposal.json`。每个业务域通过 `feature proposal-patch --run <ID> --from <patch.json>` 增量写入，最后 `feature apply --from-run <ID>`，不得只刷新指纹。复评完成后可用 `graph clear --by-task <runId/taskLeaf>` 把该任务 sourceRefs 内的功能点 open 触发落为 cleared。每个叶子功能必须在 `sourceEntries` 关联至少一个当前原型入口；入口必须有可展示的 observed 来源截图，不能用原型分组、问题或旧开发截图替代。

新原型事实经内部 CLI 获取；无需旧 JSON 导出。原型入口用 sourceEntries 关联真实截图；未在原型出现的用户需求用 sourceRequirementIds，相关问题用 sourceQuestionIds。保持来源类型，不能为需求伪造 observed 截图。

复评覆盖全部既有功能状态、子功能、迁移目标与依赖下游，逐项核对范围、状态依据、说明/分析、依赖、P/W、验收与旧任务处理。完成或暂缓不构成豁免。

apply 校验通过形成新基线；内容变化使旧基线不能继续开发。仅明确要求开发时交接 [交付入口](../delivery/entry.md)，已有任务优先续做。
