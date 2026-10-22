# mf-dev-flow 观察台

技能自带的完整 Next 应用，维护原型真源、功能演进依赖画板、系统卡片、项目卡片、运行历史和证据阅读器。业务数据仍来自工作区 `.mf-dev-flow/`。

```sh
pnpm --dir .codex/skills/mf-dev-flow/dashboard install
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs dashboard
```

访问 http://127.0.0.1:4173/。CLI 启动 Next 开发服务，保留热更新；有同端口服务时复用。也可在应用目录运行 `pnpm dev`。工作区按 `MF_DEV_FLOW_WORKSPACE_ROOT` 或从运行目录向上查找 `.mf-dev-flow/project.json` 定位。

生产模式：在应用目录依次运行 `pnpm build`、`pnpm start`。两种模式都只监听本机。

`next.config.mjs` 将 Turbopack 根目录设为父级 `mf-dev-flow`，使看板能解析同级 `modules/` 中的共享模块。

## 代码组织

| 目录                                 | 职责                                                             |
| ------------------------------------ | ---------------------------------------------------------------- |
| `app/page.tsx`                       | 观察台组合、轮询和错误提示                                       |
| `app/components/`                    | 原型、规划、运行历史、React Flow 画板、Radix 弹窗与文档阅读器    |
| `app/api/`、`app/files/`             | Next 服务端接口                                                  |
| `app/lib/`                           | 前端类型、格式化与提示词                                         |
| `server/state.js`、`server/readers/` | 聚合入口及按原型问题、功能地图、系统来源、运行证据拆分的查询模块 |
| `server/workspace.js`                | 工作区定位与归档路径校验                                         |
| `server/cli-runtime.js`              | 迁入应用的流程命令实现；无需启动 HTTP 服务即可执行               |
| `server/delivery-contract.js`        | 流程阶段与证据契约                                               |
| `server/start-dashboard.js`          | 本机 Next 启动和进程生命周期                                     |

技能外层 `scripts/mf-dev-flow.mjs` 仅为兼容命令入口，`scripts/delivery-contract.mjs` 仅为兼容导出。旧的 `mf-dev-flow-dashboard.mjs` 页面模板、浏览器脚本、静态资源路由和 HTTP 服务已移除。业务读取与流程命令都在此项目维护。

画板允许拖动节点、平移、滚轮缩放、缩略图定位和恢复自动布局。布局及视口按项目存入当前浏览器；功能状态更新会刷新节点信息，同时保留节点坐标。调整依赖或功能要求继续通过详情中的提示词交给 Agent，沿用功能地图门禁。

节点卡片展示全部关联来源截图，每行最多 4 张，自动换行，不折叠、不滚动。图片显示高度为 1072px（画板缩放前），宽度按真实比例计算，相邻图片间隔 2px；卡片按最宽图片行收紧（标题区最小宽度 320px），不使用等宽格子撑开竖图。卡片高度按图片行数增加，依赖层间距按该层最高卡片计算。点击“全屏显示画板”放大画板并适配全部节点，使用“退出全屏”或 Esc 返回；不支持原生全屏的浏览器会铺满窗口。“显示全部节点”仅调整视口。首次打开、或图片尺寸改变时会自动排列，避免旧坐标造成卡片重叠。

HTTP 接口保持只读，不执行 CLI 写命令。文件接口拒绝越界路径和越界符号链接；Markdown 经过净化，Mermaid 使用严格模式。

## 验证

```sh
pnpm test
# 自动启动隔离 Next 服务，验证只读 API、文档图片加载及点击放大（需要 Chromium）
pnpm test:smoke
# 先为隔离 fixture 启动本应用，再运行浏览器测试
pnpm test:e2e
# 也可指定测试服务
MF_DEV_FLOW_DASHBOARD_URL=http://127.0.0.1:4273 pnpm test:e2e
```

端到端测试覆盖完整页面、功能详情、文档目录和截图放大、布局持久化、运行筛选及只读接口边界。测试浏览器缺失时执行 `pnpm exec playwright install chromium`。原流程回归仍可在工作区执行 `node --test .codex/skills/mf-dev-flow/scripts/*.test.mjs`。

旧的 `mf-dev-flow:dashboard:watch` 递归监视技能目录，会监视 Next 构建输出；维护新页面请使用本项目的 `pnpm dev`。
