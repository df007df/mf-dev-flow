# 原型分析报告

来源：/private/tmp/mf-dev-flow-travel-demo/prototype/v1.html

报告格式：v2；快照：673f930e-7cce-42c6-877c-c492935a1ec8；范围：full；索引版本：4

可观察边界：本地旅行清单合成原型；只核验页面可见列表与筛选交互。

结论：相对固定来源的结构与证据对账通过；仍需人工复核追踪真实性与业务语义。

## 覆盖与未覆盖

| 类型 | 登记 | 完成 | 待办 | 阻塞 | 已撤回计划 |
| --- | ---: | ---: | ---: | ---: | ---: |
| file | 2 | 2 | 0 | 0 | 0 |
| candidate | 9 | 9 | 0 | 0 | 0 |
| node | 2 | 2 | 0 | 0 | 0 |
| edge | 2 | 2 | 0 | 0 | 0 |
| space | 1 | 1 | 0 | 0 | 0 |
| vector | 2 | 2 | 0 | 0 | 0 |
| control | 1 | 0 | 1 | 0 | 0 |
| occurrence | 2 | 2 | 0 | 0 | 0 |
| sweep | 2 | 2 | 0 | 0 | 0 |
| entry | 2 | 2 | 0 | 0 | 0 |
| group | 1 | 0 | 1 | 0 | 0 |
| question | 0 | 0 | 0 | 0 | 0 |
| evidence | 3 | 0 | 3 | 0 | 0 |

截图数量不等于交互覆盖；相同控件在不同前置状态、输入类别与结果分支分别对账。

## 用户流程、页面与状态

### 旅行清单筛选

分组 ID：trip-list

分组用途：核对出发前准备事项，并在全部项目与已完成项目之间切换。

#### 1. 旅行清单·全部项目

节点 ID：trip-list-default；分组：trip-list；状态：covered

用途：默认展示三项准备事项、各自完成状态与 3 / 3 数量。

前置与复现：重新打开 prototype/v1.html。

状态取值：{"filter":"all"}

| 截图 | 操作与结果 | 证据 |
| --- | --- | --- |
| ![旅行清单·全部项目](screenshots/ee36d41213778e96c9f2f6fc3463084d8ead154e0d0869f3dccd7adc8ee6a019.png) | 操作：打开旅行清单原型 v1，核对默认状态。；结果：页面显示 3 / 3 项，三项准备事项均可见，按钮为仅看已完成。 | evidence-909f755e53667ac834335f93 · [查看追踪](traces/af9a78f25384927c95fed9cad1c74b4c634fda6c1ac2eef12eb0625b65825ddc.trace) |
| ![旅行清单·全部项目](screenshots/ee36d41213778e96c9f2f6fc3463084d8ead154e0d0869f3dccd7adc8ee6a019.png) | 操作：从仅看已完成状态点击显示全部项目，核对恢复后的列表与数量。；结果：页面恢复显示 3 / 3 项和全部三项准备事项，按钮切回仅看已完成。 | evidence-a2d2acae4c8b262ff509cb20 · [查看追踪](traces/11eb97d84523ac96fad9a8da26a8ebf0df1e1b5317710c4997f806702c32d2c8.trace) |
| ![show-completed 截图](screenshots/30bc01ce7cc8a6743305d67dfd876b4d3b74354af57aded03ffad11b65c2683c.png) | show-completed：click #filter，输入类别 none → trip-list-completed；结果 completed-only：隐藏待完成事项，数量从 3 / 3 变为 2 / 3，按钮变为显示全部项目。；covered；复现：点击仅看已完成按钮，核对筛选后的列表与数量。；实际结果：页面显示 2 / 3 项，只保留两项已完成事项，按钮切换为显示全部项目。 | evidence-9142838d2cc6c6e1f28c9a5b · [查看追踪](traces/af9a78f25384927c95fed9cad1c74b4c634fda6c1ac2eef12eb0625b65825ddc.trace) |

#### 2. 旅行清单·仅已完成

节点 ID：trip-list-completed；分组：trip-list；状态：covered

用途：只展示两项已完成事项，并显示 2 / 3 数量。

前置与复现：从默认状态点击仅看已完成。

状态取值：{"filter":"completed"}

| 截图 | 操作与结果 | 证据 |
| --- | --- | --- |
| ![旅行清单·仅已完成](screenshots/30bc01ce7cc8a6743305d67dfd876b4d3b74354af57aded03ffad11b65c2683c.png) | 操作：点击仅看已完成按钮，核对筛选后的列表与数量。；结果：页面显示 2 / 3 项，只保留两项已完成事项，按钮切换为显示全部项目。 | evidence-9142838d2cc6c6e1f28c9a5b · [查看追踪](traces/af9a78f25384927c95fed9cad1c74b4c634fda6c1ac2eef12eb0625b65825ddc.trace) |
| ![restore-all 截图](screenshots/ee36d41213778e96c9f2f6fc3463084d8ead154e0d0869f3dccd7adc8ee6a019.png) | restore-all：click #filter，输入类别 none → trip-list-default；结果 all-items：恢复待完成事项，数量从 2 / 3 变为 3 / 3，按钮变为仅看已完成。；covered；复现：从仅看已完成状态点击显示全部项目，核对恢复后的列表与数量。；实际结果：页面恢复显示 3 / 3 项和全部三项准备事项，按钮切回仅看已完成。 | evidence-a2d2acae4c8b262ff509cb20 · [查看追踪](traces/11eb97d84523ac96fad9a8da26a8ebf0df1e1b5317710c4997f806702c32d2c8.trace) |


## 截图与证据索引

| ID | 时间 | 动作 | 实际结果 | 截图 | 追踪 |
| --- | --- | --- | --- | --- | --- |
| evidence-909f755e53667ac834335f93 | 2026-10-26T06:45:47.000Z | 打开旅行清单原型 v1，核对默认状态。 | 页面显示 3 / 3 项，三项准备事项均可见，按钮为仅看已完成。 | [截图](screenshots/ee36d41213778e96c9f2f6fc3463084d8ead154e0d0869f3dccd7adc8ee6a019.png) | [追踪](traces/af9a78f25384927c95fed9cad1c74b4c634fda6c1ac2eef12eb0625b65825ddc.trace) |
| evidence-9142838d2cc6c6e1f28c9a5b | 2026-10-26T06:45:47.000Z | 点击仅看已完成按钮，核对筛选后的列表与数量。 | 页面显示 2 / 3 项，只保留两项已完成事项，按钮切换为显示全部项目。 | [截图](screenshots/30bc01ce7cc8a6743305d67dfd876b4d3b74354af57aded03ffad11b65c2683c.png) | [追踪](traces/af9a78f25384927c95fed9cad1c74b4c634fda6c1ac2eef12eb0625b65825ddc.trace) |
| evidence-a2d2acae4c8b262ff509cb20 | 2026-10-26T06:47:16.000Z | 从仅看已完成状态点击显示全部项目，核对恢复后的列表与数量。 | 页面恢复显示 3 / 3 项和全部三项准备事项，按钮切回仅看已完成。 | [截图](screenshots/ee36d41213778e96c9f2f6fc3463084d8ead154e0d0869f3dccd7adc8ee6a019.png) | [追踪](traces/11eb97d84523ac96fad9a8da26a8ebf0df1e1b5317710c4997f806702c32d2c8.trace) |

## 待确认问题

无已登记问题；不代表已核验全部范围。

## 未完成与无法观察


## 文件遍历索引

| 路径 | SHA-256 | 分析状态 | 用途 |
| --- | --- | --- | --- |
| prototype/v1.html | 6c539dd9122ab1f8a3417c014c5dc1b48cf9b80b14728249ef310ae8050afd7a | complete |  |
| prototype/v1-init.json | 11dd47504e6a3d1809b2032e9d2d64289014096e25d54e492b293f1fc51ec1a4 | reviewed | 声明本次完整本地 HTML 原型分析的来源与可观察边界。 |

## 更新记录

- 2026-10-26T06:44:09.360Z：固定来源快照。报告由索引修订 4 派生；来源变动或抽取器变化需要新快照。
