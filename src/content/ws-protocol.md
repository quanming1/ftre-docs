# WebSocket 协议规范

## 连接信息

- **地址**: `ws://127.0.0.1:18790/`
- **格式**: JSON 文本帧
- **编码**: UTF-8

## 连接模型

一条物理 WebSocket 可以关注多个 session（多 tab / 多会话同步），通过 `attach`/`detach` 帧声明。`user_input` 和 `cancel` 帧会**隐式 attach**当前 session，保持向后兼容。

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
| `id` | string | 是 | 帧唯一标识（16 位 hex UUID） |
| `type` | string | 是 | 帧类型，决定路由行为 |
| `data` | object | 是 | 载荷，结构因 type 而异 |
| `metadata` | object | 否 | 附加元数据，透传给 Agent |

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

### 3. user_input — 用户消息

```json
{
  "id": "abc123def456",
  "type": "user_input",
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
| `content` | string \| array | 是 | 消息内容（见下方 content 协议）。v2 格式中 `skill` 作为 part 嵌入数组 |
| `session_id` | string | 是 | 目标 session ID |
| `attachments` | array | 否 | 图片附件列表 |

**metadata 字段**（前端自由填充，透传到 Agent，常用）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `model` | string | LLM 模型名 |
| `provider` | string | Provider 名称 |
| `agent_id` | string | Agent ID（默认 `"code_agent"`） |
| `session_id` | string | 当前 session（与 data.session_id 相同） |

**行为流程**：
1. 附件校验（`_validate_attachments`）：检查 mime_type、大小、数量
2. 隐式 attach 当前 session
3. `frame.id` 写入 `metadata.frame_id`
4. `data` + `metadata` → Bus inbound → AgentLoop

**id 与 frame_id 的用途**：
- 前端发送时生成 `id`，同时本地 push 一条乐观占位消息（`userMsg.id = frame.id`）
- 后端 `_on_message` 把 `frame.id` 写入 `metadata.frame_id`
- AgentLoop echo `user_input` 时把 `metadata.frame_id` 回填到下行帧
- 前端收到 echo，检查 `messages` 中是否已有同 id → 有则跳过，避免重复渲染

**并发防御**：
- 后端 `is_session_running()` 检查：同一 session 已有 Agent 运行时，静默丢弃新 `user_input`
- 前端 `isBusy` 状态阻止重复发送

### 4. cancel — 取消生成

```json
{
  "id": "abc123def456",
  "type": "cancel",
  "data": { "session_id": "ws::sess_xxx" }
}
```

**行为**：AgentLoop 收到后调用 `agent.cancel_nowait()` 中断执行。隐式 attach 当前 session。

---

## 下行帧（Server → Client）

### 通用格式

```json
{
  "id": "<message-uuid>",
  "type": "agent_event",
  "data": {
    "type": "<event-type>",
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
| `channel_id` | string | 来源 Channel（`"ws"`） |
| `session_id` | string | 所属 session |

### 事件类型完整列表

#### user_input — 用户消息 echo

```json
{
  "type": "agent_event",
  "data": {
    "type": "user_input",
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
1. **本地去重**：前端自己发的消息已有本地占位（同 `id`），echo 跳过渲染，但仍会设置 `isBusy = true`、清空 `error` 和 `retryState`（一轮对话开始的统一信号）
2. **跨 session 唤起**：当 `send_message` 工具触发远端 session 时，目标前端没有本地占位，echo 负责渲染用户气泡
3. **多端同步**：其他客户端也能看到用户消息

#### message — LLM 流式文本片段

```json
{
  "type": "agent_event",
  "data": {
    "type": "message",
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

#### message_complete — LLM 一轮文本完成

```json
{
  "type": "agent_event",
  "data": {
    "type": "message_complete",
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
        { "index": 0, "id": "call_abc123", "name": "bash", "arguments_delta": "{\"com" }
      ]
    }
  }
}
```

**前端处理**：与 `tool_call` 逻辑相同，但 `arguments` 是增量拼接（`arguments_delta`）而非一次性完整。

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
| `error_code` | string \| null | 错误码（如 `"cancelled"`, `"timed_out"`, `"parse_error"`） |
| `metadata` | object | 工具附加元数据（由工具实现传入，可选） |

**前端处理**：
- 从 `toolCalls[]` 中找到对应 ID，写入 `result` + 更新 `status`（`"ok"` / `"error"`）

#### tool_cancel_requested / tool_cancelled / tool_timed_out

工具取消/超时状态事件。**后端持久化**（在 `PERSISTENT_EVENTS` 中），会存入 DB 历史，但**前端 `applyEvent` 无对应 case 分支，不做任何渲染处理**。

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `id` | string | 关联的 tool_call ID |
| `name` | string | 工具名称 |
| `reason` | string | 取消/超时原因（如 `"user_cancelled"`, `"timed_out"`） |
| `status` | string | 状态：`"cancelling"` / `"cancelled"` / `"timed_out"` |
| `error_code` | string \| null | 错误码 |
| `result_status` | string \| null | 最终结果状态（如 `"cancelled"`, `"timed_out"`） |

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

与 `message_complete` 对应，封口 reasoning part。`data.data.content` 为完整思考文本。

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
- 设置 `error` + `isBusy = false`

常见错误码：`network`, `timeout`, `internal_server_error`, `content_filter`, `auth_error`

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

**前端处理**：
- `sealStreamingPart()` 封口所有流式 parts
- 设置 `streaming = false`
- 将 running/pending 的 toolCalls 标记为 `"ok"`
- `isBusy = false` → 解除输入框锁定

#### context_compact_start / context_compact_done / context_compact_failed

上下文压缩实时事件，插入/更新 `compact` 状态消息到消息列表。

**context_compact_start** data：

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `tokens` | number \| undefined | 压缩前的 token 数（可选） |

**context_compact_done** data：

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `tokens_before` | number \| undefined | 压缩前的 token 数（可选） |
| `summary` | string \| undefined | 压缩后的摘要预览（可选） |

**context_compact_failed** data：

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `reason` | string | 失败原因描述 |

**前端处理**：
- `context_compact_start`：push 一条 `compact.status = "running"` 的 system 消息
- `context_compact_done`：找最后一条 `running` 的 compact 消息，更新为 `status = "done"`，写入 `tokensBefore` 和 `summaryPreview`
- `context_compact_failed`：找最后一条 `running` 的 compact 消息，更新为 `status = "failed"`，写入 `reason`

#### context_compact — 历史回放专用

```json
{
  "type": "agent_event",
  "data": {
    "type": "context_compact",
    "data": { "summary": "..." }
  }
}
```

**仅出现在历史回放（HTTP API 历史消息流）中**，对应后端 `context_compact.py` 插件写入 DB 的持久化事件。前端 `applyEvent` 的 `case "context_compact"` 分支处理：插入一条已完成（`status = "done"`）的 compact 分隔气泡。与实时的三段式事件（`_start / _done / _failed`）不同，此事件是单步持久化形态。

| data.data 字段 | 类型 | 说明 |
|----------------|------|------|
| `summary` | string | 压缩摘要内容 |

#### external_message — 跨 session 消息注入

```json
{
  "type": "agent_event",
  "data": {
    "type": "external_message",
    "data": {
      "content": "来自其他 session 的消息",
      "from_channel": "subagent",
      "from_session": "subagent::sess_xxx"
    }
  }
}
```

**前端处理**：
- 插入一条 `external = true` 的 assistant 消息
- 如果当前有 streaming tail，插入到 tail 之前（避免视觉错位）

---

## 附件协议

### 请求格式

```json
{
  "type": "user_input",
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

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `type` | string | 是 | 附件类型，当前仅支持 `"image"` |
| `mime_type` | string | 是 | MIME 类型：`image/png` / `image/jpeg` / `image/webp` / `image/gif` |
| `data` | string | 是 | Base64 编码的图片数据 |
| `name` | string | 否 | 原始文件名 |

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
<channel_id>::<prefix>_<uuid>
```

示例：
- `ws::sess_89f19d375bbc` — WebSocket 来源的 session
- `cron::cron_abc123` — Cron 触发的 session
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
    { "type": "text", "data": "帮我提交代码" },
    { "type": "skill", "data": "octo-im-github" }
  ]
}
```

支持的类型：

| type | data 类型 | 说明 |
|------|-----------|------|
| `"text"` | string | 纯文本内容 |
| `"skill"` | string | 用户选中的 Skill 名称 |

**后端归一化（`_content_to_text`）**：
- string → 直接使用
- array → 遍历 parts，text 部分用 `"\n".join()` 拼接，skill 部分转为 XML 标注
- 最终传给 LLM 的是纯文本

---

## 补充说明

### USER_INPUT（大写）— 历史回放事件

`USER_INPUT` 仅出现在 HTTP API `GET /api/sessions/:id/messages` 返回的历史记录中，**不会**通过 WebSocket 实时下发。前端 `applyEvent` 有独立的 `case "USER_INPUT"` 分支处理，与实时 `user_input` echo 区分。

### external_message 的 LLM 转换

前端渲染为 `external = true` 的消息。**后端 `to_openai_messages`** 在重建 LLM 历史时转换为：

```
[来自 <channel>::<session> 的消息] <content>
```

格式为 `role: "assistant", name: "<src>"`。

### attach / detach — 无确认响应

这两个帧是 **fire-and-forget**。后端收到后直接 `return`，不返回任何确认帧。前端无需等待响应。

### context_compact — 上下文压缩

`context_compact_start / done / failed` 事件由插件（`context_compact.py`）触发。后端 `to_openai_messages` 遇到 `context_compact` 事件时，**丢弃该点之前的所有消息**，用压缩后的 summary 作为新的 user 消息起点。这是 LLM 上下文管理的关键机制。

### HTTP API 路由

后端 FastAPI 同时挂载了 `/api/*` HTTP 路由（`ws_channel.py:117`）：

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/config` | 读取 `~/.ftre/config.json` |
| POST | `/api/sessions` | 创建 session |
| GET | `/api/sessions` | 列出 sessions |
| GET | `/api/sessions/:id` | 获取 session 详情 |
| PUT | `/api/sessions/:id` | 更新 session（workspace/title） |
| GET | `/api/sessions/:id/messages` | 分页拉取历史消息（即 `USER_INPUT` 的来源） |
| DELETE | `/api/sessions/:id` | 删除 session |
| GET | `/api/workspaces` | 列出工作区 |
| GET | `/api/skills` | Skill CRUD |
| GET | `/api/cron/jobs` | Cron 任务 CRUD |

`fetchSessionMessagesPage` 分页参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| `limit` | int | 每页条数（默认 200） |
| `before_ts` | float | 拉取早于此时间戳的消息 |
| `after_ts` | float | 拉取晚于此时间戳的消息（增量更新用） |
