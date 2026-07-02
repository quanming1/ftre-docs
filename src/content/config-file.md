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
    "DeepSeek官方": {
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
      "port": 48650
    },
    "frontend": {
      "port": 48651
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
| `model` | string | 是 | 默认模型 ID。仅当 `provider` 存在且 `model` 非空时，运行时才会把该 ID 作为实际 LLM `model` 传入；若 `providers[provider].models[]` 中存在同名条目，则额外读取其 `name` / `context_window` / `max_output` / `vision` 等元数据。Provider 存在但找不到模型条目时会得到空的 model 条目元数据（`name` 为空、`context_window` / `max_output` 为 `None`、`vision=false`），但 `LLMConfig.model` 仍会使用该 `model`；Provider 不存在或 model 为空时会得到空 LLM 配置 |
| `workspace` | string | 否 | 默认工作区。该值会写入 `AgentConfig.workspace`；但当前 `AgentLoop._run_async()` 在执行时仍按 `session.workspace` → 进程 cwd 的顺序选择工作区（`session.get("workspace", "") or os.getcwd()`），不会直接读取 `AgentConfig.workspace`。`set_workspace` / 纯 `cd` 持久切换最终都会把当前 session 的 `workspace` 写回数据库 |
| `title_generation` | object | 否 | 标题生成专用 LLM。不配则沿用主 LLM；只有 provider 存在且 model 非空时才会尝试构造 `AgentConfig.title_llm`。若 Provider 存在但对应 `models[]` 中没有同名条目，则 `_build_llm_config()` 产出的 `built.model` 仍非空，因此当前实现仍会启用该标题模型，只是展示和能力元数据为空/默认值；Provider 不存在或 provider/model 为空时不启用标题模型，回退主 LLM |
| `compact_generation` | object | 否 | 上下文压缩专用 LLM。不配则沿用主 LLM；只有 provider 存在且 model 非空时才会尝试构造 `AgentConfig.compact_llm`。若 Provider 存在但对应 `models[]` 中没有同名条目，则 `_build_llm_config()` 产出的 `built.model` 仍非空，因此当前实现仍会启用该压缩模型，只是展示和能力元数据为空/默认值。`CompactHandler._run_compact_llm()` 执行摘要时会优先使用 `config.compact_llm`，未配置则回退到 `config.llm`。设计动机：压缩是后台高频长上下文调用，可用便宜/大窗口模型降低成本 |
| `system_prompt` | string | 否 | 自定义系统提示词。不配则自动从 `src/ftre/system_prompt.md` 加载内置提示词。配置后完全覆盖内置提示词，不会合并 |
| `user_prompt` | string | 否 | 用户自定义提示词。客户端设置，存于 `config.json`。与内置 system_prompt 分离，由 `context_govern` 插件在每轮构建消息时以 `<USER_CUSTOM_PROMPT>` 标签注入 system_prompt 末尾。详见 [内置插件 — context_govern](/docs/plugin-builtins#2-context_govern--上下文治理) |

### title_generation（可选）

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider` | string | Provider 名 |
| `model` | string | 标题生成模型 ID；仅当 `provider` 存在且 model 非空时，会直接作为实际 LLM `model` 传入。若该 Provider 的 `models[].id` 中存在同名条目，则读取其展示和能力元数据；找不到模型条目时当前实现仍会启用该标题模型，只是这些元数据为空/默认值；Provider 不存在或 provider/model 为空时不启用标题模型 |

> 标题生成是高频小请求，建议指向便宜/快的模型（如 `gpt-4o-mini`），避免占用主对话的高级模型配额。

### compact_generation（可选）

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider` | string | Provider 名 |
| `model` | string | 压缩摘要模型 ID；仅当 `provider` 存在且 model 非空时，会直接作为实际 LLM `model` 传入。若该 Provider 的 `models[].id` 中存在同名条目，则读取其展示和能力元数据；找不到模型条目时当前实现仍会启用该压缩模型，只是这些元数据为空/默认值；Provider 不存在或 provider/model 为空时不启用压缩模型，回退主 LLM |

> 上下文压缩是后台高频长上下文调用，建议指向便宜/大窗口模型以降低成本，避免占用主对话的高级模型配额。配置示例：`{"compact_generation": {"provider": "openai", "model": "gpt-4o-mini"}}`。

## providers

`providers` 是一个 map，key 是 Provider 名称，value 是 Provider 配置。后端按普通 JSON key 读取；桌面端 ModelSettings UI 新建/保存 Provider 时当前只允许中文、英文、数字、下划线（不允许空格），因此通过 UI 管理的 Provider 名应遵守该限制。

### Provider 配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `api_key` | string | 后端否 / 桌面端 UI 是 | API 密钥；后端缺省为空字符串，是否可用取决于目标 OpenAI 兼容端点；桌面端 ModelSettings UI 保存时当前要求填写 |
| `api_base` | string | 后端否 / 桌面端 UI 是 | 自定义端点（传给 OpenAI SDK 的 `base_url`）；桌面端 ModelSettings UI 保存时当前要求填写 |
| `api_protocol` | string | 后端否 / 桌面端 UI 是 | 配置记录字段，标识 LLM 协议类型。默认 `"openai"`；当前只作为 `_build_model_name(model_id, protocol)` 的入参，但 `_build_model_name()` 直接返回配置中的模型名，不会根据 `api_protocol` 拼接前缀；该字段不会设置 `LLMConfig.api_type`。桌面端 UI 当前会展示多个协议选项并要求选择，但运行时仍不因此切换协议 |
| `models` | array | 后端否 / 桌面端 UI 是 | 可用模型列表，供前端展示，并供后端按 `id` 匹配默认模型/标题模型以读取 `name` / `context_window` / `max_output` / `vision` 等元数据。当前后端不要求被选中的模型必须存在于此列表；只要 Provider 存在且模型 ID 非空，找不到条目时仍会使用配置中的模型 ID，只是对应元数据为空/默认值。桌面端 ModelSettings UI 保存时当前要求至少配置一个模型 |

> `api_protocol` 当前仅作为配置记录字段（默认 `"openai"`）。它会被读出并传给 `_build_model_name(model_id, protocol)`，但 `_build_model_name()` 直接返回 `model_id`，不做前缀拼接，因此实际上不影响模型名。当前通过 `config.json` 无法切换 `LLMConfig.api_type`；`load_config()` 构造出的 `LLMConfig.api_type` 始终使用 dataclass 默认值 `"completions"`，运行时使用 OpenAI Chat Completions 流式接口。

### Model 条目

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `id` | string | 是 | 模型条目 ID，用于与 `agents.defaults.model` / `title_generation.model` 匹配以补充展示和能力元数据。`_build_model_name()` 直接返回配置里的模型名，不做前缀拼接 |
| `name` | string | 否 | 展示名称 |
| `context_window` | int | 后端否 / 桌面端 UI 是 | 上下文窗口大小（token 数）；后端缺省时为 `None`，桌面端 ModelSettings UI 保存时当前要求填写正数 |
| `max_output` | int | 后端否 / 桌面端 UI 是 | 最大输出 token 数；后端缺省时为 `None`，桌面端 ModelSettings UI 保存时当前要求填写正数 |
| `vision` | bool | 否 | 是否支持图片输入 |

#### 模型 ID 命名规则

`agents.defaults.model` / `title_generation.model` 填写 Provider 端点所识别的原始模型名。当前 `ftre` 使用 OpenAI SDK 通过 `api_base` 指向兼容端点，`_build_model_name()` 函数直接返回该模型名（不做任何前缀拼接）。`providers[].models[].id` 主要用于前端展示，以及供后端匹配并补充 `name` / `context_window` / `max_output` / `vision` 等元数据；只要 Provider 存在且模型 ID 非空，即使没有匹配条目，`_build_llm_config()` 仍会使用配置中的模型 ID 构造 `LLMConfig.model`，只是这些元数据为空/默认值。Provider 不存在或模型 ID 为空时会返回空 LLM 配置。注意桌面端 ModelSettings UI 当前只能从 `models[]` 中选择默认模型/标题模型，因此通过 UI 操作时通常仍需先把模型写入列表：

- 使用 OpenAI 兼容端点时，可直接填 `gpt-4o`、`deepseek-v4-pro` 等；建议在 `models[].id` 中放置同名条目，以便前端展示并让后端读取上下文窗口、视觉能力等元数据

## agents.defaults.context

上下文压缩配置。缺省即可启用单阈值自动管理（统一使用 `precompact_threshold` 0.5 作为触发水位；`compact_threshold` 0.6 当前仅作为事件元数据记录，不参与触发决策）：

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `precompactThreshold` / `precompact_threshold` | number | `0.5` | **唯一触发水位**：idle/usage 后台路径直接写入 `context_compact(enabled=true)`；用户输入路径标记 `need_compact` 后在 `_run_async()` 中同样写入 `enabled=true` |
| `compactThreshold` / `compact_threshold` | number | `0.6` | 当前仅作为压缩事件的 `enable_ratio` 元数据记录，不参与触发决策（所有调用方显式传入 `precompact_threshold`） |
| `threshold` | number | - | 旧字段兼容别名，等价于 `compactThreshold` |
| `consolidationRatio` / `consolidation_ratio` | number | `0.5` | 压缩目标占可用输入预算比例 |
| `safetyBuffer` / `safety_buffer` | number | `1024` | 给估算误差和输出预留的安全余量 |
| `idleCompaction` / `idle_compaction` | bool | `true` | 是否在 `done` / `usage_update` 后后台触发压缩检查；命中时直接执行 `compact(enabled=true, silent=config.context.silent)` |
| `silent` | bool | `true` | 自动压缩事件是否对前端静默 |

> 当前 `api_protocol` 字段虽然存在于 Provider 配置中（默认 `"openai"`），但 `_build_model_name()` 未使用它来拼接前缀。这意味着 `api_protocol` 仅作为配置记录，不影响实际模型名构造，也不会改变 `LLMConfig.api_type`。

## servers

`servers` 是可选配置。未配置时 Gateway 默认监听 `127.0.0.1:48650`（`load_gateway_address()` 的缺省值）；前端 dev 服务默认使用 `48651`；docs 文档站默认使用 `48652`。后端启动时会从 `config.json` 的 `servers.gateway` 读取 host / port，并传入 `WebSocketChannel`；桌面端 `scripts/dev.mjs` 会从 `servers.frontend.port` 读取前端 dev 端口，再通过环境变量注入 `vite.config.ts`；文档站 `E:\ftre-docs\scripts\dev.mjs` 会从 `servers.docs.port` 读取文档站端口，并通过 `vite --port` 注入 `vite.config.ts`（该配置文件的 `server.port` 由命令行 `--port` 覆盖）。`E:\ftre\start.py` 同样会读取 `servers.docs.port` 作为文档站启动端口。

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `gateway.host` | string | 否 | Gateway 监听地址，默认 `"127.0.0.1"` |
| `gateway.port` | int | 否 | Gateway WebSocket / HTTP API 端口，默认 `48650` |
| `frontend.port` | int | 否 | 前端开发服务端口约定值。实际由 `scripts/dev.mjs` 解析 `servers.frontend.port` 后通过 `FTRE_FRONTEND_PORT` 注入 `vite.config.ts`，缺失时回退 `48651` |
| `docs.port` | int | 否 | 文档开发服务端口约定值。实际由 `E:\ftre-docs\scripts\dev.mjs` 解析 `servers.docs.port` 后通过 `vite --port` 启动，缺失时回退 `48652`；`E:\ftre\start.py` 同样会读取此端口用于一键启动文档站 |

> 当前 Gateway host / port 从 `config.json` 的 `servers.gateway` 读取（`load_gateway_address()`），缺省 `127.0.0.1:48650`。`frontend.port` 由桌面端启动脚本读取并注入 `vite.config.ts`，缺省 `48651`；`docs.port` 由 `E:\ftre-docs\scripts\dev.mjs` 读取并通过 `vite --port` 注入，缺省 `48652`，同时 `E:\ftre\start.py` 也会读取此端口用于一键启动。

## plugins

> 注意：`plugins[]` 不是插件启用列表。Gateway 会扫描并加载 `~/.ftre/plugins/` 下所有非 `_` 开头的 `.py` 插件；`plugins[]` 仅用于给同名插件传入 `config`。未出现在 `plugins[]` 中的插件仍会加载，只是收到空配置。

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `name` | string | 是 | 插件名称，必须与 `Plugin.name` 匹配 |
| `config` | object | 否 | 插件专属配置，由插件通过 `self.api.config` 读取 |

## 加载过程

1. Gateway 启动 → `load_config_file()` 读取 `~/.ftre/config.json` 原始 JSON
2. `PluginManager.load_all(config_data)` 扫描 `~/.ftre/plugins/` 加载插件，每个插件匹配 `plugins[]` 中同名条目的 `config` 传入
3. AgentLoop 处理消息时调用 `load_config()` → 内部 `_build_llm_config()` 构造 LLM 配置

> **注意**：步骤 3 中 `load_config()` 每次处理 **`user_message` 类型**消息时都会被调用——Pipeline 的 `_step_compact`（自动压缩水位检测）和 `_run_async`（Agent 执行）都会调用 `_load_current_config()`；系统级指令（如 `/cancel`）在 `_dispatch` 锁外直接执行，不触发配置重读取；命中普通斜杠指令（如 `/compact`）时 `_step_command` 返回 `False` 短路，`_step_compact` 与 `_step_run` 不执行，但 `/compact` 的 handler（`_cmd_compact`）内部会调用 `_load_current_config()`。`load_config()` 内部使用 mtime 缓存：每次调用都会检查 `config.json` 的修改时间，仅在文件变更时才重新解析内容，未变更时直接返回缓存。因此修改 providers/agents 配置后无需重启 Gateway 即可生效。但步骤 2 的插件配置只在启动时注入一次，修改 `plugins[]` 需重启才能生效。

## 校对记录

- **2025-06-26**：与 `ftre/src/ftre/config.py` / `main.py` / `agent/loop.py` 核对，描述准确。
  - `load_config_file()` / `load_config()` / `load_gateway_address()` 与 `ftre/src/ftre/config.py` 一致；
  - `api_protocol` 默认 `"openai"`（`config.py:166`），`_build_model_name()` 直接返回 `model_id`（`config.py:140-141`），不影响 `LLMConfig.api_type`；
  - `LLMConfig.api_type` 始终为 dataclass 默认 `"completions"`（`config.py:47`），实际走 OpenAI Chat Completions 流式适配；
  - `title_generation` / `compact_generation` / `user_prompt` / `context` 段读取与 `config.py:208-263` 的 `_f("camelCase", "snake_case", default)` 双键兼容逻辑一致；
  - `agents.defaults.workspace` 在 `load_config()` 中读取并写入 `AgentConfig.workspace`；运行时 `AgentLoop._run_async` 通过 `session.get("workspace", "") or os.getcwd()` 选择工作区（`agent/loop.py:447`），session workspace 优先级最高；
  - `agents.defaults.context` 所有字段（`precompactThreshold` / `compactThreshold` / `consolidationRatio` / `safetyBuffer` / `idleCompaction` / `silent`）与 `ContextConfig` dataclass 一致；
  - `servers.gateway` 默认 `127.0.0.1:48650`，`servers.frontend` 默认 `48651`（由 `ftre/start.py` 与 `ftre-desktop/scripts/resolve-port.mjs` 读取）；
  - 文档站端口 `48652` 由 `E:\ftre-docs\scripts\dev.mjs` 读取并通过 `npx vite --port ${port}` 启动（`scripts/dev.mjs`）；
  - `plugins[]` 仅用于同名插件配置注入；`PluginManager.load_all()` 内部先加载内置插件再扫描 `~/.ftre/plugins/`（`plugin/plugin.py:174-211`）；
   - `_load_current_config()` 调用时机：`_step_compact`（`agent/loop.py:342`）、`_run_async`（`agent/loop.py:425`）、`_cmd_compact`（`agent/loop.py:179`）、`_schedule_idle_compact`（`agent/loop.py:640`）；另在 `__init__` 的 `_initial_context_cfg`（`agent/loop.py:136`）也被调用——与本文描述一致。
- **2025-07-11**：补全 `agents.defaults` 表格中缺失的 `system_prompt` 和 `user_prompt` 字段。源码依据：`config.py:236-243`（`load_config()` 中读取 `system_prompt` / `user_prompt`），`context_govern.py:50-63`（`user_prompt` 注入逻辑）。
