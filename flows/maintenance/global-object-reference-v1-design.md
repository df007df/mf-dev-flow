# 全局对象引用 V1 设计

## 目标

为 mf-dev-flow 中可长期被人、CLI、看板和其他记录引用的对象提供一套**项目内全局、稳定、可解析**的对象引用（Object Ref）。它解决“看到一个对象后如何精确回到真源”的问题，而不改变既有业务 ID、运行目录或 SQLite 主键。

V1 的全局范围是**一个工作区的 `.mf-dev-flow` 命名空间**。它不承诺跨仓库、跨机器或复制工作区后的永久唯一性；该能力须等后续引入显式、不可变的 `projectUid` 后再设计。

## 非目标

- 不引入 `M-000123` 一类全局递增流水号。多种 JSON 文件、目录记录和 SQLite 目录之间没有单一原子写事务；发号器会成为并发写热点，也会让重建/导入的编号语义不稳定。
- 不给每条历史记录回填或迁移 `globalId` 字段；V1 在读/写边界按现有原生 ID 派生引用。
- 不读取、扫描、迁移真实 `.mf-dev-flow` 作为本次维护验证的一部分。
- 不把本机绝对路径、会话 ID、证据负载或密钥写进看板默认输出。
- 不把所有 Object Ref 强行放进 graph。graph 只消费可建图的一个子集。

## 基础术语

| 名称 | 定义 | 例子 |
| --- | --- | --- |
| 原生键（native key） | 当前真源已经使用的 ID 或复合键 | 功能 `reader-core`；任务 `delivery/20260910-094549Z/theme-fix` |
| Object Ref | 由 kind 和原生键确定性派生的、面向跨对象引用的字符串 | `mf-dev-flow:feature:reader-core` |
| Truth Pointer | Object Ref 当前解析到的真源位置；只在 `object locate` 中按需返回 | `planning/feature-map.json#/features/reader-core` |
| Graph Ref | 图构建内部现有的 `prefix:id` 格式；是 Object Ref 的可建图子集，不是全局对象模型本身 | `feature:reader-core` |

## 引用格式与核心契约

V1 在新模块 `modules/kernel/object-ref.mjs` 中集中定义如下纯函数，且不触碰任何文件：

```js
formatObjectRef({ kind, key }) // -> "mf-dev-flow:<kind>:<key>"
parseObjectRef(ref)            // -> { schemaVersion: 1, kind, key, ref }
objectRefFor(kind, ...segments)
```

- `kind` 只能来自固定的 `OBJECT_KINDS`；未知 kind、空键、控制字符、错误转义或多余分段必须拒绝。
- 原生键以 URL 路径分段转义后再拼接，解析必须可逆；引用的文本表示永远是 ASCII，避免空格、换行和不同平台路径分隔符造成歧义。
- 同一 kind 与同一原生键必须得到字节完全相同的 Object Ref；该性质不依赖创建顺序、时钟、会话或当前目录。
- 每个外部返回对象可以附加 `{ ref }`，但 `ref` 是派生字段，不能成为另一份需要人工同步的真源。

V1 的 Object Ref kind 与原生键如下：

| kind | 原生键 | 真源 |
| --- | --- | --- |
| `project` | 固定 `project` | `project.json` |
| `project-card` | 项目卡 ID | `projects/<id>.json` |
| `prototype-group` / `prototype-entry` / `prototype-source` | catalog 或历史目录中的 ID | `prototype/catalog.sqlite` 或历史原型记录 |
| `prd-source` / `prd-batch` | 来源 ID / 批次 ID | `prd/manifest.json`、`prd/sources/`、`prd/analyses/` |
| `system-card` | 卡片 ID | `system/cards.json` |
| `feature-group` / `feature` | 地图中的 ID | `planning/feature-map.json` |
| `run` | `<type>/<runId>` | `<type>-runs/<runId>/run.json` |
| `task` | `<runType>/<runId>/<taskId>` | `work-plan.json`、`executions/<taskId>.json` |
| `release` | 发布 ID | kernel / 发布真源 |
| `code-file` | 工作区相对 POSIX 路径 | 代码文件或图谱来源 |

`prototype` 的候选、边、控件、出现记录以及 delivery 的 attempts、快照、触碰台账、事件和缓存是内部/高容量记录：只有在已有公共查询把它们作为独立对象输出时，才按同一个协议增加 kind；V1 不为它们制造持久化流水号。

## 解析与定位

新增公共只读命令：

```text
object locate --ref <ObjectRef> --json
```

它经既有 command registry 路由，输出统一形状：

```json
{
  "schemaVersion": 1,
  "object": { "ref": "mf-dev-flow:feature:reader-core", "kind": "feature", "key": "reader-core" },
  "truthPointer": {
    "storage": "planning/feature-map.json",
    "pointer": "/features/reader-core",
    "path": "planning/feature-map.json"
  },
  "summary": { "id": "reader-core", "title": "阅读核心" }
}
```

- `truthPointer.path` 必须是相对工作区的规范化 POSIX 路径；禁止 `..`、绝对路径和符号链接逃逸。
- 不存在的已知对象返回机器可读 `not_found`；格式非法或未注册 kind 返回 `invalid_ref`；绝不猜测相近 ID。
- 解析器只读已有真源。看板必须经这一公共命令或服务端已批准的 reader 取摘要，不能直接打开 SQLite。
- 绝对路径、会话、原始证据、密钥和无上限 locator 不进入 `/api/state`；需要精确位置的使用者显式执行 `object locate`。

## 与现有 Graph Ref 的关系

现有 graph 使用 `prefix:id`，且目前 `graph.mjs` 会构造 `feature-group:<id>`，但 kernel 的 `REF_PREFIXES` 尚未接受该前缀。V1 以如下方式收敛而不混淆两层协议：

1. `object-ref.mjs` 是全量 Object Ref kind 的唯一注册表。
2. `toGraphRef(ObjectRef)` 仅对可建图类型映射为 legacy Graph Ref；无图映射的对象仍可 locate。
3. `parseRef`/`REF_PREFIXES` 与 graph 的 kind 表由同一 graph-compatible 映射生成或共享常量，至少修正 `feature-group` 的当前不一致。
4. graph 仍以现有 Graph Ref 作为节点 key，避免重写已有图、闭包和 edge 格式；看板可额外显示/复制 Object Ref。

## 对外展示

- CLI 中新增或已有的对象摘要按需附带 `ref`；原有 `id`、`runId`、`taskId` 字段不改名、不删除。
- 看板优先在功能卡和运行/任务记录中增加“复制引用”，复制 Object Ref 而不是本机 locator；图节点保留其 Graph Ref，同时提供可复制 Object Ref。
- 可以在某个具体列表中显示 `#12` 这样的顺序号，但它仅是视图状态，不能作为 `object locate` 的输入，也不写入任何真源。

## 兼容性与迁移

V1 为纯派生、加法式变更：旧 JSON、历史运行、现有 catalog 和已有 Graph Ref 必须继续可读。没有 `projectUid` 时，不生成伪造的跨项目 URI；没有某类真源时，定位仅对该类返回 `not_found`。任何以后新增的 Object Ref kind 都需要增加：注册表项、解析器测试、至少一条 fixture 定位测试和一份真源说明。

## 并发与安全边界

本设计不写全局 registry、不维护计数器、不在 hook 中分配 ID，因此不会扩大当前“声明预检 + 快照对账 + 触碰台账”的并发临界区。Object Ref 的稳定性来自原生键；同一原生键重复解析天然幂等。

维护实现只能修改技能目录和临时 fixture。所有测试在临时项目运行公共 CLI；不得读取、扫描、迁移或修补真实 `.mf-dev-flow`。现有并发归因改动与本功能分开验证、分开提交。

## 验收标准

1. 所有 V1 kind 的 format/parse 可逆，非法输入 fail-closed，且不访问文件系统。
2. 已注册的项目、功能组/功能、运行/任务、系统卡、PRD、原型及代码文件在临时 fixture 中均可 `object locate` 到唯一 Truth Pointer。
3. 历史 Graph Ref 继续解析，`feature-group:<id>` 被正确接受，图构建输出保持兼容。
4. 看板复制的是 Object Ref；默认 state 不新增绝对路径、会话、证据内容或密钥。
5. 全量 mf-dev-flow 隔离回归和 dashboard TypeScript 检查通过；真实 `.mf-dev-flow` 未被读写。
