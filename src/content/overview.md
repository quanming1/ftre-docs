# ftre 项目概览

ftre 是一个 AI 编程助手平台，由以下组件构成：

## 核心仓库

| 仓库 | 说明 |
|------|------|
| `ftre` | 后端 Gateway（Python / FastAPI），负责 WebSocket / HTTP API 通信、Session 管理、Agent 循环、默认工具集接入与事件持久化；具体工具调度执行由 `ftre-agent-core` 的 runner/tool_handler 完成。Gateway 默认监听 `127.0.0.1:48650`，可通过 `~/.ftre/config.json` 的 `servers.gateway` 调整 |
| `ftre-agent-core` | Agent 核心库（Python），包含 ReActAgent、Chat Completions 风格的流式 LLM 适配、Runner 与 Tool 系统等 |
| `ftre-desktop` | 桌面客户端（Electron + React + TypeScript），提供完整的 GUI 体验 |

## 本地配置

| 路径 | 说明 |
|------|------|
| `~/.ftre/config.json` | LLM Provider、Model、可选标题生成模型与压缩模型、上下文管理配置、全局默认工作区（`default_workspace`）、Gateway / 前端 dev 端口等配置；`agents.title_generation` / `compact_generation` 会分别解析为 `AgentConfig.title_llm` / `compact_llm`；默认 LLM（provider / model）不在 `config.json` 配置，而是由 `~/.ftre/agents/default/agent.config.json` 持有；Agent 的 `workspace` 字段语义为"家目录"（存放提示词文件的路径），不参与 session 的 cwd 决定；session 运行时 cwd 优先级链为 `session.workspace`（DB）→ `config.default_workspace` → `os.getcwd()`；Gateway 监听 host / port 从 `servers.gateway` 读取，缺省 `127.0.0.1:48650` |
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
- **2025-07-02**：移除 `ftre-agent-core` 依赖声明不一致的旧提示，避免把已变化的仓库状态继续写成确定事实。
