# 指令系统

ftre 支持斜杠指令（`/`），部分指令在 Agent 处理之前拦截并处理，不经过 LLM。

---

## 指令层级

CommandManager 支持两级指令：

- **系统级**（`system=True`）：在 `_dispatch()` 的 session lock 之外执行，不受锁阻塞，保证立即响应。当前只有 `/cancel`
- **普通级**（默认）：在 Pipeline 的 `_step_command` 阶段（锁内）执行，受 session lock 保护，用于需要串行执行的指令（如 `/compact`）

调用方只需：
```python
if await cmd.try_dispatch_system(data): return   # 锁外，系统级
# ...获取 session lock...
cmd_def = await cmd.try_dispatch(data)            # 锁内，普通级
if cmd_def is not None: return                    # 匹配到，短路
```

---

## 已注册指令

| 指令 | 层级 | 参数 | 说明 | 注册位置 |
|------|------|------|------|---------|
| `/cancel` | 系统级（`system=True`） | 无 | 取消当前 session 正在执行的 Agent。handler 直接调用 `agent.cancel_nowait()` 和 `task.cancel()`，被取消的 Agent（或 task）产出 `done(success=false, reason="cancelled")` 作为最终信号 | `AgentLoop._register_commands()` |
| `/compact` | 普通级 | 无 | 手动触发上下文压缩。handler（`_cmd_compact`）以 async 方式直接 await 执行压缩：先 emit `session_status("compacting")`，再 `await compact_manager.enable_pending_compact()`，没有 pending 则 `await compact_manager.compact(enabled=True, silent=False)`，最后 emit `session_status(...)` 收尾（通常是 `idle`，因 `_compacting_sessions` 在 finally 中先被清掉再发状态）。命中后 `_step_command` 返回 `False` 短路终止 Pipeline，指令文本不送入 Agent | `AgentLoop._register_commands()` |

> `/help` 等指令当前未注册。如需扩展，可在 `AgentLoop._register_commands()` 中追加普通级指令，或通过插件 `self.api.command_manager.register()` 注册（当前 `command_manager` 已注入 `PluginManager`，插件注册的指令会在 `GET /api/commands` 返回的列表中出现，并在 `_step_command` 中匹配）。未匹配任何注册指令的 `/` 开头输入会作为普通 `user_message` 送入 Agent。

---

## 实现原理

### 系统级指令 — 锁外执行

系统级指令在 `_dispatch()` 的最前面处理，**不受 session lock 阻塞**，保证用户点击停止后立即响应：

```python
async def _dispatch(self, data: dict) -> None:
    # ─── 系统级指令：锁外执行 ───
    if await self.command_manager.try_dispatch_system(data):
        return  # 已执行，短路退出

    # ─── 普通消息：获取 per-session lock → 跑 pipeline ───
    async with lock:
        await self._pipeline.run(data)
```

### 普通指令 — Pipeline 锁内执行

普通指令检查在 Pipeline 第一步 `_step_command` 中完成：

```text
_dispatch() → 获取 session lock → Pipeline.run(data)
                │
                ├─ _step_command: 检查 inbound 是否为 user_message 且文本以 / 开头
                │    ├─ 匹配到已注册指令 → dispatch handler → 返回 False（短路终止）
                │    └─ 未匹配已注册指令 → 返回 True（继续 pipeline）
                │
                ├─ _step_compact: 对 user_message 检测 token 水位
                │    ├─ 非 user_message → 返回 True（跳过）
                │    └─ 检测水位，超阈值标记 need_compact=True → 返回 True
                │
                └─ _step_run: await _run_async(inbound, need_compact) → 返回 False（终止）
```

**关键设计**：`_step_command` 返回 `True`（继续）或 `False`（命中指令则短路终止）。`_step_compact` 始终返回 `True`（只标记，不短路）。`_step_run` 返回 `False`（执行完毕终止 Pipeline）。

> 普通指令拦截发生在 Pipeline 内，**不经过 `before_messages_build` hook**——指令检查在 `_step_command`（Pipeline 第一步），先于 `_step_compact` 和 `_step_run`，而 `before_messages_build` hook 在 `_run_async()` 内部的 `_build_messages()` 中触发，只有未被指令拦截的 `user_message` 才会走到 hook。

### CommandManager

自包含的指令注册与匹配器，支持两级指令：

```python
cmd = CommandManager()
cmd.register("/cancel", handler, description="取消当前会话执行", system=True)  # 系统级
cmd.register("/compact", handler, description="压缩当前会话上下文")              # 普通级
```

**注册：** `register(command, handler, *, description="", args_hint="", system=False)` — 按 command 长度降序排序，长的优先匹配。`system=True` 注册为系统级指令。

**派发：**
- `try_dispatch_system(data)` — 从 data 提取文本，匹配系统级指令并执行。返回 `True` 表示命中
- `try_dispatch(data)` — 从 data 提取文本，匹配普通级指令并执行。返回 `CommandDef` 表示命中，未匹配返回 `None`
- `dispatch_system(raw, meta=None)` — 低级 API，直接传文本匹配系统级指令（与 `dispatch` 对称）。返回 `bool`
- `dispatch(raw, meta=None)` — 低级 API，直接传文本匹配普通级指令。返回 `bool`

handler 通过 `ctx.meta` 回写结果。handler 可同步可异步（`async def`），异步 handler 会被 `await`。

**匹配规则：**

| 输入 | 注册项 | 结果 |
|------|--------|------|
| `/cancel` | `/cancel` | ✅ 命中，`args=None` |
| `/cancel abc` | `/cancel` | ✅ 命中，`args="abc"` |
| `/cancelabc` | `/cancel` | ❌ 不命中（必须是完整指令或后接空格） |
| `/compact` | `/compact` | ✅ 命中，`args=None` |

### CommandContext

```python
@dataclass
class CommandContext:
    raw: str                                    # 原始输入
    command: str                                # 命中的指令
    args: str | None                            # 指令后的文本，无则为 None
    meta: dict[str, Any] = field(default_factory=dict)  # pipeline 的 data，handler 可修改
```

handler 通过 `ctx.meta` 回写结果。当前 AgentLoop 实际消费的是 `ctx.meta["inbound"]`（系统级 `/cancel` handler 不修改 meta，而是直接操作 `_active_agents` 和 `_session_tasks`）。

### /cancel 的完整流程

```python
# 注册（AgentLoop._register_commands）
def _on_cancel(ctx):
    sid = ctx.meta["inbound"].from_session or ctx.meta["inbound"].data.get("session_id", "")
    agent = self._active_agents.get(sid)
    if agent:
        agent.cancel_nowait()
    task = self._session_tasks.get(sid)
    if task and not task.done():
        task.cancel()

self.command_manager.register(
    "/cancel",
    _on_cancel,
    description="取消当前会话执行",
    system=True,
)
```

1. 前端发送 `type: "user_message"`、`content: "/cancel"` 的帧（或发送 `type: "cancel"` 帧，ws_channel 会将其转换为 `/cancel` 的 user_message）
2. `ws_channel` 投递 BusMessage(type="user_message") 到 Bus
3. `AgentLoop._consume()` → `create_task(_dispatch(data))`
4. `_dispatch()`：`try_dispatch_system()` 匹配到 `/cancel` → 执行 `_on_cancel` → 直接调用 `agent.cancel_nowait()` 和 `task.cancel()` → 返回 `True`，短路退出
5. 被取消的 Agent 或 task 产出 `done(success=false, reason="cancelled")`

`/cancel` 的用户输入**不会**入库 `user_message`（因为 `_dispatch` 在系统级指令命中后直接 return，不走 Pipeline），也**不会** echo 给前端。

### /compact 的完整流程

1. 前端发送 `type: "user_message"`、`content: "/compact"` 的帧
2. `ws_channel` 投递 BusMessage(type="user_message") 到 Bus
3. `AgentLoop._consume()` → `create_task(_dispatch(data))`
4. `_dispatch()`：`try_dispatch_system()` 不命中 → 获取 session lock → `pipeline.run(data)`
5. `_step_command`：检测到 `/compact` → 先持久化 `user_message` 入库（`_step_command` 命中指令后先保存用户输入再执行 handler）→ `try_dispatch()` 匹配并执行 `_cmd_compact` handler → handler async 直接 await 压缩 → `_step_command` 返回 `False`（短路终止 Pipeline）
6. `_step_compact` 和 `_step_run` 不再执行

`/compact` 的用户输入**会**入库 `user_message`（`_step_command` 命中后先持久化再执行 handler），但**不会** echo 给前端（echo 在 `_run_async` 的 Step 6.5 中，Pipeline 已短路跳过）。压缩结果通过 `CompactManager._notify()` 异步发送 `context_compact_start / context_compact_done / context_compact_failed` 实时事件，并写入 `enabled=true` 的 `context_compact` 持久化事件到 DB。前端的 busy 状态由 `_cmd_compact` 内的 `_publish_session_status_async` 发送的 `session_status` 全局事件控制（`compacting` → `idle`）。

---

## 前端集成

**命令面板：** `GET /api/commands` 返回已注册指令列表（含 `system` 字段标识层级），前端输入 `/` 时弹出面板供选择。

**无参指令直接发送：** `args_hint` 为空的指令（如 `/cancel`），选中后直接替换为对应指令并发送。有参指令填入输入框等待用户补全。

**手动压缩入口：** 发送 `/compact` 指令是后端可靠的手动压缩入口。后端 `routes.py` 当前**没有**实现 `POST /api/sessions/{id}/compact` 路由；前端 ChatHeader 的「归档会话」菜单调用该路由但后端未实现，无法生效；如需手动压缩，请直接发送 `/compact` 消息。

---

## 扩展

新指令可在 `AgentLoop._register_commands()` 中注册。系统级指令使用 `system=True` 参数，普通级指令默认。插件侧可通过 `self.api.command_manager.register()` 注册普通级指令（当前 `command_manager` 已注入 `PluginManager`，插件注册的指令可正常生效）。

## 校对记录

- **2025-06-26**：补全 `CommandManager` 低级 API 描述。新增 `dispatch_system(raw, meta=None)`（系统级版本），与 `dispatch(raw, meta=None)`（普通级版本）对称。源码依据：`ftre/src/ftre/command/manager.py:128-134`。
