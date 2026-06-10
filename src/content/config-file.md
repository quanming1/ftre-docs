# config.json 配置

配置文件位于 `~/.ftre/config.json`，Gateway 启动时自动读取。

## 文件位置

| 系统 | 路径 |
|------|------|
| Windows | `C:\Users\<用户名>\.ftre\config.json` |
| macOS / Linux | `~/.ftre/config.json` |

## 完整示例

```json
{
  "agents": {
    "defaults": {
      "provider": "openai",
      "model": "gpt-4o",
      "workspace": "E:\\projects",
      "title_generation": {
        "provider": "openai",
        "model": "gpt-4o-mini"
      }
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
        },
        {
          "id": "gpt-4o-mini",
          "name": "GPT-4o Mini",
          "context_window": 128000,
          "max_output": 16384,
          "vision": true
        }
      ]
    },
    "DeepSeek 官方": {
      "api_key": "sk-xxx",
      "api_base": "https://api.deepseek.com/v1",
      "api_protocol": "openai",
      "models": [
        {
          "id": "deepseek-v4-pro",
          "name": "DeepSeek V4 Pro",
          "context_window": 1000000,
          "max_output": 8192,
          "vision": false
        }
      ]
    },
    "明略网关": {
      "api_key": "xxx",
      "api_base": "https://ai.mininglamp.com/api/gateway/v1",
      "api_protocol": "openai",
      "models": [
        {
          "id": "gpt-5.5",
          "name": "GPT-5.5",
          "context_window": 128000,
          "max_output": 16384,
          "vision": false
        }
      ]
    }
  },
  "plugins": [
    {
      "name": "skill",
      "config": {
        "skills_dir": "C:\\Users\\用户名\\.ftre\\skills"
      }
    }
  ],
  "servers": {
    "gateway": {
      "host": "127.0.0.1",
      "port": 19470
    },
    "frontend": {
      "port": 19471
    },
    "docs": {
      "port": 19472
    }
  }
}
```

## 结构说明

```
{
  agents        → Agent 默认配置
  providers     → LLM Provider 列表
  plugins       → 插件配置
  servers       → Gateway / 前端 / 文档开发服务端口配置
}
```

## agents.defaults

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `provider` | string | 是 | 默认 Provider 名，对应 `providers` 的 key |
| `model` | string | 是 | 默认模型 ID，对应 provider 下 `models[].id` |
| `workspace` | string | 否 | 默认工作区，新 session 自动使用。空则走进程 cwd |
| `title_generation` | object | 否 | 标题生成专用 LLM。不配则沿用主 LLM |

### title_generation（可选）

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider` | string | Provider 名 |
| `model` | string | 模型 ID |

> 标题生成是高频小请求，建议指向便宜/快的模型（如 `gpt-4o-mini`），避免占用主对话的高级模型配额。

## providers

`providers` 是一个 map，key 是 Provider 名称（任意字符串，前端展示用），value 是 Provider 配置。

### Provider 配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `api_key` | string | 是 | API 密钥 |
| `api_base` | string | 否 | 自定义端点 |
| `api_protocol` | string | 否 | 决定 LiteLLM 模型名前缀，默认 `"openai"`。当前内置映射支持：`"openai"` / `"anthropic"` / `"gemini"` / `"azure"` / `"bedrock"` / `"minimax"`；其它值会回退为 `openai` 前缀 |
| `models` | array | 是 | 可用模型列表 |

> `api_protocol` 决定 LiteLLM 模型名的 provider 前缀（如 `openai/gpt-4o`）。如果模型 id 本身已含已知 LiteLLM 前缀（如 `openai/`、`deepseek/`、`groq/` 等），则不会重复拼接。
> 当前配置文件没有生效的 `api_type` 字段；虽然 `LLMHandler` 内部支持 `"completions"` / `"responses"` 适配器，但 `load_config()` 构造出的 `LLMConfig.api_type` 仍使用默认值 `"completions"`。

### Model 条目

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `id` | string | 是 | 模型 ID，用于 `agents.defaults.model` 匹配。通常填写 Provider 原生 ID；也允许填写已带已知 LiteLLM provider 前缀的 ID（如 `openai/gpt-4o`、`deepseek/deepseek-chat`），此时内部不会重复拼接前缀 |
| `name` | string | 否 | 展示名称 |
| `context_window` | int | 否 | 上下文窗口大小（token 数） |
| `max_output` | int | 否 | 最大输出 token 数 |
| `vision` | bool | 否 | 是否支持图片输入 |

#### 模型 ID 命名规则

`id` 填写 Provider 原始模型名即可。ftre 内部会通过 `_build_model_name()` 自动拼接 LiteLLM 前缀：

| 协议 | 拼接规则 | 示例 |
|------|---------|------|
| `openai` | `openai/<id>` | `openai/gpt-4o` |
| `anthropic` | `anthropic/<id>` | `anthropic/claude-sonnet-4` |
| `gemini` | `gemini/<id>` | `gemini/gemini-2.5-pro` |
| `azure` | `azure/<id>` | `azure/my-deployment` |
| `bedrock` | `bedrock/<id>` | `bedrock/anthropic.claude-3-sonnet` |
| `minimax` | `minimax/<id>` | `minimax/abab6.5s-chat` |

> 如果 `id` 本身已含已知 LiteLLM 前缀（如 `openai/gpt-4o`、`deepseek/deepseek-chat`），则**不再重复拼接**。这适用于网关模型名本身已带前缀的场景。当前白名单包括 `openai/`, `anthropic/`, `azure/`, `gemini/`, `bedrock/`, `minimax/`, `groq/`, `vertex_ai/`, `ollama/`, `huggingface/`, `cohere/`, `mistral/`, `deepseek/`, `together_ai/`, `replicate/`。

## servers

`servers` 是可选配置。未配置时后端默认使用 Gateway `127.0.0.1:19470`，并提供前端开发服务 `19471`、文档开发服务 `19472` 两个约定值。

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `gateway.host` | string | 否 | Gateway 监听地址，默认 `"127.0.0.1"` |
| `gateway.port` | int | 否 | Gateway WebSocket / HTTP API 端口，默认 `19470` |
| `frontend.port` | int | 否 | 前端开发服务端口约定值，默认 `19471` |
| `docs.port` | int | 否 | 文档开发服务端口约定值，默认 `19472` |

> 当前后端代码只在启动 Gateway 时读取 `servers.gateway` 并传给 `WebSocketChannel`。桌面前端仓库当前 Vite 开发服务端口写在 `packages/renderer/vite.config.ts`，实际为 `50000`，不会读取这里的 `servers.frontend`；文档仓库当前 Vite 配置也不会读取 `servers.docs`。

## plugins

> 注意：`plugins[]` 不是插件启用列表。Gateway 会扫描并加载 `~/.ftre/plugins/` 下所有 `.py` 插件；`plugins[]` 仅用于给同名插件传入 `config`。未出现在 `plugins[]` 中的插件仍会加载，只是收到空配置。

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `name` | string | 是 | 插件名称，必须与 `Plugin.name` 匹配 |
| `config` | object | 否 | 插件专属配置，由插件通过 `self.api.config` 读取 |

## 加载过程

1. Gateway 启动 → `load_config_file()` 读取 `~/.ftre/config.json` 原始 JSON
2. `PluginManager.load_all(config_data)` 扫描 `~/.ftre/plugins/` 加载插件，每个插件匹配 `plugins[]` 中同名条目的 `config` 传入
3. AgentLoop 处理消息时调用 `load_config()` → 内部 `_build_llm_config()` 构造 LLM 配置
