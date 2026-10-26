# 功能演进拆解 · 上下文摘要
> 默认只读本摘要。需要核验具体证据时使用 `run context` 按分区、分组和页读取；不要直接打开 `context.json`、`prototype-impact.json`、`previous-map.json`、`proposal.json` 或完整原型报告。
## 运行与证据
- 运行：`20261026-064908Z-功能演进拆解` · 状态：done · 冻结时间：2026-10-26T06:49:08.592Z
- 证据游标：`7ae4a1970bcb6b37e4cbec24130e1cd9b07c00e6fa95cd637a2e4184cb5cd0e5`
- 原始快照：5346 bytes（约 1671 tokens）
- 原型变更复评：用 `run context --detail planning --collection impact` 读取影响清单，再按 `--group <业务域ID>` 分页对照旧/新功能；每个受影响叶子功能必须在 `proposal.impactReviews` 留下结论。
- 相对上次快照：这是首份可比较快照。
## 原型与当前功能
- 原型：ready；功能块 1 个；入口 2 个。
- `trip-list` · 旅行清单筛选 · 原型：— · 覆盖：0/2
- 原型证据按组读取：`run context --id <本运行ID> --detail prototype --group <原型分组ID> --collection features|entries|coverage`。
- 旧/新规划先列业务域：`run context --id <本运行ID> --detail planning --collection groups`，再用 `--group <业务域ID>` 逐组读取。
- 每组结论用 `feature proposal-patch --run <本运行ID> --from <本组patch.json>` 增量合并；不要整读或整写 `proposal.json`。
## 开发与阻塞
- 开发任务：共 0 个；未结束 0 个；摘要中显示 0 个进行中、0 个最近终态记录。
- 当前无未结束开发任务。
## 系统与代码变更
- 系统卡片 0 张；未解决技术问题 0 个（摘要最多列 0 个）。
- 当前未记录未解决技术问题。
- 代码根 1 个；变更路径 0 条（摘要只列前 0 条）。
## 按需读取清单
- 默认每页 5 条、最多 12000 bytes；只有单条记录确有需要时才提高 `--max-bytes`。
- `prototype`：4158 bytes · sha256 `b951379382e44dddc09b17dca1c1e0deba957edc82c4df592eb2301671d4b664`
- `development`：302 bytes · sha256 `32cc23e8a696d170fc04207d7f20a31777de74adf1ba70bc137305bfa9168916`
- `systems`：221 bytes · sha256 `78ab3aed972004d390abe0f44503a384dc5a5a12e9bc17100d715fc057376c3f`
- `codeRoots`：455 bytes · sha256 `811a9a27e8f0ba9909437c60113b0540e567d5feed34e9342dc84e07ca15cfce`
- `documents`：2 bytes · sha256 `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`