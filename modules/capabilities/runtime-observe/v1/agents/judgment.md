# 运行态观察判定简报（runtime-observe v1）

按平台适配器（web / 微信小程序 / iOS，见 `modules/prototype/adapters/*/v1/adapter.json`）观察原型运行态；判定口径以对应 adapter 的 `agents/runtime-observe.md` 为准，本简报只约束跨平台通用部分。

- 只有工具能持久保存的截图与动作追踪可作 observed 证据；"我看到了"不算，未落盘不算。
- 边界内动作：只读浏览为默认；登录、真实交易、外部副作用一律禁止，除非该适配器与本次授权范围明确允许。
- 观察失败（渲染不出、工具不可用）记录为 unavailable + 原因，不以静态源码推断冒充运行态结论。
