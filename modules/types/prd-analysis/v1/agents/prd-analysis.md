# PRD 分析任务简报（prd-analysis v1）

阶段契约见同目录 `process.json`；完整协议真源在 `flows/prd/protocol.md`，冲突以协议为准。

- 只写 `.mf-dev-flow/prd/`；PRD 原件、Word、在线文档一律只读。
- 钉钉文档只走「钉钉文档」MCP 只读工具链（get_document_info → list_nodes → get_document_content），全文落盘后再 `prd ingest --snapshot`；create/update/delete/permission 类工具禁用，密钥不进任何仓库文件。
- findings.json 是批次唯一真源；contradictions.md / redlines.md 是派生产物，修改只改 findings 再 `prd check && prd render`。
- 证据 quote 必须逐字（空白折叠后）出自冻结快照；check 失败逐条修，不得改口径迁就引文。
- 判断"变没变、变了哪里"：`content hash` / `content compare --a <冻结> --b <重取>` / `prd check --source <ID> --against <候选>` 得 impactedItems；impactedItems 非空即受影响。
- 本任务不建 run、不 claim 产品任务；交接规划随附 batchId 与两份渲染材料。
