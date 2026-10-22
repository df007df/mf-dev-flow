# modules/capabilities — 能力注册表（M3）

任务内可复用原子功能的登记处。能力三件套 = 判定提示词（agentFile）+ 命令面（commands）+ 提供的门禁 ID（gates）。命令实现留在原模块（provider 引用），本注册表是**登记与校验层**，不是转发层——避免 M3 引入双实现漂移。

原则：能力只提供原子事实与判定口径，**结果判断归流程**——阶段通过 `evidenceGates` 引用能力，证据存在性由命令核验。已登记：visual-compare（同状态截图对+逐区判定）、miniapp-evidence（simulator_screenshot 取证）、api-mock-evidence、content-diff（字节/归一化差异）、git-diff（基线→工作区 name-status 清单，`capability git-diff`，引用参数经白名单校验拒注入）、runtime-observe（三平台适配器观察）。

`kernelGates` 列明由内核机制（stage-artifact、风险台账、apply/check 门禁）负责的 gate。交叉校验由测试保证：**任务类型的每条 evidenceGates 必有唯一归属主**（能力或 kernel），gate 不得多主。

CLI：`capability list`（含 gateOwnership 全景）/ `capability show --id` / `capability git-diff --repo --base [--head] [--include-untracked]`。
