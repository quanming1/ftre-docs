# WebSocket 协议

## 连接

```
ws://127.0.0.1:18790/
```

客户端通过 WebSocket 连接到 Gateway，发送 JSON 帧。

## 上行帧（Client → Server）

### 格式

```json
{
  "id": "<frame-id>",
  "type": "<frame-type>",
  "data": { ... },
  "metadata": { ... }
}
```

### 帧类型

| type | 说明 | data 必填字段 |
|------|------|--------------|
| `attach` | 声明该连接关注某 session | `session_id` |
| `detach` | 取消关注 | `session_id` |
| `user_input` | 用户消息 | `session_id`, `content` |
| `cancel` | 取消当前执行 | `session_id` |

### user_input 帧

```json
{
  "id": "abc123",
  "type": "user_input",
  "data": {
    "content": "帮我写一个函数",
    "session_id": "ws::sess_xxx",
    "attachments": [...]
  },
  "metadata": {
    "model": "gpt-4o",
    "provider": "openai"
  }
}
```

**content 支持两种形态（向下兼容）：**

- **字符串**：`"hello world"`
- **对象数组**：
```json
[
  {"type": "text", "data": "帮我提交代码"},
  {"type": "skill", "data": "octo-im-github"}
]
```

其中 `"skill"` 类型表示用户通过 `/` 菜单选择了 Skill，后端会转为：

```xml
<selected_skill name="octo-im-github">
请调用 loadSkill 加载此 Skill 的完整内容。
</selected_skill>
```

## 下行帧（Server → Client）

### 格式

```json
{
  "id": "<message-id>",
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

### 事件类型

| data.type | 说明 |
|-----------|------|
| `user_input` | 用户消息 echo（去重用） |
| `message` | LLM 流式文本 |
| `message_complete` | LLM 一轮完成 |
| `tool_call` | 工具调用 |
| `tool_result` | 工具结果 |
| `error` | 错误 |
| `done` | 响应结束 |
