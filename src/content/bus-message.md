# Bus 消息协议

Bus 消息是 ftre 后端内部的消息格式，Channel 层产生 inbound 消息经 EventBus 投递到 AgentLoop 消费；AgentLoop 产生 outbound 事件经 EventBus 由 ChannelManager 分发到各 Channel。

## BusMessage 数据结构

```python
@dataclass
class BusMessage:
    id: str           # 16 位 hex UUID，自动生成
    type: str         # 消息类型
    from_channel: str # 来源 Channel ID
    from_session: str # 来源 Session ID
    to_channel: str   # 目标 Channel ID
    to_session: str   # 目标 Session ID
    data: dict        # 载荷
    metadata: dict    # 附加元数据
    timestamp: float  # 创建时间戳
```

## 字段说明

| 字段 | 类型 | 谁填充 | 说明 |
|------|------|-------|------|
| `id` | string | 自动 | 16 位 hex UUID，创建时自动生成 |
| `type` | string | Channel | `"user_input"` / `"cancel"` / `"agent_event"` |
| `from_channel` | string | Channel | 来源 Channel ID（`"ws"`, `"subagent"` 等） |
| `from_session` | string | Channel | 来源 Session ID |
| `to_channel` | string | Channel | 目标 Channel ID（与 from_channel 相同） |
| `to_session` | string | Channel | 目标 Session ID（与 from_session 相同） |
| `data` | dict | Channel / AgentLoop | 原始 payload |
| `metadata` | dict | Channel | 附加信息（如 `frame_id`） |
| `timestamp` | float | 自动 | `time.time()` |

## type 取值

| type | 产生于 | 消费于 | data 内容 |
|------|-------|-------|----------|
| `"user_input"` | `Channel.receive()` | `AgentLoop._consume()` | 用户消息（content, session_id, attachments） |
| `"cancel"` | `Channel.receive()` | `AgentLoop._consume()` | `{ session_id }` |
| `"agent_event"` | `AgentLoop._run()` | `ChannelManager._dispatch_loop()` | `{type: "<event-type>", data: {...}}` |

### data 内容（按 type）

**user_input**：
```json
{
  "content": "帮我写一个函数",
  "session_id": "ws::sess_xxx",
  "attachments": [...]
}
```

**cancel**：
```json
{
  "session_id": "ws::sess_xxx"
}
```

**agent_event**：
```json
{
  "type": "message",
  "data": { "content": "你好，我是" }
}
```

`agent_event.data.type` 的取值见 [WebSocket 协议](/docs/ws-protocol) 事件类型列表。

## 来源

BusMessage 由以下 Channel 的 `receive()` 方法构造：

| Channel | channel_id | 场景 |
|---------|-----------|------|
| `WebSocketChannel` | `"ws"` | 客户端发送 `user_input` / `cancel` 帧时 |
| `SubagentChannel` | `"subagent"` | `task` 工具派发子任务时 |
| `TestChannel` | `"test"` | 测试/调试用 |

## 消费

- **inbound**（`type: "user_input"` / `"cancel"`）→ `AgentLoop._consume()` 消费
- **outbound**（`type: "agent_event"`）→ `ChannelManager._dispatch_loop()` 按 `to_channel` 分发到对应 Channel

## metadata 字段

### 上行（客户端设置）

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `model` | string | `ModelSelector` | 当前选中的 LLM 模型（如 `"gpt-4o"`） |
| `provider` | string | `ModelSelector` | 当前选中的 Provider 名称（如 `"openai"`） |
| `agent_id` | string | 前端 | Agent ID，默认 `"code_agent"` |
| `session_id` | string | 前端 | 当前 session ID |

### 下行（后端填充）

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `channel_id` | string | `ws_channel.send()` | 来源 Channel ID（`"ws"`） |
| `session_id` | string | `ws_channel.send()` | 所属 session ID |
| `frame_id` | string | `ws_channel._on_message()` | 客户端上行帧 `id`，echo 回传给前端去重 |
