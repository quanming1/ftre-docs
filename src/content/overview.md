# ftre 项目概览

ftre 是一个 AI 编程助手平台，由以下组件构成：

## 核心仓库

| 仓库 | 说明 |
|------|------|
| `ftre` | 后端 Gateway（Python / FastAPI），负责 WebSocket 通信、Session 管理、Agent 循环、Tool 执行 |
| `ftre-agent-core` | Agent 核心库（Python），包含 ReActAgent、LLM 调用、Runner 等 |
| `ftre-desktop` | 桌面客户端（Electron + React + TypeScript），提供完整的 GUI 体验 |

## 本地配置

| 路径 | 说明 |
|------|------|
| `~/.ftre/config.json` | LLM Provider、Model、Workspace 等配置 |
| `~/.ftre/plugins/` | 插件目录（Python），如 `skill_plugin.py`、`context_govern.py` |
| `~/.ftre/skills/` | Skill 目录（Markdown），可复用能力说明 |
| `~/.ftre/cron/` | 定时任务配置（JSON） |
| `~/.ftre/sessions.db` | Session 和消息持久化（SQLite） |

## 数据流概览

```
客户端 (ftre-desktop)
  │ WebSocket / HTTP API
  ▼
Gateway (ftre)
  │
  ├─ EventBus ─────────────────────────────┐
  │    ├─ Channel Manager (ws / subagent / cron)
  │    ├─ Agent Loop ──→ ReActAgent ──→ LLM (via LiteLLM)
  │    └─ Cron Scheduler
  │
  ├─ Session Manager (SQLite)
  └─ Plugin Manager (hooks + tools)
```
