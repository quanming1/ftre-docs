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
                │ ws://127.0.0.1:18790/
                │ http://127.0.0.1:18790/api
┌───────────────┼──────────────────────┐
│  ftre Gateway (Python / FastAPI)     │
│               │                      │
│  ┌────────────┴──────────────────┐   │
│  │         EventBus              │   │
│  └────────┬──────────────────────┘   │
│           │                          │
│  ┌────────┴─────────┐               │
│  │ Channel Manager   │               │
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

消息中枢，负责 inbound/outbound 消息路由。生产者和消费者通过 subscribe/publish 解耦。

### Channel

- **WebSocket Channel**：管理 WS 连接，attach/detach session，校验附件
- **HTTP API**：由 WebSocketChannel 内部 FastAPI app 挂载在 `/api`，提供 sessions / config / cron / skills 等管理接口
- **Subagent Channel**：静默通道，承载 `task` 工具派发的子任务
- **Cron Channel**：静默通道，承载 Cron Scheduler 触发的任务

### Agent Loop

全局单例，消费所有 session 的消息：
1. `user_input` → 在 worker thread 中执行 `_run()`
2. `cancel` → 中断对应 session 的 Agent

### Session Manager

基于 SQLite 的会话和消息持久化：
- `sessions` 表：会话元信息（id, channel_id, title, workspace, created_at, updated_at）
- `messages` 表：事件流（id, session_id, type, data, timestamp）

### Plugin 系统

从 `~/.ftre/plugins/` 加载 Python 插件，提供：
- `register_channel()` — 注册 Channel
- `register_tool()` — 注册 Tool
- `register_hook()` — 注册生命周期 Hook
