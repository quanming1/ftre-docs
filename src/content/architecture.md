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

定时任务调度器（`CronScheduler`），按 cron 表达式触发任务，直接通过 `bus.publish_inbound()` 向 AgentLoop 投递 `user_input`；`CronChannel` 由 `CronScheduler.__init__` 在 `mgr.start()` 之后补注册到 ChannelManager，防止 outbound 分发时产生 unknown channel 警告。该 Channel 没有额外启动副作用，调度器默认扫描间隔为 30 秒。

### Agent Loop

全局单例（`AgentLoop`），消费所有 session 的消息，Pipeline 包含三个阶段：
1. `_step_command`：对 `user_input` 类型且 `/` 开头的消息，交给 `CommandManager` 匹配；命中则 dispatch handler 并标记 `command_hit=True`（`/cancel` 替换 inbound 为 cancel 类型；`/compact` fire-and-forget 异步执行压缩）
2. `_step_compact`：对未命中指令的 `user_input`，检测 token 水位是否达到启用水位（默认 60%），超阈值则将 `need_compact=True` 写入 pipeline data；绝不在此阶段执行压缩（本阶段运行在唯一 inbound 消费循环里，执行压缩会阻塞消费循环），真正的启用/兜底压缩执行在 `_run_async()` 中
3. `_step_run`：按最终 inbound 类型派发——`cancel` → `cancel_nowait()`；`user_input` 且 `command_hit` 未设置 → 通过 `asyncio.ensure_future(run_in_executor)` fire-and-forget 派发 `_run` 到线程池线程，`_run` 内部通过 `asyncio.run()` 创建独立事件循环执行 `_run_async()`，驱动 `ReActAgent`；`command_hit=True` → 短路终止

### Session Manager

基于 SQLite 的会话和消息持久化（`SessionManager`）：
- `sessions` 表：会话元信息（`id`, `channel_id`, `title`, `workspace`, `created_at`, `updated_at`），老库会自动补 `channel_id` / `workspace` 列并按 `id` 前缀（`<ch>::sess_xxx`）回填 channel
- `messages` 表：事件流（`id`, `session_id`, `type`, `data`, `timestamp`）

### Plugin 系统

从 `~/.ftre/plugins/` 加载 Python 插件，提供（通过 `FtrePluginApi`）：
- `register_channel()` — 注册 Channel
- `register_tool()` — 注册 Tool（另有 `registerTool()` camelCase 别名）
- `register_hook()` — 注册生命周期 Hook
- `command_manager` 属性 — 返回 `CommandManager` 实例（可能为 `None`），插件可通过 `api.command_manager.register()` 注册斜杠指令。源码类型标注为 `object | None`，运行时实际为 `CommandManager` 实例或 `None`。**注：当前 `main.py` 创建了 `CommandManager` 实例并传入 `AgentLoop`（用于 `/cancel` 和 `/compact` 等内置指令注册）和 API 路由（用于 `GET /api/commands`），但创建 `PluginManager` 时未传入 `command_manager`，因此 `FtrePluginApi.command_manager` 运行时始终为 `None`；插件中条件注册（如 `if command_manager is not None`）的指令实际上不会注册**
- `event_loop` 属性 — 返回主 asyncio 事件循环引用（插件用于 `run_coroutine_threadsafe`）。源码 `FtrePluginApi.event_loop` 支持 callable 惰性求值或直接返回实例；当前 `main.py` 在 `agent_loop.start()` 后、`plugin_manager.load_all()` 前直接赋值 `plugin_manager._event_loop = agent_loop._event_loop`，因此随后加载的插件会在 `FtrePluginApi` 中拿到该事件循环实例。hook 的 `ctx.event_loop` 由 `AgentLoop._build_messages()` 单独传入，通常与 `self.api.event_loop` 指向同一个主事件循环

### CompactHandler（上下文压缩）

上下文压缩功能已从插件迁移为核心组件（`ftre/agent/compact_handler.py`），作为 `AgentLoop` 的一等公民挂载。主要入口：
- `should_compact()`：水位判断（async，只读 DB），由调用方传入 50% 预压缩水位或 60% 启用水位
- `compact()`：同步执行 LLM 直调摘要，在线程中调用；50% 后台路径写 `context_compact(enabled=false)`，手动或兜底路径写 `enabled=true`
- `enable_pending_compact()`：把最新 pending `context_compact` 原地更新为 `enabled=true`

压缩流程：选择 head/tail 边界 → LLM 直调生成 anchored summary → 写 `context_compact` 事件到 DB；后续达到启用水位时更新 `enabled=true`，`SessionManager.to_openai_messages()` 才使用该摘要替代旧历史。
