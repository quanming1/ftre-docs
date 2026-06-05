# Agent 事件协议

Agent 运行时（`ReActRunner`）在执行过程中产出的一系列事件。所有事件格式为 `{"type": "<EventType>", "data": { ... }}`，由 `ReActAgent.run()` 的 Generator 逐条 yield。

## 事件类型总览

| type | 说明 | 何时产生 |
|------|------|---------|
| `message` | LLM 流式文本片段 | LLM 每输出一段文字 |
| `message_complete` | LLM 一轮文本完成 | 流式收束 / 工具调用前 |
| `reasoning` | LLM 思考文本片段 | 支持 thinking 的模型输出 reasoning |
| `reasoning_complete` | LLM 思考文本完成 | 流式收束 / 工具调用前 |
| `tool_call` | 工具调用 | 解析 LLM 返回的 tool_calls 后 |
| `tool_call_streaming` | 工具调用参数流式增量 | LLM 逐步输出 tool_call args |
| `tool_result` | 工具执行结果 | 工具执行完成 |
| `tool_cancel_requested` | 工具取消请求 | 用户取消时，每个 pending 工具 |
| `tool_cancelled` | 工具已取消 | 工具被取消后 |
| `tool_timed_out` | 工具执行超时 | 工具执行超时 |
| `usage_update` | Token 用量更新 | LLM 返回 usage 信息时 |
| `retry` | LLM 重试 | 遇到可重试错误时 |
| `error` | Agent 错误 | LLM 调用失败（不可重试/重试耗尽） |
| `done` | 执行结束 | 正常完成 / 错误 / 取消 / 超迭代 |

---

## 事件详细定义

### message

LLM 流式输出的**增量文本片段**。

```json
{
  "type": "message",
  "data": {
    "content": "你好，我是"
  }
}
```

| data 字段 | 类型 | 说明 |
|-----------|------|------|
| `content` | string | 本轮增量文本 |

**产生**：`ReActRunner._step()` 中 `for item in self.llm.stream()` 的 `StreamDelta.content` 分支。

### message_complete

LLM 一轮输出的**完整文本**。chunk 累积完毕后统一发出。

```json
{
  "type": "message_complete",
  "data": {
    "content": "你好，我是 ftre，一个 AI 编程助手。"
  }
}
```

**产生**：流式收束时（收到 `LLMResponse`）或工具调用前。

### reasoning

支持 thinking 的模型（DeepSeek-R1、千问 QwQ 等）产出的**思考过程文本片段**。

```json
{
  "type": "reasoning",
  "data": {
    "content": "用户想要..."
  }
}
```

**产生**：`StreamDelta.reasoning` 分支。

### reasoning_complete

一轮思考的**完整文本**。

```json
{
  "type": "reasoning_complete",
  "data": {
    "content": "用户想要一个函数来计算斐波那契数列..."
  }
}
```

**产生**：流式收束或工具调用前，将累积的 reasoning 一次性发出。

### tool_call

LLM 返回一个**完整的工具调用**。

```json
{
  "type": "tool_call",
  "data": {
    "id": "call_abc123",
    "name": "bash",
    "arguments": {
      "command": "ls -la"
    }
  }
}
```

| data 字段 | 类型 | 说明 |
|-----------|------|------|
| `id` | string | 工具调用唯一 ID |
| `name` | string | 工具名称 |
| `arguments` | object | 完整工具参数 |

**产生**：`ToolHandler.execute()` 入口处，每个解析成功的工具调用发一条。

### tool_call_streaming

LLM **逐步输出**工具调用参数时的流式增量。

```json
{
  "type": "tool_call_streaming",
  "data": {
    "tool_calls": [
      {
        "index": 0,
        "id": "call_abc123",
        "name": "bash",
        "arguments_delta": "{\"com"
      }
    ]
  }
}
```

| tool_calls[] 字段 | 类型 | 说明 |
|-------------------|------|------|
| `index` | int | 工具调用序号 |
| `id` | string | 工具调用 ID |
| `name` | string | 工具名称（可能为 null） |
| `arguments_delta` | string | 参数字符串增量 |

**产生**：`StreamDelta.tool_calls` 分支。

### tool_result

**工具执行结果**。

```json
{
  "type": "tool_result",
  "data": {
    "id": "call_abc123",
    "name": "bash",
    "result": "file1.txt  file2.txt",
    "error": null,
    "status": "completed",
    "error_code": null
  }
}
```

| data 字段 | 类型 | 说明 |
|-----------|------|------|
| `id` | string | 关联的 tool_call ID |
| `name` | string | 工具名称 |
| `result` | string | 执行结果 |
| `error` | string \| null | null 表示成功 |
| `status` | string | `"completed"` / `"failed"` / `"cancelled"` |
| `error_code` | string \| null | 错误码（如 `"cancelled"`, `"timed_out"`, `"parse_error"`） |
| `metadata` | object | 工具附加元数据（可选，由工具实现传入） |

### tool_cancel_requested

取消信号到达时，**正在 pending 的工具**标记为取消请求。

```json
{
  "type": "tool_cancel_requested",
  "data": {
    "id": "call_abc123",
    "name": "bash",
    "reason": "user_cancelled",
    "status": "cancelling",
    "error_code": null,
    "result_status": "cancelled"
  }
}
```

| data 字段 | 类型 | 说明 |
|-----------|------|------|
| `id` | string | 工具调用 ID |
| `name` | string | 工具名称 |
| `reason` | string | 取消原因（如 `"user_cancelled"`） |
| `status` | string | 固定为 `"cancelling"` |
| `error_code` | string \| null | 错误码 |
| `result_status` | string \| null | 最终结果状态（`"cancelled"`） |

### tool_cancelled / tool_timed_out

工具被取消或超时后发出的状态事件。

**tool_cancelled**：
```json
{
  "type": "tool_cancelled",
  "data": {
    "id": "call_abc123",
    "name": "bash",
    "reason": "user_cancelled",
    "status": "cancelled",
    "error_code": "cancelled",
    "result_status": "cancelled"
  }
}
```

**tool_timed_out**：
```json
{
  "type": "tool_timed_out",
  "data": {
    "id": "call_abc123",
    "name": "bash",
    "reason": "timed_out",
    "status": "timed_out",
    "error_code": "timed_out",
    "result_status": "timed_out"
  }
}
```

| data 字段 | 类型 | 说明 |
|-----------|------|------|
| `id` | string | 工具调用 ID |
| `name` | string | 工具名称 |
| `reason` | string | 原因（`"user_cancelled"` / `"timed_out"`） |
| `status` | string | `"cancelled"` / `"timed_out"` |
| `error_code` | string \| null | 错误码 |
| `result_status` | string \| null | 最终结果状态 |

### usage_update

LLM 返回的 **Token 用量**。

```json
{
  "type": "usage_update",
  "data": {
    "usage": {
      "prompt_tokens": 1200,
      "completion_tokens": 350,
      "total_tokens": 1550
    }
  }
}
```

**产生**：`LLMResponse.usage` 或 `StreamDelta.usage` 不为空时。

### retry

LLM 调用遇到**可重试错误**（网络/超时/限流等），准备重试。

```json
{
  "type": "retry",
  "data": {
    "code": "network",
    "message": "网络连接失败",
    "attempt": 1,
    "max_attempts": 5
  }
}
```

| data 字段 | 类型 | 说明 |
|-----------|------|------|
| `code` | string | 错误码 |
| `message` | string | 错误描述 |
| `attempt` | int | 当前重试次数（从 1 开始） |
| `max_attempts` | int | 最大重试次数 |

### error

LLM 调用**不可重试**或重试耗尽后的错误。

```json
{
  "type": "error",
  "data": {
    "message": "认证失败",
    "code": "auth_error"
  }
}
```

| data 字段 | 类型 | 说明 |
|-----------|------|------|
| `message` | string | 错误描述 |
| `code` | string | 错误码 |

常见错误码：

| code | 说明 | 是否可重试 |
|------|------|:---:|
| `network` | 网络连接失败 | ✅ |
| `timeout` | 请求超时 | ✅ |
| `rate_limit` | 频率限制 | ✅ |
| `internal_server_error` | 服务端内部错误 | ✅ |
| `auth_error` | 认证失败 | ❌ |
| `bad_request` | 请求无效 | ❌ |
| `content_filter` | 内容审核未通过 | ❌ |

### done

**执行结束**。不论成功/失败/取消/超迭代，最后必定有一条。

```json
{
  "type": "done",
  "data": {
    "success": true,
    "reason": "completed",
    "usage": { "prompt_tokens": 1500, "completion_tokens": 500, "total_tokens": 2000 }
  }
}
```

| data 字段 | 类型 | 说明 |
|-----------|------|------|
| `success` | bool | 是否成功 |
| `reason` | string | `"completed"` / `"max_iterations"` / `"error"` / `"cancelled"` |
| `usage` | object | 总 Token 用量（可选） |

---

## 事件产出时序

```
_user_input 到达 AgentLoop_
  │
  ├─ _loop() 开始
  │   │
  │   ├─ _step() 第 1 轮
  │   │   ├─ LLM stream
  │   │   │   ├─ reasoning         (chunk 1)
  │   │   │   ├─ reasoning         (chunk 2)
  │   │   │   ├─ tool_call_streaming  (arg chunk)
  │   │   │   └─ usage_update
  │   │   ├─ reasoning_complete
  │   │   ├─ message_complete      (如有文本)
  │   │   ├─ tool_call             (每个 tool)
  │   │   └─ tool_result           (每个 tool)
  │   │
  │   ├─ _step() 第 2 轮
  │   │   ├─ message               (chunk 1)
  │   │   ├─ message               (chunk 2)
  │   │   ├─ message_complete
  │   │   └─ done (success=true, reason="completed")
  │   │
  │   └─ _loop() 结束
  │
  └─ _active_agents.pop()
```

## Agent 的退出路径

| 路径 | done.reason | done.success | 触发条件 |
|------|------------|:---:|------|
| 正常完成 | `"completed"` | true | 模型不再调用工具，直接输出最终回答 |
| 超出迭代 | `"max_iterations"` | false | 达到 `max_iterations` 上限 |
| 错误 | `"error"` | false | LLM 调用失败且不可重试/重试耗尽 |
| 取消 | `"cancelled"` | false | 用户发送 cancel 帧 |

---

## 内部类型

这些结构只存在于 Agent 内部，不直接作为事件发出，但影响最终事件的生成。

### StreamDelta

LLM 流式输出的单次增量。

| 字段 | 类型 | 说明 |
|------|------|------|
| `content` | string \| null | 文本增量 → 产出一条 `message` 事件 |
| `reasoning` | string \| null | thinking 内容增量 → 产出一条 `reasoning` 事件 |
| `tool_calls` | ToolCallDeltaChunk[] \| null | 工具调用增量 → 产出一条 `tool_call_streaming` 事件 |
| `usage` | dict \| null | usage → 产出一条 `usage_update` 事件 |

同一个 StreamDelta 可同时包含多个字段。

### LLMResponse

一次完整流式响应收束后的结果。

| 字段 | 类型 | 说明 |
|------|------|------|
| `content` | string \| null | 完整文本（如有）|
| `reasoning` | string \| null | 完整 reasoning（thinking 模型）|
| `tool_calls` | ToolCallWrapper[] | 完整工具调用列表 |
| `usage` | dict \| null | 本次响应的 Token 用量 |

收到后按顺序产出：usage_update → reasoning_complete → message_complete → tool_call → tool_result。

### 工具参数解析失败

当 LLM 返回的 tool_call.function.arguments JSON 解析失败时，**不产出 tool_call 事件**，直接产出 tool_result：

```json
{
  "type": "tool_result",
  "data": {
    "id": "call_abc123",
    "name": "unknown",
    "result": "[PARSE_ERROR] Tool call JSON truncated or malformed. Please retry.",
    "error": "[PARSE_ERROR] Tool call JSON truncated or malformed. Please retry.",
    "status": "failed"
  }
}
```
