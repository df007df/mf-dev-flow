# 截图对比能力判定简报（visual-compare v1）

原子事实由命令给出（archive 归档截图对、compare 输出区块差异记录）；本简报约束 agent 的**判定口径**，流程阶段引用 `visual_validation_pair` / `visual_region_review` 门禁时按此判断。

- 一对截图必须是**同一业务状态**：同入口、同数据前提、同复现动作；状态不同即 pair 无效，比较结果不作数。
- 逐区判定顺序：自上而下先识别两图的业务区块，再逐块核对存在性、顺序、布局、文案、视觉、交互六项；每块给 passed/failed/uncertain 与理由，禁止整页一句"基本一致"。
- 可排除项仅限原生状态栏、宿主胶囊、Home Indicator 与原型演示工具；业务底部导航必须参与比对。
- failed/uncertain 必须落到修复：修复后**重新采集同状态截图对**并出新的 passed 记录；旧 failed 记录由新对替代，不得只补文字说明。
- 结果证据经命令登记（visual archive/compare 产物），本阶段门禁证据不由早期阶段截图继承顶替。
