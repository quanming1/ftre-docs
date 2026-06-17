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
    data: dict[str, Any]        # 载荷
    metadata: dict[str, Any]    # 附加元数据
    timestamp: float  # 创建时间戳
```

## 字段说明

| 字段 | 类型 | 谁填充 | 说明 |
|------|------|-------|------|
| `id` | string | 自动 | 16 位 hex UUID，创建时自动生成 |
| `type` | string | Channel / AgentLoop / Tool | `"user_input"` / `"agent_event"` / `"global_event"` |
| `from_channel` | string | Channel / AgentLoop / Tool | 来源 Channel ID（`"ws"`, `"subagent"`, `"cron"` 等） |
| `from_session` | string | Channel / AgentLoop / Tool | 来源 Session ID |
| `to_channel` | string | Channel / AgentLoop / Tool | 目标 Channel ID；普通 `Channel.receive()` inbound 通常等于 `from_channel`，跨通道投递或全局广播时可能不同；`"*"` 表示全局广播 |
| `to_session` | string | Channel / AgentLoop / Tool | 目标 Session ID；普通 `Channel.receive()` inbound 通常等于 `from_session`，跨会话投递或全局广播时可能不同；`"*"` 表示全局广播 |
| `data` | dict | Channel / AgentLoop / Tool | 原始 payload |
| `metadata` | dict | Channel / AgentLoop | 附加信息（如 `frame_id`）。Channel 构造 inbound 时设置；AgentLoop echo 时透传 `inbound.metadata` |
| `timestamp` | float | 自动 | `time.time()` |

## type 取值

| type | 产生于 | 消费于 | data 内容 |
|------|-------|-------|----------|
| `"user_input"` | `Channel.receive()` / `CronScheduler._tick()` | `AgentLoop._consume()` → `_dispatch()` | 用户消息（content, session_id, attachments） |
| `"agent_event"` | `AgentLoop._run_async()` / `CompactHandler._notify()` / `send_message._do_notify()` | `ChannelManager._dispatch_loop()` | `{type: "<event-type>", data: {...}}`；其中既包括 Agent 运行事件（含 `done` 失败事件），也包括 `user_input` echo、`CompactHandler` 压缩事件与 `external_message` |
| `"global_event"` | `AgentLoop` 等 | `ChannelManager._dispatch_loop()` | 全局广播事件 `{type: "<event-type>", data: {...}}`，`to_channel` / `to_session` 固定为 `"*"` |

> 注意：`type="cancel"` 的 BusMessage 已不再使用。前端发送的 `type: "cancel"` 帧在 `ws_channel._on_message` 中被转换为 `content="/cancel"` 的 `user_input`，走 `/cancel` 系统级指令路径。

### data 内容（按 type）

**user_input**：
```json
{
  "content": "帮我写一个函数",
  "session_id": "ws::sess_xxx",
  "attachments": [...]
}
```

**agent_event**：
```json
{
  "type": "assistant_message",
  "data": { "content": "你好，我是" }
}
```

`agent_event.data.type` 通常为 Agent 事件类型；此外还可能是 AgentLoop echo 的 `user_input`、`CompactHandler` 产生的 `context_compact_start / context_compact_done / context_compact_enabled / context_compact_failed`，或 `send_message(kind="notify")` 产生的 `external_message`（data 内层含 `content`、`from_channel`、`from_session` 字段）。

## 来源

BusMessage 的主要构造入口：

| 构造入口 | 场景 |
|---------|------|
| `Channel.receive()` | WebSocket / Subagent / `send_message(kind="invoke")` 等入口投递 `user_input`；所有入站消息统一走 `kind="user_input"`（前端 cancel 帧在 ws_channel 层已转为 `/cancel` user_input） |
| `CronScheduler._tick()` | 直接构造 BusMessage（`from_channel=self.default_channel`，默认 `"cron"`）并调用 `bus.publish_inbound()` 投递 `user_input`，不经过 `Channel.receive()` |
| `AgentLoop._run_async()` | 构造 `agent_event`，包括 `user_input` echo 和 Agent 运行事件；`agent.run()` 正常 yield 出来的 Agent 事件中，`assistant_message_complete` / `reasoning_complete` / `tool_call` / `tool_result` / `user_message` / `usage_update` / `error` / `done` 会按 `_PERSISTENT_CLASSES` 白名单写入 DB（`assistant_message`、`reasoning`、`tool_call_streaming` 流式增量不持久化；`tool_cancel_requested` / `tool_cancelled` 无对应事件类，不产出也不持久化）。`_run_async()` 在主事件循环内直接 await 执行，不需要 `run_in_executor` 或 `asyncio.run()` |
| `AgentLoop._publish_session_status_async()` | 构造 `global_event(session_status)`，直接 `await bus.publish_outbound()` |
| `AgentLoop._cmd_compact()` | `/compact` 指令内部构造 `global_event(session_status)`（running / idle），直接 `await self._publish_session_status_async()` |
| `send_message._do_notify()` | 构造 `agent_event(external_message)` |
| `CompactHandler._notify()` | 构造 `agent_event` 通知前端；当前 `_notify()` 为全异步方法，直接 `await self.bus.publish_outbound(msg)`，不需要 `run_coroutine_threadsafe` 桥接 |

## 消费

- **inbound**（`type: "user_input"`）→ `AgentLoop._consume()` → `create_task(_dispatch(data))` 并发消费
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
AgentLoop._publish_session_status_async()
  │  BusMessage(type="global_event", from_channel="*", from_session="*",
  │             to_channel="*", to_session="*",
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
- 每个 Channel 的 `send()` 自行决定 `to_session == "*"` 时如何扇出。`ws_channel` 遍历全部连接；`subagent` / `cron` 是静默 channel，`send()` 本就 `return`，天然忽略。但 `ChannelManager._dispatch_loop()` 在 cron channel 的 outbound 分发后会将同一条消息镜像交给 ws channel（`MIRROR_TO_WS_CHANNELS = {"cron"}`）。镜像不是全局广播：`ws_channel.send()` 对普通 session 消息仍按 `to_session` 查 attach 连接，因此只有已 attach 该 cron session 的前端连接会收到；未 attach 时不会收到。注：镜像仅对 `to_channel` 为具体 Channel（非 `"*"`）的 outbound 生效；全局广播（`to_channel="*"`）时 ws_channel 已通过广播直接收到，无需镜像。

### 广播事件子类型

广播消息使用顶层 `type: "global_event"`（与 per-session 的 `agent_event` 区分），靠 `data.type` 区分具体事件：

| data.type | 说明 | 触发点 |
|-----------|------|--------|
| `session_status` | session 运行态变化 | `AgentLoop`（普通 Agent 执行由 `_run_async()` 在 `_active_agents` 增删处发出；`/compact` 指令由 `_cmd_compact()` 手动发出） |

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
| `status` | string | `"running"`（Agent 或指令开始执行）/ `"idle"`（执行结束） |

**Agent 执行路径的一致性**：在普通 Agent 执行路径（`_run_async()`）中，`running` 在 `_active_agents[sid] = agent` 之后立即发，`idle` 在 `finally` 中 `pop` 之后发，广播信号与后端 `_active_agents` 的真实运行态由同一段代码守护，不会漂移。`/compact` 指令路径不创建 `_active_agents`，由 `_cmd_compact()` 手动发送 `running` / `idle`，用于驱动前端 loading 状态。

**初始快照**：广播只负责**增量**。新连接 / 刷新的前端，应通过 HTTP `GET /api/sessions` 获取普通 Agent 执行态的初始快照；该接口的 `running` 字段只表示 session 当前是否存在于 `AgentLoop._active_agents` 中，不包含 `/compact` 等命令态。`/compact` 的 busy 状态仅通过实时 `session_status` 广播表达，后端不会在连接建立时补发这类瞬时命令态快照。

> **注意**：后端 global_event 基础设施已完整实现；前端当前会消费 `session_status`，一方面直接更新对应 chat bucket 的 `isBusy` / `error` / `retryState`，另一方面把它作为触发信号调用 `useSession.loadAllSessions()`。但刷新会话列表得到的 HTTP `running` 字段只覆盖普通 ReActAgent 执行态，不能恢复 `/compact` 等不创建 `_active_agents` 的命令态。

**并发丢弃不发事件**：`AgentLoop` 的并发防御（同 session 已运行时静默丢弃新 `user_input`）不改变运行态，因此不发 `session_status`。

## metadata 字段

### 上行（客户端设置 + ws_channel 注入）

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `model` | string | 前端模型选择 UI | 当前选中的 LLM 模型（如 `"gpt-4o"`）。**注：前端发送，后端当前未使用（模型从配置文件加载）** |
| `provider` | string | 前端模型选择 UI | 当前选中的 Provider 名称（如 `"openai"`）。**注：前端发送，后端当前未使用（Provider 从配置文件加载）** |
| `agent_id` | string | 前端 | Agent ID，默认 `"code_agent"`。**注：前端发送，后端当前未使用** |
| `session_id` | string | 前端 | 当前 session ID。**注：前端发送，后端从 `data.session_id` 读取，`metadata.session_id` 当前未使用** |
| `frame_id` | string | `ws_channel._on_message()` | 由 ws channel 从上行帧 `id` 字段自动注入到 metadata（非客户端主动设置） |

### 下行（后端填充）

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `channel_id` | string | `ws_channel.send()` | 目标 Channel ID，即 `msg.to_channel`；普通 ws 消息为 `"ws"`，`global_event` 为 `"*"` |
| `session_id` | string | `ws_channel.send()` | 目标 Session ID，即 `msg.to_session`；普通 session 消息为具体 session_id，`global_event` 为 `"*"` |
| `frame_id` | string | 上行 metadata 透传（AgentLoop echo） | 客户端上行帧 `id`，经 AgentLoop echo 透传回前端用于占位去重 |