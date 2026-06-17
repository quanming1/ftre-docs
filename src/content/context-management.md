# 上下文管理机制

> ftre 当前的上下文压缩**实际触发路径**统一使用 `precompact_threshold`（默认 50%）：
> idle / usage 后台路径直接写入 `context_compact(enabled=true)`；
> 用户输入路径标记 `need_compact` 后在 `_run_async()` 中同样写入 `enabled=true`。
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
| 用户无感 | 自动压缩 `silent=true`，前端不渲染气泡；手动 `/compact` 才显示 |

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

> `compact_threshold`（默认 0.6）当前未被任何调用方用作触发水位。
> `should_compact()` 的默认阈值是 `compact_threshold`，但所有调用方
> （`_step_compact`、`_schedule_idle_compact`）都显式传入
> `precompact_threshold`(0.5)，因此实际触发水位统一为 0.5。
> `enable_pending_compact()` 用于启用历史上已存在的 `enabled=false` 压缩事件，
> 但当前代码没有路径写入 `enabled=false`，因此该调用总是找不到 pending，
> 直接回退到 `compact(enabled=true)`。

### 2.1 idle / usage 后台路径

触发源：
- 每轮 `done` 后的 idle 检查。
- LLM stream 产生 `usage_update` 后的实时水位检查。

行为：
- `should_compact(threshold=precompact_threshold=0.5)` 检查水位。
- 超阈值则 `compact(enabled=True, silent=True)`，直接写入已启用压缩事件。
- 自动路径 `silent=true`，前端只刷新 token usage，不渲染气泡。

### 2.2 用户输入路径

触发源：
- 用户发消息进入 `_step_compact` 时（使用 `precompact_threshold`(0.5) 标记水位）。

行为：
- `_step_compact` 检查水位，超阈值则标记 `data["need_compact"] = True`。
- `_run_async()` 中看到 `need_compact` 后：
  1. 先尝试 `enable_pending_compact()` 启用历史上已有的 pending（通常无）
  2. 没有 pending 则 `compact(enabled=True)` 同步压缩
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
| `tokens_after` | number \| undefined | 启用后 `summary + tail` 的估算 token；仅 `enabled=true` 时写入 |
| `silent` | bool | 前端是否静默（可选；仅 `silent=true` 时写入） |

`timestamp` 为压缩触发时间（不使用 epsilon 修正），写入 DB 时由 `save_message(timestamp=now)` 指定。

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
- head = 游标之后全部事件（不做 `user_message` 边界选择，整段送入 LLM 摘要）。
- tail = 压缩事件之后的后续新增事件。由于 compact 事件以 `timestamp=now` 写在事件流末尾，写入时 tail 为空；后续 `user_message` / Agent 事件追加到 compact 之后自动成为 tail。
- `to_openai_messages` 遇到 `enabled=true` 的 compact 事件后清空旧 messages 并注入摘要，随后 tail 原文照常重建，自然形成"摘要 + 最近原文"的 LLM 视图。

### 4.3 摘要

使用默认 LLM 直调：
- 不派 subagent。
- 不给工具权限。
- 把 head 事件格式化为文本，一次 chat completion 生成 anchored summary。
- 如果已有上一次已启用摘要，把它作为 `<previous-summary>` 传入，要求保留仍然成立的信息、删除过时信息、合并新事实。

输出摘要必须满足基本有效性检查：非空、长度足够、包含 markdown 标题。失败时不写脏摘要。

### 4.4 去重

后台压缩触发频繁，避免重复压缩：
- 同一 session 同一时间只允许一个后台 compact task 在飞（`_compact_tasks` 去重）。
- 每次压缩从上一个 `enabled=true` 的 compact 之后全量重新摘要。
- 每 session 一把压缩锁，避免 idle / usage / 手动压缩并发写入。

---

## 5. 上下文重建

`SessionManager.to_openai_messages()` 处理 `context_compact`：

```python
if event.type == "context_compact":
    data = event["data"] or {}
    if data.get("enabled", True) is not True:
        continue
    _flush_tool_calls()       # 收束之前累积的 tool_call
    _take_reasoning()         # 丢弃未挂载的 reasoning
    messages = []
    summary = data.get("summary", "")
    if summary:
        messages.append({"role": "user", "content": "[历史上下文摘要]\n" + summary})
```

含义：
- `enabled=false`：事件只作为已准备好的压缩结果存在，不影响 LLM 上下文（当前无代码路径写入此状态）。
- `enabled=true`：丢弃之前所有已重建 messages，摘要作为新起点，后续 tail 原文继续重建。
- 多条 enabled compact 时，后面的会再次清空 messages，等价于"最新 enabled 摘要 + 它之后的 tail"。

---

## 6. 触发时机

| 时机 | 水位 | 行为 | silent |
|------|------|------|--------|
| `usage_update` 实时监测 | `>= 0.5`（`precompact_threshold`） | `compact(enabled=True)` 直接写入已启用压缩事件 | `true` |
| 每轮 `done` 后 idle 检查 | `>= 0.5`（`precompact_threshold`） | `compact(enabled=True)` 直接写入已启用压缩事件 | `true` |
| 用户下一轮输入前 | `>= 0.5`（`precompact_threshold`） | 标记 `need_compact=True`；实际在 `_run_async` 中先尝试 `enable_pending_compact()`，没有则 `compact(enabled=True)` | `true` |
| 用户手动 `/compact` | 无需水位 | 先尝试 `enable_pending_compact()`，没有则 `compact(enabled=True, silent=False)` | `false` |

---

## 7. 前端行为

自动压缩事件默认 `silent=true`：
- `context_compact_start / done / failed` 不渲染气泡。
- `context_compact_done` 到达后立即刷新 token usage。
- `context_compact_enabled` 到达后再次刷新 token usage，因为上下文视图从完整历史切换为 summary + tail。

手动 `/compact` 使用 `silent=false`：
- 前端渲染压缩状态气泡。
- 完成后显示摘要。

---

## 8. 协议事件

### context_compact_start

准备或手动压缩开始。

| 字段 | 类型 | 说明 |
|------|------|------|
| `events` | number | 本次 head 事件数 |
| `tokens` | number | 压缩前估算 token |
| `silent` | bool | 是否静默（可选；当前代码在 `silent=true` 时显式写入） |

### context_compact_done

LLM 摘要生成并写入 `context_compact` 后发送。

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | bool | 该事件是否已启用 |
| `events` | number | 被摘要覆盖的事件数 |
| `tokens_before` | number | 压缩前估算 token |
| `tokens_after` | number \| null | 启用后估算 token |
| `summary` | string | 摘要预览 |
| `silent` | bool | 是否静默 |

### context_compact_enabled

已有 pending 压缩事件被启用时发送。

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | bool | 固定 `true`（启用成功） |
| `events` | number | 被摘要覆盖的事件数 |
| `tokens_before` | number | 启用前估算 token |
| `tokens_after` | number \| null | 启用后估算 token |
| `summary` | string | 摘要预览 |
| `silent` | bool | 是否静默（可选；`silent=true` 时显式写入） |

### context_compact_failed

压缩失败时发送，包含 `reason`。

---

## 9. 配置

`~/.ftre/config.json` 的 `agents.defaults.context`：

```json
{
  "agents": {
    "defaults": {
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
}
```

兼容策略：
- 旧字段 `threshold` 可作为 `compactThreshold` 的别名读取。
- 旧 `context_compact` 事件缺少 `enabled` 时按 `enabled=true` 处理。

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
