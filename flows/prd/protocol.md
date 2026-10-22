# PRD 协议：来源冻结、findings 与门禁

实现固定在 `modules/runtime/prd.mjs`；存储固定在 `.mf-dev-flow/prd/`（`manifest.json`、`sources/<ID>.md`、`analyses/<批次>/`）。命令都从仓库根执行：`node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs prd …`。

## 摄取（prd ingest）

| 输入 | 命令 | 说明 |
| --- | --- | --- |
| 单个文本文件 | `prd ingest --file <路径>` | 支持 .md/.markdown/.txt；原件字节哈希记为 sourceSha256 |
| Word 文档 | `prd ingest --file <路径.docx>` | `unzip -p` 解出 word/document.xml，标题→#、表格行→`a \| b`，得全文快照；缺 unzip 明确拒绝 |
| 文件目录 | `prd ingest --dir <路径>` | 递归收集上述四类（跳过隐藏与 `~$` 临时文件，>500 拒绝），逐源登记 |
| 在线文档快照 | `prd ingest --snapshot <冻结文件> --url <https…> [--title <t>]` | 钉钉/alidocs 域记 kind=dingtalk，其余 remote；URL 必填 |

钉钉文档的唯一取证通道是「钉钉文档」MCP：服务配置在用户级 `~/.zcode/cli/config.json` 的 `mcp.servers`（端点含密钥，**密钥不写入本仓库任何文件、流程文档或快照**）。Agent 侧流程：`get_document_info` 判定节点类型 → 文件夹用 `list_nodes` 递归枚举 → 每篇 adoc 用 `get_document_content`（Markdown）取得全文，原样落盘为冻结文件，再逐篇 `--snapshot --url --title` 登记；文件夹整体作为一份 PRD 时，全部子文档按独立来源进入同一批 `sources`。只允许只读工具，`create/update/delete/permission/revert` 等写与权限工具一律禁用。

来源 ID = 标题 slug + 快照内容哈希前 12 位：同内容重摄幂等（`reused`），内容变化即新 ID 并存，便于会前重取留版本痕迹。快照文本 NFC 归一、CRLF 折叠。

## findings.json（批次唯一真源）

`prd/analyses/<批次>/findings.json`：

```json
{
  "schemaVersion": 1,
  "batchId": "<与目录同名>",
  "title": "<PRD 名称>",
  "summary": { "background": "<产品背景理解>", "direction": "<发展/方向理解>" },
  "sources": ["<来源ID>"],
  "items": [
    {
      "id": "C-01",
      "kind": "contradiction|ambiguity|principle|redline",
      "title": "<短标题>",
      "statement": "<结论：矛盾点/歧义口径/原则表述/红线规则>",
      "severity": "high|medium|low",
      "evidence": [
        { "source": "<来源ID>", "locator": "<章节/段落/表格定位>", "quote": "<冻结快照中的逐字原文>" }
      ],
      "question": "<待确认问题，可省略>",
      "conflictsWith": ["<其它条目ID>"]
    }
  ]
}
```

## 门禁（prd check / render）

`prd check --batch <ID> --json`（失败退出码 1）逐条核验并返回 `problems[]` 与 `warnings[]`：

- 每条 item 必须有唯一 ID、合法 kind/severity、非空 title/statement，且至少一条证据；
- 证据 `source` 必须在本批 `sources` 且在 manifest 中；`quote` 经空白折叠后必须逐字出现在该来源快照内——转述、改标点跨段拼接都会被拒；
- `conflictsWith` 指向存在的条目；未使用的来源、缺 `summary` 记 warning 不阻断。

`prd render --batch <ID>` 内部强制先跑同一核验，未通过即拒绝写文件；通过后从 findings.json 确定性渲染 `contradictions.md`（contradiction+ambiguity）与 `redlines.md`（principle+redline），按严重度排序，证据以引用块呈现并标注来源与定位。md 为派生产物：修改只改 findings.json 再重跑 check/render。

## 状态与漂移

`prd status --json` 列出来源与批次，并重算本地原件哈希：`clean` 可用；`modified/missing` 结论过期须重摄重跑；在线快照恒为 `unverifiable`。

## 内容变更与影响面（命令组合）

判断"文档内容是否变了、变了哪里、哪些结论受影响"由三个独立命令组合完成，Agent 按场景选用；helper 能力经 CLI 暴露，不在流程间耦合：

1. `content hash --file <路径> [--json]`——任意文件/快照的 sha256 指纹（本地对比、留版本痕迹）。
2. `content compare --a <文件> --b <文件> [--json] [--strict] [--fail-on-changed]`——两份内容变更判定：字节一致→未变；缺省归一化（CRLF、行尾与纯空白行差异视为未变，`--strict` 按字节）；有实质差异时分块列出行级差异（op/两侧行号与摘录）。钉钉来源会前重取全文落盘后，用 `--a .mf-dev-flow/prd/sources/<ID>.md --b <重取文件>` 判断变了没有、变了哪几块。
3. `prd check --batch <ID> --source <来源ID> --against <候选文件> --json`——候选快照复核：把该来源的逐字引文门禁在**候选文本**上重算（其余来源仍按冻结快照），输出 `snapshotChanged` 与 `impactedItems[]`（仅候选下新失效的条目；基线本身须先 check 通过，否则先修基线）。`impactedItems` 非空即结论受影响：重摄（ingest 新快照）后修 findings 再 check/render。

## 边界

- 本流程只写 `.mf-dev-flow/prd/`；PRD 原件、Word、在线文档一律只读，不改一行。
- check 只保证"引文逐字来自冻结快照"，不保证快照完整（分页在线文档须滚到全文再存快照）、不保证结论正确或已获共识；判断由 Agent 全量阅读完成，会议确认由人完成。
- 不新建 run、不 claim 产品任务；交接规划时随附 batchId 与两份 md，由规划流程复评。
