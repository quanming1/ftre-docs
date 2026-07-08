# Agent 事件协议

Agent 运行时（`ReActRunner`）在执行过程中产出的一系列事件。内部为 `@dataclass` 类实例（`isinstance` 检查 + 属性访问），通过 `to_dict()` 序列化为 `{"type": "<EventType>", "event_id": "<id>", "data": { ... }}` 走线传输；Gateway 入库时会把同一个 `event_id` 写入 `messages.data.event_id`，用于前端统一去重 HTTP history、WS live 和 WS replay。由 `ReActAgent.run()` 的 AsyncGenerator 逐条 yield。

本页主要描述 core `ReActAgent` 事件；`AgentLoop`、命令、压缩与工具层注入的扩展事件会在相应章节单独说明。

## 事件类层次

```
AgentEvent (基类 @dataclass)
 ├─ ToolResultEvent              — type = "tool_result"
 ├─ AssistantMessageEvent        — type = "assistant_message"
 ├─ AssistantMessageCompleteEvent — type = "assistant_message_complete"
 ├─ ErrorEvent                   — type = "error"
 ├─ RetryEvent                   — type = "retry"
 ├─ DoneEvent                    — type = "done"
 └─ UserMessageEvent             — type = "user_message"
```

> `EventType` 枚举（`ftre-agent-core/src/ftre_agent_core/agent/event.py`）当前只含上述 7 个值。文本 / 推理 / 工具参数三类流式片段统一通过 `assistant_message` 事件携带的 `content[]` 快照对外输出（`react_runner._emit_streaming()` 始终 yield `assistant_message`，把 `text` / `thinking` / `toolCall` 三类 part 一起打包）。

每个子类字段与下表 data 字段一一对应（如 `ToolResultEvent.tool_id` 对应 `data.id`）。

## 事件类型总览

| type | 说明 | 何时产生 |
|------|------|---------|
| `assistant_message` | 流式 assistant 消息快照（`content[]` 累积到当前为止的完整内容，含 text / thinking / toolCall） | 每次 LLM 输出增量（text / reasoning / toolCall 参数片段） |
| `assistant_message_complete` | LLM 一轮完整消息（含 text / thinking / toolCall，对齐 OpenAI message 格式） | 流式收束 / 工具调用前 |
| `tool_result` | 工具执行结果 | 工具执行完成 |
| `user_message` | 工具注入的 user message | Tool 返回 AgentEvent 时（LLM 可见，前端隐藏） |
| `retry` | LLM 重试 | 遇到可重试错误时 |
| `error` | Agent 错误 | LLM 调用失败（不可重试/重试耗尽） |
| `done` | 执行结束 | 正常完成 / 错误 / 取消 / 超迭代 |

> **注意**：`session_status` 不在此列。它不是 `ReActAgent` 产出的事件，而是 `AgentLoop` 在 session 进入 / 退出活跃态时注入的全局广播事件，使用顶层 `type: "global_event"`、`to_channel="*"` / `to_session="*"` 扇出给所有连接。详见 [WebSocket 协议 — 全局广播事件](/docs/ws-protocol) 与 [Bus 消息协议](/docs/bus-message)。

---

## 事件详细定义

### assistant_message

LLM 流式输出的**增量快照**（assistant role），每次携带到当前为止的完整 `content[]`。`content` 是内容块数组，混合 `text` / `thinking` / `toolCall`，与 `assistant_message_complete` 的 `content` 形状一致；前端消费时按 `partial_content` 理解即可。

```json
{
  "type": "assistant_message",
  "event_id": "<16-hex>",
  "data": {
    "content": [
      {"type": "text", "text": "我先检查当前目录。"},
      {"type": "toolCall", "id": "call_abc123", "name": "bash", "arguments": {"command": "ls -la"}}
    ]
  }
}
```

| data 字段 | 类型 | 说明 |
|-----------|------|------|
| `content` | `list[dict]` | 当前累积的 `content[]` 快照。块类型与 `assistant_message_complete.content[]` 一致（`text` / `thinking` / `toolCall`）。**streaming 阶段的 part 不携带 `event_id`**，event_id 只在 `_build_complete_events()` 产出 `assistant_message_complete` 时统一写入 |

**产生**：`ReActRunner._stream_turn()` 中 `async for event in self.llm.stream()` 的 `TextDelta` / `ReasoningDelta` / `ToolInputDelta` / `ToolCall` 四个分支都会把增量累积到 `partial_content`，然后通过 `_emit_streaming()` 统一产出一条 `assistant_message` 快照事件；文本 / 推理 / 工具参数三类流式片段都封装在 `assistant_message` 的 `content[]` 中。

### assistant_message_complete

LLM 一轮输出的**完整消息**。chunk 累积完毕后统一发出，`content` 是内容块数组，混合 text / thinking / toolCall，对齐 OpenAI Chat Completions API 的 message content 格式。`metadata` 携带 usage、kind、stopReason 等元信息。

`metadata.kind` 区分中间块与最终回复：

- `kind = "block"`：本轮有工具调用，文本是中间过渡（如"我先查看一下"），后续还有更多轮次
- `kind = "final"`：本轮无工具调用，文本是 Agent 的最终回复

#### 一轮有工具调用（kind="block"）

```json
{
  "type": "assistant_message_complete",
  "event_id": "<16-hex>",
  "data": {
    "content": [
      {"type": "thinking", "thinking": "用户想要查看目录内容...", "event_id": "<16-hex>"},
      {"type": "text", "text": "我先检查当前目录。", "event_id": "<16-hex>"},
      {"type": "toolCall", "id": "call_abc123", "name": "bash", "arguments": {"command": "ls -la"}, "event_id": "<16-hex>"}
    ],
    "metadata": {
      "kind": "block",
      "usage": {"prompt_tokens": 1200, "completion_tokens": 350, "total_tokens": 1550},
      "stopReason": "tool_calls",
      "model": "claude-opus-4-5-20251101",
      "responseId": "chatcmpl-636c721d"
    }
  }
}
```

#### 一轮最终回复（kind="final"）

```json
{
  "type": "assistant_message_complete",
  "event_id": "<16-hex>",
  "data": {
    "content": [
      {"type": "text", "text": "你好，我是 ftre，一个 AI 编程助手。", "event_id": "<16-hex>"}
    ],
    "metadata": {
      "kind": "final",
      "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
      "stopReason": "stop"
    }
  }
}
```

#### content 块类型

| type | 结构 | 说明 |
|------|------|------|
| `text` | `{type, text, event_id}` | 文本输出 |
| `thinking` | `{type, thinking, event_id}` | 推理/思考链 |
| `toolCall` | `{type, id, name, arguments, event_id}` | 工具调用 |

> 每块实际还携带 `event_id`（16 位 hex UUID），由 `ReActRunner._build_complete_events()` 在产出 `assistant_message_complete` 时统一生成（`uuid.uuid4().hex[:16]`），用于与 `assistant_message_complete.event_id` 一致的细粒度去重。前端 `applyEvent` 当前不依赖 `event_id` 做块级去重，仅文档级登记。

#### metadata 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `kind` | string | `"block"`（中间块，有工具调用）或 `"final"`（最终回复）；默认 `"final"` |
| `usage` | object \| null | Token 用量（`prompt_tokens` / `completion_tokens` / `total_tokens`） |
| `stopReason` | string \| null | provider 返回的 `finish_reason`：`"stop"`（自然停止）/ `"tool_calls"`（触发工具调用）/ `"length"`（超过 `max_tokens` 截断）/ `"content_filter"`（被内容过滤）等 |
| `model` | string \| null | provider 响应中的模型 ID（来自 OpenAI 响应的 `model` 字段） |
| `responseId` | string \| null | provider 响应 ID（来自 OpenAI 响应的 `id` 字段，如 `chatcmpl-...`） |

> `_build_complete_events()` 当前仅在 `kind` / `usage` / `stopReason` / `responseId` / `model` 五项存在时写入对应字段；旧的 `provider` / `error` 字段不写入。`stopReason` 的可能值与具体 provider 的 `finish_reason` 枚举一致（OpenAI Chat Completions 通常为 `"stop"` / `"tool_calls"` / `"length"` / `"content_filter"`），并未统一为 `toolUse` / `error`。

**产生**：`ReActRunner._build_complete_events()` 在流式收束时（收到 `StepFinish`）组装。将本轮累积的 `reasoning_parts`、`text_parts`、`tool_calls`、`usage`、`finish_reason` 合并为单个事件。**仅在 `content` 非空时产出**；纯空轮次（无文本、无思考、无工具调用）不会产出此事件。

> 旧的 `usage_update`、`reasoning_complete`、`tool_call` 三个独立事件已被合并到此事件的 `metadata` 和 `content[]` 中，不再单独产出。

### tool_result

**工具执行结果**。

```json
{
  "type": "tool_result",
  "event_id": "<16-hex>",
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
| `id` | string | 关联的 toolCall ID（来自 `assistant_message_complete.content[].toolCall.id`） |
| `name` | string | 工具名称 |
| `result` | string | 执行结果 |
| `error` | string \| null | null 表示成功 |
| `status` | string | 当前运行时实际会出现 `"completed"` / `"failed"` / `"cancelled"`；`"timed_out"` 当前未在 `ToolResult` 或 `tool_result_event()` 中实现。**注意**：前端当前用 `!!d.error` 判断 ok/error，不读取 `d.status`；取消/中断路径下可能出现 `status="cancelled"` 且 `error=null`，前端会将其映射为 `"ok"`，因此客户端若需要区分取消状态应优先读取 `status` |
| `error_code` | string \| null | 错误码（`react_runner` 调用 `tool_result_event()` 时未传入此参数，默认为 `null`） |
| `metadata` | object \| undefined | 工具附加元数据。仅文件编辑类工具（`edit` / `write`）会填充此字段，携带 diff 信息供前端渲染文件变更预览。其他工具不产出此字段。详见下表 |

#### tool_result.metadata（文件编辑工具）

当 `edit` 或 `write` 工具执行成功后，`metadata` 携带变更的 diff 信息。diff 由 Python 标准库 `difflib.unified_diff()` 在内存中对比修改前后的文件内容生成，不依赖 git。

```json
{
  "type": "tool_result",
  "data": {
    "id": "call_xyz789",
    "name": "edit",
    "result": "已修改文件 src/foo.ts",
    "error": null,
    "status": "completed",
    "error_code": null,
    "metadata": {
      "file": "E:/project/src/foo.ts",
      "before": "const x = 1;\nconst y = 2;\nconst z = 3;\n",
      "after": "const x = 1;\nconst y = 3;\nconst z = 3;\n",
      "diff": "--- src/foo.ts\n+++ src/foo.ts\n@@ -10,7 +10,7 @@\n const x = 1;\n-const y = 2;\n+const y = 3;\n const z = 3;\n",
      "additions": 1,
      "deletions": 1
    }
  }
}
```

| metadata 字段 | 类型 | 说明 |
|---------------|------|------|
| `file` | string | 被修改文件的绝对路径（正斜杠格式） |
| `before` | string | 修改前的完整文件内容 |
| `after` | string | 修改后的完整文件内容 |
| `diff` | string | unified diff 格式的变更摘要文本（仅含 hunk 片段） |
| `additions` | int | 新增行数（`+` 开头且非 `+++` 的行数） |
| `deletions` | int | 删除行数（`-` 开头且非 `---` 的行数） |

> **设计参考**：opencode 的 edit 工具同样在 `tool_result.metadata` 中携带 `{ diff, filediff, diagnostics }`，前端直接从 metadata 读取 diff 渲染，无需二次读取文件。ftre 采用相同模式，但用 Python `difflib` 替代 npm `diff` 包。

### tool_cancel_requested / tool_cancelled

这两个事件类型当前**不在任何代码路径中**——既不在 `ftre-agent-core/src/ftre_agent_core/agent/event.py` 的 `EventType` 枚举中，也不在 `AgentLoop._PERSISTENT_CLASSES` 白名单里，`event.py` 也没有对应的事件类，当前主运行路径不产出它们：

- 取消最终通过 `done(success=false, reason="cancelled")` 表达；如果工具任务被取消/中断，可能额外产出 `tool_result(status="cancelled")`，但不应依赖每次取消都有 cancelled 状态的 `tool_result`。
- 当前没有统一的 `tool_timed_out` 事件；工具超时通常由具体工具返回失败结果或错误文本。

因此客户端不应依赖这些事件作为取消/超时的实时信号。

### retry

LLM 调用遇到**可重试错误**（网络/超时/限流等），准备重试。

```json
{
  "type": "retry",
  "event_id": "<16-hex>",
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

**产生**：`react_runner` 捕获到可重试异常时产出，在 `error` 之前。如果重试耗尽，最后产出 `error` 事件。

### error

LLM 调用失败且**不可重试**或重试耗尽。

```json
{
  "type": "error",
  "event_id": "<16-hex>",
  "data": {
    "message": "API 余额不足",
    "code": "bad_request"
  }
}
```

| data 字段 | 类型 | 说明 |
|-----------|------|------|
| `message` | string | 错误描述 |
| `code` | string | 错误码（`auth_error` / `bad_request` / `rate_limit` / `timeout` / `api_error` / `unknown`） |

**产生**：`react_runner` 捕获到不可重试异常或重试耗尽时产出。`error` 事件之后会产出 `done(success=false, reason="error")`。

### done

执行结束。

```json
{
  "type": "done",
  "event_id": "<16-hex>",
  "data": {
    "success": true,
    "reason": "completed"
  }
}
```

| data 字段 | 类型 | 说明 |
|-----------|------|------|
| `success` | boolean | 是否成功完成 |
| `reason` | string | `"completed"` / `"max_iterations"` / `"error"` / `"cancelled"` |

> Token 用量不再通过 `done` 事件传递，而是在 `assistant_message_complete.metadata.usage` 中。

### user_message

工具返回 `AgentEvent`（非 `str`）时，`react_runner` 在所有 `tool_result` 之后统一注入此事件到 memory。LLM 下一轮可"看到"事件内容，前端跳过渲染（`metadata.hide=true`）。

典型场景：`read` 工具在读取图片时返回 `UserMessageEvent(content=[image_file])`，Agent 无需等待用户即可识别图片内容。图片数据落盘到 `~/.ftre/assets/images/`，事件中只携带文件路径；`to_openai_message()` 在写入 memory 时自动将 `image_file` 转为 `image_url`（读文件转 base64 data URL）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `content` | `str \| list[dict]` | OpenAI 格式 user message content；图片为 `{"type": "image_file", "path": "<abs_path>", "mime_type": "<mime>"}` |
| `metadata` | `dict` | 默认 `{"hide": True}`，前端由此跳过渲染 |

```json
{
  "type": "user_message",
  "event_id": "<16-hex>",
  "data": {
    "content": [{"type": "image_file", "path": "C:/Users/.../.ftre/assets/images/screenshot.png", "mime_type": "image/png"}],
    "metadata": {"hide": true}
  }
}
```

---

## 事件产出时序

```
_user_message 到达 AgentLoop_
  │
  ├─ _loop() 开始
  │   │
  │   ├─ _stream_turn() 第 1 轮（有工具调用）
  │   │   ├─ LLM stream
  │   │   │   ├─ assistant_message  (chunk 1，content 累积到当前快照，含 text/thinking/toolCall parts)
  │   │   │   ├─ assistant_message  (chunk 2 ...)
  │   │   │   └─ ...
  │   │   ├─ assistant_message_complete     (content=[thinking, text, toolCall], metadata={kind:"block", usage, stopReason:"tool_calls"})
  │   │   └─ tool_result × N                (逐条产出)
  │   │
  │   ├─ _stream_turn() 第 2 轮（直接回复）
  │   │   ├─ LLM stream
  │   │   │   ├─ assistant_message  (chunk 1)
  │   │   │   └─ assistant_message  (chunk 2)
  │   │   ├─ assistant_message_complete     (content=[text], metadata={kind:"final", usage, stopReason:"stop"})
  │   │   └─ done (success=true, reason="completed")
  │   │
  │   └─ _loop() 结束
  │
  └─ _active_agents.pop()
```

> 流式阶段所有 LLM 增量（text / reasoning / 工具参数片段）都通过 `assistant_message` 事件携带的 `content[]` 快照对外发出，块结构与 `assistant_message_complete.content[]` 一致。

### 多轮 ReAct 示例

3 轮工具调用 + 1 轮最终回复：

```
第 1 轮 LLM:
  [流式 chunk: assistant_message × N（content[] 累积 text / thinking / toolCall parts）]
  assistant_message_complete  ← content=[thinking, text, toolCall(bash curl)]
                                metadata={usage:{total:3605}, kind:"block", stopReason:"tool_calls"}
  tool_result                 ← id=tool-670d, result="..."

第 2 轮 LLM:
  [流式 chunk: assistant_message × N（content[] 累积 toolCall parts）]
  assistant_message_complete  ← content=[toolCall(bash pwsh)]
                                metadata={usage:{total:3877}, kind:"block", stopReason:"tool_calls"}
  tool_result                 ← id=tool-3f0d, result="pwsh 不是..."

第 3 轮 LLM:
  [流式 chunk: assistant_message × N（content[] 累积 text / toolCall parts）]
  assistant_message_complete  ← content=[text:"已获取到余额...", toolCall(send_message)]
                                metadata={usage:{total:3982}, kind:"block", stopReason:"tool_calls"}
  tool_result                 ← id=call_7940, result="已通知..."

第 4 轮 LLM:
  [流式 chunk: assistant_message × N（content[] 累积 text parts）]
  assistant_message_complete  ← content=[text:"已完成：查询到余额 $1323.93..."]
                                metadata={usage:{total:4037}, kind:"final", stopReason:"stop"}
  done                        ← success=true reason=completed
```

## Agent 的退出路径

| 路径 | done.reason | done.success | 触发条件 |
|------|------------|:---:|------|
| 正常完成 | `"completed"` | true | 模型不再调用工具，直接输出最终回答 |
| 超出迭代 | `"max_iterations"` | false | 达到 `max_iterations` 上限 |
| 错误 | `"error"` | false | LLM 调用失败且不可重试/重试耗尽 |
| 取消 | `"cancelled"` | false | 用户发送 `/cancel` 系统级指令，或前端 `cancel` 帧被转为 `/cancel` 后触发 `agent.cancel_nowait()` + `task.cancel()`，Agent 在 LLM stream 的 await 处抛出 `CancelledError`；若取消直接由 `AgentLoop` 捕获，则由 `AgentLoop` 补发 outbound `done(cancelled)` |

---

## 内部类型

这些结构只存在于 Agent 内部，不直接作为事件发出，但影响最终事件的生成。

### LLM 流式事件类型（概念模型）

以下类型是 `ftre-agent-core` 的 `LLMHandler` 在流式输出过程中产出的**内部 LLM 事件**，不直接作为 Agent 事件发出，但会驱动 `assistant_message` 快照事件的生成：

| 实际类型 | 字段 | 对应产出 |
|---------|------|---------|
| `TextDelta` | `text: str` | → 累积到 `partial_content` 的 `text` 块；产出一条 `assistant_message` 快照 |
| `ReasoningDelta` | `text: str` | → 累积到 `partial_content` 的 `thinking` 块；产出一条 `assistant_message` 快照 |
| `ToolInputDelta` | `id`, `name`, `text` | → 累积到 `partial_content` 中对应 `toolCall` 块的 `arguments` 字段（早期是 JSON 字符串片段）；产出一条 `assistant_message` 快照 |
| `ToolCall` | `id`, `name`, `input` | → 内部先记录并启动工具任务；同步把 `partial_content` 中对应 `toolCall` 块的 `arguments` 替换为完整 dict；产出一条 `assistant_message` 快照 |
| `StepFinish` | `finish_reason`, `usage`, `response_metadata` | → 缓存到局部变量（`finish_reason` / `usage` / `response_metadata`），**不再单独产出 `usage_update` 事件**；在 `_build_complete_events()` 中把 `usage` 嵌入 `assistant_message_complete.metadata.usage`，把 `response_metadata.{id, model}` 嵌入 `metadata.{responseId, model}` |

### 流式收束后的产出顺序

`_stream_turn()` 的产出分两个阶段：

1. **流循环内（Phase 1）**：收到 `TextDelta` / `ReasoningDelta` / `ToolInputDelta` / `ToolCall` 时把对应增量累积到 `partial_content`，然后通过 `_emit_streaming()` 统一产出一条 `assistant_message` 快照事件（`content[]` 携带到当前为止的完整内容）。收到 `StepFinish` 时缓存 `usage` / `finish_reason` / `response_metadata` 到局部变量。
2. **流循环结束后（Phase 2）**：调用 `_build_complete_events()` 将累积的 reasoning + text + toolCall + usage + stopReason 合并为**单个** `assistant_message_complete` 事件。然后产出所有 `tool_result`（逐条产出）→ `UserMessageEvent`（如有）。

## 事件转 OpenAI messages

后端在构造下一轮 LLM 输入时，会通过 `SessionManager.to_openai_messages()` 把持久化的 `assistant_message_complete` 消息转为 OpenAI Chat Completions 兼容的 `messages`。新格式直读 `content[]`（text / thinking / toolCall），不再需要 pending_* 缓冲逻辑。

### 普通回答

`content[]` 中的 text 块写入 `content`，thinking 块写入 `reasoning_content`。

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

### 工具调用

`content[]` 中的 text 块写入 `content`，thinking 块写入 `reasoning_content`，toolCall 块转为 `tool_calls`。`tool_result` 消息单独转为 `role="tool"`。

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

### 只有可见文本

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

当 LLM 返回的 `tool_call.function.arguments` JSON 解析失败，但该工具调用仍有有效 `id` 和 `name` 时，仍然会嵌入 `assistant_message_complete.content[]` 的 toolCall 块（`arguments` 为空对象 `{}`），同时产出 `tool_result(status="failed")`。`name` 保留模型返回的原始 `tool_call.function.name`。如果缺少有效 `id` 或 `name`，该工具调用会在 accumulator finalize 阶段被跳过，不会进入后续工具执行阶段。
