# Core Hook 系统

`ftre-agent-core` 内置的 Hook 系统，让外部代码可以挂到 `ReActRunner` 的关键决策点上，执行自定义逻辑——包括**阻止 Agent 停止**、拦截工具调用、注入消息等。

> **与 Gateway Hook 的区别**：Gateway 层的 `HookManager`（`ftre/plugin/hook_manager.py`）是 filter chain，只能改写 ctx，不能阻止流程。Core Hook 支持 `block` 决策，可以拦截 Agent 的停止行为。两者独立运行，互不干扰：Gateway Hook 管"消息构建"，Core Hook 管"循环控制"。

---

## 整体架构

```
ReActRunner._loop()
  │
  ├─ on_turn_start     ← 每轮迭代开始前，可注入消息
  │
  ├─ _run_turn()
  │    ├─ LLM 流式输出
  │    │
  │    ├─ on_pre_tool   ← 每个工具执行前，可拒绝/改参数（×N 个工具）
  │    ├─ 工具执行
  │    ├─ on_post_tool  ← 每个工具执行后，可改结果（×N 个工具）
  │    │
  │    └─ 无工具调用时：
  │         ├─ on_stop  ← Agent 想停下，可阻止停止 ★ 核心挂点
  │         └─ 阻止 → 注入 continuation prompt → 下一轮
  │
  ├─ on_turn_end       ← 每轮迭代结束后，只读观察
  │
  └─ 循环 / 结束
```

**源码位置**：`ftre_agent_core/hooks.py`

**挂点常量**：

| 常量 | 值 | 说明 |
|------|----|------|
| `ON_TURN_START` | `"on_turn_start"` | 每轮迭代开始前 |
| `ON_PRE_TOOL` | `"on_pre_tool"` | 每个工具执行前 |
| `ON_POST_TOOL` | `"on_post_tool"` | 每个工具执行后 |
| `ON_STOP` | `"on_stop"` | Agent 想停下时（★ 唯一能阻止停止的挂点） |
| `ON_TURN_END` | `"on_turn_end"` | 每轮迭代结束后（只读） |

---

## FtreCoreHookManager

Core 层 Hook 注册与调度中心。

```python
from ftre_agent_core import FtreCoreHookManager, ON_STOP, StopInput, HookOutput

mgr = FtreCoreHookManager()

async def goal_hook(inp: StopInput) -> HookOutput:
    if not goal_achieved:
        return HookOutput(decision="block", reason="继续工作")
    return HookOutput(decision="allow")

mgr.register(ON_STOP, goal_hook)

# 传入 ReActAgent 构造函数
agent = ReActAgent(..., hook_manager=mgr)
```

### API

| 方法 | 签名 | 说明 |
|------|------|------|
| `register` | `(point: str, fn: HookFunc) -> None` | 在指定挂点注册 hook，按注册顺序执行 |
| `unregister` | `(point: str, fn: HookFunc) -> bool` | 移除指定 hook，返回是否找到并移除 |
| `has_hooks` | `(point: str) -> bool` | 该挂点是否有已注册的 hook |
| `clear` | `(point: str \| None = None) -> None` | 清除指定挂点的全部 hook，或清除所有（`point=None`） |
| `trigger` | `(point: str, input) -> HookOutput \| None` | 触发 hook 链（详见下文） |

### trigger 执行逻辑

`trigger` 是 Hook 系统的核心。`input` 参数可以是 `HookInput` 实例，也可以是零参 callable（工厂函数）。传 callable 时，没有 hook 则不会调用它——避免无谓的 input 构造开销。

```
trigger(point, input)
  │
  ├─ 没有已注册 hook？ → 返回 None（input 不构造）
  │
  ├─ input 是 callable？ → 调用它构造 input（懒构造）
  │
  └─ 按注册顺序遍历 hook 链：
       │
       ├─ hook 抛异常 → 捕获 + log，跳过该 hook，继续链
       │
       ├─ hook 返回 None → 视为 allow，继续链
       │
       ├─ hook 返回 decision='allow' → 记录为最后输出，继续链
       │
       ├─ hook 返回 decision='modify' → 将修改写回 input，继续链
       │
       └─ hook 返回 decision='block' → 立即返回该 output，终止链
      
  最终返回最后一个非 None 的 HookOutput（可能是 allow/modify/block）
```

**关键设计**：

- **多 hook 链式执行**：同一挂点可注册多个 hook，按注册顺序依次执行
- **block 立即终止**：任一 hook 返回 `block` 后，后续 hook 不再执行
- **modify 传递**：`modify` 不终止链，修改后的 input 传递给后续 hook
- **异常不拖垮主流程**：hook 抛异常被捕获并记录，跳过该 hook 继续
- **同步/异步均支持**：hook 可以是 `async def` 或普通 `def`，`trigger` 自动检测并 `await`
- **懒构造**：`input` 传 callable 时，没有 hook 则不调用，零开销

---

## HookInput / HookOutput 基类

所有挂点的输入输出都继承自这两个基类。

### HookInput

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `session_id` | `str` | `""` | 当前会话 ID（由 Gateway 传入，core 不关心） |
| `turn_id` | `str` | `""` | 当前 Turn 标识 |
| `iteration` | `int` | `0` | 当前迭代轮次（从 1 开始） |
| `runtime_context` | `dict` | `{}` | 调用方传入的上下文（透传） |

### HookOutput

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `decision` | `str` | `"allow"` | 决策：`'allow'` / `'block'` / `'modify'` |
| `reason` | `str` | `""` | 决策原因。`on_stop` 的 `block` 时作为 continuation prompt 注入 memory |
| `system_message` | `str` | `""` | 给用户看的系统消息（不喂给模型） |

**decision 三态**：

| 值 | 含义 | 适用挂点 |
|----|------|---------|
| `'allow'` | 放行（默认） | 所有挂点 |
| `'block'` | 阻止当前操作 | `on_stop`（阻止停止）、`on_pre_tool`（阻止执行） |
| `'modify'` | 修改后放行 | `on_pre_tool`（改参数）、`on_post_tool`（改结果） |

---

## 挂点详解

### on_turn_start

**触发时机**：`_loop()` 中 `iteration += 1` 之后、`_run_turn()` 之前。每轮迭代触发一次。

**用途**：注入 system/user 消息（如每日提醒、上下文补充）。注入的消息会追加到 memory，Agent 在本轮迭代中可见。

**输入 `TurnStartInput`**（继承 `HookInput`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `messages` | `list[dict]` | 当前 memory 快照（含 system 消息，只读） |

**输出 `TurnStartOutput`**（继承 `HookOutput`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `inject_messages` | `list[dict]` | 要注入到 memory 的消息列表（OpenAI 格式） |

**示例**：

```python
async def reminder_hook(inp: TurnStartInput) -> TurnStartOutput:
    return TurnStartOutput(
        inject_messages=[{"role": "user", "content": "提醒：检查测试是否通过"}]
    )

mgr.register(ON_TURN_START, reminder_hook)
```

---

### on_stop ★

**触发时机**：`_stream_turn()` 阶段 3。当 Agent 输出了文本、没有工具调用、`finish_reason` 为 `stop`，且没有 pending user messages 时。在 `length` / `unknown` / `pending_user_messages` 分支之后、正常结束之前。

这是**唯一能阻止 Agent 停下**的挂点。

**用途**：目标判定（如 `/goal`）、完成度检查、强制续跑。

**输入 `StopInput`**（继承 `HookInput`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `last_assistant_text` | `str` | Agent 的最终文本输出 |
| `finish_reason` | `str` | provider 返回的停止原因（通常为 `"stop"`） |
| `token_usage` | `dict` | 累积 token 用量（`prompt_tokens` / `completion_tokens` / `cached_tokens` / `llm_calls`） |

**输出**：直接使用 `HookOutput`，无额外字段。

| decision | 行为 |
|----------|------|
| `'allow'` | 正常停止，Agent 结束本轮 run |
| `'block'` | 阻止停止。`reason` 作为 continuation prompt 注入 memory，Agent 进入下一轮迭代 |

**示例 — 模拟 /goal**：

```python
async def goal_hook(inp: StopInput) -> HookOutput:
    # 用独立快速模型判断目标是否达成
    achieved = await judge_goal(condition, inp.last_assistant_text)
    
    if achieved:
        return HookOutput(decision="allow")  # 放行停止
    
    return HookOutput(
        decision="block",
        reason=f"继续朝目标努力。目标条件：{condition}",
        system_message="Goal still active",  # 给用户看，不喂给模型
    )

mgr.register(ON_STOP, goal_hook)
```

**执行流程**：

```
Agent 输出 "博客搭建完成..."（无工具调用）
  │
  ├─ on_stop hook 触发
  │   └─ judge 判定：未达成 → return {decision:'block', reason:'继续...'}
  │
  ├─ Runner 拿到 block
  │   ├─ reason 注入 memory 作为 user 消息
  │   └─ 不设 COMPLETED，_loop 继续下一轮
  │
  ├─ Agent 收到 "继续朝目标努力..." → 继续干活
  │
  └─ ... 循环直到 judge 说 allow ...
```

---

### on_pre_tool

**触发时机**：`ToolHandler.run_one()` 中，工具执行之前。每个工具调用触发一次，在各自工具的并发 Task 内部执行，天然并发互不阻塞。

**用途**：权限审批、参数修改、危险操作拦截。

**输入 `PreToolInput`**（继承 `HookInput`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `tool_call_id` | `str` | 工具调用 ID |
| `tool_name` | `str` | 工具名称 |
| `tool_args` | `dict` | 工具参数 |

**输出 `PreToolOutput`**（继承 `HookOutput`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `modified_args` | `dict \| None` | 修改后的参数（`decision='modify'` 时生效） |

| decision | 行为 |
|----------|------|
| `'allow'` | 工具正常执行 |
| `'block'` | 工具不执行，`reason` 作为 tool_result 的错误内容返回给 Agent |
| `'modify'` | 用 `modified_args` 替换原始参数后执行 |

**示例 — 拦截危险命令**：

```python
async def safety_hook(inp: PreToolInput) -> PreToolOutput:
    if inp.tool_name == "bash" and "rm -rf" in inp.tool_args.get("command", ""):
        return PreToolOutput(decision="block", reason="禁止执行 rm -rf")
    return PreToolOutput(decision="allow")

mgr.register(ON_PRE_TOOL, safety_hook)
```

---

### on_post_tool

**触发时机**：`ToolHandler.run_one()` 中，工具执行完毕后（含异常路径）。每个工具调用触发一次，在各自工具的并发 Task 内部执行。

**用途**：结果审计、敏感信息脱敏、结果改写。

**输入 `PostToolInput`**（继承 `HookInput`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `tool_call_id` | `str` | 工具调用 ID |
| `tool_name` | `str` | 工具名称 |
| `tool_args` | `dict` | 工具参数 |
| `result` | `str` | 工具执行结果 |
| `error` | `str \| None` | 错误信息（失败时） |
| `status` | `str` | 执行状态：`"completed"` / `"failed"` / `"cancelled"` |
| `metadata` | `dict` | 工具返回的结构化元数据（如 edit/write 的 diff 信息） |

**输出 `PostToolOutput`**（继承 `HookOutput`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `modified_result` | `str \| None` | 修改后的结果（`decision='modify'` 时生效） |

| decision | 行为 |
|----------|------|
| `'allow'` | 结果原样使用 |
| `'modify'` | 用 `modified_result` 替换原始 result 字符串 |
| `'block'` | 当前无特殊语义，等同于 allow |

**示例 — 脱敏**：

```python
async def redact_hook(inp: PostToolInput) -> PostToolOutput:
    if inp.tool_name == "read_file":
        cleaned = inp.result.replace("AKIAXXXX", "***REDACTED***")
        return PostToolOutput(decision="modify", modified_result=cleaned)
    return PostToolOutput(decision="allow")

mgr.register(ON_POST_TOOL, redact_hook)
```

---

### on_turn_end

**触发时机**：`_loop()` 中 `_run_turn()` 返回后，且 `state.is_done` 为 True 时。每轮迭代结束后触发一次。

**用途**：遥测、日志、UI 通知。**只读观察，不能阻止任何流程**——返回值被忽略。

**输入 `TurnEndInput`**（继承 `HookInput`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `done_reason` | `str` | 结束原因：`"completed"` / `"max_iterations"` / `"error"` / `"cancelled"` |

**输出**：直接使用 `HookOutput`，无额外字段。返回值被忽略。

**示例**：

```python
async def telemetry_hook(inp: TurnEndInput) -> HookOutput:
    print(f"Turn ended: iteration={inp.iteration} reason={inp.done_reason}")
    return None  # 返回值被忽略

mgr.register(ON_TURN_END, telemetry_hook)
```

---

## 多 Hook 叠加

同一挂点可以注册多个 hook，按注册顺序链式执行：

```
hook1 (allow) → hook2 (modify) → hook3 (block) → 终止链
```

- `allow`：记录为最后输出，继续链
- `modify`：将修改写回 input，后续 hook 看到修改后的值，继续链
- `block`：立即返回该 output，后续 hook **不再执行**
- `None`：视为 allow，继续链
- 异常：捕获 + log，跳过该 hook，继续链

**示例 — logger + goal 叠加**：

```python
async def logger_hook(inp: StopInput) -> HookOutput:
    print(f"Agent wants to stop: {inp.last_assistant_text[:50]}")
    return HookOutput(decision="allow")  # 只记录，不阻止

async def goal_hook(inp: StopInput) -> HookOutput:
    if not achieved:
        return HookOutput(decision="block", reason="继续工作")
    return HookOutput(decision="allow")

mgr.register(ON_STOP, logger_hook)  # 先执行
mgr.register(ON_STOP, goal_hook)    # 后执行
```

如果 `logger_hook` 返回 `block`，`goal_hook` 不会执行。

---

## 与 ReActAgent 集成

`ReActAgent` 构造函数接受可选的 `hook_manager` 参数：

```python
from ftre_agent_core import ReActAgent, FtreCoreHookManager

mgr = FtreCoreHookManager()
# ... 注册 hook ...

agent = ReActAgent(
    model="...",
    api_key="...",
    hook_manager=mgr,  # 不传则自动创建空的 FtreCoreHookManager
)
```

不传 `hook_manager` 时，Agent 内部自动创建一个空实例——所有 `trigger` 调用返回 `None`，行为与无 Hook 完全一致，零开销。

### 已集成的挂点

| 挂点 | 集成位置 | 状态 |
|------|---------|------|
| `on_turn_start` | `_loop()` — iteration 递增后、`_run_turn()` 前 | ✅ 已集成 |
| `on_stop` | `_stream_turn()` 阶段 3e — 正常结束前 | ✅ 已集成 |
| `on_turn_end` | `_loop()` — `state.is_done` 后 | ✅ 已集成 |
| `on_pre_tool` | `ToolHandler.run_one()` — 工具执行前 | ✅ 已集成 |
| `on_post_tool` | `ToolHandler.run_one()` — 工具执行后 | ✅ 已集成 |

### on_stop 在 _stream_turn 中的位置

`on_stop` hook 插在 `_stream_turn()` 的"阶段 3"决策树中，具体位置如下：

```
阶段 3：没有工具调用的 turn
  │
  ├─ 3a: finish_reason == "length" → 续写提示，return
  ├─ 3b: finish_reason == "unknown" → return
  ├─ 3c: pending_user_messages → 注入，return
  ├─ 3d: continuation_active (runtime_context 魔法键) → 续跑，return
  │
  ├─ 3e: on_stop hook ★ ← 在这里
  │   ├─ block → 注入 continuation prompt，return（不设 COMPLETED）
  │   └─ allow → 继续
  │
  └─ 3f: 正常结束 → TURN_END step，COMPLETED
```

`on_stop` 在所有内置的"阻止停止"机制（length 续写、pending messages、continuation_active）之后触发。这意味着这些内置机制优先于 `on_stop` hook。

---

## 完整示例：/goal 模拟

```python
import asyncio
from ftre_agent_core import (
    ReActAgent, FtreCoreHookManager,
    ON_STOP, StopInput, HookOutput,
)

# 1. 创建 Hook 管理器
mgr = FtreCoreHookManager()

# 2. 模拟 goal 状态
goal_condition = "所有测试通过且 lint 零报错"
iteration_count = 0

# 3. 注册 on_stop hook
async def goal_hook(inp: StopInput) -> HookOutput:
    global iteration_count
    iteration_count += 1
    
    # 模拟 judge 判定（实际应调用独立快速模型）
    achieved = iteration_count >= 3  # 前 2 次未达成，第 3 次达成
    
    if achieved:
        print(f"✅ Goal achieved after {iteration_count} iterations")
        return HookOutput(decision="allow")
    
    print(f"⏳ Goal not yet achieved (iteration {iteration_count}), continuing...")
    return HookOutput(
        decision="block",
        reason=f"继续朝目标努力。目标条件：{goal_condition}",
    )

mgr.register(ON_STOP, goal_hook)

# 4. 创建 Agent
agent = ReActAgent(
    model="...",
    api_key="...",
    hook_manager=mgr,
    max_iterations=10,
)

# 5. 运行
# Agent 会循环执行：输出文本 → on_stop 阻止 → 继续工作 → ... → on_stop 放行
async for event in agent.run("帮我构建一个博客网站"):
    # 处理事件...
    pass
```

---

## 变更日志

- **2026-07-11**：新增 Core Hook 系统。`FtreCoreHookManager` + 5 个挂点全部已集成到 `ReActRunner` 和 `ToolHandler`。`on_turn_start` / `on_stop` / `on_turn_end` 集成在 `react_runner.py`；`on_pre_tool` / `on_post_tool` 集成在 `tool_handler.py` 的 `run_one()` 中，天然并发。删除了无任何调用方的 `ToolMiddleware` 中间件机制（`registry.py` 的 `ToolMiddleware` 类、`_middlewares` 字段、`add_middleware` / `remove_middleware` / `middlewares` 属性；`tool_handler.py` 的 `_run_before` / `_run_after`；`ToolContext` 的 `skip` / `skipped` / `skip_result`）。`ReActAgent` 构造函数新增 `hook_manager` 参数。`trigger` 支持懒构造（input 传 callable 时，没有 hook 则不调用）。源码位于 `ftre_agent_core/hooks.py`，测试位于 `tests/test_hooks.py`（30 个测试）。
