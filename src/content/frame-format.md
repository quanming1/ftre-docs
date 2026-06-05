# 帧格式规范

## 通用帧结构

所有 WebSocket 帧遵循统一的外壳结构，前后端共用：

```json
{
  "id": "<uuid>",
  "type": "<type>",
  "data": { ... },
  "metadata": { ... }
}
```

## id 字段

**用途**：
- 客户端发送帧时生成唯一 `id`（16 位 hex UUID）
- 后端将 `id` 回填到 echo 帧的 `metadata.frame_id`
- 前端用 `frame_id` 与本地乐观占位去重

**去重流程**：
1. 前端 `sendMessage()` 生成 `frameId`，本地 push `userMsg.id = frameId`
2. 上行帧 `id = frameId`
3. 后端 `_on_message` → `metadata.frame_id = frameId`
4. AgentLoop echo 时原样回填
5. 前端 `case "user_input"` 检查 `messages` 中是否已有同 `id` 消息 → 有则 skip push
6. 跨 session 消息 / cron 触发 / 多端同步：无本地占位 → 正常 push

## type 字段

### 上行（Client → Server）

| type | data.session_id | 是否隐式 attach | 说明 |
|------|:---:|:---:|------|
| `attach` | 必填 | — | 关注某个 session |
| `detach` | 必填 | — | 取消关注 |
| `user_input` | 必填 | ✅ | 用户消息 |
| `cancel` | 必填 | ✅ | 取消生成 |

### 下行（Server → Client）

| type | 说明 |
|------|------|
| `agent_event` | 包含 `data.type` 子类型，封装所有 Agent 事件 |
| `error` | 附件校验失败等直发错误（仅在 ws_channel 层产生） |

## data.content 协议

### v1（旧 / 兼容）— 字符串

```json
{ "content": "hello world" }
```

### v2（新）— 结构化数组

```json
{
  "content": [
    { "type": "text", "data": "帮我提交代码" },
    { "type": "skill", "data": "octo-im-github" }
  ]
}
```

**支持类型**：

| type | data | 说明 |
|------|------|------|
| `"text"` | `string` | 纯文本 |
| `"skill"` | `string` | 用户选中的 Skill 名称 |

**后端归一化**（`_content_to_text`）：
- `isinstance(content, str)` → 原样返回
- `isinstance(content, list)` → 遍历 parts，text 拼接到一起，skill 转为 XML 标注：
  ```xml
  <selected_skill name="octo-im-github">
  请调用 loadSkill 加载此 Skill 的完整内容。
  </selected_skill>
  ```

**向下兼容**：后端同时接受 string 和 array。前端还没升级时传 string，后端正常处理。

## data.content 在 different frame types 中的表现

### user_input（上行）

```json
{
  "data": {
    "content": "hello",
    "session_id": "ws::sess_xxx"
  }
}
```

### user_input echo（下行）

```json
{
  "data": {
    "type": "user_input",
    "data": {
      "content": "hello",
      "session_id": "ws::sess_xxx"
    }
  },
  "metadata": { "frame_id": "abc123def456" }
}
```

### USER_INPUT（历史回放）

后端 SessionManager 从 SQLite 读取：
```
messages 表 → WHERE session_id = ? ORDER BY timestamp ASC
```

历史事件的 `data.content` 保持原始 JSON 形态。回放时与实时使用同一个 `applyEvent` reducer，保证一致性。

## metadata 字段

### 上行 metadata（前端 → 后端）

由前端自由填充，常用字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `model` | string | LLM 模型（如 `"gpt-4o"`） |
| `provider` | string | Provider 名称（如 `"openai"`） |
| `agent_id` | string | Agent ID，默认 `"code_agent"` |
| `session_id` | string | 当前 session |

### 下行 metadata（后端 → 前端）

后端自动填充：

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `channel_id` | string | `msg.to_channel` | 来源 Channel |
| `session_id` | string | `msg.to_session` | 所属 session |
| `frame_id` | string | 上行 `frame.id` | echo 时的帧 ID（去重用） |

### BusMessage 内部字段（不入帧）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | Bus 消息 ID（帧的 `id` 仅用于 echo 去重） |
| `type` | string | `"user_input"` / `"cancel"` / `"agent_event"` |
| `from_channel` | string | 消息来源 Channel |
| `from_session` | string | 消息来源 Session |
| `to_channel` | string | 消息目标 Channel |
| `to_session` | string | 消息目标 Session |
| `timestamp` | float | 消息时间戳 |

## 帧生命周期（user_input 为例）

```
Client                          Server
  │                                │
  ├─ sendChat(content, meta) ────→│ ws_channel._on_message()
  │  (id=frameId)                 │   ├─ 校验 attachments
  │                               │   │   └─ ❌ 违规 → _reject(ws) 不入 Bus
  │                               │   ├─ frame_id → metadata
  │                               │   └─ receive(sid, data, meta)
  │  local push userMsg           │       └─ Bus.publish_inbound()
  │  (id=frameId)                 │           └─ AgentLoop._consume()
  │                               │               └─ _run() [thread]
  │                               │                   ├─ session 存在?
  │                               │                   ├─ channel 匹配?
  │                               │                   ├─ 已有 Agent 在跑? → skip
  │                               │                   ├─ save USER_INPUT
  │                               │                   ├─ echo user_input
  │                               │                   ├─ agent.run(messages)
  │  ←─ echo (frame_id=frameId) ──┤                   │   ├─ message chunk
  │  (skip, same id found)        │                   │   ├─ tool_call
  │                               │                   │   ├─ tool_result
  │  ←─ message ─────────────────┤                   │   ├─ message_complete
  │  ←─ tool_call ────────────────┤                   │   └─ done
  │  ←─ tool_result ──────────────┤                   │
  │  ←─ done ─────────────────────┤                   │
  │                               │                   └─ active_agents.pop()
```
