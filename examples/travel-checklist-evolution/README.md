# 旅行清单：一个项目从简单需求演进到复杂交付

这是 `mf-dev-flow` 的完整公开示例。它只使用一个合成项目：先冻结 PRD 与原型，拆出并交付一个简单筛选功能；随后摄取 PRD v2，主动识别旧功能受影响，再重规划为三个有依赖关系的功能并全部交付。

所有里程碑中的 `.mf-dev-flow` 都是在中性临时工作区实际执行本仓库 CLI 后冻结的状态，不是为了截图手工拼装的数据。生成方法、命令哈希与验证方式见 [`generation/README.md`](generation/README.md)。

## 五分钟最小闭环

如果只想判断它是否有用：

```bash
npm --prefix ../../modules/prototype ci
pnpm --dir ../../dashboard install
node scripts/select-case.mjs case-03
node ../../scripts/mf-dev-flow.mjs dashboard
```

打开 <http://127.0.0.1:4173/>，查看“功能点分组列表”和“运行历史”，再打开 `app/index.html` 点击筛选按钮。你会看到同一功能的需求、三条 AC、三阶段交付、浏览器证据和 `done` 结论在同一条链路上。

![Case 03 的功能、AC 与阶段完整区块](screenshots/case-03/dashboard-feature-group.png)

## 完整演进索引

| Case | 难度 | 项目状态 | 核心价值 |
| --- | --- | --- | --- |
| [01 · PRD 与原型基线](cases/01-prd-and-prototype-baseline.md) | 入门 | 来源已冻结，尚未分析 | 不把“收到文档”伪装成“已理解” |
| [02 · 原型分析与功能拆解](cases/02-prototype-analysis-and-planning.md) | 入门进阶 | 原型 ready，功能 not_started | 用真实状态证据拆出用户结果和 AC |
| [03 · 交付第一个功能](cases/03-first-delivery.md) | 进阶 | v1 功能 done | 方案、开发、浏览器验收和总控验证闭环 |
| [04 · PRD 变化与影响分析](cases/04-prd-change-impact.md) | 进阶 | 旧功能 review_required | 保留旧事实，主动阻止沿用过期规划 |
| [05 · 重规划与最终交付](cases/05-replan-and-final-delivery.md) | 完整闭环 | 3 个功能全部 done | 拆分依赖、替代旧 AC、逐功能重新交付 |

## 最终效果

![v2 最终应用默认态](screenshots/case-05/app-v2-final-default.png)

![旧 AC、v2 AC 和三个完成的功能同屏](screenshots/case-05/dashboard-final-feature-group.png)

## 切换任意里程碑

```bash
node scripts/select-case.mjs case-01
node scripts/select-case.mjs case-02
node scripts/select-case.mjs case-03
node scripts/select-case.mjs case-04
node scripts/select-case.mjs case-05
```

`select-case.mjs` 会先核对快照清单和 SHA-256，再替换当前示例的 `.mf-dev-flow`。看板只读这些状态；不会修改业务结论。

## 验证真实生成数据

```bash
node scripts/verify-example.mjs case-01 case-02 case-03 case-04 case-05
node --test scripts/*.test.mjs
node --test app/filter-state.test.mjs
```

验证器会把每个里程碑复制到新的临时路径，核对完整文件清单、最终 gate、相对命令参数，并重新读取 PRD、原型、功能地图、AC 与影响状态。

## 数据与隐私边界

- PRD、原型、应用内容和名称全部为公开合成数据。
- `generation/*.jsonl` 只保留相对参数、退出码和输出哈希，不保存原始输出或本机绝对路径。
- 截图来自本示例的真实浏览器运行，并保留完整卡片所在区块。
- 示例快照可以公开；真实业务项目的 `.mf-dev-flow`、原型、截图和运行日志仍应按团队策略保留在本地。
