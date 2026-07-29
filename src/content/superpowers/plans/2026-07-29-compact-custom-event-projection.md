# Compact CustomEvent → ReplyProjection 执行计划

## 1. 原始需求与结论

当前 `/compact` 能生成并保存滚动摘要，但其完成通知只通过 WebSocket 实时发送。
客户端刷新或重新进入会话后，只从 `/sessions/{session_id}/messages` 加载普通消息，因而丢失
“历史已压缩”的气泡，也无法在历史中查看当前生效的摘要。

目标是统一如下职责：

1. `CompactManager` 只负责判断、调用摘要模型和产生压缩领域事件；不直接写 session state，
   不直接向 Bus / WebSocket 派发事件。
2. 压缩过程中产生的 `context_compact_start`、`context_compact_done`、
   `context_compact_failed` 全部使用 core 的 `CustomEvent`，交给 `ReplyProjection`。
3. `ReplyProjection` 对不同 `CustomEvent.name` 决定投影行为，并始终在投影完成后统一实时广播。
4. `context_compact_done` 投影成一条特殊的 **user Msg**：`name == "compact"`。
   它的正文就是完整摘要，不是单独的“提示气泡”。
5. 下一轮发给 LLM 的上下文从最后一条 `name == "compact"` 的 Msg 开始：该 Msg 本身和
   之后的 tail 保留；它之前的原始 Msg 已被摘要覆盖，不再加载。
6. 该 compact Msg 进入 `state.json.messages`，因此现有历史接口可返回它，客户端刷新后可重建
   同一个压缩气泡。

本计划不保留旧的 `state.summary.message` 双份摘要结构，也不引入 `timeline` / `session_events`
等平行存储。

## 2. 术语与协议约定

### 2.1 `Msg.name` 语义

`role` 负责说明“谁发的消息”；`name` 只说明该 Msg 的语义类别，不能再复用为 agent id 或模型名。

在 core 中新增并统一导出：

```python
class MsgName(StrEnum):
    DEFAULT = "default"
    COMPACT = "compact"
```

约定：

| 消息 | role | name | 其他信息 |
| --- | --- | --- | --- |
| 普通用户消息 | `user` | `default` | `metadata.agent_id` |
| 普通助手消息 | `assistant` | `default` | `metadata.model` |
| 压缩摘要 | `user` | `compact` | `metadata.context_compact` |

不提前加入 `system`、`assistant` 等枚举值：这些概念已由 `role` 表达。以后只有出现新的、确有
持久化语义的特殊 Msg 时才扩展 `MsgName`。

### 2.2 `CustomEvent` 语义

core 的 `CustomEvent.type` 固定为 `"CUSTOM"`，业务事件名必须放在 `name`：

```python
CustomEvent(
    name="context_compact_done",
    value={...},
)
```

压缩事件包括：

```text
CUSTOM / context_compact_start
CUSTOM / context_compact_done
CUSTOM / context_compact_failed
```

不要把 `context_compact_done` 写进 `CustomEvent.type`，也不要继续使用嵌套的
`BusMessage.data = {"type": "context_compact_done", ...}` 作为唯一协议来源。

## 3. 目标状态结构

压缩前：

```text
M1 user/default
M2 assistant/default
M3 user/default
M4 assistant/default
```

压缩完成后，`state.json.messages`：

```text
M1 user/default
M2 assistant/default
M3 user/default
M4 assistant/default              ← compact 覆盖到这里
C1 user/compact                   ← M1 ~ M4 的完整摘要
M5 user/default
M6 assistant/default
```

`C1` 示例：

```json
{
  "id": "compact_01",
  "role": "user",
  "name": "compact",
  "content": [
    { "type": "text", "text": "完整压缩摘要……" }
  ],
  "metadata": {
    "hide": true,
    "context_compact": {
      "through_message_id": "m4",
      "trigger": "manual",
      "tokens_before": 118973,
      "tokens_after": 6290
    }
  }
}
```

`hide: true` 表示它不作为普通用户输入气泡渲染；客户端根据 `name == "compact"` 渲染专用
`CompactBubble`。它不是“隐藏于历史之外”的 Msg，必须继续由 messages API 返回。

### 多次压缩

第二次压缩时，CompactManager 读取的上下文是：

```text
C1 + M5 + M6
```

生成 `C2` 后追加：

```text
M1 ~ M4, C1, M5, M6, C2, M7 ...
```

LLM 上下文选择最后一条 compact，因此为：

```text
C2 + M7 ...
```

`C1` 仍作为完整可见历史记录存在，但不再进入 LLM 上下文。无需覆盖或删除历史 Msg。

## 4. 完整运行流程

```text
用户输入 /compact
  ↓
CompactManager 收集当前 active context（最后 compact + tail）
  ↓
CompactManager 产生 CustomEvent(context_compact_start)
  ↓
统一事件入口 → ReplyProjection.apply(session_id, event)
  ↓
ReplyProjection：start 不持久化，只允许统一实时广播
  ↓
CompactManager 调用摘要 LLM
  ↓
成功：产生 CustomEvent(context_compact_done, summary_text + stats)
失败：产生 CustomEvent(context_compact_failed, reason)
  ↓
ReplyProjection.apply(session_id, event)
  ↓
done：创建 UserMsg(name=COMPACT)，追加 state.messages，落盘成功
  ↓
统一事件入口将 Event 广播给 Bus / WebSocket
  ↓
客户端收到 done：按 compact Msg ID upsert CompactBubble
```

关键顺序必须是：

```text
Projection 落盘成功 → 广播 WebSocket
```

不允许先通知客户端、再异步写文件；否则客户端已看到压缩完成但刷新后状态未存在。

## 5. ReplyProjection 的扩展边界

不需要立刻改名为 `SessionProjection`，也不需要让所有 CustomEvent 都入库。

扩展后的职责是：

```text
Event → 决定是否改变可恢复的 session Msg 状态 → 落盘 → 允许统一广播
```

伪代码：

```python
async def apply(session_id: str, event: AgentStreamEvent) -> ProjectionResult:
    if event.type == "CUSTOM":
        match event.name:
            case "context_compact_done":
                compact = make_compact_user_msg(event.value)
                await session_manager.save_message(session_id, compact)
                return ProjectionResult(persisted_messages=[compact])
            case _:
                return ProjectionResult()

    # 保持既有 REPLY_START/TEXT/TOOL/REPLY_END 的 assistant Msg 投影逻辑
```

`context_compact_start` 与 `context_compact_failed` 也必须经过 `apply()`，但默认不持久化。
它们是临时过程状态；刷新期间是否展示“压缩中”由 session status `compacting` 决定。

当前 `PIPELINE_START`、`TURN_END` 等 Turn CustomEvent 也会进入 `apply()`，但因为没有顶层
`reply_id`，目前直接返回、仅实时派发。此次改造后它们仍保持此行为；不能因为新增 compact
处理而把全部 CustomEvent 都写入 messages。

## 6. 后端改动计划（E:\ftre）

### 6.1 建立统一 Event 出口

当前 `TurnExecutor.publish_agent_event()` 已有“Projection → `_dispatch_agent_event`”的顺序；
CompactManager 目前绕过它，直接构造 `BusMessage`。

提取 AgentLoop 级的统一入口，供 TurnExecutor 和 CompactManager 共用：

```python
async def emit_session_event(session_id, channel_id, event) -> ProjectionResult:
    result = await reply_projection.apply(session_id, event)
    await dispatch_agent_event(session_id, channel_id, event)
    return result
```

要求：

- `dispatch_agent_event` 序列化的是 core Event 本身；不再嵌套私有 `{type, data}` 协议。
- 保留 `frame_id`、`session_id`、`channel_id` 的 WebSocket 外层封装。
- Event 的 `id` 作为客户端幂等键。

### 6.2 CompactManager 改造

- 删除 `_notify()` 与 `_notify_failed()` 对 Bus 的直接依赖。
- compact 起始、成功、失败都创建 `CustomEvent` 后调用统一 Event 出口。
- `context_compact_done.value` 必须包含完整 `summary_text`，而不是 `_preview(summary)`。
- CompactManager 不再调用 `save_summary()`。
- 删除或替换 `state.summary` 的读写 API，避免残留双事实来源。

### 6.3 ReplyProjection 改造

- 保留现有 Reply 生命周期投影与运行中 snapshot 行为。
- 新增 `CustomEvent` 分支，仅识别 `name == "context_compact_done"`。
- 创建 `UserMsg(name=MsgName.COMPACT, ...)`；Msg id 使用 Event id 或稳定派生值，保证重复事件
  不会重复写入。
- 使用 `SessionManager.save_message()` 的按 id 幂等写入，或新增明确的 `upsert_message()`。
- `ProjectionResult` 替代当前仅 `Msg | None` 的返回值；调用方不应再猜测 CustomEvent 是否已持久化。

### 6.4 SessionManager 与上下文选择

删除当前“`state.summary` 保存一份完整 SummaryMsg，`get_context_messages()` 从 summary + tail
拼接”的实现，改为扫描 messages：

```python
records = state.messages
last_compact_index = max(
    index for index, msg in enumerate(records)
    if msg.name == MsgName.COMPACT
)
return records[last_compact_index:]
```

无 compact Msg 时返回全部 messages。

注意：这里必须包含 compact Msg 本身；它上方的消息才被排除。`through_message_id` 主要用于
客户端说明、审计与校验，不作为上下文裁剪的唯一依据。

### 6.5 Msg name 规范化

在 `ftre-agent-core` 定义 `MsgName` 后，后端改造所有 Msg 创建点：

- `UserMsg`：普通输入使用 `MsgName.DEFAULT`，agent id 留在 metadata。
- ReplyProjection 创建的 assistant Msg：使用 `MsgName.DEFAULT`，模型名写进 `metadata.model`。
- `CompactManager` 产生的摘要：使用 `MsgName.COMPACT`。
- 旧的 `name="context_compact"`、模型名作为 Msg name 的用法全部删除。

## 7. Core 改动计划（E:\ftre-agent-core）

1. 在 message 模块定义、导出 `MsgName`。
2. `Msg.name` 改为 `MsgName`，默认值 `MsgName.DEFAULT`；序列化仍是字符串值。
3. `UserMsg`、`AssistantMsg`、`SystemMsg` 工厂函数默认采用 `MsgName.DEFAULT`，调用方可在
   特殊场景显式传 `MsgName.COMPACT`。
4. 保留 `CustomEvent(type="CUSTOM", name=..., value=...)` 的既有结构；不要为 compact 在 Event
   enum 增加第二套顶层 type。
5. 为 name 枚举、序列化、OpenAI converter 增加单测。

## 8. 客户端改动计划（E:\binn\ftre-desktop）

### 8.1 协议解析

客户端的 agent event 解析改为直接识别：

```json
{ "type": "CUSTOM", "name": "context_compact_done", "value": { ... } }
```

而不是只识别旧的 `agent_event.data.type`。

### 8.2 实时气泡

- `context_compact_start`：创建临时 running CompactBubble，ID 使用 event id。
- `context_compact_done`：使用 `value.compact_message` 或 `value.message_id` 把临时气泡替换为
  已完成的 CompactBubble；必要时从后端 refresh 对应 messages。
- `context_compact_failed`：把临时气泡变为失败状态。

### 8.3 历史加载与刷新

持久化历史消息转换时识别：

```ts
record.role === "user" && record.name === "compact"
```

将其转换为：

```ts
{
  id: record.id,
  role: "system",
  compact: {
    status: "done",
    mode: "summary",
    tokensBefore: record.metadata.context_compact.tokens_before,
    tokensAfter: record.metadata.context_compact.tokens_after,
    summaryPreview: record.content 的完整文本,
  }
}
```

因此实时事件和刷新后的历史 Msg 使用同一个 `id`，store 的 upsert 不会产生双气泡。

移除 `loadSessionMessages()` 中“保留内存 compact 气泡以躲过刷新”的临时逻辑；它将不再需要。

## 9. 数据迁移与测试期原则

当前项目处于可清理历史数据的测试阶段：**不需要兼容旧 `state.summary`、旧 name 语义或旧的
context_compact Bus payload。**

实施前清理：

```text
C:\Users\蒋全明\.ftre\sessions
```

仅在确认 Gateway 已停止后执行。开发与测试期间直接创建全新 state.json。

## 10. 验收测试

### 后端 / core

1. 无 compact Msg：`get_context_messages()` 返回全部 Msg。
2. 一次 compact：返回 `C1 + tail`，不包含 `C1` 上方原始消息。
3. 两次 compact：只返回最后一个 compact `C2 + tail`。
4. `context_compact_done` 仅写入一条 `user/compact` Msg；重放同一 Event id 不重复写入。
5. `context_compact_start` / `failed` 不写入 Msg。
6. `MsgName.DEFAULT`、`MsgName.COMPACT` 在 JSON 中正确序列化为字符串。
7. 普通 assistant Msg 的 model 在 `metadata.model`，不在 `name`。
8. Projection 写入成功前，不允许广播 done Event。

### 客户端

1. 执行 `/compact` 时显示“压缩中”。
2. done 后显示一条可展开的“历史已压缩”气泡，正文为完整 compact Msg。
3. 页面刷新、切换 session、WebSocket 重连后，气泡仍出现且不重复。
4. 加载更早历史时，compact Msg 仍按其原始时间顺序显示。
5. `context_compact_failed` 显示失败气泡，但刷新后不残留为成功记录。

## 11. 实施顺序

1. core：新增 `MsgName` 及测试。
2. backend：先实现 messages-last-compact 的上下文选择，并删除旧 summary 双写。
3. backend：扩展 ReplyProjection 与统一事件出口。
4. backend：改造 CompactManager，全面改用 CustomEvent。
5. desktop：改 Event 协议解析、compact Msg 历史映射和 CompactBubble upsert。
6. 停止 Gateway，删除测试 sessions，启动 Gateway 与 Desktop 做端到端验证。
7. 运行 core、backend、desktop 的定向测试与构建。

## 12. 非目标

- 不让所有 `CustomEvent` 自动入库。
- 不保留旧 `state.summary` 兼容层。
- 不创建独立 `timeline` / `session_events` 数据结构。
- 不改变普通 assistant / user 的 `role` 语义。
