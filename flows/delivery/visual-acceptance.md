# 验收对比：双维度逐区审查

UI 截图的验收对比统一为「逐区语义结论」：不使用全图像素阈值、差异像素比例、红色差异图作为通过/失败依据（历史像素门禁已退役）。同一份逐区报告骨架支持两个维度，**可独立使用，也可配对使用**：

- `vision`（缺省，向后兼容）：图片理解逐区——对两张截图用图像识别能力逐区块对比，适合最终验收、无结构源码可比、跨端外观核对。
- `dom`：结构抽取逐区——对参考侧（原型 HTML 源码/渲染 DOM）与结果侧（运行时 DOM：小程序开发者工具 WXML 树、H5 元素树）逐区块对比，适合开发阶段快速核对结构、顺序与文案；DOM 相同不证明像素外观一致，外观结论仍需 vision 或人工看屏。

## 能力加载（视觉判定前）

视觉/结构判定统一由 `visual-compare` 能力承载；执行对比前按需加载其判定简报，字段结构一律由本协议与命令 schema 定义，能力只给判定口径，不返回也不定义复杂字段结构：

```bash
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs capability show --id visual-compare --version 1  # 判定口径
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs capability list --json                              # 全量能力索引
```

未加载判定简报前不得提交 region-report；加载状态不影响命令产物，命令只按本协议 schema 核验与归档。

## 两个维度共同的硬要求

1. 两侧必须是同一业务状态；状态不一致时补采，不得比较。
2. 原生状态栏、宿主胶囊、Home Indicator、模拟器外壳、原型演示工具列入 `excludedRegions`（唯一 id+理由）；业务底部导航属于业务区块。
3. `regions` 按从上到下 `order` 严格递增，`scope: "business"`，每块 `reference/result.summary` 必填。
4. 每块六项唯一检查：`presence`、`order`、`layout`、`copy`、`visual`、`interaction`，各给 `passed|failed|uncertain|not_applicable` + 简短 `detail`；不允许全部 `not_applicable`。
5. `copy` 检查除 `not_applicable` 外必须 `sourceVerified: true`：文案由原型 HTML 与实现源码（或 DOM 抽取文本）交叉核实，模型/识别不确定时保持 `uncertain` 并补采。
6. 任一 `failed` 或 `uncertain` 不得确认全链路验收；命令退出码非 0。

## 场景矩阵（Agent 按场景选维度与命令）

| 场景 | 维度 | 命令 | 结果去向 |
| --- | --- | --- | --- |
| 交付阶段截图门禁（原型 vs ui-client，绑定任务） | vision 或 dom（开发期两侧 DOM 可得时优先 dom，验收以 vision 收口） | `visual archive` 归档截图对，再 `visual compare --run --task --state --prototype --ui --ui-project --action --region-report <json>` | 运行 `visual-region-reviews`，参与阶段确认门禁 |
| 开发迭代自查（改动后快速回归，不充当门禁） | dom 优先 | `visual validate-report --region-report <json> [--state <s>]` | 输出即结论，Agent 自行记入 `verification.md` / e2e 报告 |
| e2e / 原型回归截图对比 | vision 或 dom | `visual validate-report` | e2e 产物目录；需要进交付门禁时改用 `visual compare` |
| 最终验收 / 跨端外观 | vision（两份同状态截图） | `visual archive` + `visual compare` | 交付门禁 |

`validate-report` 不依赖开发运行、任务或截图归档，可缺省 `--state`（由报告内参考/结果状态推断）；它只核验报告形状与语义结论，归档由调用方负责。**只有 `visual compare` 写入的运行记录才能满足交付阶段门禁**；`validate-report` 通过不产生门禁证据。

## 维度专属规则

vision：`capture.baseline` 记录设备/缩放/画布，两侧截图必须同基准采集；`analyzer.provider/model` 记录实际使用的图像模型。

dom：每个业务区块必须附 `domEvidence.reference.{locator,excerpt}` 与 `domEvidence.result.{locator,excerpt}`——locator 为可复现选择器（原型 HTML 选择器 / WXML 或元素树路径），excerpt 为该块抽取文本摘要；`analyzer.provider/model` 记录抽取工具（如 `agent-dom-extract` + `wxml-tree`）。`visual` 检查可 `not_applicable`（无像素），`interaction` 必须实测或 `uncertain`，不得凭 DOM 属性推断交互已验证。

## 报告模板（schemaVersion 1）

vision：

```json
{
  "schemaVersion": 1, "dimension": "vision",
  "analyzer": { "provider": "<图像模型提供方>", "model": "<实际使用的模型>" },
  "capture": { "comparable": true,
    "baseline": { "device": "iphone-14", "scale": "3x", "canvas": "390x844" },
    "reference": { "state": "<状态名>", "source": "<原型运行/文件>" },
    "result": { "state": "<同一状态名>", "source": "<ui-client 来源>" } },
  "excludedRegions": [ { "id": "status-bar", "reason": "原生状态栏" } ],
  "regions": [ { "id": "<区块名>", "order": 1, "scope": "business",
    "reference": { "summary": "<参考侧该区块内容>" },
    "result": { "summary": "<结果侧该区块内容>" },
    "checks": [
      { "kind": "presence", "status": "passed", "detail": "<两侧都存在>" },
      { "kind": "order", "status": "passed", "detail": "<相对顺序一致>" },
      { "kind": "layout", "status": "passed", "detail": "<布局一致>" },
      { "kind": "copy", "status": "passed", "detail": "<文案一致>", "sourceVerified": true },
      { "kind": "visual", "status": "passed", "detail": "<配色/字号/间距一致>" },
      { "kind": "interaction", "status": "passed", "detail": "<已实测的交互>" }
    ] } ]
}
```

dom：在 vision 骨架上把 `dimension` 改为 `"dom"`，`capture.baseline` 记录结构抽取基准（如 `"canvas": "dom-tree"`），并为每个区块增加：

```json
"domEvidence": {
  "reference": { "locator": "body > div.hero", "excerpt": "<原型 HTML 该块文本>" },
  "result":  { "locator": "view.hero", "excerpt": "<运行时 DOM 该块文本>" }
}
```

## Agent 填报告提示词

vision：「分别识别两张图片从上到下的业务区块，逐块给出存在性、顺序、布局、文案、视觉与交互六项结论；原生与演示内容写入排除区；文案结论必须回到原型 HTML 与实现源码交叉核实后才写 sourceVerified:true；拿不准写 uncertain，不得为通过而通过。按 flows/delivery/visual-acceptance.md 的 schemaVersion 1 模板输出报告 JSON。」

dom：「从原型 HTML 源码提取参考区块（选择器+文本），用浏览器自动化/开发者工具提取结果侧运行时 DOM 树，按屏幕顺序对齐区块，逐块给出六项结论并附两侧 locator+excerpt；样式外观写 not_applicable，交互未实测写 uncertain。按 flows/delivery/visual-acceptance.md 的 schemaVersion 1 模板输出报告 JSON。」

## 命令

- `visual archive --run <ID> --task <ID> --state <s> --reference <原型图> --result <ui 图> --ui-project <代码根> --action <复现动作>`
- `visual compare … --region-report <报告 JSON>`（交付门禁归档）
- `visual validate-report --region-report <报告 JSON> [--state <s>]`（独立校验，任何场景可用）
