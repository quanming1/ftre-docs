# 快速开始

## 启动后端

```bash
cd E:\ftre-agent-core
py -m pip install -e .

cd E:\ftre
py -m pip install -e .
ftre gateway
```

Gateway 启动后默认监听：
- WebSocket：`ws://127.0.0.1:48650/`
- HTTP API：`http://127.0.0.1:48650/api/`

> `ftre` 与 `ftre-agent-core` 当前 `pyproject.toml` 都声明 `requires-python = ">=3.11"`；本项目约定通常使用 Python 3.12 运行。
>
> 端口可通过 `~/.ftre/config.json` 的 `servers.gateway.port` 调整，缺省 `48650`。前端 dev 服务默认端口为 `48651`（由 `servers.frontend.port` 控制）。
>
> `ftre-agent-core` 源码直接使用 `openai.AsyncOpenAI`，其 `pyproject.toml` 声明 `litellm` 依赖，而 `litellm` 自身依赖 `openai`，因此安装 `litellm` 后 `openai` 包会自动安装。

Gateway 默认从 `~/.ftre/config.json` 的 `servers.gateway` 读取 host / port，缺省 `127.0.0.1:48650`。

## 启动客户端

```bash
cd E:\binn\ftre-desktop
pnpm install
pnpm dev
```

当前桌面前端开发服务由 `packages/renderer/vite.config.ts` 配置，缺省监听 `127.0.0.1:48651`；实际端口由 `scripts/dev.mjs` 解析 `~/.ftre/config.json` 的 `servers.frontend.port` 后通过 `FTRE_FRONTEND_PORT` 环境变量注入。

## 配置文件

`~/.ftre/config.json`：

```json
{
  "providers": {
    "openai": {
      "api_key": "sk-xxx",
      "api_base": "https://api.openai.com/v1",
      "api_protocol": "openai",
      "models": [
        {
          "id": "gpt-4o",
          "name": "GPT-4o",
          "context_window": 128000,
          "max_output": 16384,
          "vision": true
        }
      ]
    }
  }
}
```

> 默认 LLM（provider / model / workspace）不在 `config.json` 的 `agents` 段配置，而是由 `~/.ftre/agents/default/agent.config.json` 持有。`agents` 段可选配置 `title_generation` / `compact_generation` / `context`，详见 [config.json 配置](/docs/config-file)。
>
> `api_protocol` 会被后端读取并传给 `_build_model_name(model_id, protocol)`，但当前 `_build_model_name()` 直接返回 `model_id`，不会据此拼接前缀；`load_config()` 构造出的 `LLMConfig.api_type` 仍使用默认 `"completions"`，实际走 OpenAI Chat Completions 流式适配。

## 校对记录

- **2025-06-26**：与 `ftre/start.py` / `E:\ftre\pyproject.toml` / `E:\ftre-agent-core\pyproject.toml` 核对，描述准确。
  - `py -m pip install -e .` 安装 `E:\ftre-agent-core` 与 `E:\ftre` 两个仓库的步骤与各自 `pyproject.toml` 一致；`ftre` 入口通过 `[project.scripts] ftre = "ftre.main:main"` 注册；
  - `ftre gateway` 与 `ftre/src/ftre/main.py:201-208` 一致；
  - WebSocket 监听 `127.0.0.1:48650/` 与 `config.json` 的 `servers.gateway` 一致（缺省值 `48650`）；
  - HTTP API 监听 `http://127.0.0.1:48650/api/`（`/api` 前缀在 `ws_channel.py:294,299` 注入）；
  - `requires-python = ">=3.11"` 与两个 `pyproject.toml` 一致；当前工作区通常使用 Python 3.12；
  - 前端 dev 服务由 `E:\binn\ftre-desktop\scripts\dev.mjs` 启动，端口由 `resolveFrontendPort()` 从 `~/.ftre/config.json` 的 `servers.frontend.port` 读取并通过 `FTRE_FRONTEND_PORT` 环境变量注入 `packages/renderer/vite.config.ts`；
  - `ftre-agent-core` 源码直接使用 `openai.AsyncOpenAI`（`llm/completion.py:272`），其 `pyproject.toml` 只声明 `litellm` 依赖；但 `litellm` 自身依赖 `openai`（`litellm 1.82.6` 的 `Requires` 列表包含 `openai`），因此安装 `litellm` 后 `openai` 包自动安装，不存在依赖缺失问题。正文已据此说明。
- **2026-08-08**：复验启动链路。当前 `ftre/src/ftre/main.py:209-219` 的 `main()` 入口仅支持 `gateway` 子命令，与文档"用法: ftre gateway"一致；`run_gateway()`（`main.py:102-201`）按 SessionManager → EventBus → ChannelManager → HookManager → ToolRegistry → CommandManager → PluginManager → AgentManager 顺序构建组件，调用 `plugin_manager.load_all(config_data)` 加载插件（`main.py:161`），注册 ws / subagent Channel（`main.py:168-171`），启动 `AgentLoop`（`main.py:174-184`）和 `ChannelManager.start()`（`main.py:188`），最后启动 `CronScheduler`（`main.py:191-194`），与文档"启动后端"章节的链路描述一致。`config.py:154-166` 的 `load_gateway_address()` 与 `ws_channel.py:269-270` 的 `WebSocketChannel(host, port)` 调用贯通，host/port 完全由 `config.json` 的 `servers.gateway` 控制。
