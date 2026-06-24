# 架构设计

## 整体架构

```
┌─────────────────────────────────────┐
│         ftre-desktop (Electron)     │
│  ┌─────────┐  ┌──────────────────┐  │
│  │ Chat UI │  │  Editor / Term   │  │
│  └────┬────┘  └────────┬─────────┘  │
│       │                │            │
│  ┌────┴────────────────┴─────────┐  │
│  │ WebSocket + HTTP API Client   │  │
│  └────────────┬──────────────────┘  │
└───────────────┼──────────────────────┘
                │ Gateway 监听: 0.0.0.0:19470
                │ 客户端默认: ws://127.0.0.1:19470/
                │ HTTP API: http://127.0.0.1:19470/api
                │ renderer dev: http://127.0.0.1:50000
┌───────────────┼──────────────────────┐
│  ftre Gateway (Python / FastAPI)     │
│               │                      │
│  ┌────────────┴──────────────────┐   │
│  │         EventBus              │   │
│  └────────┬──────────────────────┘   │
│           │                          │
│  ┌────────┴─────────┐               │
│  │ ChannelManager    │               │
│  │ ├ WS Channel      │               │
│  │ ├ Subagent Channel│               │
│  │ └ Cron Channel    │               │
│  └───────────────────┘               │
│           │                          │
│  ┌────────┴──────────────────────┐   │
│  │       Agent Loop              │   │
│  │  ┌──────────────────────────┐ │   │
│  │  │      ReActAgent          │ │   │
│  │  │  (ftre-agent-core)       │ │   │
│  │  └──────────────────────────┘ │   │
│  └───────────────────────────────┘   │
│           │                          │
│  ┌────────┴──────────────────────┐   │
│  │      Session Manager          │   │
│  │       (SQLite)                │   │
│  └───────────────────────────────┘   │
│           │                          │
│  ┌────────┴──────────────────────┐   │
│  │    Plugin Manager + Hooks     │   │
│  │    Tool Registry              │   │
│  └───────────────────────────────┘   │
└──────────────────────────────────────┘
                │
┌───────────────┴──────────────────────┐
│  LLM (via OpenAI SDK; 依赖声明仍需同步) │
└──────────────────────────────────────┘
```

> 说明：`ftre-agent-core` 当前 LLM 适配源码直接使用 `openai.AsyncOpenAI`；但仓库 `pyproject.toml` 仍只声明 `litellm` 依赖，依赖声明与源码存在不一致。

## 核心组件

### EventBus

消息中枢，负责 inbound/outbound 消息路由。生产者和消费者通过 `publish_inbound`/`publish_outbound` 与 `subscribe_inbound`/`subscribe_outbound` 解耦；支持通过 `use_inbound`/`use_outbound` 注册中间件，对消息做过滤（返回 `None` 丢弃消息）或改写（返回修改后的 `BusMessage`）。

### Channel

内置 Channel 负责 inbound 接收与 outbound 推送：

- **WebSocketChannel**（channel_id=`ws`）：管理 WS 连接，attach/detach session，校验附件；内部 FastAPI app 挂载 `/api` 路由，提供 sessions / workspaces / config / cron / skills / commands 等 HTTP 管理接口
- **SubagentChannel**（channel_id=`subagent`）：静默通道，承载 `task` 工具派发的子任务，outbound 丢弃（事件仅持久化到数据库）
- **CronChannel**（channel_id=`cron`，定义在 `tools/cron.py`）：静默通道，承载 Cron Scheduler 触发的任务；它不是在 `mgr.start()` 前注册的常规启动 Channel，而是在 `CronScheduler.__init__()` 中补注册到 ChannelManager。cron outbound 在自身 `send()` 中丢弃，但 `ChannelManager._dispatch_loop()` 会将 `to_channel="cron"` 的 outbound 镜像到 ws channel（`MIRROR_TO_WS_CHANNELS = {"cron"}`），因此已 attach 对应 cron session 的前端连接可收到这些事件；未 attach 时不会收到

### Cron Scheduler

定时任务调度器（`CronScheduler`），按 cron 表达式触发任务，直接通过 `bus.publish_inbound()` 向 AgentLoop 投递 `user_message`；`CronChannel` 由 `CronScheduler.__init__` 在 `mgr.start()` 之后补注册到 ChannelManager，防止 outbound 分发时产生 unknown channel 警告。该 Channel 没有额外启动副作用，调度器默认扫描间隔为 30 秒。

### Agent Loop

全局单例（`AgentLoop`），并发消费所有 session 的消息。

**并发模型（v3 — 主循环化）：**

- `_consume()` 从 inbound 队列取消息后立即 `create_task(_dispatch(data))` 派发，不同 session 并发执行
- `_dispatch()` 对系统级指令（如 `/cancel`）在锁外立即执行；对普通消息获取 per-session `asyncio.Lock` 串行处理
- 所有 Agent 执行在主事件循环，`Task.cancel()` 的 `CancelledError` 在 LLM stream 的下一个 `await` 处立即抛出，实现毫秒级响应

**Pipeline（锁内执行的三步骤）：**

1. `_step_command`：对普通指令（如 `/compact`），调用 `command_manager.try_dispatch(data)`，命中则返回 `False` 短路终止（指令文本不送入 Agent）
2. `_step_compact`：对 `user_message` 类型消息检测 token 水位是否达到预压缩水位（默认 50%），超阈值则标记 `data["need_compact"]=True`；不执行压缩，仅标记
3. `_step_run`：直接 `await self._run_async(inbound, need_compact)`，在主事件循环内异步执行 Agent

> 系统级指令（`/cancel`）不在 Pipeline 内处理，而是在 `_dispatch()` 的锁外阶段由 `command_manager.try_dispatch_system()` 匹配并执行。

### Session Manager

基于 SQLite 的会话和消息持久化（`SessionManager`）：
- `sessions` 表：会话元信息（`id`, `channel_id`, `title`, `workspace`, `created_at`, `updated_at`），老库会自动补 `channel_id` / `workspace` 列并按 `id` 前缀（`<ch>::sess_xxx`）回填 channel
- `messages` 表：事件流（`id`, `session_id`, `type`, `data`, `timestamp`）

### Plugin 系统

从 `~/.ftre/plugins/` 加载 Python 插件，提供（通过 `FtrePluginApi`）：
- `register_channel()` — 注册 Channel
- `register_tool()` — 注册 Tool（另有 `registerTool()` camelCase 别名）
- `register_hook()` — 注册生命周期 Hook
- `command_manager` 属性 — 返回 `CommandManager` 实例，插件可通过 `api.command_manager.register()` 注册斜杠指令。当前 `main.py` 已将 `CommandManager` 实例传入 `PluginManager`，因此 `FtrePluginApi.command_manager` 运行时为 `CommandManager` 实例而非 `None`。系统级指令（如 `/cancel`，`system=True`）在锁外执行；普通指令在 Pipeline 锁内执行
- `event_loop` 属性 — 返回主 asyncio 事件循环引用（插件用于 `run_coroutine_threadsafe`）。当前 `main.py` 通过 `event_loop=lambda: event_loop` 在 `PluginManager` 构造函数中传入事件循环，`FtrePluginApi.event_loop` 通过 `@property` 动态解析（内部存储为 `_event_loop: Callable | None`，若可调用则惰性求值，否则直接返回）

> 注意：`AgentLoop._build_messages()` 构造 `MessagesBuildContext` 时当前未传入 `event_loop` 字段，因此 hook 的 `ctx.event_loop` 为 `None`。插件如需在 hook 中使用事件循环，应使用 `self.api.event_loop` 而非 `ctx.event_loop`。

### CompactHandler（上下文压缩）

上下文压缩功能已从插件迁移为核心组件（`ftre/agent/compact_handler.py`），作为 `AgentLoop` 的一等公民挂载。**对外入口是全异步实现**，主要方法（`should_compact()`、`compact()`、`enable_pending_compact()`、`_notify()`）都在主事件循环内 await，不需要 `run_coroutine_threadsafe` 桥接。（注：工具线程使用的 `WorkspaceAccessor` 仍会通过 `run_coroutine_threadsafe` 读写 session 的 `workspace`，但这与 CompactHandler 无关。）

主要入口：
- `should_compact()`：水位判断（async，只读 DB），默认会看 `compact_threshold`，但当前所有调用方都显式传入 `precompact_threshold`（默认 0.5）
- `compact()`：异步执行 LLM 直调摘要；当前后台 idle/usage 路径与用户输入关键路径实际都写 `context_compact(enabled=true)`。`compact(enabled=False)` 分支仍保留在代码里，作为兼容历史预压缩/pending 逻辑的入口，但当前没有调用方传入 `False`
- `enable_pending_compact()`：把历史上可能存在的 pending（`enabled=false`）`context_compact` 原地更新为 `enabled=true`；当前没有新写入 `enabled=false` 的路径，因此该调用通常返回 `False`，随后回退到 `compact(enabled=true)`

### 工具能力裁剪（Tool Capability Gating）

`build_default_tools()` 根据当前模型配置决定注册哪些工具。不支持视觉的模型不会注册 `see_img`，避免模型调用无效工具。

```python
def build_default_tools(..., llm_config=None):
    tools = [bash, read, write, edit, set_workspace, cron, ...]
    if getattr(llm_config, "vision", False):
        tools.append(see_img)
```

### Tool → AgentEvent 注入

工具可返回 `AgentEvent` 实例（不仅是 `str`），`react_runner` 检测后注入 memory。注入分两阶段：先写完所有 `tool_result`，再统一追加 `UserMessageEvent`，确保 OpenAI message 顺序合法（`assistant → tool → user`，不能交错）。

流程：`tool.func() → AgentEvent → ToolResult.event → react_runner 两阶段写入 → LLM 下一轮看到`

### see_img 工具

内置图片查看工具，支持本地绝对路径和 HTTP(S) URL。大图自动压缩（文件 >5MB 时触发：先按 >4096px resize 缩放，再按 JPEG 质量压缩），统一转 JPEG。仅在 `llm_config.vision=True` 时注册。

返回 `UserMessageEvent(content=[image_url])`，LLM 直接看到图片，前端隐藏（`metadata.hide=true`）。

### Agent 事件体系

事件从裸 dict 迁移为 `@dataclass` 类（12 个子类含 `UserMessageEvent`）。内部用 `isinstance` + 属性访问，通过 `to_dict()` 序列化为 JSON。详见 [Agent 事件协议](/docs/agent-events)。