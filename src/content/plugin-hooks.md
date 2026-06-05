# Hook 挂点与上下文

Hook 是插件在 ftre 生命周期关键节点注入逻辑的机制。每个 hook 是一个函数 `(ctx) -> ctx`，接收上下文对象，返回（可能被修改的）上下文。

## 执行模型

```
AgentLoop._build_messages()
  │
  ├─ 从 DB 加载 events
  ├─ 触发 BEFORE_MESSAGES_BUILD hook 链
  │   ├─ fn1(ctx) → ctx
  │   ├─ fn2(ctx) → ctx
  │   └─ fn3(ctx) → ctx     ← 任意 fn 抛异常 → 跳过，用当前 ctx 继续
  │
  └─ 用最终 ctx 构建 LLM 输入
```

- Hook 按注册顺序依次执行
- Hook 抛异常被捕获、记录后跳过
- Hook 返回 `None` 视为未改写，沿用当前 ctx
- Hook 不应阻塞太久

## 挂点：`before_messages_build`

**触发时机**：每次 Agent 构建 LLM 输入消息时，在加载历史 events 之后、调用 `to_openai_messages` 之前。

**Hook 函数签名**：

```python
from ftre.plugin import MessagesBuildContext

def my_hook(ctx: MessagesBuildContext) -> MessagesBuildContext:
    # 修改 ctx
    return ctx
```

### MessagesBuildContext

| 字段 | 类型 | 读写 | 说明 |
|------|------|:---:|------|
| `session_id` | str | 只读 | 当前会话 ID |
| `channel_id` | str | 只读 | 来源 Channel ID（`"ws"` 等） |
| `inbound_data` | dict | 只读 | 本次 `user_input` 的完整 data（含 content, attachments, session_id 等） |
| `workspace` | str | 只读 | 当前工作区绝对路径 |
| `event_loop` | Any | 只读 | 主 asyncio 事件循环，可传递给 `run_coroutine_threadsafe` |
| `config` | AgentConfig | **可改** | Agent 配置的深拷贝。可改 `llm`, `system_prompt`, `max_iterations` 等 |
| `events` | list[dict] | **可改** | 从 DB 加载的事件流，可裁剪 / 注入 / 重排 |

### 常用场景

**注入 Skill 描述到 system prompt**（skill_plugin 的实现思路）：

```python
def _inject_skills(self, ctx):
    descriptions = get_all_skill_descriptions()
    prefix = "\n".join(f"- {s['name']}: {s['description']}" for s in descriptions)
    ctx.config.system_prompt += f"\n\n可用技能:\n{prefix}"
    return ctx
```

**裁剪过长的历史**（context_govern 的实现思路）：

```python
def _trim_events(self, ctx):
    max_tokens = ctx.config.llm.context_window
    trimmed = trim_events_to_token_limit(ctx.events, max_tokens)
    ctx.events = trimmed
    return ctx
```

**注入外部消息**：

```python
def _inject_external(self, ctx):
    external_event = {
        "type": "external_message",
        "data": {
            "content": "来自外部的通知",
            "from_channel": "cron",
            "from_session": "cron::xxx",
        },
    }
    ctx.events.insert(0, external_event)
    return ctx
```

## 挂点常量

```python
from ftre.plugin import BEFORE_MESSAGES_BUILD
```

目前只有一个挂点。更多挂点可通过 `self.api.register_hook("自定义挂点名", fn)` 注册，但只有 `before_messages_build` 会被框架自动触发。

## AgentConfig 可改字段

Hook 可以通过 `ctx.config` 修改以下 Agent 配置：

| 字段 | 类型 | 说明 |
|------|------|------|
| `system_prompt` | str | 系统提示词 |
| `llm` | LLMConfig | LLM 配置（model, api_key, api_base, context_window, max_output, vision） |
| `max_iterations` | int \| None | 最大迭代次数 |
| `workspace` | str | 默认工作区 |
| `title_llm` | LLMConfig \| None | 标题生成专用 LLM |

> 修改 `config` 只影响当前请求，不影响其他 session。
