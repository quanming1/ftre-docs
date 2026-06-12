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
- WebSocket：`ws://127.0.0.1:19470/`
- HTTP API：`http://127.0.0.1:19470/api/`

> `ftre` 当前 `pyproject.toml` 声明 `requires-python = ">=3.11"`；本工作区通常使用 Python 3.12 运行。
>
> 注意：`ftre-agent-core` 当前 LLM 适配源码直接导入 `openai.AsyncOpenAI`，但 `pyproject.toml` 仍只声明了 `litellm` 依赖；如果全新环境按上述命令安装后缺少 `openai` 包，需要先补装或修正依赖声明。

当前 Gateway 监听地址使用 `WebSocketChannel` 的硬编码默认值（`host="0.0.0.0"`、`port=19470`），后端未从 `config.json` 的 `servers` 配置读取。

## 启动客户端

```bash
cd E:\binn\ftre-desktop
pnpm install
pnpm dev
```

当前桌面前端开发服务由 `packages/renderer/vite.config.ts` 配置，监听 `127.0.0.1:50000`；根目录 `pnpm dev` 脚本会等待 `http://127.0.0.1:50000` 可用后启动 Electron，Electron 窗口实际加载 `http://localhost:50000`。

## 配置文件

`~/.ftre/config.json`：

```json
{
  "agents": {
    "defaults": {
      "provider": "openai",
      "model": "gpt-4o",
      "workspace": "E:\\binn"
    }
  },
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

> `api_protocol` 会被后端读取并传给 `_build_model_name(model_id, protocol)`，但当前 `_build_model_name()` 直接返回 `model_id`，不会据此拼接前缀；`load_config()` 构造出的 `LLMConfig.api_type` 仍使用默认 `"completions"`，实际走 OpenAI Chat Completions 流式适配。
