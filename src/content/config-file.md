# 配置

ftre 的配置分两层：

- **全局配置** `~/.ftre/config.json` — Provider、插件、服务器端口等全局设置
- **Agent 配置** `~/.ftre/agents/<agent_id>/agent.config.json` — 每个 Agent 的独立配置（LLM、工具、提示词）

---

# 全局配置（config.json）

配置文件位于 `~/.ftre/config.json`，Gateway 启动时自动读取。

## 文件位置

| 系统 | 路径 |
|------|------|
| Windows | `C:\Users\<用户名>\.ftre\config.json` |
| macOS / Linux | `~/.ftre/config.json` |

## 完整示例

```json
{
  "default_workspace": "E:\\binn",
  "agents": {
    "title_generation": {
      "provider": "openai",
      "model": "gpt-4o-mini"
    },
    "compact_generation": {
      "provider": "openai",
      "model": "gpt-4o-mini"
    },
    "context": {
      "precompactThreshold": 0.5,
      "compactThreshold": 0.6,
      "consolidationRatio": 0.5,
      "safetyBuffer": 1024,
      "idleCompaction": true,
      "silent": true
    }
  },
  "providers": {
    "openai": {
      "api_key": "sk-xxx",
      "api_base": "https://api.openai.com/v1",
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
  },
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "@playwright/mcp@latest"],
      "disabled": false,
      "timeout": 60000
    }
  },
  "plugins": [
    {
      "name": "octo_channel",
      "enabled": true,
      "config": { }
    }
  ],
  "disabled_skills": ["mcp-guide"],
  "servers": {
    "gateway": { "host": "127.0.0.1", "port": 48650 },
    "frontend": { "port": 48651 },
    "docs": { "port": 48652 }
  }
}
```

## 字段总览

| 字段 | 说明 |
|------|------|
| `default_workspace` | 全局默认工作区（创建新 session 时的预填值） |
| `agents` | 标题生成 / 压缩生成 / 上下文管理参数 |
| `providers` | LLM Provider 列表 |
| `mcp` | MCP 服务器配置（全局，可被 agent.config.json 覆盖） |
| `plugins` | 插件配置 |
| `disabled_skills` | 全局禁用的 Skill 列表（可被 agent.config.json 整体替换） |
| `servers` | Gateway / 前端 / 文档站端口 |

## default_workspace

全局默认工作区路径。`POST /api/sessions` 创建 session 时不会自动写入该值（创建时 workspace 默认为空串），仅在 session 实际执行时（`AgentLoop._run_async()`）通过 `session.workspace or config.workspace or os.getcwd()` 兜底使用；不配置时直接回退到进程 cwd。

> 此字段与 `agent.config.json` 的 `workspace` 是不同概念。`agent.config.json` 的 `workspace` 是 Agent 的家目录（存放 SOUL/AGENTS/USER.md 的路径），不参与 session 的 cwd 决定。session 运行时 cwd 优先级链：`session.workspace`（DB）→ `config.default_workspace` → `os.getcwd()`。

## agents

标题生成模型、压缩模型与上下文管理参数。默认 LLM（provider / model）不在 `config.json` 中配置，由 `~/.ftre/agents/default/agent.config.json` 持有。

| 字段 | 类型 | 说明 |
|------|------|------|
| `title_generation` | `{provider, model}` | 标题生成专用 LLM。不配则沿用主 LLM。高频小请求，建议指向便宜/快的模型 |
| `compact_generation` | `{provider, model}` | 上下文压缩专用 LLM。不配则沿用主 LLM。后台高频长上下文调用，建议指向便宜/大窗口模型 |
| `context` | object | 上下文压缩参数，详见下表 |

### agents.context

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `precompactThreshold` | number | `0.5` | 触发水位：`estimated_tokens / context_window ≥ 此值` 时后台 / 用户输入路径触发压缩。`should_compact()` 的默认阈值虽为 `compact_threshold`，但所有调用方（`_step_compact`、`CompactManager.maybe_schedule_idle_compact`）都显式传入 `precompact_threshold` |
| `compactThreshold` | number | `0.6` | 历史"启用压缩水位"字段；当前实际触发路径统一用 `precompact_threshold`，该字段仅作为压缩事件 `enable_ratio` 元数据写入 DB，不参与触发判断 |
| `threshold` | 别名 | 同 `compactThreshold` | 旧字段名，等价于 `compactThreshold` |
| `consolidationRatio` | number | `0.5` | 压缩目标占可用输入预算比例；当前 `_run_compact_llm()` 直接 LLM 直调摘要不以此做硬截断，仅作为预留字段 |
| `safetyBuffer` | number | `1024` | 给估算误差和输出预留的安全余量；同上预留字段，未参与实际计算 |
| `idleCompaction` | bool | `true` | 是否在 `done` 后后台异步压缩 |
| `silent` | bool | `true` | 压缩事件是否标记 silent（前端不渲染气泡） |

## providers

`providers` 是一个 map，key 是 Provider 名称，value 是 Provider 配置。

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `api_key` | string | 是 | API 密钥 |
| `api_base` | string | 是 | 自定义端点（传给 OpenAI SDK 的 `base_url`） |
| `models` | array | 是 | 可用模型列表，供前端展示和后端匹配元数据 |

### models[] 条目

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `id` | string | 是 | 模型 ID，用于与 `agent.config.json` 的 `llm.model` 匹配 |
| `name` | string | 否 | 展示名称 |
| `context_window` | int | 是 | 上下文窗口大小（token 数） |
| `max_output` | int | 是 | 最大输出 token 数 |
| `vision` | bool | 否 | 是否支持图片输入 |

> ftre 使用 OpenAI 兼容协议，`llm.model` 填写 Provider 端点识别的原始模型名。`models[].id` 主要用于前端展示和后端读取上下文窗口等元数据。

## mcp

MCP 服务器配置。key 是服务器名称，可被 `agent.config.json` 的 `mcp` 段覆盖。

```json
"mcp": {
  "playwright": {
    "type": "local",
    "command": ["npx", "@playwright/mcp@latest"],
    "disabled": false,
    "timeout": 60000
  }
}
```

## plugins

> `plugins[]` 不是插件启用列表。Gateway 会扫描 `~/.ftre/plugins/` 下所有插件；`plugins[]` 仅用于给同名插件传入 `config`。

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `name` | string | 是 | 插件名称，必须与 `Plugin.name` 匹配 |
| `config` | object | 否 | 插件专属配置，由插件通过 `self.api.config` 读取 |

## disabled_skills

全局禁用的 Skill 名称列表。`agent.config.json` 可配置自己的 `disabled_skills` 整体替换此值。

```json
"disabled_skills": ["mcp-guide", "playwright-mcp"]
```

## servers

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `gateway.host` | string | `"127.0.0.1"` | Gateway 监听地址 |
| `gateway.port` | int | `48650` | Gateway WebSocket / HTTP API 端口 |
| `frontend.port` | int | `48651` | 前端开发服务端口 |
| `docs.port` | int | `48652` | 文档开发服务端口 |

## 加载过程

1. Gateway 启动 → `load_config_file()` 读取 `~/.ftre/config.json` 原始 JSON
2. `PluginManager.load_all(config_data)` 扫描 `~/.ftre/plugins/` 加载插件，每个插件匹配 `plugins[]` 中同名条目的 `config` 传入
3. AgentLoop 处理消息时调用 `load_config()` → 内部 `_build_llm_config()` 构造 LLM 配置

> `load_config()` 使用 mtime 缓存，修改 `config.json` 后无需重启即可生效。但插件配置只在启动时注入一次，修改 `plugins[]` 需重启。

---

# Agent 配置（agent.config.json）

每个 Agent 是 `~/.ftre/agents/<agent_id>/` 下的一个目录，通过 `agent.config.json` 定义独立配置。`default` Agent 的配置作为全局兜底（LLM / workspace），其他 Agent 缺省时回退到 default。

## 目录结构

```
~/.ftre/agents/
├── default/
│   ├── agent.config.json     ← 主 LLM 配置（provider/model）+ 家目录
│   ├── SOUL.md               ← 人格定义（角色、语气、行为边界）
│   ├── AGENTS.md             ← 行为规范（工作方式、约束）
│   ├── USER.md               ← 用户偏好提示词
│   └── skills/               ← 私有 Skill（可选，自动与全局合并）
├── coder/
│   ├── agent.config.json
│   ├── SOUL.md / AGENTS.md / USER.md
│   └── skills/
├── octo/
│   └── ...
└── exodia/
    └── ...
```

## agent.config.json 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `name` | string | 否 | Agent 显示名称；缺省取目录名（`agent_id`） |
| `llm` | object | 否 | Agent 专属 LLM 配置；缺省回退到 default agent 的 LLM |
| `llm.provider` | string | 否 | Provider 名（对应 `config.json` 的 `providers` key） |
| `llm.model` | string | 否 | 模型 ID（对应 Provider 的 `models[].id`） |
| `workspace` | string | 否 | Agent 的**家目录**（存放 SOUL/AGENTS/USER.md 的路径）。此字段不是对话的 cwd |
| `tools` | object | 否 | 工具白/黑名单：`{"allow": [...], "deny": [...]}`。`allow` 缺省表示全部允许 |
| `mcp` | object | 否 | Agent 专属 MCP 配置，深度合并到全局 `mcp` 段（同名 key 覆盖） |
| `plugins` | array | 否 | Agent 专属插件配置，按 `name` 合并到全局 `plugins`（同名条目覆盖） |
| `disabled_skills` | array | 否 | 禁用的 Skill 名称列表；缺省时沿用全局值；配置后整体替换全局值 |

### 示例

```json
{
  "name": "Octo Bot",
  "llm": {
    "provider": "明略网关",
    "model": "ali/deepseek-v4-flash"
  },
  "tools": {
    "deny": ["cron", "set_workspace", "task"]
  }
}
```

## 提示词文件

三个 Markdown 文件在 Agent 加载时自动读取，以 XML 标签注入到 system_prompt：

| 文件 | 标签 | 说明 |
|------|------|------|
| `SOUL.md` | `<SOUL>` | 人格定义：角色、语气、行为边界 |
| `AGENTS.md` | `<AGENTS_RULE>` | 行为规范：工作方式、约束（由 `context_govern` 插件注入，agent 目录与工作区目录两份叠加） |
| `USER.md` | `<USER_PROFILE>` | 用户偏好与个人要求 |

> `AGENTS.md` 由 `context_govern` 插件注入（`before_messages_build` hook）：同时注入两份（如果都存在，叠加注入）——`agent_dir/AGENTS.md`（Agent 行为规则）和 `workspace/AGENTS.md`（项目约定）。`SOUL.md` 和 `USER.md` 则直接由 `AgentManager` 在合成 system prompt 时注入。

## 私有 Skill

Agent 目录下可创建 `skills/` 子目录，存放该 Agent 专属的 Skill 文件。格式与全局 `~/.ftre/skills/` 一致（`<name>.md` / `<name>/SKILL.md` / `<name>/skill.md`）。

- **合并规则**：全局 Skill 和当前 Agent 私有 Skill 合并展示；同名 Skill 私有版本覆盖全局
- **加载顺序**：`loadSkill` 工具先搜私有目录，再搜全局目录

## 校对记录

- **2026-08-08**：复验 config 加载逻辑。当前 `ftre/src/ftre/config.py` 的 `load_config()` 实现：默认 LLM（provider / model）从 `~/.ftre/agents/default/agent.config.json` 读取（`_read_default_agent_llm`，`config.py:36-59`），`title_generation` / `compact_generation` 解析为 `AgentConfig.title_llm` / `compact_llm`（`config.py:262-283`），与本文档"默认 LLM 不在 `config.json` 配置，由 `agent.config.json` 持有"一致；`agents.context` 的字段解析（`config.py:288-306`）支持 camelCase（如 `precompactThreshold`）和 snake_case（如 `precompact_threshold`），并提供 `threshold` 别名（兼容旧 `compact_threshold`），与"兼容策略"章节描述一致；`load_gateway_address()` 从 `servers.gateway` 读 host/port，缺省 `127.0.0.1:48650`（`config.py:154-166`），与"servers 字段"表一致；`disabled_skills` 由 `skill_plugin.py:68-84` 读取，`agent_id` 维度由 `agent.config.json` 整体替换（`skill_plugin.py:91-104`），与本文档"整体替换全局值"一致。
- **2026-08-08**：`mtime` 缓存：当前 `load_config()` 用 `_last_config` + `_last_sig`（`config.py:138-139`）做缓存，签名跟踪 `config.json` + `default agent config` 的 mtime（`config.py:222-237`），与本文档"修改 `config.json` 后无需重启即可生效"一致；插件配置仅在启动时注入一次（`main.py:161` 调用 `plugin_manager.load_all(config_data)`），与"插件配置只在启动时注入一次，修改 `plugins[]` 需重启"一致。
