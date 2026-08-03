# FTRE：从 AgentScope Event/Msg 语义到 SessionProjection 的改造交接

> 更新时间：2026-07-30  
> 用途：交给后续 Agent 继续审计、修复和演进 FTRE 的会话、事件、消息、压缩与客户端恢复机制。  
> 说明：本文记录的是本轮架构演进的背景、理念和当前实现。旧设计文档只能作为历史参考，接手时应以当前代码和本文为准。

## 1. 一句话结论

FTRE 已从“把 AgentScope 流式 Event 当作历史记录存储”改造成：

```text
AgentScope/core Event = 一次执行中的过程信号
Msg                   = 可恢复、可渲染、可送入 LLM 的会话事实
SessionProjection     = Event → Msg / session runtime state 的唯一投影层
```

历史恢复依赖 `state.json.messages` 中的 Msg；正在运行的回复和正在压缩等临时状态，由 `SessionProjection` 保存在内存中，在 WebSocket attach 时发送最新快照。`TEXT_BLOCK_DELTA` 等高频 Event 不再作为历史逐条入库。

## 2. 原始问题

最初 FTRE 的 `messages` 存储实际更接近 Event 表：

- `REPLY_START`
- `MODEL_CALL_START`
- `TEXT_BLOCK_START`
- 大量 `TEXT_BLOCK_DELTA`
- `TOOL_CALL_*`
- `TOOL_RESULT_*`
- `REPLY_END`

这导致了几个根本问题：

1. 一条 assistant 回复会膨胀为大量数据库记录。
2. `TEXT_BLOCK_DELTA` 每个 token/片段都入库，磁盘 I/O 和历史体积失控。
3. 客户端恢复历史必须重新回放 Event，历史语义和实时协议耦合。
4. Event 协议一变，旧历史也要兼容。
5. 无法清楚回答“messages 存的是 Event 还是 Message”。
6. 长任务只有结束时才有完整 Msg，一旦切 session、刷新或 Gateway 异常，客户端恢复困难。
7. HTTP 历史与 WS replay 可能重复，客户端缺少稳定的 Msg 身份和版本语义。

当前项目仍处于测试阶段，用户明确允许删除旧 session 数据，因此本次改造不承担旧协议、旧数据库和旧 `state.json` 的兼容成本。

## 3. 我们从 AgentScope / QwenPaw 得到了什么

### 3.1 AgentScope 的核心语义

AgentScope 把两个概念分开：

- `Event`：运行过程中的增量通知，例如文本块开始、文本增量、工具调用开始、工具结果结束。
- `Msg`：带 `role + content blocks` 的完整语义消息，内容块可以是 text、thinking、tool call、tool result 等。

Event 可以不断修改同一个 Msg，但 Event 本身不是对话历史的最终事实。

### 3.2 QwenPaw 的实际做法

参考代码位于：

- `E:\QwenPaw\src\qwenpaw\agents\react_agent.py`
- `E:\QwenPaw\src\qwenpaw\app\task_tracker.py`

QwenPaw 使用 AgentScope 2.x，并把 Agent 的可恢复状态序列化：

```python
def state_dict(self) -> dict:
    return {"state": self.state.model_dump(mode="json")}
```

恢复时：

```python
self.state = AgentState.model_validate(raw)
```

也就是说，它持久化的是 `AgentState`，其中真正的上下文是 Msg/内容块语义，而不是把每个流式 Delta 当成永久历史。

与此同时，QwenPaw 的 `TaskTracker` 为仍在运行的任务保留内存 SSE buffer：

```text
持久化：AgentState / Msg context
实时恢复：当前 Run 的 SSE event buffer
任务结束：清理 event buffer
```

### 3.3 FTRE 没有照抄 QwenPaw

QwenPaw 的状态主要由 Agent 自身持有；FTRE 的 Gateway 是多 session、长驻、有独立 Desktop 客户端和 WebSocket attach 语义的系统，因此不能把持久化职责继续塞进 Agent。

FTRE 采用了相同的“Event 与 Msg 分离”理念，但把状态所有权上移到 Gateway：

```text
Agent/core 只产生 Event
        ↓
Gateway SessionProjection 聚合
        ↓
state.json.messages 保存 Msg
        ↓
HTTP / Desktop / LLM context 共同消费 Msg
```

另外，QwenPaw 的运行时恢复可以重放一段 SSE buffer；FTRE 不希望为长任务保留越来越多的原始 Event，因此进一步把“事件队列”压缩成“当前 Msg 的最新投影快照”。

## 4. FTRE 的最终设计原则

### 4.1 Event 是过程，不是历史

Event 用于：

- WebSocket 实时渲染；
- 更新运行中的 Msg；
- 表达 Turn、compact 等短期生命周期；
- trace/debug。

Event 默认不进入 `state.json.messages`。

### 4.2 Msg 是事实

Msg 用于：

- `state.json` 持久化；
- Desktop 历史展示；
- HTTP 分页；
- Gateway 重启后的恢复；
- 转换成 OpenAI messages 发送给 LLM；
- token usage 锚定。

### 4.3 Projection 是唯一状态写入边界

任何会改变 session 可恢复状态的 Event，都先进入 `SessionProjection.apply()`。

统一顺序必须是：

```text
接收 Event
  → Projection 更新内存 Msg/session runtime state
  → 必要时写 state.json
  → 写入成功后广播 WebSocket
```

不能先向客户端说“完成”，再异步落盘。

### 4.4 不保存原始 Event 日志来恢复聊天

`state.json` 不是 event sourcing 日志。它保存当前 transcript 的 Msg 快照。

如果以后需要审计完整 Event，可使用独立 trace 系统；不要再次污染 `messages`。

## 5. 当前整体数据流

### 5.1 用户消息

core 已增加 `UserMessageEvent`，让用户输入和 assistant Reply 使用同一个 Projection 入口。

```text
Desktop 发送 user_message
  → TurnExecutor 构造 UserMessageEvent
  → AgentLoop.emit_session_event()
  → SessionProjection.apply()
  → 创建 UserMsg(name=default)
  → upsert state.json
  → 广播给客户端
```

用户消息必须先落盘，再进入后续 compact / build / agent run，这保证：

- UserMsg 总在对应 AssistantMsg 前面；
- 构建 LLM context 时不需要再 append 一次当前输入；
- 避免同一用户输入被发给 LLM 两次。

### 5.2 Assistant Reply

```text
REPLY_START
  → 创建 id=reply_id 的空 AssistantMsg
  → 立即写 state.json
  → 注册为 active Reply

TEXT_BLOCK_START / DELTA / END
THINKING_BLOCK_*
TOOL_CALL_*
TOOL_RESULT_*
MODEL_CALL_*
  → Msg.append_event(event)
  → 更新内存中的同一条 AssistantMsg
  → 在语义边界 checkpoint 完整 Msg

REPLY_END
  → 写 finished_at / finished_reason / token / error
  → 最终 update state.json
  → 从 active Reply 集合移除
```

关键点：

- `Event.reply_id` 就是对应 `AssistantMsg.id`。
- `TextBlock.id` 是 Msg 内部 content block 的 id，不是 Msg id。
- 同一个 Reply 的所有 Event 都投影到同一条 Msg。
- `TEXT_BLOCK_DELTA` 不逐条入库；它只修改内存 Msg。

### 5.3 Checkpoint

当前只保留语义边界立即 checkpoint，不按每个 Delta 写盘。

当前集合位于 `session_projection.py`：

```python
IMMEDIATE_CHECKPOINT_TYPES = frozenset({
    "REPLY_START",
    "TEXT_BLOCK_END",
    "THINKING_BLOCK_END",
    "DATA_BLOCK_END",
    "TOOL_CALL_START",
    "TOOL_CALL_END",
    "TOOL_RESULT_END",
    "MODEL_CALL_END",
})
```

含义不是“保存这些 Event”，而是：

> 收到这些 Event 后，把截至此刻聚合出的完整 Msg 快照写入 `state.json`。

因此磁盘中仍只有一条 AssistantMsg，只是它会被多次更新。

## 6. SessionProjection 的职责

代码：

- `E:\ftre\src\ftre\agent\session_projection.py`

它由早期的 `ActiveReplyRegistry` / `ReplyProjection` 演进而来。改名的原因是：它现在不只处理带 `reply_id` 的 Reply Event，也处理 session 级 CustomEvent。

### 6.1 内部状态

```text
_replies:
  session_id
    → reply_id
      → ReplyState(message, revision, dirty)

_active_session_events:
  session_id
    → CompactEventName
      → CustomEvent
```

### 6.2 ReplyState

- `message`：从 Event 聚合出的完整 AssistantMsg，是当前事实来源。
- `revision`：每处理一个 Reply Event 单调递增，防止客户端旧 snapshot 覆盖新状态。
- `dirty`：内存 Msg 是否比最近磁盘 checkpoint 更新。

`revision` 不放进持久化 Msg；它是运行中快照协议的版本。

### 6.3 ProjectionResult

`apply()` 不再只返回 `Msg | None`，而返回：

- `persisted_messages`：本次新增/更新的持久化 Msg；
- `completed_message`：收到 `REPLY_END` 后完成的 AssistantMsg。

这样调用方不需要重新猜测某种 Event 是否已落盘。

### 6.4 session 级 CustomEvent

目前 compact 事件使用：

```text
CUSTOM / context_compact_start
CUSTOM / context_compact_done
CUSTOM / context_compact_failed
```

稳定枚举位于：

- `E:\ftre\src\ftre\agent\compact_events.py`

不要在业务代码里散落魔法字符串。

处理行为：

| Event | 内存 | state.json | 客户端 |
| --- | --- | --- | --- |
| `context_compact_start` | 保存为 active session event | 不写 | 实时显示；attach 时重发 |
| `context_compact_done` | 清除 start | 投影为 `user/compact` Msg | 实时完成气泡；刷新后从 Msg 恢复 |
| `context_compact_failed` | 清除 start | 不写 | 实时失败提示 |

并不是所有 CustomEvent 都要入库。`PIPELINE_START`、`TURN_START`、`TURN_END` 等仍主要是实时生命周期信号。

## 7. WebSocket 重连与快照

代码：

- `E:\ftre\src\ftre\channel\ws_channel.py`
- `E:\binn\ftre-desktop\packages\renderer\src\services\websocket-client.ts`
- `E:\binn\ftre-desktop\packages\renderer\src\stores\chat.ts`

attach 时，后端发送：

```json
{
  "type": "reply_snapshot",
  "data": {
    "session_id": "...",
    "replies": [
      {
        "reply_id": "...",
        "revision": 12,
        "message": { "...完整 Msg..." }
      }
    ],
    "events": [
      {
        "type": "CUSTOM",
        "name": "context_compact_start",
        "value": {}
      }
    ]
  }
}
```

恢复职责：

```text
HTTP messages API
  → 已持久化 transcript

WS reply_snapshot.replies
  → 当前仍在运行的 Reply 最新 Msg 快照

WS reply_snapshot.events
  → 当前仍有效的 session 临时状态，例如 compact_start
```

### 7.1 为什么 snapshot 与数据库可能重复

这是正常且几乎必然的：

- `REPLY_START` 已经把空 AssistantMsg 写入磁盘；
- 后续 checkpoint 也会更新这条 Msg；
- active snapshot 表示同一个 Msg 的更新版本。

二者的 `id` 相同，客户端必须 upsert，不能 append。

`revision` 只解决 active snapshot 之间的新旧顺序；Msg id 解决 HTTP 历史与 WS snapshot 的实体去重。

### 7.2 为什么不用回放所有 Event

如果一个任务产生十万条 Delta，重连不应重放十万条 Event。客户端真正需要的是：

> “这条 Reply 到现在已经长成什么样了？”

因此 attach 发送完整 Msg snapshot，而不是过程日志。

## 8. Compact 的语义

### 8.1 compact Msg 不是普通 UI 提示

压缩完成后写入：

```json
{
  "role": "user",
  "name": "compact",
  "content": [
    {
      "type": "text",
      "text": "完整摘要"
    }
  ],
  "metadata": {
    "hide": true,
    "context_compact": {
      "through_message_id": "...",
      "trigger": "manual|auto|idle",
      "tokens_before": 100000,
      "tokens_after": 12000
    }
  }
}
```

它有两重职责：

1. UI 历史中表示“这里发生过一次压缩”；
2. LLM context 中替代它所覆盖的全部早期 Msg。

### 8.2 历史与上下文必须分开

完整 transcript 不删除：

```text
M1 M2 M3 M4 C1 M5 M6 C2 M7
```

Desktop 仍可加载全部历史。

但 `get_context_messages()` 只返回最后一个 compact 摘要和未覆盖 tail：

```text
C2 + M7
```

多次压缩时，上一份 compact 和后续 tail 会被压进新的 compact。旧 Msg 保留作可见历史，但不再进入 LLM。

### 8.3 through_message_id

不能只根据 compact Msg 在数组里的位置裁剪，因为压缩执行期间可能有消息先于 compact Msg 写入。

`through_message_id` 表示摘要实际覆盖到哪条 Msg。当前 `SessionManager.get_context_messages()`：

1. 找最后一条 `name=compact`；
2. 找它的 `through_message_id`；
3. 返回 compact Msg 本身；
4. 再返回 `through_message_id` 之后、且不是该 compact Msg 的 tail。

### 8.4 压缩任务并发

当前 `CompactManager` 为每个 session 保存唯一 `_compact_tasks[session_id]`：

- 同一 session 同时最多一个真正的 `_do_compact` Task；
- 后来的 compact 调用等待同一个 Task；
- `asyncio.shield()` 防止某个等待者取消时把共享压缩一起取消；
- Gateway stop 才统一取消。

当前还采用了一个更简单的输入策略：

> session 正在压缩时，新到达的用户消息在 `PIPELINE_START` 和 UserMsg 入库之前直接丢弃，并打印 warning log。

这避免出现“用户消息已入库，但永远没有后续 Reply”的半条 Turn。后续若要改善 UX，应给客户端明确的拒绝确认，而不是悄悄丢弃。

## 9. Msg.name 规范

core：

- `E:\ftre-agent-core\src\ftre_agent_core\message\_msg.py`

当前约定：

```python
class MsgName(StrEnum):
    DEFAULT = "default"
    COMPACT = "compact"
```

| 场景 | role | name | 其他身份 |
| --- | --- | --- | --- |
| 普通用户消息 | user | default | `metadata.agent_id` |
| 普通助手消息 | assistant | default | `metadata.model` |
| 压缩摘要 | user | compact | `metadata.context_compact` |

原则：

- `role` 表示谁说的；
- `name` 表示消息的特殊语义类别；
- agent id、模型名不能再滥用 `name`；
- 没有特殊语义的消息统一叫 `default`；
- 只有确实需要持久化和转换行为的特殊 Msg，才扩展 `MsgName`。

## 10. Token usage 的当前约定

token 用量放在 AssistantMsg，而不是每个 Event：

```json
{
  "token": {
    "usage": {
      "prompt_tokens": 53027,
      "completion_tokens": 548,
      "total_tokens": 53575
    },
    "last_call_usage": {
      "prompt_tokens": 17919,
      "completion_tokens": 186,
      "total_tokens": 18105
    }
  }
}
```

- `usage`：该 Reply 内多次模型调用的累计用量；
- `last_call_usage`：最后一次 LLM call 的用量，用来估计当前上下文水位；
- 暂时只支持 OpenAI 风格的三个字段，不扩展供应商私有字段。

上下文用量必须对 `get_context_messages()` 计算，不能对完整 transcript 计算，否则 compact 后仍会被早期历史撑大。

## 11. state.json 的定位

每个 session：

```text
C:\Users\蒋全明\.ftre\sessions\<session_id>\state.json
```

session id 已改为文件系统安全的下划线形式，例如：

```text
ws_sess_a5d48c98c5ff
```

因此无需再使用 base64url 目录名。

`state.json.messages` 保存 Msg 快照，不保存 Delta Event。项目不采用 TinyDB；原因是当前需求是一个 session 一个原子 JSON 状态文件，使用 TinyDB并不能解决投影、原子写入和并发语义。

## 12. 重要代码地图

### ftre-agent-core

```text
E:\ftre-agent-core\src\ftre_agent_core\event\_event.py
  ReplyStartEvent / ReplyEndEvent / CustomEvent / UserMessageEvent

E:\ftre-agent-core\src\ftre_agent_core\message\_msg.py
  Msg / UserMsg / AssistantMsg / MsgName / append_event()
```

core 的责任是定义无状态协议和 Event→Msg 内容块聚合能力，不负责 session 文件和 WebSocket。

### FTRE Gateway

```text
E:\ftre\src\ftre\agent\session_projection.py
  Event → Msg/session runtime state

E:\ftre\src\ftre\agent\loop.py
  emit_session_event()：Projection → Bus 的统一出口

E:\ftre\src\ftre\agent\turn_executor.py
  Turn 状态机、UserMessageEvent、关键路径 compact、Agent Event 驱动

E:\ftre\src\ftre\agent\compact_manager.py
  压缩判断、单飞任务、产生 compact CustomEvent

E:\ftre\src\ftre\agent\compact_events.py
  CompactEventName 枚举

E:\ftre\src\ftre\session\manager.py
  Msg CRUD、upsert、完整历史、context 裁剪、token usage

E:\ftre\src\ftre\channel\ws_channel.py
  attach 时发送 reply_snapshot
```

### Desktop

```text
E:\binn\ftre-desktop\packages\renderer\src\services\websocket-client.ts
  reply_snapshot 与 compact CustomEvent 协议

E:\binn\ftre-desktop\packages\renderer\src\stores\chat.ts
  active Reply snapshot、revision、Event→UI 状态

E:\binn\ftre-desktop\packages\renderer\src\stores\session.ts
  HTTP Msg 历史映射；user/compact → CompactBubble

E:\binn\ftre-desktop\packages\renderer\src\features\chat\AssistantMessage.tsx
  Assistant 内容与 Tool UI 渲染
```

## 13. 已明确废弃的做法

后续 Agent 不要重新引入：

- 在 SQL/messages 中逐条保存 `TEXT_BLOCK_DELTA`；
- 用 Event 表回放整个聊天历史；
- `messages` 名为 Message、实际存 Event；
- 把模型名放到 `Msg.name`；
- 同时维护 `state.summary` 和 compact Msg 两套摘要真相；
- CompactManager 直接写 state 或直接拼私有 WebSocket payload；
- 客户端靠“保留旧内存气泡”跨刷新恢复 compact；
- 为测试期旧 session 设计兼容分支；
- 先广播 done，再落盘；
- HTTP 历史和 WS snapshot 直接 append，产生重复 Msg。

## 14. 当前已知问题与待继续审计

### 14.1 LLM 并发超限会长期卡在 Preparing

最近会话：

```text
C:\Users\蒋全明\.ftre\sessions\ws_sess_a5d48c98c5ff\state.json
```

现象：

- UserMsg 已入库；
- REPLY_START 创建了空 AssistantMsg；
- AssistantMsg `content=[]`、`finished_at=null`；
- session 状态仍为 running；
- 日志出现 `Concurrency limit exceeded for account`。

原因是 OpenAI SDK 内部重试与 core 外层最多 6 次重试叠加。客户端在首个内容块到来前只能显示 `Preparing`。

建议：

1. 只保留一层重试策略；
2. 限制总重试时长；
3. 把 retry 进度投影/广播给客户端；
4. 最终失败必须 `finish_open()`，让空 AssistantMsg 获得 error 和终态；
5. 考虑 provider/account 级并发控制，避免 cron 与交互 session 抢额度。

### 14.2 压缩期间丢弃输入缺少客户端确认

当前只打印：

```text
[compact] session=... 正在压缩，丢弃新消息
```

客户端可能以为消息已发出。应增加明确的拒绝 ACK 或在 compacting 状态禁用输入，但这是下一阶段 UX 设计，不要在未确认协议前随意实现。

### 14.3 文档存在旧协议内容

`E:\ftre-docs\src\content\agent-events.md` 等页面仍有旧 SQL/Event 入库描述，不能当作当前实现真相。需要后续系统性更新。

历史计划：

```text
E:\ftre-docs\src\content\superpowers\plans\
2026-07-29-compact-custom-event-projection.md
```

它记录了当时的计划，但其中“暂不改名 SessionProjection”等内容已经过时：当前代码已经正式使用 `SessionProjection`。

## 15. 接手后的建议审计顺序

1. 先读 core 的 `_event.py` 与 `_msg.py`，确认 Event/Msg 协议。
2. 读 `session_projection.py`，画出每类 Event 的状态迁移。
3. 读 `loop.emit_session_event()`，确认所有路径都是“投影后广播”。
4. 搜索所有 `save_message()` / `update_message()` / `upsert_message()` 调用，确认没有绕过 Projection 的会话事实写入。
5. 搜索 `TEXT_BLOCK_DELTA`，确认没有任何持久化 Event 队列。
6. 检查 `ws_channel._send_reply_snapshot()` 与客户端 revision/upsert。
7. 检查 `get_context_messages()` 的多次 compact 和 `through_message_id`。
8. 检查异常、取消、Gateway restart 是否都能终结 open Reply。
9. 检查客户端 ToolResult、error、interrupted Msg 的渲染终态。
10. 最后再处理 LLM retry/Preparing 问题，避免把传输问题误判为 Projection 问题。

## 16. 推荐测试矩阵

### Projection

- `REPLY_START` 立即创建空 Msg；
- 多个 Delta 只更新同一 Msg；
- `TEXT_BLOCK_END` checkpoint；
- `TOOL_RESULT_END` checkpoint 后刷新可恢复；
- `REPLY_END` 写终态并移出 active；
- cancel/error 能终结所有 open Reply；
- 同一 Event/reply 不产生重复 Msg。

### WebSocket

- 回复中切 session 再切回；
- 回复中刷新页面；
- WS 断开重连；
- HTTP 已有旧 checkpoint + WS 有更新 snapshot；
- 旧 revision 不覆盖新 revision；
- task 很长时 attach 数据大小只与当前 Msg 快照有关，不与 Event 数量有关。

### Compact

- 手动 `/compact`；
- 关键路径自动 compact；
- idle compact；
- compact 中刷新仍显示“压缩中”；
- done 后刷新从 `user/compact` Msg 恢复；
- failed 后 active start 被清除；
- 两次 compact 只把最后一份摘要送入 LLM；
- 同一 session 并发 compact 只执行一个 LLM 摘要；
- compact 期间用户输入按当前策略被拒绝且不入库。

### 客户端

- HTTP Msg 与 WS snapshot 同 id 时 upsert；
- compact 实时气泡与历史 Msg 不重复；
- ToolResultEnd 到达后立即停止 loading；
- interrupted/error Msg 先正常渲染已有正文，再在末尾渲染错误；
- 空 Reply 最终失败时也有可见错误 UI。

## 17. 给下一位 Agent 的工作准则

1. 先判断正在处理的是 Event、Msg，还是 session runtime state。
2. 新增 Event 不代表必须新增持久化结构。
3. 新增特殊 Msg 时才扩展 `MsgName`。
4. 所有可恢复状态变化优先经过 `SessionProjection`。
5. 实时传输与持久化可以来自同一个 Event，但职责不能混在 CompactManager、Agent 或 WS Channel 中。
6. 不做旧数据兼容；测试前可在 Gateway 停止后删除 sessions。
7. 未经用户明确要求，不 commit、不 push。

## 18. 可直接交给下一位 Agent 的提示词

```text
请先完整阅读 E:\ftre-docs\notes\agentscope-event-msg-session-projection-handoff.md，
再审计 E:\ftre-agent-core、E:\ftre、E:\binn\ftre-desktop 三个仓库的当前实现。
核心原则是：Event 是实时过程，Msg 是持久化事实，SessionProjection 是
Event→Msg/session runtime state 的唯一投影层；禁止重新把 TEXT_BLOCK_DELTA
等流式 Event 作为聊天历史入库。先核对文档所述与当前代码是否一致，列出偏差和
风险，不要为了兼容旧 session 添加分支。重点检查统一事件出口、open Reply
异常终结、WS attach snapshot 的 id/revision 去重、多次 compact 的上下文裁剪，
以及 LLM 并发超限时空 AssistantMsg 长期停留在 Preparing 的问题。未经明确要求
不要 commit 或 push。
```

