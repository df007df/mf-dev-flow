# Task 5 验证报告：公开运行态发现、文档与兼容性

## 范围

本任务只登记 `web-runtime@1` 的公开只读发现能力、相应 CLI 能力摘要、运行态分析文档与兼容性回归；不改变浏览器控制边界，不改变既有 HTML 批次的执行方式。本报告是本任务最终唯一新增文件；未提交或暂存任何内容。

## 公开命令与文档路径

- 公开命令实现：`modules/prototype/capabilities.mjs`、`modules/prototype/cli.mjs`。
  - `prototype process list` 仅返回版本化流程摘要（ID、版本、标题、阶段 ID、哈希），不返回 Agent 指令。
  - `prototype adapter list` 返回适配器能力摘要；`prototype adapter capabilities --adapter web-runtime@1` 返回受限的声明式能力。
  - `prototype capabilities` 分开列出静态 `analysisAdapters` 与运行态 `runtimeAdapters`，并明确 Node CLI 不控制浏览器；当前阶段 Agent 通过可用浏览器自动化观察，再以 `prototype capture` 归档实际截图与追踪。
- 使用入口与操作说明：`flows/prototype/entry.md`、`flows/prototype/workflow.md`、`flows/prototype/contract.md`、`flows/prototype/capture.md`、`flows/prototype/report-format.md`。
  - 文档覆盖 `runtime-analysis@1` / `web-runtime@1` 的 init 命令、构建或预览 revision、四阶段图及可回环阶段、checkpoint 的 Agent／理由／索引 revision 要求。
  - `runtime-only` 边界明确为只陈述已观察并归档的行为，不能声明源码、隐藏分支或未观察状态已完整覆盖。

运行态网页初始化示例：

```bash
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs prototype init \
  --process runtime-analysis@1 --adapter web-runtime@1 \
  --evidence-profile runtime-only --agent scope-snapshot \
  --input input.json --request-id web-analysis-001
```

## RED / GREEN 证据

- RED 目标（任务简报 Step 1–2）：`modules/prototype/tests/unified.test.mjs` 新增的公开命令断言要求 `prototype capabilities` 同时区分静态 HTML 与运行态网页，且适配器能力可由 `web-runtime@1` 查询；在公开运行态清单和能力命令尚未暴露时，该测试应失败。最终收尾期间不逆转或篡改实现来重放 RED，因为本次授权明确禁止修改代码；此处保留任务定义的失败条件，不把它表述为本轮新执行的失败结果。
- GREEN（本轮新执行）：

```bash
node --check .codex/skills/mf-dev-flow/modules/prototype/processes.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/core/runtime-source.mjs
node --check .codex/skills/mf-dev-flow/modules/prototype/core/workflow.mjs
node --test .codex/skills/mf-dev-flow/modules/prototype/tests/*.test.mjs
```

三个语法检查均成功；原型测试共 54 项通过、0 项失败、0 项取消、0 项跳过（退出码 0）。其中包含公开 manifest 边界、运行态能力区分，以及未带流程参数的旧 HTML init 继续不受新 Agent／阶段门禁影响的回归。

## 兼容性与未解决的范围外失败

执行：

```bash
node --test .codex/skills/mf-dev-flow/modules/workflow/tests/*.test.mjs .codex/skills/mf-dev-flow/scripts/*.test.mjs
```

结果为 77 项通过、2 项失败、1 项跳过（退出码 1）。两项失败均来自既存、与 Task 5 公开原型命令／文档范围无关的 `.codex/skills/mf-dev-flow/scripts/mf-dev-flow.project-check.test.mjs`：

- 第 71 行：`Cannot read properties of undefined (reading 'protected')`。
- 第 152 行：断言原本期望项目卡片检查失败，实际命令成功（`Expected "actual" to be strictly unequal to: 0`，`actual: 0`）。

Task 5 的所有权仅覆盖原型公开发现、能力摘要、相关文档及 `modules/prototype/tests/unified.test.mjs`；没有修改上述项目检查测试或其被测行为。为避免通过削弱原型门禁、篡改无关项目检查或扩展本任务范围来掩盖失败，本任务将它们记录为独立的既存问题，不作修复。

## 最终差异与状态复核

报告写入后重新执行：

```bash
git diff --check -- .codex/skills/mf-dev-flow
git status --short -- .codex/skills/mf-dev-flow
```

`git diff --check` 无输出且成功。状态输出为 `?? .codex/skills/mf-dev-flow/`：该技能目录在当前仓库基线中整体未跟踪，因此 Git 不会逐文件列出或生成常规 tracked diff；本任务未执行提交或暂存。最终报告及 Task 5 范围内实现保留在该未跟踪目录中。
