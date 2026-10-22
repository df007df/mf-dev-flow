# 贡献指南

感谢你改进 `mf-dev-flow`。本项目的核心原则是：流程声明、测试证据与真实项目数据必须分离。

## 开始前

- 先阅读根目录 [`README.md`](README.md) 与目标流程的 `flows/*/entry.md`。
- 修改技能、CLI、hook 或看板自身时，走 `maintenance` 边界：不得读取、扫描、改写或迁移真实项目的 `.mf-dev-flow/`。
- 不要顺带格式化或修改无关文件；当前工作区可能包含其他人的未提交改动。

## 变更原则

- CLI、hook 与流程登记表必须保持单一真源，避免复制命令语义。
- 新增或变更流程时，同时更新 `modules/workflow/registry.json`、对应入口文档和隔离测试。
- 看板只能通过公共命令或只读模块读取工作区状态，不能直接改写业务数据。
- 文档、fixture 和测试必须使用中性项目名、相对路径和示例域名；不得写入真实用户、客户、机器路径、截图、凭据或内部仓库信息。

## 本地验证

在仓库根目录运行与改动范围相称的验证：

```bash
node --test scripts/*.test.mjs modules/*/tests/*.test.mjs
node --test integrations/codex/hooks/mf-dev-flow.test.mjs
pnpm --dir dashboard test
pnpm --dir dashboard exec tsc --noEmit --incremental false
pnpm --dir dashboard build
```

浏览器测试是可选的额外验证，首次需要安装 Chromium：

```bash
pnpm --dir dashboard exec playwright install chromium
pnpm --dir dashboard test:smoke
pnpm --dir dashboard test:e2e
```

提交前还应运行：

```bash
git diff --check
git status --short
```

## 提交与评审

- 一个提交聚焦一个问题，并在描述中写明行为变化和实际运行的验证命令。
- 不提交 `.env*`、`.mf-dev-flow/`、`node_modules/`、构建产物、截图、临时文件或本地编辑器文件。
- 若改动涉及流程门禁，请增加正向与拒绝路径的隔离测试，并说明旧数据兼容策略。
- 若发现安全问题，按 [`SECURITY.md`](SECURITY.md) 私下报告，不要把可利用细节放进公开 issue 或测试 fixture。
