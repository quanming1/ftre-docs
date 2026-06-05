# Bus 消息协议

## 概述

EventBus 是 ftre 后端内部的消息中枢，解耦 Channel 层和 Agent 层。所有消息通过两个全局 `asyncio.Queue` 流转：

```
Channel                          AgentLoop
  │                                  │
  ├─ receive()                       │
  │   └─ BusMessage                  │
  │       └─ publish_inbound()       │
  │           └─ inbound_queue ──────→│ subscribe_inbound()
  │                                  │   └─ _consume()
  │                                  │       ├─ user_input → _run()
  │                                  │       └─ cancel → cancel_nowait()
  │                                  │
  │  ←─ ChannelManager ◄─────────────│ publish_outbound()
  │          └─ dispatch to_channel  │   └─ outbound_queue
  │                                  │
```

## BusMessage

### 数据结构

```python
@dataclass
class BusMessage:
    id: str              # 16 位 hex UUID，自动生成
    type: str            # 消息类型
    from_channel: str    # 来源 Channel ID
    from_session: str    # 来源 Session ID
    to_channel: str      # 目标 Channel ID
    to_session: str      # 目标 Session ID
    data: dict           # 载荷
    metadata: dict       # 附加元数据
    timestamp: float     # 创建时间戳
```

### 字段说明

| 字段 | 类型 | 生成时 | 说明 |
|------|------|-------|------|
| `id` | string | 自动 `uuid.hex[:16]` | 消息唯一 ID |
| `type` | string | 调用方指定 | `"user_input"` / `"cancel"` / `"agent_event"` |
| `from_channel` | string | Channel.receive() | 来源 Channel（如 `"ws"`, `"subagent"`） |
| `from_session` | string | Channel.receive() | 来源 Session ID |
| `to_channel` | string | Channel.receive() | 目标 Channel（与 from 相同） |
| `to_session` | string | Channel.receive() | 目标 Session ID（与 from 相同） |
| `data` | dict | Channel.receive() | 原始 payload（如 user_input 的 content/attachments） |
| `metadata` | dict | Channel.receive() | 附加信息（如 `frame_id`） |
| `timestamp` | float | 自动 `time.time()` | 创建时间 |

### type 取值

| type | 流向 | 说明 |
|------|------|------|
| `"user_input"` | Channel → Bus → AgentLoop | 用户消息 |
| `"cancel"` | Channel → Bus → AgentLoop | 取消指令 |
| `"agent_event"` | AgentLoop → Bus → Channel | Agent 产生的所有事件 |

## EventBus

### 核心机制

```python
class EventBus:
    _inbound_queue: asyncio.Queue   # Channel → AgentLoop
    _outbound_queue: asyncio.Queue  # AgentLoop → Channel
    _inbound_middlewares:  []       # inbound 中间件链
    _outbound_middlewares: []       # outbound 中间件链
```

### 发布

```python
# Channel 层调用
await bus.publish_inbound(msg: BusMessage)

# Agent 层调用
await bus.publish_outbound(msg: BusMessage)
```

发布前会经过中间件链。中间件返回 `None` 则**丢弃消息不投递**。

### 订阅

```python
# AgentLoop 消费
async for msg in bus.subscribe_inbound():
    ...

# ChannelManager 消费
async for msg in bus.subscribe_outbound():
    ...
```

两个订阅方法都是**无限异步生成器**，阻塞等待队列中的下一条消息。

### 中间件

```python
Middleware = Callable[[BusMessage], BusMessage | None]

# 注册
bus.use_inbound(my_middleware)
bus.use_outbound(my_middleware)
```

中间件按注册顺序执行。返回值：
- `BusMessage`：继续传递（可修改 msg）
- `None`：丢弃此消息

## Channel 层

### Channel.receive()

所有 Channel 子类通过 `receive()` 统一构造 BusMessage 并投递到 inbound：

```python
async def receive(self, session_id, data, metadata=None, *, kind="user_input"):
    msg = BusMessage(
        type=kind,                      # "user_input" / "cancel"
        from_channel=self.channel_id,   # "ws" / "subagent" / ...
        from_session=session_id,
        to_channel=self.channel_id,
        to_session=session_id,
        data=data,
        metadata=metadata or {},
    )
    await self.bus.publish_inbound(msg)
```

### Channel.send()

Channel 子类实现 `send()` 处理 outbound 消息：

| Channel | send() 行为 |
|---------|------------|
| `WebSocketChannel` | 将 BusMessage 封装为 WS 帧 `{id, type:"agent_event", data, metadata}`，推送给所有 attach 该 session 的 ws 连接 |
| `SubagentChannel` | 静默丢弃（subagent 无外部观察者，事件已由 AgentLoop 持久化） |

## ChannelManager

```python
class ChannelManager:
    _channels: dict[str, Channel]       # channel_id → Channel
    _dispatch_task: asyncio.Task         # 后台分发协程
```

### 分发循环

```python
async def _dispatch_loop(self):
    async for msg in self.bus.subscribe_outbound():
        channel = self._channels.get(msg.to_channel)
        if channel:
            await channel.send(msg)
```

按 `msg.to_channel` 查找对应 Channel 并调用 `send()`。找不到 Channel 时打印 warning。

## AgentLoop 消费

```python
async def _consume(self):
    async for msg in self.bus.subscribe_inbound():
        if msg.type == "user_input":
            # 在线程池中执行 _run()
            asyncio.ensure_future(
                loop.run_in_executor(None, self._run, msg)
            )
        elif msg.type == "cancel":
            # 中断对应 session 的 Agent
            agent = self._active_agents.get(sid)
            if agent: agent.cancel_nowait()
```

### user_input 处理流程

1. 提取 `content` 和 `attachments`
2. 校验 session 存在性 + channel_id 匹配
3. 并发防御（同一 session 已有 Agent 在跑则丢弃）
4. 加载历史消息 + hook 处理 → 构建 LLM 输入
5. 创建 ReActAgent 实例
6. 持久化 `USER_INPUT` 到 SQLite
7. **Echo**：将 `inbound.data` 包装为 `agent_event` + `data.type = "user_input"` 发布到 outbound
8. 驱动 Agent 执行，每个 event 持久化 + 发布到 outbound
9. 清理 `_active_agents`

### agent_event 的 outbound 发布

Agent 产生的每个事件通过 `publish_outbound` 投递：

```python
out = BusMessage(
    type="agent_event",
    from_channel=inbound.from_channel,
    to_channel=inbound.to_channel,
    from_session=inbound.from_session,
    to_session=inbound.to_session,
    data=event,  # {"type": "message", "data": {...}}
)
await bus.publish_outbound(out)
```

## 消息生命周期

### user_input 全程

```
1. WS Client 发送 JSON 帧
2. ws_channel._on_message() → 解析帧 → 校验
3. Channel.receive() → BusMessage(type="user_input")
4. bus.publish_inbound() → inbound_queue
5. AgentLoop._consume() → _run() [线程池]
6.   保存 USER_INPUT 到 SQLite
7.   echo user_input → publish_outbound → ChannelManager → ws_channel.send() → 推给前端
8.   agent.run(messages) → 逐条 event
9.   每条 event → publish_outbound → ChannelManager → ws_channel.send() → 推给前端
10.  _active_agents.pop()
```

### cancel 全程

```
1. WS Client 发送 cancel 帧
2. ws_channel._on_message() → receive(kind="cancel")
3. BusMessage(type="cancel") → bus.publish_inbound()
4. AgentLoop._consume() → agent.cancel_nowait()
```

## Channel 注册

```python
# 启动时
mgr = ChannelManager(bus)
ws_channel = WebSocketChannel(bus)
mgr.register(ws_channel)
mgr.register(SubagentChannel(bus))
await mgr.start()   # 启动所有 Channel + 分发循环
```
