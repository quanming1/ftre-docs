# ftre 项目概览

ftre 是一个 AI 编程助手平台，由以下组件构成：

## 核心仓库

| 仓库 | 说明 |
|------|------|
| `ftre` | 后端 Gateway（Python / FastAPI），负责 WebSocket / HTTP API 通信、Session 管理、Agent 循环、默认工具集接入与事件持久化；具体工具调度执行由 `ftre-agent-core` 的 runner/tool_handler 完成 |
| `ftre-agent-core` | Agent 核心库（Python），包含 ReActAgent、基于 OpenAI SDK 的 Chat Completions 流式 LLM 适配、Runner 与 Tool 系统等（注意：当前源码直接导入 `openai.AsyncOpenAI`，但 `pyproject.toml` 仍只声明了 `litellm` 依赖，依赖声明与源码存在不一致） |
| `ftre-desktop` | 桌面客户端（Electron + React + TypeScript），提供完整的 GUI 体验 |

## 本地配置

| 路径 | 说明 |
|------|------|
| `~/.ftre/config.json` | LLM Provider、Model、默认 Workspace、可选标题生成模型等配置；`agents.defaults.title_generation` 会被解析为 `AgentConfig.title_llm`，本地 `title_gen` 插件会尝试读取它用于标题生成（但当前插件与现版 LLM API 不兼容，详见本地插件页）；Gateway 监听端口当前不从此文件读取 |
| `~/.ftre/plugins/` | 插件目录（Python），如 `skill_plugin.py`、`context_govern.py` |
| `~/.ftre/skills/` | Skill 目录（Markdown），可复用能力说明 |
| `~/.ftre/cron/` | 定时任务目录（JSON），每个任务一个 `job_xxx.json` 文件 |
| `~/.ftre/sessions.db` | Session 和消息持久化（SQLite） |

## 数据流概览

```
客户端 (ftre-desktop)
  │ WebSocket / HTTP API
  ▼
Gateway (ftre)
  │
  ├─ EventBus（消息中枢：inbound / outbound 两个全局队列）
  │    ├─ inbound → AgentLoop 统一消费
  │    └─ outbound → ChannelManager 统一分发
  │
  ├─ ChannelManager（常规启动 ws / subagent；CronScheduler 创建时补注册 cron 静默 Channel）
  ├─ AgentLoop (Pipeline: command → compact → run)
  │    ├─ _step_command → CommandManager → /cancel / /compact
  │    ├─ _step_compact → CompactHandler → 自动压缩水位检测
  │    └─ _step_run → ReActAgent → LLM (via OpenAI SDK / OpenAI 兼容接口)
  ├─ CronScheduler（按 cron 表达式周期扫描 ~/.ftre/cron/）
  ├─ SessionManager (SQLite)
  └─ PluginManager (hooks + tools)
```
