# 版本化功能点交付流程

流程目录格式为 `<流程 ID>/v<正整数>/`。每个版本包含一个 `process.json` 与每阶段一个独立的 `agents/*.md` 文件。`process.json` 定义阶段顺序、职责、产出与门禁；agent 文件只定义该阶段的执行指令。

新建功能点时，流程快照（阶段定义、agent 指令和 SHA-256）会写入 `delivery-input.json`。因此绝不修改已发布版本：调整一个阶段时，新建版本目录，例如 `miniapp-product/v2/`，再通过 `id@版本` 选择它。历史运行只读取自己的冻结快照。

当前内置流程：

```text
miniapp-product@1（历史运行冻结快照仍读取各自版本）
  prototype_alignment    agents/prototype-alignment.md
  technical_solution     agents/technical-solution.md
  development            agents/development.md
  end_to_end_acceptance  agents/e2e-acceptance.md

miniapp-product@2（已被 v3 取代；历史运行冻结快照仍读取各自版本）
  prototype_alignment    agents/prototype-alignment.md     + risk_ledger
  technical_solution     agents/technical-solution.md      + dataflow_svg_evidence（数据系统流转 SVG，可多张）
  development            agents/development.md             + risk_ledger（风险/下一步逐条 --risk 登记到功能点）
  end_to_end_acceptance  agents/e2e-acceptance.md          + e2e_screenshot_evidence（本阶段登记真实截图）

miniapp-product@3（功能地图交付的当前默认）
  prototype_alignment    agents/prototype-alignment.md     + risk_ledger
  technical_solution     agents/technical-solution.md      + dataflow_svg_evidence（数据系统流转 SVG，可多张）+ technical_requirement_confirmed（技术要求已与用户确认）+ dev_plan_evidence（writing-plans 计划已登记）
  development            agents/development.md             + risk_ledger（风险/下一步逐条 --risk 登记到功能点）+ subagent-driven-development（默认）
  end_to_end_acceptance  agents/e2e-acceptance.md          + e2e_screenshot_evidence（本阶段登记真实截图）

web-product@1（普通浏览器项目显式选择）
  solution_design        agents/solution-design.md         + risk_ledger
  development            agents/development.md             + risk_ledger
  end_to_end_acceptance  agents/e2e-acceptance.md          + e2e_screenshot_evidence + risk_ledger
```

v3 新增的门禁语义（v2 门禁全量继承）：
- `technical_requirement_confirmed`：确认技术方案前，任务叶子功能 `sourceRequirementIds` 中所有 `kind=technical` 的要求必须已 confirmed（brainstorming 到用户确认后置位）；无关联技术要求时通过，不强制每单必有。
- `dev_plan_evidence`：确认技术方案前，本阶段必须已用 `delivery stage-artifact --kind dev_plan --file <md> --caption <计划说明>` 登记 writing-plans 产出的 plan.md；文字描述不构成门禁证据。
- development 阶段默认 superpowers:subagent-driven-development，逐切片回写 `delivery stage --summary`、`--risk` 与 changedFiles，并在 processData 记录 SDD 台账。

v2 新增的门禁语义：
- `dataflow_svg_evidence`：确认技术方案前，必须已用 `delivery stage-artifact --kind dataflow_svg --file <svg>` 在本阶段登记至少一张数据系统流转图（节点=系统，连线=数据+对应接口）。
- `risk_ledger`：阶段总结"风险/下一步"含具体留项时，必须在闭环的 `delivery stage` 命令中用 `--risk "<条目>"` 逐条登记到关联功能点；独立条目挂在功能点上（`feature risks --id <ID>` 查看，`feature risk-resolve` 关闭），并在下一次该功能的交付运行创建时自动注入为运行输入（`work delivery-brief` 会列出"功能点携带的开放风险/下一步"）。
- `e2e_screenshot_evidence`：确认端到端验收前，本阶段必须已用 `delivery stage-artifact --kind e2e_screenshot --file <png>` 登记真实截图；早期阶段的截图证据不继承为本阶段门禁。

创建交付运行时可显式选择流程：

```bash
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs delivery start \
  --source feature-map --intensity focused --features <功能 ID> \
  --process miniapp-product@1

node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs feature start \
  --id <功能 ID> --process miniapp-product@1
```

没有 `--process` 时，feature-map 交付默认使用 `miniapp-product@3`。每次 `work claim` 或 checkpoint 后的 `work bind-session` 都必须传入目标阶段 agent profile ID；进行中的阶段不允许更换 agent，已验证检查点才允许交接。

普通 Web 功能使用：

```bash
node .codex/skills/mf-dev-flow/scripts/mf-dev-flow.mjs feature start \
  --id <功能 ID> --process web-product@1
```

它要求真实浏览器 E2E 大图和冻结 AC 结论，但不会要求微信开发者工具截图。
