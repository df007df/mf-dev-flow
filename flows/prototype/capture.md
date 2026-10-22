# 截图与观察记录受管提交

`prototype capture --input <文件> --request-id <唯一ID> --json` 接收已由真实工具保存的截图、追踪和本批次记录，归档成功后原子发布证据与记录引用。命令不操作浏览器，也不能判定日志是否真实；Agent 仍须观察和复核。旧 evidence／put 保留兼容。

对 `runtime-analysis@1`，只能由 `runtime-observe` 阶段的 Agent 提交 capture，并携带 `--agent runtime-observe`。该 Agent 使用可用浏览器自动化完成实际访问、操作、截图和追踪落盘；CLI 只核验文件和记录后归档。运行态 `runtime-only` 证据只支持“已观察且已归档”的结论，不能从截图、追踪或成功返回推断源码、隐藏分支或未观察状态已覆盖。

小程序自动化边界：CLI 不直接操控微信开发者工具。用户授权的模拟器由观察 Agent 操作；capture 命令仅核验和归档该 Agent 已保存的 PNG、trace 与结构化记录。

小程序 trace 字段：route、preconditions、selector/action、expected 和 observed result。每次模拟器观察还要记录操作前后页面栈、完整可见的目标状态和结果断言；trace 中不得写入凭据、session 或原始敏感定位信息。

iOS 自动化边界：CLI 不直接操控 iOS 模拟器。用户授权的设备自动化（如本机模拟器驱动或计算机操作工具）由观察 Agent 使用；capture 命令仅核验和归档该 Agent 已保存的 PNG、trace 与结构化记录。

iOS trace 字段：bundleId、screen、preconditions、element/action、expected 和 observed result。每次模拟器观察还要记录操作前后屏幕状态、完整可见的目标状态和结果断言；trace 中不得写入凭据、session 或原始敏感定位信息。

先按本批分析要求做一个真实状态，核对访问、缩放、容器完整性和实际 PNG 尺寸，再批量展开。输入形状：

```json
{
  "evidence": {
    "snapshotId": "<当前批次快照ID>",
    "capturedAt": "<实际取证时间>",
    "path": "/absolute/real-screenshot.png",
    "trace": "/absolute/real-trace.jsonl",
    "action": "<实际操作>",
    "assertion": {"expected": "<期望>", "actual": "<实际>", "passed": true},
    "capture": {
      "target": "<截图目标容器>",
      "zoom": 1,
      "deviceScaleFactor": 1,
      "sourceUnchanged": true,
      "fullTargetVisible": true,
      "outputSize": {"width": 390, "height": 844}
    }
  },
  "records": [
    {"type": "entry", "record": {"id": "<入口ID>", "feature": "<组ID>", "status": "covered", "evidenceIds": ["$evidence"]}}
  ]
}
```

尺寸仅为示例，必须按本项目实际要求替换。已有记录还需在该项携带 expectedRevision。`$evidence` 由命令替换成本次真实归档 ID；其他字段与 put 契约一致。最多 50 项／1 MiB，不能写用户语义或开发状态。

- 路径、追踪、截图头、实际 PNG 尺寸、快照版本及记录引用任一失败，事务不发布已覆盖记录或证据计数。
- 相同 request-id 和相同载荷重试返回原结果，不重复增加证据；异内容复用拒绝。旧归档被删除／改写时重试也拒绝。需要新观察时使用新 request-id。
- 返回 `evidence.files.screenshot`、`evidence.files.trace` 绝对路径与 `verified: true`，表示归档哈希核验通过；它不代表浏览器动作真实性或全流程验收通过。
- 数据库事务失败后可能保留无引用的内容寻址文件；它们不计作证据、不进入覆盖或报告。不自动删除可能被其他成功记录复用的文件。进程崩溃后同请求可重试。
- capture 元数据记录 Agent 已核验的缩放与完整性，程序只核验其声明和 PNG 像素尺寸，不能自动识别图片是否包含全部业务内容。其他图片格式仍可走旧 evidence，但不宣称支持尺寸门禁。
- 归档截图必须由 Agent 通过图片分析能力（支持图像输入的大模型、图片理解技能/工具或视觉 Agent）实际查看核验；仅凭文件存在、尺寸或源码/DOM 推断内容不视为已核验。当前环境无图像输入时先向用户确认视觉通道，用户明确坚持非视觉方式时才可继续并随批次记录。
