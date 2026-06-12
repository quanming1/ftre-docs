# 指令系统

ftre 支持斜杠指令（`/`），在消息被 Agent 处理之前由 Pipeline 拦截并处理，不经过 LLM。

---

## 已注册指令

| 指令 | 参数 | 说明 | 注册位置 |
|------|------|------|---------|
| `/cancel` | 无 | 取消当前 session 正在执行的 Agent。handler 将 pipeline 的 inbound 替换为 `type="cancel"` 的 BusMessage，后续 `_step_run` 检测到 cancel 类型后调用 `agent.cancel_nowait()`；被取消的 Agent 自身产出 `done(success=false, reason="cancelled")` 作为最终信号 | `AgentLoop._register_commands()` |
| `/compact` | 无 | 手动触发上下文压缩。handler（`_cmd_compact`）以 fire-and-forget 方式派发压缩任务：通过 `asyncio.ensure_future` 启动 `_run_compact` 协程，后者在 `run_in_executor` 线程中执行 `CompactHandler.compact()`；压缩完成后通过 `_emit_status("idle")` 发送 `session_status` 全局事件通知前端结束 loading（而非 `done` 事件，因为 `/compact` 走命令短路、不走 `_run_async`）。`CompactHandler` 通过 `_notify()` 发送 `context_compact_start / context_compact_done / context_compact_failed` 实时事件，并写入 `context_compact` 持久化事件到 DB。handler 不修改 `ctx.meta["inbound"]`，但 `_step_command` 命中后设置 `command_hit=True`，后续 `_step_compact` 跳过已命中指令的 user_input，`_step_run` 中 `command_hit=True` 时不再将指令文本作为 user_input 送入 Agent | `AgentLoop._register_commands()` |

> `/compact` 指令已在 `AgentLoop._register_commands()` 中直接注册（不再通过插件 `command_manager`），可正常使用。`FtrePluginApi.command_manager` 运行时仍为 `None`（`main.py` 未将其传入 `PluginManager`），因此插件中条件注册的指令（如 `if command_manager is not None`）实际不会生效。

> `/help` 等指令当前未注册。如需扩展，当前应在 `AgentLoop._register_commands()` 中追加。`FtrePluginApi` 理论上暴露 `command_manager` 属性，但当前运行时 `PluginManager` 未注入该对象，插件通过 `self.api.command_manager.register()` 注册指令不会生效。未匹配任何注册指令的 `/` 开头输入会作为普通 `user_input` 送入 Agent。

---

## 实现原理

### 拦截点在 Pipeline

指令检查在 `_consume()` 的 Pipeline 第一步 `_step_command` 中完成，随后经过 `_step_compact`（自动压缩）到达 `_step_run`：

```text
_consume() → Pipeline.run({inbound})
               │
               ├─ _step_command: 检查 inbound 是否为 user_input 且文本以 / 开头
               │    ├─ 匹配到已注册指令 → dispatch handler（handler 可修改 ctx.meta）；
               │    │   命中后设置 data["command_hit"]=True
               │    └─ 未匹配已注册指令 → 继续
               │
               ├─ _step_compact: 对未命中指令的 user_input 执行自动压缩水位检测
               │    ├─ command_hit=True → 跳过
               │    └─ 否则检测 token 水位，超阈值则标记 need_compact=True（不执行压缩；压缩在 _run 线程中执行）
               │
               └─ _step_run: 根据最终 inbound.type 派发
                    ├─ type=cancel     → cancel_nowait()
                    ├─ type=user_input 且 command_hit=True → 短路终止（指令文本不送入 Agent）
                    ├─ type=user_input 且 command_hit 为空 → _run()
                    └─ 返回 False（短路终止 Pipeline）
```

**关键设计**：`_step_command` 和 `_step_compact` 始终返回 `True`（继续），不做短路。`_step_run` 返回 `False`（短路终止）。指令的 handler 通过修改 `ctx.meta` 来改变后续行为——如 `/cancel` 把 inbound 替换为 `type="cancel"` 的 BusMessage，使得 `_step_run` 走 cancel 分支；`/compact` 命中后设置 `command_hit=True`，使 `_step_run` 不再将指令文本作为 user_input 送入 Agent。

> 指令拦截发生在 Pipeline 内，**不经过 `before_messages_build` hook**——指令检查在 `_step_command`（Pipeline 第一步），先于 `_step_compact` 和 `_step_run`，而 `before_messages_build` hook 在 `_run` 内部的 `_build_messages()` 中触发，只有未被指令拦截的 `user_input` 才会走到 hook。

### CommandManager

自包含的指令注册与匹配器，不依赖 Pipeline：

```python
cmd = CommandManager()
cmd.register("/cancel", handler, description="取消当前会话执行")
cmd.register("/compact", handler, description="压缩当前会话上下文")
```

**注册：** `register(command, handler, *, description="", args_hint="")` — 按 command 长度降序排序，长的优先匹配。

**派发：** `dispatch(raw, meta=None)` — 前缀 + 空格边界匹配。返回 `True` 表示命中，`False` 表示未匹配。handler 通过 `ctx.meta` 回写结果。handler 可同步可异步（`async def`），异步 handler 会被 `await`。`_step_command` 中通过 `await` 调用。

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

handler 通过 `ctx.meta` 回写结果——当前 AgentLoop 实际消费的是 `ctx.meta["inbound"]`（如 `/cancel` 替换为 cancel 消息）和 `_step_command` 写入的 `command_hit` 标记。`ctx.meta["result"]` 只是 CommandManager 示例里可约定使用的普通字段，现有 AgentLoop 不会把它自动转换成前端文本响应。

### /cancel 的完整流程

```python
# 注册（AgentLoop._register_commands）
# /cancel
self.command_manager.register(
    "/cancel",
    lambda ctx: ctx.meta.update(
        inbound=BusMessage(
            type="cancel",
            from_channel=ctx.meta["inbound"].from_channel,
            from_session=ctx.meta["inbound"].from_session,
            to_channel=ctx.meta["inbound"].to_channel,
            to_session=ctx.meta["inbound"].to_session,
            data={"session_id": ctx.meta["inbound"].from_session},
        )
    ),
    description="取消当前会话执行",
)
# /compact
self.command_manager.register(
    "/compact",
    self._cmd_compact,
    description="压缩当前会话上下文",
)
```

1. 前端发送 `type: "user_input"`、`content: "/cancel"` 的帧
2. `ws_channel` 投递 BusMessage(type="user_input") 到 Bus
3. `AgentLoop._consume()` → Pipeline.run
4. `_step_command`：检测到 `/cancel`，dispatch handler → handler 把 `ctx.meta["inbound"]` 替换为 `type="cancel"` 的 BusMessage
5. `_step_run`：inbound.type == "cancel" → 调用 `agent.cancel_nowait()`
6. 被取消的 Agent 产出 `done(success=false, reason="cancelled")`

`/cancel` 的用户输入**不会**入库 USER_INPUT（因为后续走的是 cancel 分支，不会执行 `_run`），也**不会** echo 给前端。

### /compact 的完整流程

1. 前端发送 `type: "user_input"`、`content: "/compact"` 的帧
2. `ws_channel` 投递 BusMessage(type="user_input") 到 Bus
3. `AgentLoop._consume()` → Pipeline.run
4. `_step_command`：检测到 `/compact`，dispatch `_cmd_compact` handler → handler 以 fire-and-forget 方式派发 `_run_compact` 协程（`asyncio.ensure_future`），协程内先发 `session_status("running")`，再通过 `run_in_executor` 线程执行 `CompactHandler.compact()`，完成后发 `session_status("idle")`；`dispatch` 命中返回后由 `_step_command` 统一设置 `command_hit=True`
5. `_step_compact`：`command_hit=True` → 跳过
6. `_step_run`：`command_hit=True` → 不执行 Agent，短路终止

`/compact` 的用户输入**不会**入库 USER_INPUT，也**不会** echo 给前端。压缩结果通过 `CompactHandler._notify()` 发送 `context_compact_start / context_compact_done / context_compact_failed` 实时事件，并写入 `context_compact` 持久化事件到 DB。前端的 busy 状态由 `_cmd_compact` 内的 `_emit_status` 发送的 `session_status` 全局事件控制（`running` → `idle`）。

---

## 前端集成

**命令面板：** `GET /api/commands` 返回已注册指令列表，前端输入 `/` 时弹出面板供选择。

**无参指令直接发送：** `args_hint` 为空的指令（如 `/cancel`），选中后直接替换为对应指令并发送。有参指令填入输入框等待用户补全。

**手动压缩入口：** 当前后端已实现的手动压缩入口是发送 `/compact` 指令。桌面端 `ChatHeader` 中的归档/压缩菜单调用 `triggerCompaction()`，会请求 `POST /api/sessions/{id}/compact`；后端 `routes.py` 当前没有该路由，因此该 HTTP 入口尚未接通，会失败。

---

## 扩展

新指令当前应在 `AgentLoop._register_commands()` 中注册。插件侧虽然可以读取 `self.api.command_manager` 属性，但当前运行时该属性为 `None`，因此不能依赖插件动态注册指令。
