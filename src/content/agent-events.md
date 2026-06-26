# Agent 事件协议

Agent 运行时（`ReActRunner`）在执行过程中产出的一系列事件。内部为 `@dataclass` 类实例（`isinstance` 检查 + 属性访问），通过 `to_dict()` 序列化为 `{"type": "<EventType>", "data": { ... }}` 走线传输和 DB 存储。由 `ReActAgent.run()` 的 AsyncGenerator 逐条 yield。

本页主要描述 core `ReActAgent` 事件；`AgentLoop`、命令、压缩与工具层注入的扩展事件会在相应章节单独说明。

## 事件类层次

```
AgentEvent (基类 @dataclass)
 ├─ ToolCallEvent          — type = "tool_call"
 ├─ ToolResultEvent        — type = "tool_result"
 ├─ AssistantMessageEvent           — type = "assistant_message"
 ├─ AssistantMessageCompleteEvent   — type = "assistant_message_complete"
 ├─ ReasoningEvent         — type = "reasoning"
 ├─ ReasoningCompleteEvent — type = "reasoning_complete"
 ├─ ErrorEvent             — type = "error"
 ├─ RetryEvent             — type = "retry"
 ├─ DoneEvent              — type = "done"
 ├─ ToolCallStreamingEvent — type = "tool_call_streaming"
 ├─ UsageUpdateEvent       — type = "usage_update"
 └─ UserMessageEvent       — type = "user_message"
```

每个子类字段与下表 data 字段一一对应（如 `ToolCallEvent.tool_id` 对应 `data.id`）。

## 事件类型总览

| type | 说明 | 何时产生 |
|------|------|---------|
| `assistant_message` | LLM 流式文本片段 | LLM 每输出一段文字 |
| `assistant_message_complete` | LLM 一轮文本完成 | 流式收束 / 工具调用前 |
| `reasoning` | LLM 思考文本片段 | 支持 thinking 的模型输出 reasoning |
| `reasoning_complete` | LLM 思考文本完成 | 流式收束 / 工具调用前 |
| `tool_call` | 工具调用 | 解析 LLM 返回的 tool_calls 后 |
| `tool_call_streaming` | 工具调用参数流式增量 | `ToolInputDelta` 事件到达时产出 |
| `tool_result` | 工具执行结果 | 工具执行完成 |
| `usage_update` | Token 用量更新 | LLM 返回 usage 信息时 |
| `user_message` | 工具注入的 user message | Tool 返回 AgentEvent 时（LLM 可见，前端隐藏） |
| `retry` | LLM 重试 | 遇到可重试错误时 |
| `error` | Agent 错误 | LLM 调用失败（不可重试/重试耗尽） |
| `done` | 执行结束 | 正常完成 / 错误 / 取消 / 超迭代 |

> **注意**：`session_status` 不在此列。它不是 `ReActAgent` 产出的事件，而是 `AgentLoop` 在 session 进入 / 退出活跃态时注入的全局广播事件，使用顶层 `type: "global_event"`、`to_channel="*"` / `to_session="*"` 扇出给所有连接。详见 [WebSocket 协议 — 全局广播事件](/docs/ws-protocol) 与 [Bus 消息协议](/docs/bus-message)。

---

## 事件详细定义

### assistant_message

LLM 流式输出的**增量文本片段**（assistant role）。

```json
{
  "type": "assistant_message",
  "data": {
    "content": "你好，我是"
  }
}
```

| data 字段 | 类型 | 说明 |
|-----------|------|------|
| `content` | string | 本轮增量文本 |

**产生**：`ReActRunner._stream_turn()` 中 `async for event in self.llm.stream()` 的 `TextDelta` 分支。

### assistant_message_complete

LLM 一轮输出的**完整文本**。chunk 累积完毕后统一发出。

```json
{
  "type": "assistant_message_complete",
  "data": {
    "content": "你好，我是 ftre，一个 AI 编程助手。"
  }
}
```

**产生**：流式收束时（收到 `StepFinish`）或工具调用前。**仅在 LLM 有文本输出时产出**（`full_text` 非空）；纯工具调用轮次（无文本）不会产出此事件。

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

**产生**：`ReasoningDelta` 事件。

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

**产生**：流式收束或工具调用前，将累积的 reasoning 一次性发出。**仅在有思考内容时产出**（`full_reasoning` 非空）；无 reasoning 的轮次不会产出此事件。

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

**产生**：`ReActRunner._stream_turn()` 阶段 5，每个工具调用发一条。工具参数 JSON 解析失败时也会产出此事件，`arguments` 为空对象 `{}`；同时产出 `tool_result(status="failed")`。如果流结束时某个工具调用缺少有效 `id` 或 `name`，底层 accumulator 会跳过该调用，因而不会产生对应的 `tool_call` / `tool_result` 事件。

### tool_call_streaming

LLM **逐步输出**工具调用参数时的流式增量。

```json
{
  "type": "tool_call_streaming",
  "data": {
    "tool_calls": [
      {
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
| `index` | int | 工具调用序号（可选；当前 `react_runner` 构造事件时未包含此字段，前端不应依赖） |
| `id` | string | 工具调用 ID。当前 `react_runner` 会把 `ToolInputDelta.id` 原样放入事件；字段通常会出现，但值可能是空字符串，消费端不应依赖首个参数增量已有有效 ID |
| `name` | string | 工具名称。同 `id`，字段通常会出现，但值可能是空字符串，消费端应容忍无有效名称的早期增量 |
| `arguments_delta` | string | 参数字符串增量（可选字段；当前 `react_runner` 只在有参数片段时才通过 `ToolInputDelta` 产出事件，因此实际每个 chunk 都含此字段） |

> `id` / `name` / `arguments_delta` 为 `None` 时整个字段从 JSON 中省略（不输出 `"name": null`），因此消费端应以字段是否存在来判断，而非检查值是否为 `null`。`index` 同理，当前实现未包含此字段，消费端不应假设它存在。当前 `react_runner` 会把 `ToolInputDelta.id/name` 原样放入事件；这两个字段通常会出现，但值可能是空字符串 `""`（取决于上游 delta 是否已经给出 id/name），消费端不应假设首个参数增量一定有有效 id/name。

**产生**：LLM 流式输出的 `ToolInputDelta` 事件。当前 `LLMHandler`（Chat Completions 适配器）会在流式 `delta.tool_calls` 到达时产生；`react_runner` 收到 `ToolInputDelta` 后构造 `tool_call_streaming_event` 时仅传递 `id`、`name`、`arguments_delta`，不传递 `index`。

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
| `status` | string | 当前运行时实际会出现 `"completed"` / `"failed"` / `"cancelled"`；`"timed_out"` 当前未在 `ToolResult` 或 `tool_result_event()` 中实现。**注意**：前端当前用 `!!d.error` 判断 ok/error，不读取 `d.status`；取消/中断路径下可能出现 `status="cancelled"` 且 `error=null`，前端会将其映射为 `"ok"`，因此客户端若需要区分取消状态应优先读取 `status` |
| `error_code` | string \| null | 错误码（`react_runner` 调用 `tool_result_event()` 时未传入此参数，默认为 `null`） |
| `metadata` | object | 预留的工具附加元数据字段；`react_runner` 当前调用 `tool_result_event()` 时未将 `ToolResult.metadata` 传入，因此即使中间件 after 钩子补充了 metadata 也不会出现在事件中，此字段通常不存在 |

### tool_cancel_requested / tool_cancelled

这两个事件类型曾在 `AgentLoop.PERSISTENT_EVENTS`（已改为 `_PERSISTENT_CLASSES`）中被列出，但不在 `EventType` 枚举中，`event.py` 也没有对应的事件类，当前主运行路径不产出它们：

- 取消最终通过 `done(success=false, reason="cancelled")` 表达；如果工具任务被取消/中断，可能额外产出 `tool_result(status="cancelled")`，但不应依赖每次取消都有 cancelled 状态的 `tool_result`。
- 当前没有统一的 `tool_timed_out` 事件；工具超时通常由具体工具返回失败结果或错误文本。

因此客户端不应依赖这些事件作为取消/超时的实时信号。

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

**产生**：`StepFinish.usage` 不为空时。底层适配器在 OpenAI 流结束后会先 finalize 出完整 `ToolCall*` 内部事件，再产出 `StepFinish`；`react_runner` 收到 `ToolCall` 时会先记录并启动工具任务，收到随后的 `StepFinish` 后如果 `usage` 不为空则发出 `usage_update`。由于 `StepFinish` 仍在 `_stream_turn()` 的流循环内处理，而 `assistant_message_complete` 在流循环结束后才产出，因此对外 `usage_update` 始终出现在 `assistant_message_complete` 之前。

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
| `max_attempts` | int | 最大重试次数（不含首次尝试） |

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
| `api_error` | API 通用错误 | ✅ |
| `unknown` | 未知错误 | ✅ |
| `auth_error` | 认证失败 | ❌ |
| `bad_request` | 请求无效 | ❌ |
| `content_filter` | 内容审核未通过 | ❌ |

### done

**执行结束**。对已经进入 `ReActAgent.run()` / `ReActRunner` 的一次运行，正常完成、失败、取消或超迭代时都会产出此事件；`AgentLoop` 在入参为空、session 不存在、channel 不匹配等早退路径不会发布 `done`。取消时 `ReActRunner._loop()` 捕获 `CancelledError` 产出 `done(success=false, reason="cancelled")`；`AgentLoop._run_async()` 中 `CancelledError` 由 `task.cancel()` 触发，也会产出同样的 `done` 事件。

```json
{
  "type": "done",
  "data": {
    "success": true,
    "reason": "completed"
  }
}
```

| data 字段 | 类型 | 说明 |
|-----------|------|------|
| `success` | bool | 是否成功 |
| `reason` | string | `"completed"` / `"max_iterations"` / `"error"` / `"cancelled"` |
| `usage` | object | 总 Token 用量（可选；当前运行时不填充此字段，token 用量通过 `usage_update` 事件获取） |

---

## 事件产出时序

```
_user_message 到达 AgentLoop_
  │
  ├─ _loop() 开始
  │   │
  │   ├─ _stream_turn() 第 1 轮（有工具调用）
  │   │   ├─ LLM stream
  │   │   │   ├─ reasoning             (chunk 1，如有)
  │   │   │   ├─ assistant_message          (chunk，如有文本输出)
  │   │   │   └─ tool_call_streaming   (arg chunks)
  │   │   ├─ usage_update              (StepFinish.usage，如有)
  │   │   ├─ reasoning_complete          (如有思考内容)
  │   │   ├─ assistant_message_complete     (如有文本)
  │   │   ├─ tool_call × N → tool_result × N   (先全部 call，再全部 result)
  │   │
  │   ├─ _stream_turn() 第 2 轮（直接回复）
  │   │   ├─ LLM stream
  │   │   │   ├─ assistant_message          (chunk 1)
  │   │   │   └─ assistant_message          (chunk 2)
  │   │   ├─ usage_update              (StepFinish.usage，如有)
  │   │   ├─ assistant_message_complete
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
| 取消 | `"cancelled"` | false | 用户发送 `/cancel` 系统级指令，或前端 `cancel` 帧被转为 `/cancel` 后触发 `agent.cancel_nowait()` + `task.cancel()`，Agent 在 LLM stream 的 await 处抛出 `CancelledError` |

---

## 内部类型

这些结构只存在于 Agent 内部，不直接作为事件发出，但影响最终事件的生成。

### LLM 流式事件类型（概念模型）

以下类型是 `ftre-agent-core` 的 `LLMHandler` 在流式输出过程中产出的内部事件，不直接作为 Agent 事件发出，但影响最终事件的生成：

| 实际类型 | 字段 | 对应产出事件 |
|---------|------|-------------|
| `TextDelta` | `text: str` | → 产出一条 `assistant_message` 事件 |
| `ReasoningDelta` | `text: str` | → 产出一条 `reasoning` 事件 |
| `ToolInputDelta` | `id`, `name`, `text` | → 产出一条 `tool_call_streaming` 事件 |
| `ToolCall` | `id`, `name`, `input` | → 内部先记录并启动工具任务；对外事件在流循环结束、完整文本事件之后产出 |
| `StepFinish` | `finish_reason`, `usage` | → 产出一条 `usage_update` 事件（usage 不为空时） |

每个事件是独立对象，不存在"同一对象同时包含多个字段"的情况。当前 Chat Completions 适配器在 provider 流结束后产出的内部顺序是：先 `ToolCall*`，再 `StepFinish`。因此工具任务可能已经在对外 `usage_update` / `assistant_message_complete` 之前启动，但 `tool_call` / `tool_result` 这两个 Agent 事件仍会等到完整文本事件之后再统一产出。

### 流式收束后的产出顺序

`_stream_turn()` 的产出分两个阶段：

1. **流循环内（Phase 1）**：收到 `StepFinish` 时，若 `usage` 不为空则产出 `usage_update`（在流循环内处理，始终出现在 `assistant_message_complete` 之前）
2. **流循环结束后（Phase 2）**：按顺序产出 `reasoning_complete`（仅在有思考内容时）→ `assistant_message_complete`（仅在有文本时）→ 所有 `tool_call`（逐条产出）→ 所有 `tool_result`（逐条产出，与 tool_call 不交替）→ `UserMessageEvent`（如有）

## 事件转 OpenAI messages

后端在构造下一轮 LLM 输入时，会通过 `SessionManager.to_openai_messages()` 把持久化 Agent 事件重建为 OpenAI Chat Completions 兼容的 `messages`。重建时不会直接一条事件对应一条 message，而是按事件顺序合并同一轮 assistant 的 reasoning、可见文本和 tool calls。

### 普通回答：`reasoning_complete → assistant_message_complete`

没有工具调用时，reasoning 写入 `reasoning_content`，模型正文写入 `content`（text parts 列表）。`format_assistant_message()` 始终输出 `reasoning_content` 字段——有思考内容时为思考文本，无思考时为空字符串。

```json
[
  {
    "role": "assistant",
    "content": [
      {"type": "text", "text": "最终回答"}
    ],
    "reasoning_content": "思考过程"
  }
]
```

### 直接工具调用：`reasoning_complete → tool_call → tool_result`

如果模型没有输出可见文本就直接调用工具，assistant message 保留真实 `reasoning_content`，`content` 规范为空字符串。工具结果仍然单独转成 `role="tool"`。

```json
[
  {
    "role": "assistant",
    "content": "",
    "reasoning_content": "需要调用 bash 查看目录",
    "tool_calls": [
      {
        "id": "c1",
        "type": "function",
        "function": {
          "name": "bash",
          "arguments": "{\"command\": \"pwd\"}"
        }
      }
    ]
  },
  {
    "role": "tool",
    "tool_call_id": "c1",
    "content": "E:\\ftre"
  }
]
```

### 先输出可见文本再工具调用：`reasoning_complete → assistant_message_complete → tool_call → tool_result`

如果同一轮模型先输出可见文本，再发起工具调用，`assistant_message_complete` 不会立即落成一条普通 assistant message，而是先暂存；随后出现的 `tool_call` 会把它合并进同一条 assistant message。此时可见文本放在 `content`，真实 reasoning 保留在 `reasoning_content`。

```json
[
  {
    "role": "assistant",
    "content": [
      {"type": "text", "text": "我先检查当前目录。"}
    ],
    "reasoning_content": "我需要先说明，再调用 bash 查看目录",
    "tool_calls": [
      {
        "id": "c1",
        "type": "function",
        "function": {
          "name": "bash",
          "arguments": "{\"command\": \"pwd\"}"
        }
      }
    ]
  },
  {
    "role": "tool",
    "tool_call_id": "c1",
    "content": "E:\\ftre"
  }
]
```

### 只有可见文本：`assistant_message_complete`

如果没有 reasoning，也没有 tool call，则生成普通 assistant message。`content` 为 text parts 列表，`reasoning_content` 固定为空字符串（`format_assistant_message()` 始终输出此字段）。

```json
[
  {
    "role": "assistant",
    "content": [
      {"type": "text", "text": "最终回答"}
    ],
    "reasoning_content": ""
  }
]
```

### 工具参数解析失败

当 LLM 返回的 `tool_call.function.arguments` JSON 解析失败，但该工具调用仍有有效 `id` 和 `name` 时，仍然会产出 `tool_call` 事件（`arguments` 为空对象 `{}`），同时产出 `tool_result(status="failed")`。`name` 保留模型返回的原始 `tool_call.function.name`。如果缺少有效 `id` 或 `name`，该工具调用会在 accumulator finalize 阶段被跳过，不会进入后续工具执行阶段。

```json
{
  "type": "tool_call",
  "data": {
    "id": "call_abc123",
    "name": "bash",
    "arguments": {}
  }
}
```

```json
{
  "type": "tool_result",
  "data": {
    "id": "call_abc123",
    "name": "bash",
    "result": "[PARSE_ERROR] Tool call arguments were malformed JSON.",
    "error": "malformed JSON arguments",
    "status": "failed",
    "error_code": null
  }
}
```

### user_message

工具返回 `AgentEvent`（非 `str`）时，`react_runner` 在所有 `tool_result` 之后统一注入此事件到 memory。LLM 下一轮可"看到"事件内容，前端跳过渲染（`metadata.hide=true`）。

典型场景：`read` 工具在读取图片时返回 `UserMessageEvent(content=[image_file])`，Agent 无需等待用户即可识别图片内容。图片数据落盘到 OS temp 目录，事件中只携带文件路径；`to_openai_message()` 在写入 memory 时自动将 `image_file` 转为 `image_url`（读文件转 base64 data URL）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `content` | `str \| list[dict]` | OpenAI 格式 user message content；图片为 `{"type": "image_file", "path": "<abs_path>", "mime_type": "<mime>"}` |
| `metadata` | `dict` | 默认 `{"hide": True}`，前端由此跳过渲染 |

```json
{
  "type": "user_message",
  "data": {
    "content": [{"type": "image_file", "path": "C:/Users/.../Temp/ftre_images/screenshot.png", "mime_type": "image/png"}],
    "metadata": {"hide": true}
  }
}
```
