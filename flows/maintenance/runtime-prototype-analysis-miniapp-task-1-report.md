# Mini Program adapter — Task 1 验证报告

## 范围

- 新增 `modules/prototype/adapters/wechat-miniapp-runtime/v1/adapter.json`。
- 新增 `modules/prototype/adapters/wechat-miniapp-runtime/v1/agents/runtime-observe.md`。
- 更新 `modules/prototype/tests/processes.test.mjs`。
- 未修改核心运行态、CLI、能力声明、文档、看板、计划、台账或真实 `.mf-dev-flow`；未提交、暂存、创建工作树或委派子代理。

## RED

先新增 `wechat simulator overlay composes only into runtime-observe`，再运行：

```sh
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs
```

结果为 7 通过、1 失败。失败原因符合预期：`loadPrototypeAdapter({ id: "wechat-miniapp-runtime", version: 1 })` 报 `原型流程无效：适配器 目录不存在`，因为 manifest 与 overlay 尚未创建。

## GREEN

实现了只接受 `wechat-devtools-simulator` 的 v1 manifest：关闭源码发现，声明 `pageStack`、`selectorAction`、`simulatorScreenshot`、`traceArchive`、`compileRefresh` 五项声明式能力，并且只为 `runtime-observe` 声明 overlay。

overlay 要求导航前后页面栈、基于 selector 的用户操作、完整可见状态截图及含 route、query、selector/action、前置条件、断言、结果的真实追踪；编译/刷新、角色/数据/demo 准备与业务交互严格区分。它没有声明 CLI 自动化能力。

追加回归覆盖：

- overlay 仅组合进 `runtime-observe`，不会泄露到 `structure-model`；
- 非流程阶段 overlay 在组合时被拒绝；
- 适配器版本目录的符号链接越界被加载器拒绝。

最终执行：

```sh
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/processes.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs
git diff --check -- .codex/skills/mf-dev-flow
```

结果：loader suite 9/9 通过；两个 Node 语法检查和 Git 已跟踪差异空白检查均无错误。技能目录尚未跟踪，因此另以逐行 `[ \t]+$` 扫描三个任务文件，确认没有尾随空白，并以 `JSON.parse` 验证 manifest 有效。

## 自审

- manifest 仅声明一个 `runtime-observe` overlay，且 `sourceDiscovery` 为 `false`；操作名称为能力枚举，并非 Node/CLI 方法。
- 附录不允许强制/脚本点击或直接改写运行状态，并且将准备动作从业务证据中隔离。
- 可渲染的追踪字段和截图可见性要求均在 Agent 附录中明确；没有加入 URL、凭据或会话信息的输出要求。
- 本次写入仅限本任务授予的四个路径。

## P1 安全修复

审查发现共享加载器只对 `web-runtime@1` 固定能力与 overlay 契约，`wechat-miniapp-runtime@1` 的 manifest 漂移会在加载阶段被放行。此修复只更新 `modules/prototype/processes.mjs`、`modules/prototype/tests/processes.test.mjs` 与本报告。

### RED

先增加小程序适配器的真实 manifest 变异回归，再运行：

```sh
node --test --test-name-pattern='wechat-miniapp-runtime@1 rejects malformed runtime capability or overlay contracts' .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs
```

结果如预期失败：`Missing expected exception: adds another source mode`。这证明旧加载器会接受未授权的 `sourceModes` 扩展。

### GREEN

共享加载器现对 `wechat-miniapp-runtime@1` 精确固定：

- 来源模式只能是 `wechat-devtools-simulator`；
- `sourceDiscovery` 必须是 `false`；
- 操作列表必须恰为 `pageStack`、`selectorAction`、`simulatorScreenshot`、`traceArchive`、`compileRefresh`；
- 证据必须恰为 PNG 截图和 `trace: true`，且不允许额外能力字段；
- 只能有一个 `runtime-observe → agents/runtime-observe.md` overlay。

回归逐项变异额外来源模式、静态发现、操作、截图格式、trace、额外能力字段、合法但错误的 `audit-accept` stage、错误 Agent 文件与额外 overlay。旧的“非流程阶段 overlay”用例也更新为在加载阶段立即拒绝，而非推迟到流程组合时。

最终执行：

```sh
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/processes.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs
git diff --check -- .codex/skills/mf-dev-flow/modules/prototype/processes.mjs .codex/skills/mf-dev-flow/modules/prototype/adapters/wechat-miniapp-runtime/v1 .codex/skills/mf-dev-flow/modules/prototype/tests/processes.test.mjs .codex/skills/mf-dev-flow/flows/maintenance/runtime-prototype-analysis-miniapp-task-1-report.md
```

结果：loader suite 10/10 通过；两个 Node 语法检查和 Git 已跟踪差异空白检查均无错误。技能目录尚未跟踪，因此另以逐行 `[ \t]+$` 扫描本修复的全部任务路径，确认没有尾随空白。

### 修复自审

- 校验比较完整的 allow-list capability 对象，因此会同时拒绝缺失、替换、重排或新增声明，避免仅验证单个字段留下扩展入口。
- `sourceModes` 与 overlay 同样精确比较；错误但仍属于真实流程的 stage 不能再进入后续组合器。
- 测试在实际复制的 adapter root 上改写 JSON，并调用真实加载器；没有通过检查源码文本或 mock 取巧。
- 不改变 manifest 的正常小程序观察能力，也没有新增 CLI/自动化能力、敏感字段输出或真实 `.mf-dev-flow` 写入。
