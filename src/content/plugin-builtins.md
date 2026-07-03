# 内置插件

ftre 随代码仓库发布 4 个内置插件，位于 `src/ftre/plugin/builtin/`。Gateway 启动时 `PluginManager.load_all()` 先加载内置插件，再扫描 `~/.ftre/plugins/` 外部目录。

> **注意**：上下文压缩功能（原 `context_compact.py` 插件）已迁移为核心组件 `CompactManager`（`ftre/agent/compact_manager.py`），不再作为插件存在。`/compact` 指令现已在 `AgentLoop._register_commands()` 中注册为普通指令。自动上下文管理采用 `precompact_threshold`(0.5) 单阈值：idle/usage 后台路径直接 `compact(enabled=true)`，用户输入路径在 `_step_compact` 中标记 `need_compact` 后在 `_run_async()` 中执行压缩；自动压缩的静默行为取 `agents.context.silent`，默认 `true`。

---

## 1. title_gen — 自动生成会话标题

| 配置项 | 默认 | 说明 |
|--------|------|------|
| `system_prompt` | 内置 prompt | 标题生成的 system prompt |
| `input_truncate` | 1000 | 用户消息截断长度 |
| `max_chars` | 40 | 标题最大字符数 |

**触发条件：** events 为空（首次对话）+ session 无 title。

**实现说明：** 插件在 `before_messages_build` 时判断首条消息，随后在独立 worker 线程中异步调用 LLM 生成标题。优先使用 `agents.title_generation` 配置的专用模型，未配置则回退到主 LLM。生成结果经清洗后写入 session 的 `title` 字段，前端通过会话列表刷新展示新标题。

---

## 2. context_govern — 上下文治理

在 `before_messages_build` 阶段对事件流做四项修复 + AGENTS.md 注入。

> **注意**：用户自定义提示词（`USER.md`）的注入不在 `context_govern` 插件中完成，而是由 `agent_manager.py` 在构建 `AgentProfile` 时从 `~/.ftre/agents/<agent_id>/USER.md` 读取，并在 `_build_system_prompt()` 中以 `<USER_PROFILE>` 标签追加到 system_prompt 末尾。详见 [架构设计 — Agent Loop](/docs/architecture#agent-loop)。

### 修复能力

| 步骤 | 说明 |
|------|------|
| 孤立事件清理 | 丢弃没有配对 tool_call 的 tool_result，反之亦然 |
| tool_call 去重 | 同一 id 的 tool_call 只保留第一个（防止 DB 重复写入导致 `Duplicate tool_call_id`） |
| 相邻性修复 | 被 external_message 打断的 tool_call/tool_result 重新紧邻；同一 tool_call_id 的重复 tool_result 也会被去重丢弃 |
| 悬挂 tool_result | 压缩后 tool_call 被裁掉、tool_result 残留的丢弃 |

### AGENTS.md 注入

如果当前工作区下存在 `AGENTS.md`，将其内容以 `<AGENTS_RULE>` 标签注入 system_prompt 末尾：

```xml
<AGENTS_RULE desc="以下是用户在工作区自定义的规则与指令，你必须严格遵守" path="E:\project\AGENTS.md">
...文件内容...
</AGENTS_RULE>
```

### 用户自定义提示词注入（agent_manager，非插件）

用户自定义提示词不在 `config.json` 中配置，而是从 `~/.ftre/agents/<agent_id>/USER.md` 文件读取，由 `agent_manager.py` 在构建 system_prompt 时以 `<USER_PROFILE>` 标签注入末尾：

```xml
<USER_PROFILE desc="用户偏好与个人要求" path="C:\Users\用户名\.ftre\agents\default\USER.md">
...USER.md 文件内容...
</USER_PROFILE>
```

---

## 3. skill — Skills 能力加载

扫描 `~/.ftre/skills/` 下的 Skill 文件（支持 `<name>.md`、`<name>/SKILL.md`、`<name>/skill.md`），注册 `loadSkill` 工具，并在 system_prompt 中注入 Skill 描述列表。

| 配置项 | 默认 | 说明 |
|--------|------|------|
| `skills_dir` | `~/.ftre/skills` | Skill 文件目录 |

**工作原理：**

- `setup()` 时注册 `loadSkill` 工具（Tool 类），Agent 可以调用它按需读取 Skill 完整内容
- 注册 `BEFORE_AGENT_RUN` hook，注入 `<skill_desc>` 标签说明 Skill 机制（如何发现与加载）和 `<skill_list>` 标签（可用 Skill 列表），均通过 `append_to_first_system(ctx.messages, ...)` 追加到第一条 system 消息末尾
- Agent 根据用户需求自主判断是否需要调用 `loadSkill`，同一个 Skill 只加载一次

---

## 4. mcp — MCP 服务器管理

将 MCP 模块封装为内置插件，负责 MCP 连接生命周期、工具注册、系统提示词注入和 HTTP CRUD 路由。

| 配置项 | 默认 | 说明 |
|--------|------|------|
| （无插件专属配置） | — | MCP 配置在 `config.json` 顶层 `mcp` 段，不在 `plugins[]` 数组里 |

**工作原理：**

- `setup()` 时创建 `McpManager` 实例，通过 `self.api.tool_registry` 注册 MCP 工具
- 注册 `BEFORE_AGENT_RUN` hook，hook 函数（`_inject_system_prompt`）通过 `append_to_first_system(ctx.messages, ...)` 追加 MCP 工具使用说明到第一条 system 消息末尾
- 通过 `self.api.register_router()` 注册 `/api/mcp` CRUD 路由
- 异步启动 MCP 服务器连接，并启动 config watcher 实现热重载
- 每 3 秒轮询 `config.json` 的 `mcp` 段变化作为兜底

详见 [MCP 服务器](/docs/mcp)。

---

## 通用约定

这些插件主要通过 `before_messages_build` hook（`context_govern`、`title_gen`）或 `BEFORE_AGENT_RUN` hook（`mcp`、`skill`）参与 Agent 生命周期；`mcp` 额外注册 HTTP 路由和 MCP 工具，`skill` 注册 `loadSkill` 工具和 HTTP 路由。上下文压缩功能已从插件迁移为核心组件 `CompactManager`，自动压缩水位检测在 AgentLoop Pipeline 的 `_step_compact` 阶段执行（仅标记 `need_compact`），真正的启用或压缩执行在 `_run_async()` 中（关键路径直接 `await`）；空闲后台压缩由 `CompactManager.maybe_schedule_idle_compact()` 使用 `asyncio.create_task()` 异步派发。hook 内抛异常会被捕获跳过，不会拖垮主流程。内置插件按 `Path.glob("*.py")` 返回顺序加载；同一 hook 点上的执行顺序就是注册顺序。

## 校对记录

- **2025-06-26**：与 `ftre/src/ftre/plugin/builtin/*.py` 完整核对，描述准确。
  - 4 个内置插件（`title_gen` / `context_govern` / `skill` / `mcp`）与 `ftre/src/ftre/plugin/builtin/` 目录一致；
  - `context_govern` 的治理流程与注入能力（孤立事件清理 / tool_call 去重 / 相邻性修复 / 悬挂 tool_result / AGENTS.md 注入 / 用户自定义提示词注入）与 `context_govern.py:23-46` 一致；
  - `AGENTS_RULE` 与 `USER_CUSTOM_PROMPT` 标签的 XML 包裹格式与 `context_govern.py:50-97` 一致；
  - `title_gen` 默认配置（`DEFAULT_INPUT_TRUNCATE = 1000`、`DEFAULT_MAX_CHARS = 40`、`DEFAULT_SYSTEM_PROMPT`）与 `title_gen.py:24-29` 一致；通过 `before_messages_build` 判断首条消息（`ctx.events` 为空 + session 无 title），worker 线程中调用 `LLMHandler.stream` 生成标题；
  - `mcp` 插件在 `setup()` 中注册 `BEFORE_AGENT_RUN` hook，hook 函数 `_inject_system_prompt` 通过 `append_to_first_system(ctx.messages, ...)` 追加 MCP 工具说明到第一条 system 消息末尾；`self.api.register_router(self._build_router())` 注册 `/mcp` 前缀路由（最终路径为 `/api/mcp`）；`loop.call_soon_threadsafe(asyncio.create_task, self._start_connections())` 异步启动 MCP 连接；
   - MCP `local` / `remote` 配置校验在 `_validate_mcp_server`（`mcp_plugin.py:199-241`）；`timeout` 默认 `30_000` ms（即 30 秒），与代码一致；
   - `skill` 插件默认目录 `~/.ftre/skills`，支持 `<name>.md` / `<name>/SKILL.md` / `<name>/skill.md` 三种形式（`skill_plugin.py:276-278,341-343`）；
  - 上下文压缩功能已迁出插件：原 `context_compact.py` 插件不再存在；`CompactManager` 在 `ftre/src/ftre/agent/compact_manager.py`；`/compact` 在 `AgentLoop._register_commands()` 注册为普通指令。
- **2025-07-18**：修正 mcp 插件的 hook 描述。`mcp_plugin.py:36` 实际注册 `BEFORE_AGENT_RUN`，`_inject_system_prompt` 通过 `append_to_first_system(ctx.messages, ...)` 追加 MCP 工具说明到第一条 system 消息末尾。同步修正第 4 节「通用约定」中 "mcp 不注册 hook" 的错误表述。源码依据：`mcp_plugin.py:19,36,51-60`。
- **2025-12-18**：修正 skill 插件 hook 描述。`skill_plugin.py:49` 实际注册 `BEFORE_AGENT_RUN`，skill 的 `_inject_system_prompt` 同时注入 `<skill_desc>` 和 `<skill_list>`（通过 `append_to_first_system(ctx.messages, ...)` 追加到第一条 system 消息末尾），非两个独立 hook。同步修正校对记录中 mcp 的 hook 描述。
- **2026-07-18**：修正 `context_govern` 插件能力描述。原校对记录（2025-06-26）称 context_govern 负责「用户自定义提示词注入」并使用 `<USER_CUSTOM_PROMPT>` 标签，但当前 `context_govern.py` 只做四项 tool 事件修复 + AGENTS.md 注入，不处理用户自定义提示词。`USER.md` 的读取和 `<USER_PROFILE>` 标签注入由 `agent_manager.py:172,622-629` 完成，与 context_govern 无关。正文「用户自定义提示词注入」章节已同步修正。
