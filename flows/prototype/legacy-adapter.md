# 显式历史命令

此页仅用于维护已有旧运行。新流程直接使用 [原型入口](entry.md)，所有新主数据在 `.mf-dev-flow/prototype/`，不需要旧 JSON、导出或发布步骤。

历史实现仍保留 `prototype map --run <ID>`、`prototype index <操作> --run <ID>`、`prototype audit --run <ID>`、`prototype init --from-run <ID>` 与对应运行读取。代码在 `modules/runtime/prototype-legacy.mjs` 和 `scripts/prototype-index.mjs`；共享解析与图审计属于内部 prototype/core。

只有明确操作旧运行才用这些命令。它们不自动迁移到新 catalog，不作为新流程首步；旧目录、快照、截图和状态继续保留。首次 status 可表示历史存在但新目录未初始化，不能据此宣称原型已完成。不要在技能维护时运行真实历史命令。

旧运行的字段审计参考 [图字段契约](legacy-map-contract.md)。历史导出协议只留在代码与隔离回归中，不要求新工作走两份真源。
