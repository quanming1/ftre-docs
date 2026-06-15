# 上下文管理机制

> ftre 的上下文压缩采用“双水位 + 延迟启用”模型：50% 水位先在后台生成
> `context_compact(enabled=false)` 事件，60% 水位才启用最新压缩事件并让后续 LLM
> 上下文切换为“摘要 + tail 原文”。压缩事件只改变上下文重建视图，不物理删除历史。

---

## 1. 目标

| 目标 | 做法 |
|------|------|
| 降低延迟 | 50% 水位提前后台压缩，把 LLM 摘要耗时挪到 idle / usage 事件之后 |
| 降低信息损失 | 压缩结果先写入但不启用，60% 前仍使用完整事件流 |
| 防止溢出 | 60% 水位启用已准备好的压缩事件；没有可用事件时同步兜底压缩 |
| 用户无感 | 自动压缩 `silent=true`，前端不渲染气泡；手动 `/compact` 才显示 |

---

## 2. 双水位

```
水位 = estimated_tokens / context_window

水位 >= precompact_threshold(0.5)
  -> 后台准备压缩事件 context_compact(enabled=false)

水位 >= compact_threshold(0.6)
  -> 启用最新 pending 压缩事件 enabled=true
  -> 后续 to_openai_messages 使用 summary + tail
```

### 2.1 50%：准备压缩

触发源：
- 每轮 `done` 后的 idle 检查。
- LLM stream 产生 `usage_update` 后的实时水位检查。

行为：
- 如果当前 session 没有可复用的 pending compact，则后台调用默认 LLM 摘要。
- 写入 `context_compact` 事件，`enabled=false`。
- 事件 timestamp 放在 tail 起点之前，但在启用前 `to_openai_messages()` 会忽略它。
- 自动路径 `silent=true`，前端只刷新 token usage，不渲染气泡。

### 2.2 60%：启用压缩

触发源：
- 用户发消息进入 `_step_compact` 时。
- usage 实时监测发现已到强制水位时。

行为：
- 优先启用最新 `enabled=false` 的 `context_compact`。
- 启用方式是原地更新事件 data：`enabled=true`，并记录 `enabled_at_ratio` / `enabled_at`。
- 启用后 `SessionManager.to_openai_messages()` 遇到该事件才清空旧 messages 并注入摘要。
- 如果没有 pending compact，关键路径同步执行一次压缩并直接写 `enabled=true`。

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
| `enable_ratio` | number | 启用水位，默认 0.6 |
| `enabled_at_ratio` | number \| null | 实际启用时水位 |
| `tokens_before` | number \| null | 压缩前估算 token |
| `tokens_after` | number \| null | 启用后 `summary + tail` 的估算 token |
| `events_before` | number | 被摘要覆盖的事件数 |
| `tail_turns` | number | tail 中保留的 user turn 数 |
| `silent` | bool | 前端是否静默 |

`timestamp = boundary.timestamp - CURSOR_TIMESTAMP_EPSILON`，保证启用后自然形成
`summary + tail`。

---

## 4. 压缩算法

### 4.1 预算

```
budget = context_window - max_output - safety_buffer
target = budget * consolidation_ratio
```

默认：
- `precompact_threshold = 0.5`
- `compact_threshold = 0.6`
- `consolidation_ratio = 0.5`
- `safety_buffer = 1024`

### 4.2 选择 head / tail

从最新已启用游标之后开始选择压缩范围：
- 边界必须落在 `USER_INPUT` 事件上，避免切坏 `tool_call` / `tool_result` 配对。
- head 是游标到边界之间的旧历史。
- tail 是边界之后的最近原文，启用后仍完整参与 LLM 上下文。
- pending 事件不推进“已启用游标”；只有 `enabled=true` 后才影响后续上下文视图。

### 4.3 摘要

使用默认 LLM 直调：
- 不派 subagent。
- 不给工具权限。
- 把 head 事件格式化为文本，一次 chat completion 生成 anchored summary。
- 如果已有上一次已启用摘要，把它作为 `<previous-summary>` 传入，要求保留仍然成立的信息、删除过时信息、合并新事实。

输出摘要必须满足基本有效性检查：非空、长度足够、包含 markdown 标题。失败时不写脏摘要。

### 4.4 去重

后台压缩触发频繁，必须避免重复写 pending 事件：
- 如果已有最新 `enabled=false` 的 `context_compact`，且它仍覆盖当前候选 head，则不重复生成。
- 启用后 tail 继续增长，水位再次超过 50% 时才生成下一条 pending。
- 每 session 一把压缩锁，避免 idle / usage / 手动压缩并发写入。

---

## 5. 上下文重建

`SessionManager.to_openai_messages()` 处理 `context_compact`：

```python
if event.type == "context_compact":
    data = event["data"] or {}
    if data.get("enabled", True) is not True:
        continue
    messages = []
    messages.append({"role": "user", "content": "[历史上下文摘要]\n" + data["summary"]})
```

含义：
- `enabled=false`：事件只作为已准备好的压缩结果存在，不影响 LLM 上下文。
- `enabled=true`：丢弃之前所有已重建 messages，摘要作为新起点，后续 tail 原文继续重建。
- 多条 enabled compact 时，后面的会再次清空 messages，等价于“最新 enabled 摘要 + 它之后的 tail”。

---

## 6. 触发时机

| 时机 | 水位 | 行为 | silent |
|------|------|------|--------|
| `usage_update` 实时监测 | `>= 0.5` | 后台准备 `enabled=false` 压缩事件 | `true` |
| 每轮 `done` 后 idle 检查 | `>= 0.5` | 后台准备 `enabled=false` 压缩事件 | `true` |
| 用户下一轮输入前 | `>= 0.6` | 启用 pending；没有 pending 则同步压缩并启用 | `true` |
| 用户手动 `/compact` | 无需水位 | 立即压缩并启用 | `false` |

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
| `mode` | `"prepare"` \| `"manual"` \| `"force"` | 触发模式 |
| `silent` | bool | 是否静默 |

### context_compact_done

LLM 摘要生成并写入 `context_compact` 后发送。

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | bool | 该事件是否已启用 |
| `events` | number | 被摘要覆盖的事件数 |
| `tokens_before` | number \| null | 压缩前估算 token |
| `tokens_after` | number \| null | 启用后估算 token；pending 时可为空 |
| `summary` | string | 摘要预览 |
| `silent` | bool | 是否静默 |

### context_compact_enabled

已有 pending 压缩事件被启用时发送。

| 字段 | 类型 | 说明 |
|------|------|------|
| `tokens_before` | number \| null | 启用前估算 token |
| `tokens_after` | number \| null | 启用后估算 token |
| `summary` | string | 摘要预览 |
| `silent` | bool | 是否静默 |

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
- OpenCode 触发后立即启用；ftre 在 50% 先写 pending，60% 才启用。
- Nanobot 把摘要写入 memory/history；ftre 追加 SQLite 事件流游标。
- ftre 保留完整原始事件，不物理删除历史。
