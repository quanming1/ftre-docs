# 上下文管理机制

> ftre 当前的上下文压缩**实际触发路径**统一使用 `precompact_threshold`（默认 50%）：
> idle / usage 后台路径直接写入 `context_compact(enabled=true)`；
> 用户输入路径标记 `need_compact` 后在 `_run_async()` 中同样写入 `enabled=true`。
> 自动压缩是否静默取 `config.context.silent`，默认 `true`。
> 但配置结构仍保留两个字段：`precompact_threshold`（默认 0.5）与
> `compact_threshold`（默认 0.6）。后者当前主要写入 `enable_ratio` 元数据，
> 不参与现有调用方的触发判断。
> 压缩事件只改变上下文重建视图，不物理删除历史。

---

## 1. 目标

| 目标 | 做法 |
|------|------|
| 降低延迟 | 50% 水位提前后台压缩，把 LLM 摘要耗时挪到 idle / usage 事件之后 |
| 降低信息损失 | 旧历史压缩为摘要 + 保留最近 tail 原文 |
| 防止溢出 | 实际调用路径在 50% 水位触发压缩，写入 `enabled=true` 的 compact 事件 |
| 用户无感 | 自动压缩默认 `silent=true`（由 `agents.context.silent` 控制），前端不渲染气泡；手动 `/compact` 使用 `silent=false` 才显示 |

---

## 2. 单阈值触发

```
水位 = estimated_tokens / context_window

水位 >= precompact_threshold(0.5)
  -> idle/usage 后台路径：compact(enabled=true)，直接写入已启用事件
  -> 用户输入路径：_step_compact 标记 need_compact=True，
     然后在 _run_async 中先尝试 enable_pending_compact()，
     没有 pending 则 compact(enabled=true)
  -> 后续 to_openai_messages 使用 summary + tail
```

> `compact_threshold`（默认 0.6）当前主要写入 `enable_ratio` 元数据，不参与现有调用方的触发判断。
> `should_compact()` 的默认阈值是 `compact_threshold`，但所有调用方
> （`_step_compact`、`CompactManager.maybe_schedule_idle_compact`）都显式传入
> `precompact_threshold`（默认 0.5，运行时读 `config.context.precompact_threshold`），
> 因此实际触发水位统一为 `precompact_threshold`（默认 0.5）。
> `enable_pending_compact()` 用于启用历史上已存在的 `enabled=false` 压缩事件，
> 但当前代码没有路径写入 `enabled=false`，因此该调用总是找不到 pending，
> 直接回退到 `compact(enabled=true)`。

### 2.1 idle / usage 后台路径

触发源：
- 每轮 `done` 后的 idle 检查（subagent channel 除外）。
- LLM stream 产生 `assistant_message_complete`（含 `metadata.usage`）后的实时水位检查（subagent channel 除外）。

行为：
- `should_compact(threshold=precompact_threshold=0.5)` 检查水位。
- 超阈值则 `compact(enabled=True, silent=config.context.silent)`，直接写入已启用压缩事件。
- 自动路径使用 `silent=config.context.silent`（默认 `true`）；默认情况下前端只刷新 token usage，不渲染气泡。

### 2.2 用户输入路径

触发源：
- 用户发消息进入 `_step_compact` 时（使用 `precompact_threshold`(0.5) 标记水位）。

行为：
- `_step_compact` 检查水位，超阈值则标记 `data["need_compact"] = True`。
- `_run_async()` 中看到 `need_compact` 后：
  1. 先尝试 `enable_pending_compact()` 启用历史上已有的 pending（通常无）
  2. 没有 pending 则 `compact(enabled=True, silent=config.context.silent)` 同步压缩
- 启用后 `SessionManager.to_openai_messages()` 遇到该事件清空旧 messages 并注入摘要。

---

## 3. 游标事件

`context_compact` 是游标事件。它按 timestamp 插在 tail 起点之前：

```
[旧历史 head] [context_compact(summary, enabled)] [最近 tail 原文]
```

字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `summary` | string | 旧历史 head 的摘要 |
| `enabled` | bool | 是否参与 `to_openai_messages()`；缺省按 `true` 处理以兼容旧数据 |
| `trigger_ratio` | number | 生成该压缩事件时的水位 |
| `enable_ratio` | number | 启用水位（配置的 `compact_threshold`） |
| `events_before` | number | 被摘要覆盖的事件数 |
| `tokens_before` | number | 压缩前估算 token |
| `tokens_after` | number \| undefined | 启用后估算 token；仅 `enabled=true` 时写入。`compact()` 写入时 compact 事件在末尾、无 tail，因此仅估算 summary 本身；`enable_pending_compact()` 启用历史 pending 时才包含 tail 事件（当前无代码写入 `enabled=false`，此路径实际不触发） |
| `silent` | bool \| undefined | 是否静默；仅传入 `silent=true` 时写入。自动压缩默认写入，若配置 `agents.context.silent=false` 则不写入；手动 `/compact` 不写入此字段 |

> `silent` 既出现在通知事件（`context_compact_start / done / enabled / failed`）的 `data` 中，也会在传入 `silent=true` 时写入持久化的 `context_compact` 游标事件。前端在历史回放时据此跳过静默压缩事件的渲染。

`timestamp` 为压缩触发时间（不使用 epsilon 修正），写入 DB 时由 `save_message(timestamp=now)` 指定；`context_compact` 事件作为普通历史事件追加在事件流末尾，后续新增事件自然成为它的 tail。

---

## 4. 压缩算法

### 4.1 预算

```
budget = context_window - max_output - safety_buffer
target = budget * consolidation_ratio
```

> `consolidation_ratio` 与 `safety_buffer` 来自 `ContextConfig`（可配置），但当前 `_run_compact_llm()` 是直接 LLM 直调摘要，不以此做硬截断或 token 约束；这两个字段预留用于后续预算控制。

默认：
- `precompact_threshold = 0.5`
- `compact_threshold = 0.6`
- `consolidation_ratio = 0.5`
- `safety_buffer = 1024`

### 4.2 head / tail

从最新已启用游标之后开始选择压缩范围：
- head = **上一个 `enabled=true` 的 compact 事件之后的全部事件**（不做 `user_message` 边界选择，整段送入 LLM 摘要）。实现上 `get_cursor_index(events)` 返回的是“上一个已启用 compact 的下一位”，因此旧的 compact 事件本身不会再次进入新的 head。
- tail = 压缩事件之后的后续新增事件。由于 compact 事件以 `timestamp=now` 写在事件流末尾，写入时 tail 为空；后续 `user_message` / Agent 事件追加到 compact 之后自动成为 tail。
- `to_openai_messages` 遇到 `enabled=true` 的 compact 事件后清空旧 messages 并注入摘要，随后 tail 原文照常重建，自然形成"摘要 + 最近原文"的 LLM 视图。

### 4.3 摘要

LLM 直调：
- 优先使用 `compact_llm`（通过 `config.json` 的 `compact_generation` 配置），未配置则回退到主 LLM。
- 不派 subagent。
- 不给工具权限。
- 把 head 事件格式化为文本，一次 chat completion 生成 anchored summary。
- 如果已有上一次已启用摘要，把它作为 `<previous-summary>` 传入，要求保留仍然成立的信息、删除过时信息、合并新事实。

输出摘要必须满足基本有效性检查：非空、长度 ≥ 200、包含 markdown 标题（`## `）。失败时不写脏摘要。

### 4.4 去重

后台压缩触发频繁，避免重复压缩：
- 每次压缩从上一个 `enabled=true` 的 compact 之后全量重新摘要。
- 后台 idle/usage 路径通过 `_compact_tasks` 去重（`asyncio.create_task` 派发，运行在 session lock 之外），同一 session 同一时间最多只有一个后台 compact task 在飞。
- 后台路径还有冷却机制（`_compact_retry_after`）：当后台压缩因不可重试 LLM 错误（`auth_error` / `bad_request` / `content_filter`）失败时，该 session 进入 300 秒冷却期，期间跳过后台压缩调度；冷却仅作用于后台 idle/usage 路径，不影响用户输入路径和手动 `/compact`。
- 用户输入关键路径与手动 `/compact` 都在 Pipeline session lock 内执行，与同一 session 的其他 lock 内操作互斥。
- `CompactManager` 自身不持有锁；session lock 由 AgentLoop 提供。
- 注意：`_compact_tasks` 仅对后台 idle/usage 路径去重，不覆盖 idle 与用户输入路径之间的并发。后台 compact task 运行在 session lock 之外，理论上可能与 lock 内的用户输入 compact 并行（实际中后台任务通常很快完成，冲突概率极低）。

---

## 5. 上下文重建

`SessionManager.to_openai_messages()` 处理 `context_compact`（`data` 在循环顶部已由 `data = event.get("data") or {}` 取出，此处直接复用）：

```python
elif _t == "context_compact":
    if data.get("enabled", True) is not True:
        continue
    messages = []              # 清空之前累积的 messages
    summary = data.get("summary", "")
    if summary:
        messages.append({
            "role": "user",
            "content": f"[历史上下文摘要]\n{summary}",
        })
```

含义：
- `enabled=false`：事件只作为已准备好的压缩结果存在，不影响 LLM 上下文（当前无代码路径写入此状态）。
- `enabled=true`：丢弃之前所有已重建 messages，摘要作为新起点，后续 tail 原文继续重建。
- 多条 enabled compact 时，后面的会再次清空 messages，等价于"最新 enabled 摘要 + 它之后的 tail"。

---

## 6. 触发时机

| 时机 | 水位 | 行为 | silent |
|------|------|------|--------|
| `assistant_message_complete` 实时监测 | `>= 0.5`（`precompact_threshold`） | `compact(enabled=True)` 直接写入已启用压缩事件；subagent channel 不触发 | `config.context.silent`（默认 `true`） |
| 每轮 `done` 后 idle 检查 | `>= 0.5`（`precompact_threshold`） | `compact(enabled=True)` 直接写入已启用压缩事件；subagent channel 不触发；冷却期内跳过 | `config.context.silent`（默认 `true`） |
| 用户下一轮输入前 | `>= 0.5`（`precompact_threshold`） | 标记 `need_compact=True`；实际在 `_run_async` 中先尝试 `enable_pending_compact()`，没有则 `compact(enabled=True)` | `config.context.silent`（默认 `true`） |
| 用户手动 `/compact` | 无需水位 | 先尝试 `enable_pending_compact()`，没有则 `compact(enabled=True, silent=False)` | `false` |

> 后台 idle/usage 路径受冷却机制（`_compact_retry_after`）保护：遇到不可重试 LLM 错误（`auth_error` / `bad_request` / `content_filter`）后进入 300 秒冷却期，期间跳过后台压缩。用户输入路径和手动 `/compact` 不受冷却限制。

---

## 7. 前端行为

自动压缩事件使用 `config.context.silent`，默认 `silent=true`：
- `context_compact_start / done / failed` 在携带 `silent=true` 时不渲染气泡。
- `context_compact_done` 到达后立即刷新 token usage。
- `context_compact_enabled` 到达后再次刷新 token usage，因为上下文视图从完整历史切换为 summary + tail。

手动 `/compact` 使用 `silent=false`：
- 前端渲染压缩状态气泡。
- 完成后显示摘要。

---

## 8. 协议事件

### context_compact_start

准备压缩开始。

| 字段 | 类型 | 说明 |
|------|------|------|
| `events` | number | 本次 head 事件数 |
| `tokens` | number | 压缩前估算 token |
| `silent` | bool | 是否静默（可选；传入 `silent=true` 时显式写入） |

### context_compact_done

LLM 摘要生成并写入 `context_compact` 后发送。

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | bool | 该事件是否已启用 |
| `events` | number | 被摘要覆盖的事件数 |
| `tokens_before` | number | 压缩前估算 token |
| `tokens_after` | number \| null | 启用后估算 token |
| `summary` | string | 摘要预览 |
| `silent` | bool | 是否静默（可选；传入 `silent=true` 时显式写入） |

### context_compact_enabled

已有 pending 压缩事件被启用时发送。

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | bool | 固定 `true`（启用成功） |
| `events` | number | 被摘要覆盖的事件数 |
| `tokens_before` | number | 压缩创建时估算 token（取自 pending 事件的 `tokens_before` 字段，非启用时实时值） |
| `tokens_after` | number \| null | 启用后估算 token（`summary + tail`） |
| `summary` | string | 摘要预览 |
| `silent` | bool | 是否静默（可选；`silent=true` 时显式写入） |

### context_compact_failed

压缩失败时发送，包含 `reason`。

| 字段 | 类型 | 说明 |
|------|------|------|
| `reason` | string | 失败原因 |
| `silent` | bool | 是否静默（可选；传入 `silent=true` 时显式写入） |

---

## 9. 配置

`~/.ftre/config.json` 的 `agents.context`：

```json
{
  "agents": {
    "context": {
      "precompactThreshold": 0.5,
      "compactThreshold": 0.6,
      "consolidationRatio": 0.5,
      "safetyBuffer": 1024,
      "idleCompaction": true,
      "silent": true
    }
  }
}
```

兼容策略：
- 旧字段 `threshold` 可作为 `compactThreshold` 的别名读取。
- 旧 `context_compact` 事件缺少 `enabled` 时按 `enabled=true` 处理。
- `context_compact_start` / `done` / `failed` / `enabled` 都可能携带 `silent=true`；自动压缩默认取 `config.context.silent`，手动 `/compact` 默认 `silent=false`。

---

## 10. 与 OpenCode / Nanobot 的关系

借鉴点：
- OpenCode 的 `head -> summary`、`tail -> recent 原文` 模式。
- OpenCode 的 anchored summary：用 previous summary 更新而不是重写。
- Nanobot 的 `budget = context_window - max_output - safety_buffer` 和 `consolidation_ratio=0.5`。
- Nanobot 的游标只进不退与 user-turn 边界。

ftre 的差异：
- OpenCode 触发后立即启用；ftre 同样在触发后直接写入 `enabled=true`。
- Nanobot 把摘要写入 memory/history；ftre 追加 SQLite 事件流游标。
- ftre 保留完整原始事件，不物理删除历史。

## 校对记录

- **2026-07-19**：行号复验。代码持续演进后偏移，所有关键行为仍与源码一致。
- **2026-07-20**：协议改造对齐。`usage_update` / `reasoning_complete` / `tool_call` 三个独立事件已合并到 `assistant_message_complete`（分别嵌入 `metadata.usage` / `content[].thinking` / `content[].toolCall`）；compact 调度触发从 `usage_update` 改为 `assistant_message_complete.metadata.usage`；`to_openai_messages()` 中 `context_compact` 处理不再需要 `_flush_tool_calls()` / `_take_reasoning()`（新格式直读，无缓冲）；`_serialize_events` 改为从 `assistant_message_complete.content[]` 拆出 text/thinking/toolCall。
