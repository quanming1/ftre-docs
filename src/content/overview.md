# ftre 项目概览

ftre 是一个 AI 编程助手平台，由以下组件构成：

## 核心仓库

| 仓库 | 说明 |
|------|------|
| `ftre` | 后端 Gateway（Python / FastAPI），负责 WebSocket / HTTP API 通信、Session 管理、Agent 循环、默认工具集接入与事件持久化；具体工具调度执行由 `ftre-agent-core` 的 runner/tool_handler 完成。Gateway 默认监听 `127.0.0.1:48650`，可通过 `~/.ftre/config.json` 的 `servers.gateway` 调整 |
| `ftre-agent-core` | Agent 核心库（Python），包含 ReActAgent、基于 OpenAI SDK 的 Chat Completions 流式 LLM 适配、Runner 与 Tool 系统等（注意：当前源码直接导入 `openai.AsyncOpenAI`，但 `pyproject.toml` 仍只声明了 `litellm` 依赖，依赖声明与源码存在不一致） |
| `ftre-desktop` | 桌面客户端（Electron + React + TypeScript），提供完整的 GUI 体验 |

## 本地配置

| 路径 | 说明 |
|------|------|
| `~/.ftre/config.json` | LLM Provider、Model、默认 Workspace、可选标题生成模型与压缩模型、Gateway / 前端 dev 端口等配置；`agents.defaults.title_generation` / `compact_generation` 会分别解析为 `AgentConfig.title_llm` / `compact_llm`；`agents.defaults.workspace` 会写入 `AgentConfig.workspace`，但实际运行时工作区优先级仍以 session 自身 `workspace` 字段为准；Gateway 监听 host / port 从 `servers.gateway` 读取，缺省 `127.0.0.1:48650` |
| `~/.ftre/plugins/` | 外部插件目录（Python），用于扩展；内置插件（`skill`、`mcp`、`context_govern`、`title_gen`）随代码仓库发布在 `src/ftre/plugin/builtin/`，Gateway 先加载内置插件再扫描此目录 |
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
  │    ├─ inbound → AgentLoop._consume() 并发派发
  │    └─ outbound → ChannelManager 统一分发
  │
  ├─ ChannelManager（常规启动 ws / subagent；CronScheduler 创建时补注册 cron 静默 Channel）
  ├─ AgentLoop（并发模型：_consume() create_task 派发 _dispatch()；per-session asyncio.Lock 串行）
  │    ├─ _dispatch()
  │    │    ├─ 系统级指令（/cancel）→ 锁外直接执行：cancel_nowait() + task.cancel()
  │    │    └─ 普通消息 → 获取 session lock → Pipeline(command → compact → run)
  │    │         ├─ _step_command → CommandManager.try_dispatch（普通指令如 /compact）
  │    │         ├─ _step_compact → 检测 token 水位，标记 need_compact
  │    │         └─ _step_run → await _run_async()（主事件循环直接 await Agent）
  ├─ CronScheduler（按 cron 表达式周期扫描 ~/.ftre/cron/）
  ├─ SessionManager (SQLite)
  └─ PluginManager (hooks + tools)
```

## 校对记录

- **2025-06-26**：整体与三个仓库源码核对，描述准确。
  - Gateway 端口、cron 路径、SessionManager 数据源均与 `ftre/src/ftre/main.py` / `ftre/src/ftre/tools/cron.py` 一致；
  - 内置插件列表（`skill` / `mcp` / `context_govern` / `title_gen`）与 `ftre/src/ftre/plugin/builtin/` 目录一致；
  - `ftre-agent-core` 当前 LLM 适配使用 `openai.AsyncOpenAI`（`llm/completion.py:272`），但 `pyproject.toml` 仅声明 `litellm` 依赖，依赖声明与源码不一致的提醒保留。
