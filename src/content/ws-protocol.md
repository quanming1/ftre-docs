# WebSocket 协议规范

## 连接信息

- **地址**: `ws://127.0.0.1:48650/`
- **格式**: JSON 文本帧
- **编码**: UTF-8

> Gateway 默认从 `~/.ftre/config.json` 的 `servers.gateway` 读取 host / port，缺省 `127.0.0.1:48650`。下文中所有 HTTP API 路径均基于 `http://127.0.0.1:48650/api`。前端 dev 服务默认端口为 `48651`。

## 连接模型

一条物理 WebSocket 可以关注多个 session（多 tab / 多会话同步），通过 `attach`/`detach` 帧声明。`user_message` / `cancel` 帧会**隐式 attach**当前 session，保持向后兼容。

后端维护两个索引：

| 索引 | 类型 | 说明 |
|------|------|------|
| `session_id → set[WebSocket]` | 正向 | 推送 outbound 时遍历 |
| `WebSocket → set[session_id]` | 反向 | 断开时清理 |

---

## 通用帧结构

所有帧遵循统一外壳：

```json
{
  "id": "<uuid-16>",
  "type": "<frame-type>",
  "data": { ... },
  "metadata": { ... }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `id` | string | 建议 | 帧唯一标识；前端通常用 `crypto.randomUUID().slice(0, 16)`，后端当前不强制校验。缺失时帧仍会被处理；仅 `user_message` / `cancel` 等进入 Bus 的帧会写入 `metadata.frame_id`，`attach` / `detach` 不回显该字段，因此无法用于服务端确认；后端 BusMessage 默认用 uuid4 hex 前 16 位 |
| `type` | string | 是 | 帧类型，决定路由行为 |
| `data` | object | 否 | 载荷，结构因 type 而异；后端对缺失 data 有容错（默认 `{}`） |
| `metadata` | object | 否 | 附加元数据，进入后端 `BusMessage.metadata`；当前不参与 LLM 配置或消息构建，主要用于透传 `frame_id` 等控制信息 |

---

## 上行帧（Client → Server）

### 1. attach — 关注 session

```json
{
  "id": "abc123def456",
  "type": "attach",
  "data": { "session_id": "ws::sess_xxx" }
}
```

| data 字段 | 类型 | 说明 |
|-----------|------|------|
| `session_id` | string | 要关注的 session ID |

**行为**：将当前 WebSocket 连接注册为该 session 的推送目标。之后该 session 的所有 outbound 事件都会推送到这条 ws。

**使用场景**：
- 前端切换到某个 session 时
- 前端创建新 session 后
- 多端同步（多个客户端 attach 同一个 session）
- 重连时批量重新 attach 所有已关注的 session

### 2. detach — 取消关注

```json
{
  "id": "abc123def456",
  "type": "detach",
  "data": { "session_id": "ws::sess_xxx" }
}
```

**行为**：移除当前 WebSocket 对该 session 的关注。如果该 session 下没有其他 ws 连接，索引自动清理。

**使用场景**：
- 前端关闭 tab
- 切换到不同的 session 且不再关心旧 session

### 3. user_message — 用户消息

```json
{
  "id": "abc123def456",
  "type": "user_message",
  "data": {
    "content": "帮我写一个函数",
    "session_id": "ws::sess_xxx",
    "attachments": [...]
  },
  "metadata": {
    "model": "gpt-4o",
    "provider": "openai",
    "agent_id": "code_agent",
    "session_id": "ws::sess_xxx"
  }
}
```

| data 字段 | 类型 | 必填 | 说明 |
|-----------|------|:---:|------|
| `content` | string \| array | 否 | 消息内容（见下方 content 协议）。v2 格式中 `skill` 作为 part 嵌入数组；协议上通常不应与 `attachments` 同时为空。当前后端未在 WS 入口显式拒绝二者同时为空，`AgentLoop._run_async()` 会静默忽略这种输入 |
| `session_id` | string | 是 | 目标 session ID |
| `attachments` | array | 否 | 图片附件列表；允许只发送附件不带文本 |

**metadata 字段**（前端自由填充；当前仅作为 BusMessage metadata 保存/部分下行透传，不参与 LLM 配置或消息构建）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `model` | string | 前端模型选择 UI 当前选中的 LLM 模型名 |
| `provider` | string | 前端模型选择 UI 当前选中的 Provider 名称 |
| `agent_id` | string | Agent ID（默认 `"code_agent"`） |
| `session_id` | string | 当前 session（与 data.session_id 相同） |

> 注意：当前后端仅透传这些 metadata；模型选择实际来自 `~/.ftre/config.json`，`metadata.model` / `metadata.provider` / `metadata.agent_id` 不会改变本次 LLM 配置。

**行为流程**：
1. 附件校验（`_validate_attachments`）：检查 mime_type、大小、数量
2. 附件落盘（`_persist_attachments`）：base64 解码后存到 `~/.ftre/assets/images/`，将 `data` 字段替换为 `path`（文件绝对路径）。事件链路不再携带 base64
3. 隐式 attach 当前 session
4. `frame.id` 写入 `metadata.frame_id`
5. `data` + `metadata` → `Channel.receive(..., kind="user_message")` → Bus inbound → AgentLoop

**id 与 frame_id 的用途**：
- 前端发送时生成 `id`，同时本地 push 一条乐观占位消息（`userMsg.id = frame.id`）
- 后端 `_on_message` 把 `frame.id` 写入 `metadata.frame_id`
- AgentLoop echo `user_message` 时把 `metadata.frame_id` 回填到下行帧
- 前端收到 echo，检查 `messages` 中是否已有同 id → 有则跳过，避免重复渲染

**并发防御**：
- `AgentLoop._dispatch()` 中 per-session asyncio.Lock 保证同一 session 串行处理
- 前端 `isBusy` 状态阻止重复发送

### 4. cancel — 取消生成

取消当前通过 `/cancel` 系统级指令实现：前端发送 `type: "user_message"`、`content: "/cancel"` 的帧（参见[指令系统](/docs/commands)），或发送 `type: "cancel"` 帧。桌面前端的暂停按钮和 `/cancel` 指令候选都走这条路径。

**`cancel` 帧的处理**：`ws_channel._on_message` 收到 `type: "cancel"` 帧时，会将其转为 `content="/cancel"` 的 `user_message` 投递到 Bus（隐式 attach 当前 session），不再产生 `type="cancel"` 的 BusMessage。转换后由 `/cancel` 系统级指令处理：`_dispatch` 中 `command_manager.try_dispatch_system(data)` 在 session lock 外直接调用 `agent.cancel_nowait()` + `task.cancel()`；被取消的 Agent 在 LLM stream 的下一个 await 处抛出 `CancelledError`，产出 `done(success=false, reason="cancelled")` 作为最终信号。

> `websocket-client.ts` 的 `sendCancel()` 方法已改为直接发送 `type: "user_message"` + `content: "/cancel"` 的帧（不再发送 `type: "cancel"` 帧）。`ws_channel` 层仍保留对 `type: "cancel"` 帧的兼容处理（转为 `/cancel` user_message），但前端已不再使用这种帧类型。

---

## 下行帧（Server → Client）

### 通用格式

```json
{
  "id": "<message-uuid>",
  "type": "agent_event",
  "data": {
    "type": "<event-type>",
    "event_id": "<16-hex>",
    "data": { ... }
  },
  "metadata": {
    "channel_id": "ws",
    "session_id": "ws::sess_xxx"
  }
}
```
| metadata 字段 | 类型 | 说明 |
|---------------|------|------|
| `channel_id` | string | 目标 Channel ID，即后端 `BusMessage.to_channel`；普通 ws 消息为 `"ws"`，全局广播为 `"*"` |
| `session_id` | string | 目标 Session ID，即后端 `BusMessage.to_session`；普通 session 消息为具体 session_id，全局广播为 `"*"` |
| `event_id` | string | AgentEvent 的稳定事件 ID。core 创建 `AgentEvent` 时生成，WS 下行放在 `data.event_id`，DB 历史记录同步写入 `messages.data.event_id`。前端 reducer 用它统一去重 HTTP history、WS live、WS replay；同一个事件从不同路径到达时只渲染一次。旧历史行没有 `event_id` 时，gateway 启动迁移会用 `messages.id` 回填。 |

> **注意区分 `id` 和 `event_id`**：`id` 是 WS 帧 ID，仅用于 `user_message` echo 去重（前端自己发的消息不再渲染第二次）；`event_id` 是事件 ID，用于所有事件的统一去重（HTTP / WS live / WS replay 三路）。两者职责不同，不可混用。

**Volatile Replay Buffer**：后端在 WS 层临时缓存未入库的流式事件，并短暂保留刚入库的稳定事件（如 `assistant_message_complete` / `tool_call` / `tool_result`）来覆盖 HTTP history 与 WS attach 之间的 race。客户端 attach 时先补发这些缓存，再继续接收 live 流。重复帧由 `event_id` 在前端 reducer 统一去重。

### 事件类型完整列表

#### user_message — 用户消息 echo

```json
{
  "type": "agent_event",
  "data": {
    "type": "user_message",
    "data": {
      "content": "帮我写一个函数",
      "session_id": "ws::sess_xxx"
    }
  },
  "metadata": {
    "channel_id": "ws",
    "session_id": "ws::sess_xxx",
    "frame_id": "abc123def456"
  }
}
```

**用途**：
1. **本地去重**：前端自己发的消息已有本地占位（同 `id`），echo 跳过渲染；`isBusy`、`error`、`retryState` 的实际切换由 `session_status` 全局事件负责（见下方全局广播）
2. **跨 session 唤起**：当 `send_message` 工具触发远端 session 时，目标前端没有本地占位，echo 负责渲染用户气泡
3. **多端同步**：其他客户端也能看到用户消息

#### assistant_message — LLM 流式文本片段

```json
{
  "type": "agent_event",
  "data": {
    "type": "assistant_message",
    "data": { "content": "你好，我是" }
  }
}
```

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `content` | string | 流式增量文本片段 |

**前端处理**：
- 无 streaming assistant 时自动创建一条空消息
- 文本追加到 `parts[]` 末尾的流式 text part
- 清除重试横幅（`retryState = null`，若存在）

#### assistant_message_complete — LLM 一轮文本完成

```json
{
  "type": "agent_event",
  "data": {
    "type": "assistant_message_complete",
    "data": { "content": "你好，我是 ftre，一个 AI 编程助手。" }
  }
}
```

**前端处理**：
- 找到 `parts[]` 中还在 streaming 的 text part，用完整文本覆盖并封口
- 如果找不到（历史回放），push 一条已封口的新 text part
- **不设置 `streaming = false`**（由 `done` 事件统一收尾）

#### tool_call — 工具调用

```json
{
  "type": "agent_event",
  "data": {
    "type": "tool_call",
    "data": {
      "id": "call_abc123",
      "name": "bash",
      "arguments": { "command": "git status" }
    }
  }
}
```

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `id` | string | 工具调用唯一 ID |
| `name` | string | 工具名称 |
| `arguments` | object | 工具参数 |

**前端处理**：
- 创建/更新 `toolCalls[]`，status 标记为 `"running"`
- 在 `parts[]` 中插入 `tool_call` part（供 InlineToolCallCard 渲染）

#### tool_call_streaming — 工具参数流式增量

```json
{
  "type": "agent_event",
  "data": {
    "type": "tool_call_streaming",
    "data": {
      "tool_calls": [
        { "id": "call_abc123", "name": "bash", "arguments_delta": "{\"command\"" }
      ]
    }
  }
}
```

**前端处理**：与 `tool_call` 逻辑相同，但 `arguments` 是增量拼接（`arguments_delta`）而非一次性完整。当前 `react_runner` 构造的下行 chunk 只包含 `id` / `name` / `arguments_delta`，不包含 `index`；前端也不依赖 `index`。当前 `chat.ts` 会跳过没有有效 `id` 的增量（`if (!c.id) continue`），因此后端/上游早期发出的空 id 参数片段可能不会被前端展示；消费端不应假设每个增量都一定能归并到可见工具卡片。

#### tool_result — 工具执行结果

```json
{
  "type": "agent_event",
  "data": {
    "type": "tool_result",
    "data": {
      "id": "call_abc123",
      "name": "bash",
      "result": "On branch develop\nnothing to commit",
      "error": null,
      "status": "completed",
      "error_code": null
    }
  }
}
```

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `id` | string | 关联的 tool_call ID |
| `name` | string | 工具名称 |
| `result` | string | 执行结果 |
| `error` | string \| null | 非 null 表示执行失败 |
| `status` | string | `"completed"` / `"failed"` / `"cancelled"` |
| `error_code` | string \| null | 错误码（`react_runner` 调用 `tool_result_event()` 时未传入此参数，默认为 `null`） |
| `metadata` | object | 预留的工具附加元数据字段；`react_runner` 当前调用 `tool_result_event()` 时未将 `ToolResult.metadata` 传入，因此即使中间件 after 钩子补充了 metadata 也不会出现在事件中，此字段通常不存在 |

**前端处理**：
- 从 `toolCalls[]` 中找到对应 ID，写入 `result` + 更新 `status`（`"ok"` / `"error"`），同时更新 `name`（`d.name || tc.name`，优先使用事件中的 name）
- **注意**：前端当前用 `!!d.error` 判断 `"ok"` / `"error"`，不读取 `d.status` 字段。后端在取消路径（`status="cancelled"` + `error=null`）和部分中断路径（`status="failed"` + `error=null`）下，前端会将 `status` 错误映射为 `"ok"`

#### tool_cancel_requested / tool_cancelled

这两个类型曾在 `AgentLoop.PERSISTENT_EVENTS`（已改为 `_PERSISTENT_CLASSES`）中被列出，但它们不在 `ftre-agent-core.agent.event.EventType` 中，`event.py` 也没有对应的事件类，当前主运行路径不产出它们。取消最多表现为 `tool_result(status="cancelled")` + `done(reason="cancelled")`；前端 `applyEvent` 对这两类无 case 分支。

注意：`tool_timed_out` 不在 `_PERSISTENT_CLASSES` 中，当前也没有统一的 `tool_timed_out` 实时事件；工具超时通常由具体工具返回失败结果或错误文本。

#### reasoning — LLM 思考文本片段

```json
{
  "type": "agent_event",
  "data": {
    "type": "reasoning",
    "data": { "content": "这个需求需要..." }
  }
}
```

**前端处理**：与 `message` 同逻辑，但写入 `reasoning` 字段和 `reasoning` 类型 part，用于展示思考过程。

#### reasoning_complete — 思考文本完成

```json
{
  "type": "agent_event",
  "data": {
    "type": "reasoning_complete",
    "data": { "content": "用户想要一个函数来计算斐波那契数列..." }
  }
}
```

与 `assistant_message_complete` 对应，封口 reasoning part。`data.data.content` 为完整思考文本。

#### usage_update — Token 用量更新

```json
{
  "type": "agent_event",
  "data": {
    "type": "usage_update",
    "data": {
      "usage": {
        "prompt_tokens": 1200,
        "completion_tokens": 350,
        "total_tokens": 1550
      }
    }
  }
}
```

**前端处理**：写入当前 streaming assistant 的 `usage` 字段。

#### error — Agent 错误

```json
{
  "type": "agent_event",
  "data": {
    "type": "error",
    "data": {
      "message": "网络连接失败",
      "code": "network"
    }
  }
}
```

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `message` | string | 错误描述 |
| `code` | string | 错误码 |

**前端处理**：
- 关闭当前 streaming assistant 的 `streaming` 状态
- push 一条 `isError = true` 的消息
- 设置 `error`（格式：`code ? `[\${code}] \${message}` : message`）
- `isBusy` 的实际切换由紧随其后的 `session_status(idle)` 全局事件负责

常见错误码：`network`, `timeout`, `rate_limit`, `internal_server_error`, `content_filter`, `auth_error`, `bad_request`, `api_error`, `unknown`

#### retry — Agent 重试

```json
{
  "type": "agent_event",
  "data": {
    "type": "retry",
    "data": {
      "code": "network",
      "attempt": 1,
      "max_attempts": 5,
      "message": "Retrying..."
    }
  }
}
```

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `code` | string | 触发重试的错误码（与 error 事件的 code 同源，如 `"network"`、`"timeout"`、`"rate_limit"`） |
| `message` | string | 错误描述 |
| `attempt` | number | 当前是第几次重试（从 1 开始） |
| `max_attempts` | number | 最大重试次数（不含首次调用；等于 `agent.max_retries`） |

**前端处理**：
- 清理 streaming assistant 尾部未封口的 part 片段
- 保留已完成的 tool_call / tool_result
- 设置 `retryState` 显示重试横幅

#### done — 响应结束

**成功**：
```json
{
  "type": "agent_event",
  "data": {
    "type": "done",
    "data": { "success": true, "reason": "completed" }
  }
}
```

**失败**（Agent 异常退出）：
```json
{
  "type": "agent_event",
  "data": {
    "type": "done",
    "data": { "success": false, "reason": "error" }
  }
}
```

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `success` | bool | 是否成功 |
| `reason` | string | `"completed"`（正常完成）/ `"max_iterations"` / `"error"` / `"cancelled"` |
| `usage` | object | 总 Token 用量（可选；当前运行时不填充此字段，前端不消费 done 事件的 usage，由 `usage_update` 事件单独推送） |

**前端处理**：
- `sealStreamingPart()` 封口末尾仍在 streaming 的 text/reasoning part；`assistant_message_complete` / `reasoning_complete` 负责按类型查找并封口对应流式段
- 设置 `streaming = false`
- 当前前端会将仍处于 running/pending 的 toolCalls 标记为 `"ok"`
- 清空 `retryState`
- `isBusy` 的实际切换由紧随其后的 `session_status(idle)` 全局事件负责

#### context_compact_start / context_compact_done / context_compact_enabled / context_compact_failed

上下文压缩实时事件。当前实际代码路径中，自动压缩与关键路径压缩都统一按 `precompact_threshold`（默认 50%）触发，并直接写入 `context_compact(enabled=true)`；自动压缩的 `silent` 取 `agents.defaults.context.silent`，默认 `true`。`enable_pending_compact()` 与 `context_compact_enabled` 仍然保留用于兼容历史上可能存在的 pending（`enabled=false`）事件，但当前代码没有新的 `enabled=false` 写入路径。手动 `/compact` 也会先尝试启用历史 pending，没有则直接生成 `enabled=true` 的压缩事件。

**context_compact_start** data：

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `events` | number | 被摘要覆盖的事件数 |
| `tokens` | number | 压缩前估算 token |
| `silent` | bool | 是否静默（可选；仅 `silent=true` 时写入） |

**context_compact_done** data：

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `tokens_before` | number | 压缩前的 token 数 |
| `tokens_after` | number \| undefined | 启用后的估算 token；pending 事件可为空 |
| `enabled` | bool | 压缩事件是否已启用 |
| `events` | number | 被摘要覆盖的事件数 |
| `summary` | string | 压缩后的摘要预览 |
| `silent` | bool | 是否静默（可选；`silent=true` 时显式写入） |

**context_compact_enabled** data：

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `enabled` | bool | 固定 `true`（启用成功） |
| `events` | number | 被摘要覆盖的事件数 |
| `tokens_before` | number | 取自 pending 事件的 `tokens_before` 字段（压缩创建时的估算值），非启用时实时估算 |
| `tokens_after` | number \| undefined | 启用后估算 token |
| `summary` | string | 摘要预览 |
| `silent` | bool | 是否静默（可选；`silent=true` 时显式写入） |

**context_compact_failed** data：

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `reason` | string | 失败原因描述 |
| `silent` | bool | 是否静默（可选；当前代码在 `silent=true` 时显式写入） |

**前端处理**：
- `context_compact_start`：push 一条 `compact.status = "running"` 的 system 消息，同时写入 `tokensBefore`（来自 `data.tokens`，若存在）
- `context_compact_done`：找最后一条 `running` 的 compact 消息，更新为 `status = "done"`，写入 `tokensBefore`（优先取 `data.tokens_before`，回退到 start 时写入的值）和 `summary`
- `context_compact_enabled`：不渲染气泡，只触发 token usage 刷新
- `context_compact_failed`：找最后一条 `running` 的 compact 消息，更新为 `status = "failed"`，写入 `reason`

**注意**：这些实时事件由核心组件 `CompactHandler`（`ftre/agent/compact_handler.py`）通过 Bus 发送，当前不在后端 `AgentLoop._PERSISTENT_CLASSES` 白名单内，不经过 AgentLoop 持久化路径（`context_compact` 事件本身由 `CompactHandler.compact()` 直接调用 `save_message()` 写入 DB）。桌面端 `ChatHeader` 的归档/压缩菜单当前调用 `POST /api/sessions/{id}/compact`，但后端尚未实现该 HTTP 路由；可靠的手动压缩入口仍是发送 `/compact` 指令。

#### context_compact — 历史回放专用

```json
{
  "type": "agent_event",
  "data": {
    "type": "context_compact",
    "data": { "summary": "...", "events_before": 42 }
  }
}
```

**仅出现在历史回放（HTTP API 历史消息流）中**，对应后端 `CompactHandler` 写入 DB 的持久化事件。前端 `applyEvent` 的 `case "context_compact"` 分支处理：插入一条已完成（`status = "done"`）的 compact 分隔气泡。与实时的三段式事件（`_start / _done / _failed`）不同，此事件是单步持久化形态。

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `summary` | string | 压缩摘要内容 |
| `enabled` | bool | 是否参与后端上下文重建；缺省 `true` 兼容旧事件 |
| `trigger_ratio` | number | 生成该压缩事件时的水位 |
| `enable_ratio` | number | 启用水位（配置的 `compact_threshold`） |
| `events_before` | number | 被摘要覆盖的事件数 |
| `tokens_before` | number | 压缩前 token 数 |
| `tokens_after` | number \| undefined | 启用后估算 token；仅 `enabled=true` 时写入 |
| `silent` | bool | 是否静默（可选；仅 `silent=true` 时写入） |

#### external_message — 跨 session 消息注入

```json
{
  "type": "agent_event",
  "data": {
    "type": "external_message",
    "data": {
      "content": "来自其他 session 的消息",
      "from_channel": "ws",
      "from_session": "ws::sess_xxx"
    }
  }
}
```

**前端处理**：
- 插入一条 `external = true` 的 assistant 消息，附带 `externalFrom = "${from_channel}::${from_session}"` 标识来源，以及 `parts` 渲染文本段
- 如果当前有 streaming tail，插入到 tail 之前（避免视觉错位）

**来源**：仅 `send_message(kind="notify")` 会产生并持久化 `external_message`。`send_message(kind="invoke")` 不产生该事件，而是向目标 session 投递普通 `user_message`；来源信息会写入 `content` 前缀，并按普通 `user_message` echo 渲染。

---

## 全局广播事件（global event）

少数事件不针对单一 session，而是广播给**所有** WebSocket 连接，供跨 session 的全局视图（如会话列表）消费。这类下行帧使用顶层 `type: "global_event"`（区别于 per-session 的 `agent_event`）。`session_status` 这类全局事件当前 `metadata.channel_id` 与 `metadata.session_id` 为 `"*"`，真正关心的 session ID 在 `data.data.session_id` 里。

后端分发不走 per-session 的 `attach` 索引，而是扇出给所有活跃连接，因此**无需 attach 也能收到**。详见 [Bus 消息协议 — 全局广播消息](/docs/bus-message)。

**前端分流**：在 WebSocket 入口按顶层 `type` 分流。`agent_event` 进 `applyEvent`（按 session 路由到消息流），`global_event` 不进消息流；当前 `chat.ts` 已消费 `session_status`，收到后会更新对应 chat bucket 的 busy 状态，并触发 `useSession.loadAllSessions()` 刷新会话列表（该流程会先拉取 `/api/workspaces`，再按工作区分页拉取 `/api/sessions`）。注意 HTTP 刷新得到的 `running` 字段仅覆盖普通 ReActAgent 执行态，不覆盖 `/compact` 等命令态。

### session_status — session 运行态变化

```json
{
  "type": "global_event",
  "data": {
    "type": "session_status",
    "data": {
      "session_id": "ws::sess_xxx",
      "status": "running"
    }
  },
  "metadata": {
    "channel_id": "*",
    "session_id": "*"
  }
}
```

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `session_id` | string | 状态变化的 session ID（在 data 内，因为帧本身不绑定单一 session） |
| `status` | string | `"running"`（普通 Agent 执行中）/ `"compacting"`（`/compact` 等命令执行中）/ `"idle"`（无活动执行） |

**何时发出**：
- 普通 Agent 执行路径的 `running`：在 `_active_agents[sid] = agent` 之后、`user_message` echo 之前（实际在 `_run_async()` 中）
- 普通 Agent 执行路径的 `idle`：Agent 执行结束时在 `finally` 中 `pop` 之后发出（正常 / 错误 / 取消 / 超迭代都会发）
- `/compact` 指令路径：不进入 `_run_async()`，由 `_cmd_compact()` 内部调用 `_publish_session_status_async()` 手动发送 `compacting`（开始）→ 完成后发送 `get_session_status()` 返回的最终态（通常是 `idle`，因为 `_compacting_sessions` 在 finally 中先被清掉再发状态）用于驱动前端 loading 状态

**前端处理**：
- 不入消息流、不持久化，是瞬时控制信号
- `chat.ts` 收到 `session_status` 后会直接更新对应 session bucket 的 `isBusy`；`running` 还会清空上一轮 `error` / `retryState`
- 同时触发 `useSession.loadAllSessions()` 刷新会话列表；该流程会先请求 `GET /api/workspaces`，再按工作区分页请求 `GET /api/sessions`
- 但后端 `GET /api/sessions` 返回的 `running` 字段仅由 `AgentLoop._active_agents` 判断，只覆盖普通 ReActAgent 执行态，不覆盖 `/compact` 等命令态。因此 `/compact` 的 busy 状态以实时 `session_status` 为准，不能依赖 HTTP 初始快照恢复

**当前状态**：后端已完整实现 global_event 的生成与扇出；前端已消费 `session_status`，用于同步当前会话 busy 状态，并作为刷新会话列表的触发信号。

**注意**：`session_status` 不在 `_PERSISTENT_CLASSES` 中，不写入 DB，历史回放（`GET /api/sessions/:id/messages`）不会出现。

---

## 附件协议

### 请求格式

```json
{
  "type": "user_message",
  "data": {
    "content": "看下这张图",
    "session_id": "ws::sess_xxx",
    "attachments": [
      {
        "type": "image",
        "mime_type": "image/png",
        "data": "<base64-encoded>",
        "name": "screenshot.png"
      }
    ]
  }
}
```

### 附件对象字段

> **前端发送格式**（WebSocket 入站）：前端发送 `data` 字段（base64 编码），后端校验通过后落盘到 `~/.ftre/assets/images/`，将 `data` 替换为 `path`（绝对路径）。事件链路和 DB 持久化中只保留 `path`。

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `type` | string | 是 | 附件类型，当前仅支持 `"image"` |
| `mime_type` | string | 是 | MIME 类型：`image/png` / `image/jpeg` / `image/webp` / `image/gif` |
| `data` | string | 是* | Base64 编码的图片数据（*前端发送时必填，后端落盘后删除） |
| `path` | string | — | 落盘后的文件绝对路径（后端落盘后填充，前端不发送） |
| `name` | string | 否 | 原始文件名（用于存储文件命名，会做特殊字符过滤） |

### 校验规则

| 规则 | 值 |
|------|-----|
| 允许的 MIME | `image/png`, `image/jpeg`, `image/webp`, `image/gif` |
| 单张最大 | 3 MB（Base64 解码后） |
| 单条消息最大附件数 | 8 |
| 校验失败响应 | `type: "error"`, `code: "invalid_input"` |

---

## 重连机制

前端 WebSocketClient 维护一个 `attachedSessions` 集合：

1. 断线后按指数退避重连：1s → 2s → 4s → 8s → 15s → 30s
2. 重连成功后自动重新 attach 集合中所有 session
3. 最大重连次数无上限（持续重试）

---

## 错误响应

```json
{
  "id": "<original-frame-id>",
  "type": "error",
  "data": {
    "code": "invalid_input",
    "message": "attachments[0].mime_type 不支持: 'application/pdf'",
    "session_id": "ws::sess_xxx"
  },
  "metadata": {
    "channel_id": "ws",
    "session_id": "ws::sess_xxx"
  }
}
```

仅在附件校验失败时触发，由 `_reject()` 直发，不入 Bus。

---

## Session ID 格式

```
<channel_id>::<prefix>_<uuid4-hex-12>
```

示例：
- `ws::sess_89f19d375bbc` — WebSocket 来源的 session（`89f19d375bbc` 为 uuid4 hex 前 12 位）
- `cron::sess_xxx` — Cron 触发的 session
- `subagent::sess_xxx` — 子任务 session

---

## content 协议（v2 结构化格式）

### 字符串（v1 兼容）

```json
{ "content": "hello world" }
```

### 结构化数组（v2）

```json
{
  "content": [
    { "type": "text", "text": "帮我提交代码" },
    { "type": "skill", "data": "octo-im-github" }
  ]
}
```

支持的类型：

| type | 文本字段 | 说明 |
|------|----------|------|
| `"text"` | `text: string` | 纯文本内容（前端发送时使用 `text` 字段；后端 `_text_value` 兼容读取 `text` 优先、`data` 兜底） |
| `"skill"` | `data: string` | 用户选中的 Skill 名称 |
| `"email"` | object | 前端 `MessagePart` 类型中保留的邮件消息段（`EmailPartData`）；当前后端 `_content_to_text` 会忽略 |
| `"image"` | object | 前端本地渲染用图片段；上送给后端时实际拆到 `attachments` 字段，当前后端 `_content_to_text` 不处理此 part |

当前后端 `_content_to_text` 实际只处理 `text` 和 `skill`，其它 part 会被忽略；图片输入由 `attachments` 字段处理。

**后端归一化（`_content_to_text`）**：
- string → 直接使用
- array → 遍历 parts，`text` 部分用 `"\n".join()` 拼接，`skill` 部分转为 XML 标注；其它 part 当前会被忽略
- 最终传给 LLM 的是纯文本

---

## 补充说明

### user_message — 历史回放用户消息

`user_message` 出现在 HTTP API `GET /api/sessions/:id/messages` 返回的历史记录中。真实用户输入写入为 `metadata.hide=false`，工具注入给 LLM 的隐藏 user message 写入为 `metadata.hide=true`。实时 WebSocket echo 仍使用 `user_message`，用于本轮输入去重和跨 session 展示。

### external_message 的 LLM 转换

前端渲染为 `external = true` 的消息。**后端 `to_openai_messages`** 在重建 LLM 历史时转换为：

```
[来自 <from_channel>::<from_session> 的消息] <content>
```

格式为 `role: "assistant", name: _safe_name(src)`，其中 `src = f"{from_channel}::{from_session}"`。注意 `from_session` 本身通常已经是完整 session id（如 `ws::sess_xxx`），因此实际示例可能是 `[来自 ws::ws::sess_xxx 的消息] <content>`，对应 `name` 为 `ws__ws__sess_xxx`。`_safe_name` 会将非字母数字及 `_-` 以外的字符逐个替换为 `_`、去头尾 `_`、截断到 64 字符；空字符串兜底返回 `"external"`。

### attach / detach — 无确认响应

这两个帧是 **fire-and-forget**。后端收到后直接 `return`，不返回任何确认帧。即使上行带了 `id`，该值也只对客户端本地有意义，后端不会回显；前端无需等待响应。

### context_compact — 上下文压缩

`context_compact_start / done / enabled / failed` 事件由核心组件 `CompactHandler`（`ftre/agent/compact_handler.py`）触发。后端 `to_openai_messages` 遇到 `context_compact(enabled=true)` 事件时，**丢弃该点之前的所有消息**，用 `"[历史上下文摘要]\n{summary}"` 作为新的 user 消息起点；`enabled=false` 的 pending 事件会被跳过（当前无代码写入 `enabled=false`，所有路径直接写入 `enabled=true`）。

### HTTP API 路由

后端 FastAPI 在 WebSocketChannel 初始化时 `include_router(api_router, prefix="/api")`，挂载以下 HTTP 路由：

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/config` | 读取 `~/.ftre/config.json` |
| PUT | `/api/config` | 覆盖写 `~/.ftre/config.json` |
| GET | `/api/health` | 健康检查 |
| POST | `/api/sessions` | 创建 session（`channel_id` 必填 query param，`title`/`workspace` 可选 query param；若省略 `workspace`，后端当前会以空串落库，不会自动写入 `agents.defaults.workspace`） |
| GET | `/api/sessions` | 列出 sessions（支持 limit/offset/channel_id/workspace 过滤；返回 `{sessions, total, limit, offset}`，其中每个 session 附带 `running` 字段；该字段仅表示该 session 是否存在于 `AgentLoop._active_agents` 中，即是否有普通 ReActAgent 正在执行，不包含 `/compact` 等不创建 `_active_agents` 的命令态） |
| PUT | `/api/sessions/:id` | 更新 session（workspace/title） |
| DELETE | `/api/sessions/:id` | 删除 session 及其所有消息 |
| GET | `/api/sessions/:id/messages` | 拉取该 session 历史消息（按时间正序）。支持 `limit_turns=N` 按对话轮次返回最近 N 轮（一轮以可见 `user_message` 为界），可选 `before_ts` 游标加载更早消息。带 `limit_turns` 时返回 `{messages, has_more, status}`；不带参数时返回 `{messages, status}`。`status` 为 `idle` / `running` / `compacting`。`has_more` 表示是否还有更早的消息 |
| GET | `/api/sessions/:id/token_usage` | 获取 Token 用量估算 |
| GET | `/api/workspaces` | 列出工作区（支持 `channel_id` 过滤；默认 `ws`） |
| GET | `/api/images/{filename}` | 返回 `~/.ftre/assets/images/` 目录下的图片文件，供前端历史消息渲染附件图片；对 `filename` 做 basename 过滤防路径穿越 |
| GET | `/api/image-file?path=<abs_path>` | 按绝对路径返回本地图片文件，供 renderer 预览；对 path 做 `expanduser`+`abspath` 解析，校验文件存在且 MIME 为 image 类型 |
| GET | `/api/skills` | 列出所有 Skill 元信息 |
| GET | `/api/skills/:name` | 读取单个 Skill 完整信息 |
| POST | `/api/skills` | 创建 Skill（返回 201） |
| PUT | `/api/skills/:name` | 覆盖写 Skill 正文 |
| DELETE | `/api/skills/:name` | 删除 Skill（返回 204；目录形态会连同 references/scripts 一并删除） |
| PATCH | `/api/skills/:name/toggle` | 切换 Skill 的禁用状态（在 `config.json` 的 `disabled_skills` 数组中添加/移除该名称；返回 `{name, disabled}`） |
| GET | `/api/cron` | 列出所有 Cron 任务 |
| GET | `/api/cron/:job_id` | 获取单个 Cron 任务 |
| POST | `/api/cron` | 创建 Cron 任务（返回 201） |
| PATCH | `/api/cron/:job_id` | 局部更新 Cron 任务（仅允许修改 `cron` / `title` / `prompt` / `disabled`） |
| DELETE | `/api/cron/:job_id` | 删除 Cron 任务（返回 204） |
| GET | `/api/commands` | 返回已注册的斜杠指令列表（含 `system` 字段标识系统级指令） |
| GET | `/api/traces` | 列出最近的 Agent trace 摘要（支持 limit/offset 分页） |
| GET | `/api/traces/{trace_id}` | 获取单个 trace 的轻量 Run 树 |
| GET | `/api/traces/{trace_id}/runs/{run_id}` | 获取单个 Run 的完整输入/输出/事件 |
| GET | `/api/mcp` | 列出所有 MCP 服务器及连接状态 |
| POST | `/api/mcp` | 创建 MCP 服务器并立即连接（返回 201） |
| PATCH | `/api/mcp/{name}` | 局部更新 MCP 服务器配置并增量重连 |
| DELETE | `/api/mcp/{name}` | 删除 MCP 服务器并断开连接（返回 204） |

> 可靠的手动压缩入口是发送 `/compact` 指令。后端 `routes.py` 当前没有 `POST /api/sessions/:id/compact` 路由；前端 ChatHeader 的「归档会话」菜单仍存在，调用该路由但后端未实现，因此实际无法生效。建议使用 `/compact` 指令。

`GET /api/sessions/:id/messages` 返回该 session 消息（按时间正序）。支持 `limit_turns` 参数按对话轮次分页返回最近 N 轮，可选 `before_ts` 游标向前翻页；返回 `has_more` 表示是否还有更早的消息，`status` 为当前会话运行状态（`idle` / `running` / `compacting`）。


## 校对记录

 - **2025-06-26**：与 `ftre/src/ftre/channel/ws_channel.py` / `ftre-agent-core/.../websocket-client.ts` / `ftre/src/ftre/api/routes.py` 核对，描述准确。
   - WS 默认地址 `ws://127.0.0.1:48650/` 与 `config.json` 的 `servers.gateway` 一致；
    - 隐式 attach 行为（`user_message` / `cancel` 帧）由 `ws_channel._on_message` 实现：cancel 帧的 `_attach` 调用在 `channel/ws_channel.py:525`，user_message 帧的 `_attach` 调用在 `channel/ws_channel.py:559`；
    - `cancel` 帧被 ws_channel 转为 `content="/cancel"` 的 `user_message`（`channel/ws_channel.py:519-537`）；
   - 前端 `websocket-client.ts:223-229` 中 `sendCancel()` 已改为直接发送 `type: "user_message"` + `content: "/cancel"`；
    - 附件校验规则：MIME 白名单（`image/png` / `image/jpeg` / `image/webp` / `image/gif`）、单张 ≤ 3 MB、单条 ≤ 8 张（常量 `channel/ws_channel.py:36-46`，校验函数 `_validate_attachments` 定义在 `channel/ws_channel.py:248-293`）；
   - 前端 ChatHeader 的「归档会话」菜单仍存在，调用 `triggerCompaction()` → `POST /api/sessions/{id}/compact`，但后端 `routes.py` 没有该路由，因此该菜单实际不生效；可靠的手动压缩入口仍是发送 `/compact` 指令。
 - **2025-07-18**：补全 HTTP API 路由表中缺失的 `GET /api/image-file` 路由。源码依据：`ftre/src/ftre/api/routes.py:456-470`。
