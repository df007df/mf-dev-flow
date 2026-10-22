# modules/kernel — 任务内核（M1）

类型无关的任务记录契约。设计依据：`flows/maintenance/graph-layer-m2-design.md`。

- `record.mjs`：任务/运行记录 schema v1、ref 形状（`前缀:标识`）、状态机与非法迁移拒绝、时间线、hook×声明过程数据对账纯函数（三态：reconciled / missing 拒绝 / declared-only 降级）、旧 delivery 记录 → kernel 的纯转换（M5 割接与双写共用）。
- `sync.mjs`：kernel 记录落盘（校验后原子写 `.mf-dev-flow/tasks/`）、`inferTaskTypeRef`（显式 stageDefinitions 推断，历史缺省回退 v1）、`readHookObservations`（读取 Codex hook 状态目录，键 sha256(root\0sessionId)，时间窗过滤）。delivery 的 claim/finish 已双写。
- 边界：本模块只校验形状与状态语义；ref 指向是否解析由 M2 `graph build --check` 负责；边的写入在 apply/finish 命令层。
- 消费方：`modules/types/registry.mjs` 用 `NODE_KINDS` 校验 dispatch；旧命令双写改造（M1 剩余）与 M5 迁移脚本用 `normalizeDeliveryRun`。
