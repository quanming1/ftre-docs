# 指令系统

ftre 支持斜杠指令（`/`），在消息被 Agent 处理之前由 Pipeline 拦截并直接处理，不经过 LLM。

---

## 已实现

| 指令 | 参数 | 说明 | 注册位置 |
|------|------|------|---------|
| `/cancel` | 无 | 取消当前 session 正在执行的 Agent；这是 `ephemeral` 指令，不持久化用户输入、不 echo `/cancel`，只调用 `agent.cancel_nowait()`；取消的最终信号由 Agent 自身发出的 `done(reason="cancelled")` 表达 | `AgentLoop._register_commands()` |
| `/help` | 无 | 列出当前已注册的所有指令；普通指令，会持久化 `USER_INPUT`、echo 输入、持久化并下发结果 | `AgentLoop._register_commands()` |
| `/compact` | 无 | 立即触发上下文压缩；普通指令，会写入 `context_compact` 事件并下发压缩状态事件 | `context_compact.py` 插件 |

> 后续如需扩展（如 `/status`、`/model`、`/new` 等），可在 `AgentLoop._register_commands()` 中追加，或由插件通过 `self.api.register_command()` / `self.api.command_manager.register()` 动态添加。若需要不入库、不 echo 的控制指令，可直接使用 `CommandManager.register(..., ephemeral=True)`。

---

## 实现原理

### 拦截点在 Pipeline

指令检查在 `_consume()` 的 Pipeline 第一节点 `_step_command` 中完成：

```text
_consume() → Pipeline.run({inbound})
               │
               ├─ _step_command: 检查 inbound 是否为 user_input 且文本以 / 开头
               │    ├─ 未匹配已注册指令 → 继续
               │    ├─ 命中 ephemeral 指令（如 /cancel）
               │    │    └─ 同步 dispatch handler；不持久化用户输入、不 echo；
               │    │       pipeline 返回 False 短路（不发送 message_complete / done）
               │    └─ 命中普通指令（如 /help、/compact）
               │         └─ 把“入库 USER_INPUT + echo + dispatch + 结果/完成事件”
               │            整体丢到线程池（_run_command）；pipeline 返回 False 短路
               │
               └─ _step_run: 仅处理未命中指令的 inbound
                    ├─ type=cancel     → cancel_nowait()
                    └─ type=user_input → _run()
```

整个过程**不经过 `before_messages_build` hook**——指令拦截在更外层，先于消息构建。

> 注意：命中指令时 pipeline 会**短路**（不再走 `_step_run`）。普通指令的副作用由 `_run_command` 在线程池中完成；`ephemeral` 指令只执行 handler，不保存用户输入、不 echo 输入。

### CommandManager

自包含的指令注册与匹配器，不依赖 Pipeline：

```python
cmd = CommandManager()
cmd.register("/cancel", handler, description="取消当前会话执行", ephemeral=True)
cmd.register("/model", handler, description="切换模型预设", args_hint="[preset]")
```

**注册：** `register(command, handler, *, description="", args_hint="", ephemeral=False)` — 按 command 长度降序排序，长的优先匹配。

**匹配：** `match(raw)` — 返回 `None` / `"ephemeral"` / `"normal"`，供 Pipeline 判断处理路径。

**派发：** `dispatch(raw, meta)` — 前缀 + 空格边界匹配。返回 `True` 表示命中，`False` 表示未匹配，通过 `ctx.meta` 回写结果。

**匹配规则：**

| 输入 | 注册项 | 结果 |
|------|--------|------|
| `/cancel` | `/cancel` | ✅ 命中，`args=None` |
| `/cancel abc` | `/cancel` | ✅ 命中，`args="abc"` |
| `/cancelabc` | `/cancel` | ❌ 不命中（必须是完整指令或后接空格） |
| `/model gpt-5` | `/model` | ✅ 命中，`args="gpt-5"` |

### CommandContext

```python
@dataclass
class CommandContext:
    raw: str                                    # 原始输入
    command: str                                # 命中的指令
    args: str | None                            # 指令后的文本，无则为 None
    meta: dict[str, Any] = field(default_factory=dict)  # pipeline 的 data，handler 可修改
```

handler 通过 `ctx.meta` 回写结果——常用字段是 `result`（文本响应），也可读取 `inbound` 获取当前 BusMessage。

### Handler 模式

**文本响应型：**

```python
cmd.register("/help", lambda ctx: ctx.meta.update(result="可用指令: ..."))
```

普通指令写入 `result` 后，`_run_command` 会持久化并下发：

```json
{ "type": "message_complete", "data": { "content": "..." } }
{ "type": "done", "data": { "success": true, "reason": "command" } }
```

**ephemeral 控制型（/cancel）：**

```python
def _handle_cancel_command(self, ctx) -> None:
    sid = ctx.meta["inbound"].from_session
    agent = self._active_agents.get(sid)
    if agent:
        agent.cancel_nowait()

cmd.register("/cancel", _handle_cancel_command, description="取消当前会话执行", ephemeral=True)
```

`/cancel` handler 直接对 `_active_agents` 中对应 session 的 Agent 调用 `cancel_nowait()`。被取消的 Agent 在 `ReActRunner._loop()` 中捕获取消后产出 `done(success=false, reason="cancelled")` 事件并正常收尾。由于 `/cancel` 是 ephemeral 指令，handler 不设 `result` 时不产生额外的确认消息和 `done`——取消的最终信号由 Agent 自身发出的 `done(reason="cancelled")` 表达。

---

## 前端集成

**命令面板：** `GET /api/commands` 返回已注册指令列表，前端输入 `/` 时弹出面板供选择。

**无参指令直接发送：** `args_hint` 为空的指令（如 `/cancel`），选中后直接替换为对应指令并发送。有参指令填入输入框等待用户补全。

---

## 扩展

新指令在 `AgentLoop._register_commands()` 中注册，也可通过插件调用 `self.api.register_command()` 动态添加；若插件需要设置 `ephemeral=True`，可直接调用 `self.api.command_manager.register(...)`。