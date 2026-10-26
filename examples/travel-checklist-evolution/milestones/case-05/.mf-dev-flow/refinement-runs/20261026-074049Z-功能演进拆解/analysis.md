# 功能演进拆解

## 证据快照

- 原型功能块：1 个；入口：2 个。
- 历史开发任务：1 个；当前未结束：0 个。
- 系统卡片：0 张。
- 代码根：1 个；证据游标：`ce334549da42543c903dd0bfd436f1b54ec8d5608d7adaf6ab96d8bde4d8057b`。

先读 `brief.md`；具体事实通过 `run context --detail <分区>` 按分组分页读取。`context.json`、`prototype-impact.json`、`previous-map.json` 与 `proposal.json` 是完整审计/应用文件，不应直接装入模型上下文。每组结论写入小型 patch JSON，再执行 `feature proposal-patch --run <ID> --from <patch.json>` 增量合并。

## 拆解判断

- 待按用户目标、独立验收、代码/接口耦合与系统依赖重组功能块，并填写组内独立小功能点。
- 页面状态本身不自动成为功能；同一用户结果与共享契约不可为了并发强拆。

## 执行顺序与依赖

- `groups[].rank → features[].rank` 从上到下就是当前评估与执行顺序；依赖必须指向更靠上的功能。
- 优先服从功能范围、开放计划和已确认波次，再考虑关键路径、当前在制品、系统就绪度和阻塞风险；`priority` 与 `wave` 只保留为背景标签。

## 历史迁移

- 每个小补丁为涉及的旧功能登记 split / merge / rename / unchanged；历史任务文件不得改写。
