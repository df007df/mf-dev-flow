# PRD 阅读与取证

触发：全量阅读 PRD（本地文件目录、Word、钉钉等在线文档），在不修改 PRD 的前提下理解产品背景、需求与发展方向，产出业务逻辑矛盾/不清楚清单与核心原则红线证据索引，供会议逐项依赖。产出保存在 `.mf-dev-flow/prd/`；本流程只证明"引用忠于原文"，不代表结论已获产品确认，也不授权开发。

先 `prd status --json` 查看已冻结来源与漂移状态。未摄取时按 [PRD 协议](protocol.md) 逐源 `prd ingest`：本地 .md/.txt/.docx 或整个目录直接摄取；钉钉文档只走「钉钉文档」MCP（用户级 `mcp.servers` 配置，端点密钥不落仓库与文档）：`get_document_info`/`list_nodes` 枚举文档树，逐篇 `get_document_content` 取 Markdown 全文，原样冻结为快照文件后 `--snapshot --url --title` 登记。只允许该 MCP 的只读工具，写/权限/回滚类工具禁用。CLI 不访问网络、不存凭证；原件与远端文档一律只读。

写入边界只允许 `.mf-dev-flow/prd/`。一个分析批次唯一真源是 `prd/analyses/<批次>/findings.json`：每条矛盾（contradiction）、歧义（ambiguity）、原则（principle）、红线（redline）必须携带来源 ID、定位与逐字引文。`prd check --batch <ID> --json` 以命令核验每条引文逐字存在于冻结快照，防转述漂移与编造；未通过不得成文。通过后 `prd render --batch <ID>` 渲染 contradictions.md 与 redlines.md 两份会议材料。

- 来源漂移：`prd status` 会重算原件哈希；`modified/missing` 即结论过期，重摄后重跑 check/render。在线快照标记 unverifiable，重要会前重取全文落盘，用 `content compare` 判断是否变更、变了哪几块，再用 `prd check --batch <ID> --source <ID> --against <候选文件>` 算受影响结论（见协议「内容变更与影响面」）。
- 会议口径：红线含原则原文与出处；口径未确认的放 `question` 待确认，不得写成共识。背景与发展方向写入 `summary`，render 自动带上。
- 需要规划或复评时交接 [规划入口](../planning/entry.md)；问题取证若来自原型界面，用 [原型流程](../prototype/entry.md)，PRD 文本结论不冒充运行态观察。
