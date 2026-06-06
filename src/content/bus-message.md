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
| `type` | string | Channel / AgentLoop | `"user_input"` / `"cancel"` / `"agent_event"` / `"global_event"` |
| `from_channel` | string | Channel | 来源 Channel ID（`"ws"`, `"subagent"` 等） |
| `from_session` | string | Channel | 来源 Session ID |
| `to_channel` | string | Channel / AgentLoop / Tool | 目标 Channel ID；普通 `Channel.receive()` inbound 通常等于 `from_channel`，跨通道投递或全局广播时可能不同；`"*"` 表示全局广播 |
| `to_session` | string | Channel / AgentLoop / Tool | 目标 Session ID；普通 `Channel.receive()` inbound 通常等于 `from_session`，跨会话投递或全局广播时可能不同；`"*"` 表示全局广播 |
| `data` | dict | Channel / AgentLoop | 原始 payload |
| `metadata` | dict | Channel | 附加信息（如 `frame_id`） |
| `timestamp` | float | 自动 | `time.time()` |

## type 取值

| type | 产生于 | 消费于 | data 内容 |
|------|-------|-------|----------|
| `"user_input"` | `Channel.receive()` | `AgentLoop._consume()` | 用户消息（content, session_id, attachments） |
| `"cancel"` | `Channel.receive()` | `AgentLoop._consume()` | `{ session_id }` |
| `"agent_event"` | `AgentLoop._run()` / `send_message._do_notify()` | `ChannelManager._dispatch_loop()` | `{type: "<event-type>", data: {...}}` |
| `"global_event"` | `AgentLoop` 等 | `ChannelManager._dispatch_loop()` | 全局广播事件 `{type: "<event-type>", data: {...}}`，`to_channel` / `to_session` 固定为 `"*"` |

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

`agent_event.data.type` 通常为 Agent 事件类型；此外还可能是 AgentLoop echo 的 `user_input`，或 `send_message(kind="notify")` 产生的 `external_message`。

## 来源

BusMessage 的主要构造入口：

| 构造入口 | 场景 |
|---------|------|
| `Channel.receive()` | WebSocket / Subagent / `send_message(kind="invoke")` 等入口投递 `user_input` / `cancel` |
| `CronScheduler._tick()` | 构造 cron channel 的 `user_input` |
| `AgentLoop._run()` | 构造 `agent_event`，包括 `user_input` echo 和 Agent 运行事件 |
| `AgentLoop._publish_session_status()` | 构造 `global_event(session_status)` |
| `send_message._do_notify()` | 构造 `agent_event(external_message)` |

## 消费

- **inbound**（`type: "user_input"` / `"cancel"`）→ `AgentLoop._consume()` 消费
- **outbound**（`type: "agent_event"` / `"global_event"`）→ `ChannelManager._dispatch_loop()` 分发；`global_event` 在 `to_channel == "*"` 时广播给所有 Channel

## 全局广播消息（global event）

某些 outbound 事件的消费者不是单一 session，而是**跨 session 的全局视图**（典型：会话列表需要知道"哪些 session 正在运行"）。这类视图通常没有 `attach` 对应的 session，无法用点对点的 `to_channel` + `to_session` 寻址送达。

为此，BusMessage 约定一组**硬编码的全局标记值**（定义在 `bus/message.py`）：

| 常量 | 值 | 含义 |
|------|-----|------|
| `GLOBAL_CHANNEL` | `"*"` | `to_channel` 设为此值 → 分发给**所有**已注册 Channel |
| `GLOBAL_SESSION` | `"*"` | `to_session` 设为此值 → Channel 扇出给它管理的**所有**连接 |

**不需要改 `BusMessage` 结构**，全局广播复用现有字段，只是把 `to_channel` / `to_session` 设为 `"*"`。

### 分发路径

```
AgentLoop._publish_session_status()
  │  BusMessage(type="global_event", to_channel="*", to_session="*",
  │             data={type:"session_status", data:{...}})
  ▼
ChannelManager._dispatch_loop()
  │  to_channel == GLOBAL_CHANNEL("*")  →  遍历所有 Channel，逐个 send()
  ▼
WebSocketChannel.send()
  │  to_session == GLOBAL_SESSION("*")  →  遍历所有活跃 ws 连接（无视 attach）扇出
  │  其它静默 Channel（subagent / cron）的 send() 直接忽略
  ▼
所有前端连接收到下行帧
```

两层判断各司其职：
- `ChannelManager` 只认 `to_channel`，`"*"` 表示"扇给所有 Channel"。
- 每个 Channel 的 `send()` 自行决定 `to_session == "*"` 时如何扇出。`ws_channel` 遍历全部连接；`subagent` / `cron` 是静默 channel，`send()` 本就 `return`，天然忽略。

### 广播事件子类型

广播消息使用顶层 `type: "global_event"`（与 per-session 的 `agent_event` 区分），靠 `data.type` 区分具体事件：

| data.type | 说明 | 触发点 |
|-----------|------|--------|
| `session_status` | session 运行态变化 | `AgentLoop` 在 `_active_agents` 增删的同一处发出 |

**session_status 的 data**：

```json
{
  "type": "session_status",
  "data": {
    "session_id": "ws::sess_xxx",
    "status": "running"
  }
}
```

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `session_id` | string | 状态发生变化的 session（注意在 data 内，因为帧本身不绑定单一 session） |
| `status` | string | `"running"`（Agent 进入活跃态）/ `"idle"`（Agent 退出） |

**强一致保证**：`running` 在 `_active_agents[sid] = agent` 之后立即发，`idle` 在 `finally` 中 `pop` 之后发。广播信号与后端 `_active_agents` 的真实运行态由同一段代码守护，不会漂移。

**初始快照**：广播只负责**增量**。新连接 / 刷新的前端，应通过 HTTP `GET /api/sessions` 获取当前各 session 的运行态作为初始快照，之后靠 `session_status` 广播保持同步。后端不在连接建立时补发快照，避免 `ws_channel` 反向依赖 `AgentLoop`。

> **注意**：后端 global_event 基础设施已完整实现；前端 `chat.ts` 当前已消费 `session_status`，但只是把它作为触发信号调用 `useSession.loadAllSessions()`，由 HTTP `GET /api/sessions` 重新获取会话列表运行态，并非直接维护本地增量状态表。

**并发丢弃不发事件**：`AgentLoop` 的并发防御（同 session 已运行时静默丢弃新 `user_input`）不改变运行态，因此不发 `session_status`。

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
| `channel_id` | string | `ws_channel.send()` | 目标 Channel ID，即 `msg.to_channel`；普通 ws 消息为 `"ws"`，`global_event` 为 `"*"` |
| `session_id` | string | `ws_channel.send()` | 目标 Session ID，即 `msg.to_session`；普通 session 消息为具体 session_id，`global_event` 为 `"*"` |
| `frame_id` | string | `ws_channel._on_message()` | 客户端上行帧 `id`，echo 回传给前端去重 |
