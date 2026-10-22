# 看板

`node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs dashboard` 使用固定本地端口 4173；显式请求查看/启动时才执行。开发看板使用其 package 脚本；修改前读 dashboard/AGENTS.md 和当前安装版本的相关 Next 文档。

首页为项目卡片、原型、功能地图、系统卡片、开发运行。功能图、卡片和详情读取同一地图，保留 rank、依赖、P/W、原开发状态、阶段与历史；原型变更另派生 review_required，不把复评状态写成开发状态。

现代原型的数据契约：

- `/api/state` 只经公共 CLI 读取 prototype status，不加载整篇报告或全图。
- 自动刷新必须等待上一轮读取完成，页面隐藏时暂停；默认 30 秒一轮。服务端对多标签页的相邻读取短时复用同一快照，手动“刷新”带 `fresh=1` 强制读取最新状态，避免高成本状态扫描长期占满事件循环。
- `/api/prototype` 只开放 status/query/revision/document；默认10条、总 UTF-8 ≤16KiB。每次打开完整报告时，看板先用 document 校验报告新鲜度，再按报告内容 fingerprint 复用缓存，并经 `/files?path=prototype/report.md` 一次读取受限归档文件；证据替换或报告排版不改变语义版本时也必须刷新。Agent 需要文本上下文时仍按 fingerprint 分段读取。服务端经 modules/prototype/client.mjs，不直查 SQLite。
- 分组、入口、状态、交互、问题回答、需求/说明、变更历史和完整报告按需查询。超大单条以 field/offset 分段；分页修订改变明确要求重新读取。
- report.md 的截图链接定位到 analyses/<批次>/screenshots，文件服务验证真实路径在工作区归档范围内。`accept` 与已验收结论的语义变更会自动物化报告；分析中的观察变化保留到下一次验收。报告尚未生成、已过期或自动生成失败时，看板依据 `reportStatus` 显示明确状态与重建提示词，不在 GET 中写报告。
- 没有 catalog 时不建库、不扫描或导入历史。旧记录只由历史读取分支展示，不能据旧覆盖比例宣称新分析完整。

AI 按钮先展示提示词弹窗，再复制；不通过点击直接写数据。问题回答提示词保留问题 ID，需求/说明保留用户输入占位符，随后由专用语义命令操作并触发 feature impact。系统问题仍在单卡中统一回答，记录未解决项与历史。

页面错误与来源失效必须可见；错误不当作零问题、通过或已完成。只读看板不触发 claim/current/初始化、完整扫描、重规划或数据迁移。性能验证和界面验证只用隔离 fixture，不为维护启动真实项目。

路由遵循 `--flow` → 本次 `--intent` → 保存选择 → 会话绑定 → 指定运行；只读 route 不修改保存偏好，需跨恢复固定新选择时显式 flow select；`flow clear --session <ID>` 只清除该会话偏好，保留任务绑定。路由 goal 给出操作对象、范围与完成条件，沿用已有授权。

`flow health --json` 只读查看本工作区 Codex 适配器各事件最近状态与最近故障时间。unknown 不表示已安装，observed 不表示产品门禁通过；degraded 保留告警与事件定位，修复后重试对应事件。健康记录位于系统临时目录，不保存原始输入或错误消息，不进入产品真源。
