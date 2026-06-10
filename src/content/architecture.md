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
                │ ws://127.0.0.1:19470/
                │ http://127.0.0.1:19470/api
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
│           LLM (via LiteLLM)           │
└──────────────────────────────────────┘
```

## 核心组件

### EventBus

消息中枢，负责 inbound/outbound 消息路由。生产者和消费者通过 `publish_inbound`/`publish_outbound` 与 `subscribe_inbound`/`subscribe_outbound` 解耦；支持通过 `use_inbound`/`use_outbound` 注册中间件，对消息做过滤或改写。

### Channel

三个 Channel 子类注册到 ChannelManager，负责 inbound 接收与 outbound 推送：

- **WebSocketChannel**（channel_id=`ws`）：管理 WS 连接，attach/detach session，校验附件；内部 FastAPI app 挂载 `/api` 路由，提供 sessions / workspaces / config / cron / skills / commands 等 HTTP 管理接口
- **SubagentChannel**（channel_id=`subagent`）：静默通道，承载 `task` 工具派发的子任务，outbound 丢弃（事件仅持久化到数据库）
- **CronChannel**（channel_id=`cron`）：静默通道，承载 Cron Scheduler 触发的任务，outbound 丢弃

### Cron Scheduler

定时任务调度器（`CronScheduler`），按 cron 表达式触发任务，直接通过 `bus.publish_inbound()` 向 AgentLoop 投递 `user_input`；CronChannel 仅作为静默 sink 注册到 ChannelManager，防止 outbound 分发时产生 unknown channel 警告。

### Agent Loop

全局单例（`AgentLoop`），消费所有 session 的消息：
1. `user_input` → 经过 `Pipeline`（内置 `/cancel`、`/help` 指令由 `CommandManager` 匹配；插件可注册如 `/compact`）；未命中指令时在 worker thread 中执行 `_run()`，驱动 `ReActAgent`
2. `cancel` → 中断对应 session 的 Agent

### Session Manager

基于 SQLite 的会话和消息持久化（`SessionManager`）：
- `sessions` 表：会话元信息（`id`, `channel_id`, `title`, `workspace`, `created_at`, `updated_at`），老库会自动补 `channel_id` / `workspace` 列并按 `id` 前缀（`<ch>::sess_xxx`）回填 channel
- `messages` 表：事件流（`id`, `session_id`, `type`, `data`, `timestamp`）

### Plugin 系统

从 `~/.ftre/plugins/` 加载 Python 插件，提供（通过 `FtrePluginApi`）：
- `register_channel()` — 注册 Channel
- `register_tool()` — 注册 Tool（另有 `registerTool()` camelCase 别名）
- `register_hook()` — 注册生命周期 Hook
- `register_command()` — 注册斜杠指令
