# 插件系统

ftre 的插件系统允许你在不修改核心代码的前提下，扩展 Agent 的能力。

---

## 插件是什么

插件是一个 Python 类，继承 `Plugin` 基类，放在 `~/.ftre/plugins/` 目录下。Gateway 启动时自动扫描并加载。

一个插件可以：

- **注册 Tool** — 给 Agent 添加新的工具
- **注册 Channel** — 添加新的输入/输出通道
- **注册 Hook** — 在 Agent 生命周期中插入自定义逻辑
- **读取配置** — 从 `~/.ftre/config.json` 获取插件专属配置

> 说明：本文描述的是插件框架能力。当前 `main.py` 将 `CommandManager` 实例传入 `PluginManager`（`command_manager=cmd`），因此插件可通过 `self.api.command_manager.register()` 注册斜杠指令；`register()` 签名支持 `system: bool = False` 参数，系统级指令在 session lock 外执行。内置指令仍在 `AgentLoop` 中注册（`/cancel` 为系统级、`/compact` 为普通级）。

---

## 运行位置

```
~/.ftre/
├── config.json          ← 在这里配置插件
└── plugins/
    └── my_plugin/       ← 每个子目录是一个插件 package
        ├── __init__.py  ← 入口文件（必需），暴露 Plugin 子类
        └── helper.py    ← 插件内部模块
```

插件以**子目录**形式存放，目录名即 Python package 名（使用下划线，如 `octo_plugin`）。Gateway 启动时扫描 `~/.ftre/plugins/` 下的每个子目录，将目录加入 `sys.path`，然后 import 该 package（执行 `__init__.py`），从中找到 `Plugin` 子类自动实例化并加载。

---

## 配置方式

在 `~/.ftre/config.json` 中添加 `plugins` 数组：

```json
{
  "plugins": [
    {
      "name": "my_plugin",
      "config": {
        "api_key": "xxx",
        "timeout": 30
      }
    }
  ]
}
```

- `name` — 必须与插件的 `name` 属性匹配
- `config` — 任意 JSON 对象，插件通过 `self.api.config` 读取

注意：`plugins[]` 不是启用列表。Gateway 启动时会扫描 `~/.ftre/plugins/` 下所有非 `_` 开头的子目录（每个子目录是一个 Python package，入口固定为 `__init__.py`）；`plugins[]` 只用于给同名插件传入配置。

---

## Plugin 基类

```python
from ftre.plugin import Plugin

class MyPlugin(Plugin):
    name: str = ""            # 必填，用于配置匹配
    version: str = "0.0.0"    # 版本号
    api: FtrePluginApi        # 框架注入

    def setup(self) -> None:
        """插件入口，在此注册能力。必须实现。"""
        raise NotImplementedError

    def teardown(self) -> None:
        """卸载时清理资源。可选，基类默认空实现。"""
        pass
```

---

## FtrePluginApi

每个插件通过 `self.api` 访问框架能力：

| 属性 | 类型 | 说明 |
|------|------|------|
| `config` | dict | 插件专属配置（来自 config.json） |
| `bus` | EventBus | 消息总线 |
| `session_manager` | SessionManager | Session 和消息的持久化 |
| `channel_manager` | ChannelManager | Channel 注册和分发 |
| `command_manager` | CommandManager | 斜杠指令注册器，插件通过 `command_manager.register()` 注册指令。当前 `main.py` 已将 `CommandManager` 实例传入 `PluginManager`（`command_manager=cmd`），因此此属性运行时为 `CommandManager` 实例。`register()` 签名新增 `system: bool = False` 参数，`system=True` 注册的系统级指令在 `_dispatch` 的 session lock 外执行，适合需要立即响应的指令（如取消操作）；默认 `system=False` 的普通指令在 lock 内执行。注意：`/cancel` 已在 `AgentLoop._register_commands()` 中作为系统级指令注册（`system=True`），`/compact` 作为普通指令注册 |
| `event_loop` | AbstractEventLoop \| None | 主 asyncio 事件循环引用；通过 `@property` 动态解析（内部存储为 `_event_loop: Callable | None`，若可调用则惰性求值，否则直接返回）。当前 `main.py` 在 `PluginManager` 构造时直接传入 `event_loop=lambda: event_loop`（闭包引用 `asyncio.get_running_loop()` 返回的事件循环），因此插件加载时即可通过 `FtrePluginApi.event_loop` 拿到主事件循环实例。**注意**：`AgentLoop._build_messages()` 构造 `MessagesBuildContext` 时当前未传入 `event_loop`，因此 hook 的 `ctx.event_loop` 为 `None`；插件如需在 hook 中使用事件循环，应使用 `self.api.event_loop` |
| `_hook_manager` | HookManager | 内部 hook 管理器，通常通过 `register_hook()` 使用 |
| `_tool_registry` | ToolRegistry | 内部工具注册表（`ftre_agent_core.tool.ToolRegistry`），通常通过 `self.api.tool_registry.register(tool)` 使用；当前 `register()` 实现为直接覆盖（`self._tools[name] = tool`），同名工具（包括插件工具之间、与内置工具同名）都会被静默覆盖，不抛 `ValueError`。后注册的同名插件工具会覆盖先前注册的同名插件工具；插件工具与同名内置工具的覆盖发生在 Agent 构建工具表（`to_openai_tools()` / `snapshot()`）时，由全局 `ToolRegistry` 统一按工具名取最新注册 |

`FtrePluginApi` 不提供 `register_tool()` 方法；插件注册工具需通过 `self.api.tool_registry.register(tool)`。`tool_registry` 属性返回 `ftre_agent_core.tool.ToolRegistry` 实例。

### register_router(router)

注册 FastAPI `APIRouter`，路由会在 `WebSocketChannel` 启动时统一挂载到 `/api` 前缀下。`mcp` 内置插件通过此方法注册 `/api/mcp` CRUD 路由，`skill` 插件注册 `/api/skills` 路由：

```python
from fastapi import APIRouter

router = APIRouter(prefix="/my-plugin")
@router.get("/status")
async def status():
    return {"ok": True}

self.api.register_router(router)
# 最终路径: /api/my-plugin/status
```

### 修改 messages 列表（通过 before_agent_run hook）

> **`append_system_prompt()` 已移除。** 当前内置插件的 system prompt 注入通过 `BEFORE_AGENT_RUN` hook 操作 `ctx.messages`（`McpPlugin` / `SkillPlugin` 通过 `append_to_first_system(ctx.messages, ...)` 将提示词追加到第一条 system 消息末尾）；`BEFORE_MESSAGES_BUILD` hook 可直接修改 `ctx.config.system_prompt`（`ContextGovernPlugin` 用于注入 AGENTS.md）。用户自定义提示词（`USER.md`）不在插件中处理，而是由 `agent_manager.py` 在构建 system_prompt 时以 `<USER_PROFILE>` 标签注入。

```python
from ftre.plugin import BEFORE_AGENT_RUN

def _inject(self, ctx):
    # 追加到已有的 system 消息
    for msg in ctx.messages:
        if msg.get("role") == "system":
            msg["content"] += "\n\n## 额外指令\n- 始终使用中文回复"
            break
    else:
        ctx.messages.insert(0, {"role": "system", "content": "## 额外指令\n- 始终使用中文回复"})
    # 也可以插入 user 消息作为对话上下文
    ctx.messages.insert(1, {"role": "user", "content": "[会话背景]\n这是群聊 \"项目组\" 中的对话"})
    return ctx

self.api.register_hook(BEFORE_AGENT_RUN, _inject)
```

相比旧的 `append_system_prompt`，新机制的优势：
- 直接操作 OpenAI 格式的 messages，与 LLM 协议一致，所见即所得
- 可以自由选择 `{"role": "system"}` 或 `{"role": "user"}`，实现 OpenClaw 的 prependContext/prependSystemContext 双轨注入
- 可以插入/删除/重排消息，不限于追加
- 多个插件按注册顺序依次执行，后一个 hook 看到前一个的改写结果

### 注册 Tool（通过 tool_registry.register）

插件通过 `self.api.tool_registry.register(tool)` 注册 Tool 到 Agent 的默认工具集：

```python
from ftre_agent_core.tool import Tool, ToolParameter

tool = Tool(
    name="my_tool",
    description="一个示例工具",
    parameters=[
        ToolParameter(name="input", type="string", description="输入", required=True),
    ],
    func=lambda input: f"处理结果: {input}",
)
self.api.tool_registry.register(tool)
```

### register_channel(channel)

注册一个新 Channel。需继承 `ftre.channel.Channel` 并实现 `send()`：

```python
from ftre.channel import Channel
from ftre.bus import BusMessage

class MyChannel(Channel):
    def __init__(self, bus):
        super().__init__(channel_id="my_channel", name="My Channel", bus=bus)

    async def send(self, msg: BusMessage) -> None:
        pass  # 推送到外部

self.api.register_channel(MyChannel(bus=self.api.bus))
```

Channel 基类的 `__init__` 需要三个参数：
- `channel_id`: 唯一标识符，用于消息路由
- `name`: 显示名称
- `bus`: EventBus 实例

### 注册斜杠指令（通过 command_manager.register）

> `FtrePluginApi` 本身不提供 `register_command()` 方法，此段标题仅表示"注册指令"这一操作。插件注册斜杠指令需直接调用 `self.api.command_manager.register()`。当前 `main.py` 已将 `CommandManager` 传入 `PluginManager`，因此运行时 `self.api.command_manager` 为 `CommandManager` 实例，下面示例代码可正常生效。

```python
def my_command(ctx):
    ctx.meta.update(result="处理完成")

self.api.command_manager.register(
    "/my",
    my_command,
    description="执行我的插件指令",
)
# 或注册系统级指令（在 session lock 外执行）
# self.api.command_manager.register("/my_system", my_handler, description="...", system=True)
```

`command_manager.register()` 签名：`register(command, handler, *, description="", args_hint="", system=False)`。`system=True` 注册的系统级指令在 `_dispatch` 的 session lock 外执行，适合需要立即响应的指令（如取消操作）；默认 `system=False` 的普通指令在 Pipeline `_step_command` 中执行，受 session lock 保护。注册后指令会出现在 `GET /api/commands` 返回的列表中（含 `system` 字段），并在 `AgentLoop._dispatch` / Pipeline 中匹配。

### register_hook(point, fn)

在生命周期挂点注册钩子。当前框架内置并自动触发的挂点有 `before_messages_build` 和 `before_agent_run`：

```python
from ftre.plugin import BEFORE_MESSAGES_BUILD, BEFORE_AGENT_RUN

# 挂点 1：消息构建前（事件流处理）
def my_event_hook(ctx):
    ctx.events = [e for e in ctx.events if e.get("type") != "noise"]
    return ctx

# 挂点 2：Agent 运行前（OpenAI 消息列表操作）
def my_run_hook(ctx):
    ctx.messages.insert(0, {"role": "user", "content": "[GROUP CONTEXT]\n群聊信息..."})
    return ctx

self.api.register_hook(BEFORE_MESSAGES_BUILD, my_event_hook)
self.api.register_hook(BEFORE_AGENT_RUN, my_run_hook)
```

---

## Hook 挂点

### before_messages_build

**触发时机：** 每次 Agent 执行前，在构建 LLM 输入消息时。

**上下文 `MessagesBuildContext`：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `session_id` | str | 当前会话 ID |
| `channel_id` | str | 来源 channel |
| `workspace` | str | 工作区绝对路径 |
| `events` | list | 事件流（可修改：裁剪/注入/重排） |
| `config` | AgentConfig | 配置副本（可改 `system_prompt` / `llm` / `max_iterations` 等，[完整字段见下文](#agentconfig-字段说明)） |
| `inbound_data` | dict | 当前用户消息的原始 data |
| `agent_dir` | str | Agent 的家目录绝对路径（存放提示词文件的目录，来自 `agent_profile.agent_dir`；只读） |
| `event_loop` | Any | 主 asyncio 事件循环引用（插件用于 `run_coroutine_threadsafe`）。**注意**：当前 `AgentLoop._build_messages()` 构造 `MessagesBuildContext` 时未传入此字段，因此 `ctx.event_loop` 为 `None`；插件如需在 hook 中使用事件循环，应使用 `self.api.event_loop` |

`MessagesBuildContext` 包含上述所有字段。**注意**：当前 `AgentLoop._build_messages()` 构造 `MessagesBuildContext` 时未传入 `event_loop`，因此 `ctx.event_loop` 为 `None`。插件如需在 hook 中使用事件循环，应使用 `self.api.event_loop`（该属性在 `PluginManager` 构造时已通过 `event_loop=lambda: event_loop` 注入，通常指向主事件循环）。

**使用示例：**

```python
def my_hook(ctx):
    # 修改 system_prompt
    ctx.config.system_prompt += "\n\n## 额外规则\n- 始终使用中文回复"

    # 过滤事件流
    ctx.events = [e for e in ctx.events if e.get("type") != "some_noise"]

    return ctx
```

### before_agent_run

**触发时机：** 在 `AgentLoop._run_async()` 中，Agent 已创建、messages 已转 OpenAI 格式、`agent.run(messages)` 调用之前。

**上下文 `AgentRunContext`：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `session_id` | str | 当前会话 ID（只读） |
| `channel_id` | str | 来源 channel（只读） |
| `messages` | list[dict] | OpenAI 格式消息列表（可增删改） |
| `config` | AgentConfig | 配置深拷贝（可读，[完整字段见下文](#agentconfig-字段说明)） |
| `agent_profile` | `AgentProfile \| None` | 当前 agent 的完整运行时配置（只读）。含 `agent_id` / `name` / `tools_config` / `mcp_config` / `soul_prompt` / `agents_md` / `user_prompt_md` / `agent_dir` 等字段；`None` 表示未加载到 agent 配置（仅 default 无目录时） |
| `agent_tool_registry` | `ToolRegistry \| None` | 当前 agent 的私有工具注册表。插件可在 `before_agent_run` hook 中通过 `ctx.agent_tool_registry.register(tool)` 注册仅对当前 agent 生效的私有工具，不影响其他 agent。`None` 表示未提供（仅 default 无 agent 配置时） |

**使用示例：**

```python
from ftre.plugin import BEFORE_AGENT_RUN

def my_hook(ctx):
    # 注入系统身份（system 消息）
    ctx.messages.insert(0, {"role": "system", "content": "你是 Alice 的 AI 助手"})

    # 注入对话上下文（user 消息）
    ctx.messages.insert(1, {"role": "user", "content": "[GROUP CONTEXT]\n群聊信息\n[/GROUP CONTEXT]"})

    # 或追加到已有 system 消息
    for msg in ctx.messages:
        if msg.get("role") == "system":
            msg["content"] += "\n\n## MCP 工具\n你可以通过 MCP 调用外部工具。"
            break

    # 注册 per-agent 私有工具
    if ctx.agent_tool_registry is not None:
        ctx.agent_tool_registry.register(my_tool)

    return ctx
```

#### per-agent 私有工具

`ctx.agent_tool_registry` 是一个独立的 `ToolRegistry` 实例，仅对当前 agent 生效。通过 `before_agent_run` hook 注册的工具会合并到该 agent 的工具集中，其他 agent 不会看到这些工具。典型场景：Channel 插件为不同 agent 注册不同的平台管理工具（如 octo-plugin 按 `agent_id` 匹配 bot，注册对应的 `octo_management` 工具）。

与之相对，`self.api.tool_registry` 是**全局**工具注册表，注册到其中的工具对所有 agent 可见。

**与 `before_messages_build` 的区别：**

| 维度 | `before_messages_build` | `before_agent_run` |
|------|------------------------|---------------------|
| 触发时机 | 消息构建时（每次 run） | Agent 创建后、run 前（每次 run） |
| 输入数据 | 原始事件流（list[dict]） | OpenAI 格式消息（list[dict]） |
| 主要用途 | 事件流清洗/裁剪/注入、system_prompt 修改 | system/user 消息双轨注入 |
| 可改字段 | events, config | messages, config |
| 典型使用者 | context_govern, title_gen | mcp（注入 MCP 工具说明）、skill（注入 Skill 说明和列表）、octo（注入群聊上下文） |

---

## AgentConfig 字段说明

Hook 上下文中的 `config` 是 `AgentConfig` 的副本（`before_messages_build` 可改，`before_agent_run` 只读）。以下是完整字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `llm` | `LLMConfig` | 主 LLM 配置（详见下表） |
| `system_prompt` | `str` | 系统提示词，默认从 `system_prompt.md` 加载。`before_messages_build` hook 可修改 |
| `max_iterations` | `int \| None` | Agent 最大迭代轮数；`None` 表示用框架默认值 |
| `workspace` | `str` | 默认工作区。空字符串表示走进程 cwd 兜底 |
| `title_llm` | `LLMConfig \| None` | 标题生成专用 LLM；`None` 表示沿用主 `llm` |
| `compact_llm` | `LLMConfig \| None` | 上下文压缩专用 LLM；`None` 表示沿用主 `llm` |
| `context` | `ContextConfig` | 上下文管理配置（详见下表） |

### LLMConfig 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `api_key` | `str` | API 密钥（来自 `providers[provider]`） |
| `api_base` | `str` | API 基础 URL（来自 `providers[provider]`） |
| `api_type` | `str` | API 类型，默认 `"completions"` |
| `name` | `str` | 模型显示名（来自 `providers[provider].models[]` 中匹配的条目） |
| `id` | `str` | 模型原始 ID |
| `context_window` | `int \| None` | 上下文窗口大小（token 数） |
| `max_output` | `int \| None` | 最大输出 token 数 |
| `vision` | `bool` | 是否支持视觉输入 |
| `model` | `str` | 派生字段，当前由 `_build_model_name()` 直接返回 `model_id`（不做前缀拼接），供 ReActAgent 直接使用 |

### ContextConfig 字段

对应 `config.json` 的 `agents.context`，所有字段都有默认值，缺省即用代码内常量。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `precompact_threshold` | `float` | `0.5` | 预压缩水位：`estimated_tokens / context_window ≥ 此值` 时后台准备摘要 |
| `compact_threshold` | `float` | `0.6` | 启用压缩水位：达到此值时启用已准备的摘要 |
| `consolidation_ratio` | `float` | `0.5` | 压缩目标比例：`target = budget * consolidation_ratio` |
| `safety_buffer` | `int` | `1024` | 预算安全垫：`budget = context_window - max_output - safety_buffer` |
| `idle_compaction` | `bool` | `True` | 是否开启后台空闲压缩（每轮 done 后异步 LLM 摘要） |
| `silent` | `bool` | `True` | 压缩事件是否标记 silent（前端不渲染气泡，对用户无感） |

---

## AgentProfile 字段说明

`before_agent_run` hook 上下文中的 `agent_profile` 是当前 agent 的完整运行时配置（只读）。对应 `~/.ftre/agents/<id>/agent.config.json` 合并后的结果：

| 字段 | 类型 | 说明 |
|------|------|------|
| `agent_id` | `str` | Agent 标识符（如 `"default"` / `"octo"` / `"exodia"`） |
| `name` | `str` | Agent 显示名称 |
| `llm` | `LLMConfig` | Agent 专属 LLM 配置（已合并进 `AgentConfig.llm`） |
| `workspace` | `str` | Agent 的"家目录"（存放 prompt 文件的路径，不是对话 cwd） |
| `tools_config` | `dict \| None` | 工具白/黑名单：`{"allow": [...], "deny": [...]}` 或 `None`（不过滤） |
| `mcp_config` | `dict` | MCP 服务器配置 |
| `plugins_config` | `list` | 插件配置列表 |
| `disabled_skills` | `list` | 禁用的 Skill 名称列表 |
| `soul_prompt` | `str` | `SOUL.md` 内容（Agent 人格定义） |
| `user_prompt_md` | `str` | `USER.md` 内容（用户偏好提示词） |
| `agents_md` | `str` | `AGENTS.md` 内容（行为规范） |
| `agent_dir` | `str` | Agent 目录的绝对路径（如 `~/.ftre/agents/default`） |

---

### 自定义 Hook

`HookManager` 提供异步触发接口 `trigger(point, ctx)`。框架当前自动触发 `before_messages_build` 和 `before_agent_run`；如果你在扩展代码里手动触发自定义挂点，可复用同一个 HookManager：

```python
from ftre.plugin import HookManager

ctx = await hook_manager.trigger("my_custom_point", ctx)
```

> 所有 hook 均为异步执行。hook 函数可以是 `async def` 也可以是普通 `def`——`trigger` 会检测返回值是否为 coroutine 并自动 `await`。

---

## Tool 创建方式

### 手动构造

```python
Tool(
    name="bash",
    description="执行 shell 命令",
    parameters=[ToolParameter(name="command", type="string", description="要执行的命令")],
    func=run_bash,
)
```

### 装饰器

```python
from ftre_agent_core.tool import tool

@tool(name="hello", description="打个招呼")
def hello(name: str) -> str:
    return f"Hello, {name}!"
```

### 继承

```python
class MyTool(Tool):
    name = "my_tool"
    description = "我的工具"

    def _run(self, **kwargs):
        return "result"
```

### ToolParameter

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `name` | string | 是 | 参数名 |
| `type` | string | 是 | JSON Schema 类型 |
| `description` | string | 是 | 参数描述 |
| `required` | bool | 否 | 默认 `True` |
| `enum` | list \| None | 否 | 可选值列表，默认 `None` |

### Injected 依赖注入

标记为 `Injected` 的参数不暴露给 LLM，由框架自动注入。同步工具通过 `ToolRegistry.execute(..., runtime_context=...)` 路径解析；异步工具在 `ToolHandler.run_one()` 中先调用 `registry._resolve_injections()` 解析 `Injected` 参数，再 `await` 底层协程：

```python
from ftre_agent_core.tool import Injected

class MyTool(Tool):
    def _run(self, event_loop=Injected("event_loop"), **kwargs):
        ...
```

---

## 禁止事项

- 文件名不要以 `_` 开头（会被跳过）
- 插件类必须继承 `Plugin`，设置非空 `name`
- `setup()` 必须实现；`teardown()` 可选，基类默认空实现
- hook 函数抛异常会被捕获跳过，不会拖垮主流程
- 同名插件只加载第一个，后续同名插件会被跳过
- `Injected` 只能作为参数默认值使用（如 `x=Injected("x")`），不要写成类型注解
- 同名工具之间（包括插件工具与内置工具、插件工具之间）在 `ftre_agent_core.tool.ToolRegistry.register()` 阶段不会抛 `ValueError`，而是按名称直接覆盖（`self._tools[name] = tool`）。后注册的同名插件工具会覆盖先前注册的内置/插件工具；构建 Agent 工具表时由该 `ToolRegistry` 统一按工具名取最新注册
- `FtrePluginApi` 不提供 `register_tool()` 方法；插件注册工具需通过 `self.api.tool_registry.register(tool)`。`tool_registry` 属性返回 `ftre_agent_core.tool.ToolRegistry` 实例。插件注册斜杠指令需直接调用 `self.api.command_manager.register(command, handler, *, description="", args_hint="", system=False)`。当前运行时 `command_manager` 为 `CommandManager` 实例（`main.py` 将其传入 `PluginManager`），因此此调用可以生效。`system=True` 注册的系统级指令在 session lock 外执行，默认普通指令在 lock 内执行。内置指令（如 `/cancel` 为系统级、`/compact` 为普通级）已在 `AgentLoop._register_commands()` 中直接注册

## 校对记录

 - **2025-06-26**：与 `ftre/src/ftre/plugin/plugin.py` / `hook_manager.py` / `command/manager.py` / `main.py` 核对，描述准确。
   - `FtrePluginApi` 暴露的方法与属性（`register_channel` / `register_hook` / `register_router` / `tool_registry` / `command_manager` / `event_loop`）与 `plugin/plugin.py` 一致；
   - `PluginManager.__init__` 接受 `command_manager` 参数（`plugin/plugin.py`），并在 `_load` 时将其透传给 `FtrePluginApi`；
   - `load_all()` 先用 `BUILTIN_DIR.glob("*.py")` 加载内置插件，再扫描 `PLUGINS_DIR`（`plugin/plugin.py`）；内置插件按 `Path.glob` 返回顺序加载，同一 hook 点上的执行顺序就是注册顺序；
    - `MessagesBuildContext` 字段（`session_id` / `channel_id` / `inbound_data` / `workspace` / `agent_dir` / `event_loop` / `config` / `events`）与 `plugin/hook_manager.py:52-76` 一致；其中 `event_loop` 默认 `None`，由 `_build_messages` 构造时未传入该字段（`agent/loop.py:714-722`）；
   - `CommandManager.register()` 签名 `register(command, handler, *, description="", args_hint="", system=False)` 与 `command/manager.py` 一致；
   - 插件工具与同名内置工具冲突时，`ftre-agent-core` 的 `ToolRegistry.register()` 按名称覆盖内置工具（`self._tools[name] = tool`，不抛 `ValueError`）；插件同名工具之间同样按名称覆盖，后注册者覆盖先前注册者；
 - **2025-07-11**：补全 `FtrePluginApi` 文档中缺失的 `register_router()` 和 `append_system_prompt()` 方法。源码依据：`plugin/plugin.py:95-97`（`register_router`）。
  - **2025-07-18**：重构 system prompt 注入机制，新增 `before_agent_run` 挂点。
    - 删除 `append_system_prompt()` 方法与 `appended_system_prompts` 属性；
     - 新增 `AgentRunContext` dataclass，字段：`session_id` / `channel_id`（只读）、`messages`（OpenAI 格式消息列表，可增删改）、`config`（可读），与 `plugin/hook_manager.py:78-98` 一致；
    - `AgentLoop._run_async()` 在 `_create_agent()` 之后、`agent.run(messages)` 之前触发 `before_agent_run` hook（`agent/loop.py:546-556`）；
      - `mcp` 和 `skill` 内置插件从 `append_system_prompt` 迁移到 `register_hook(BEFORE_AGENT_RUN, self._inject_system_prompt)`，通过 `append_to_first_system(ctx.messages, ...)` 将提示词追加到第一条 system 消息末尾（`plugin/builtin/mcp_plugin.py:19,36,51-60`、`plugin/builtin/skill_plugin.py:16,49,51-66`、`hook_manager.py:33-48`）；
     - 现有 `before_messages_build` hook 在 `AgentLoop._build_messages()` 中触发，代码在 `agent/loop.py:691-705`。
- **2025-12-18**：修正 `before_agent_build` hook 文档错误。经核实，代码中不存在 `BEFORE_AGENT_BUILD` / `AgentBuildContext`，`hook_manager.py` 只定义 `BEFORE_MESSAGES_BUILD`（`hook_manager.py:29`）和 `BEFORE_AGENT_RUN`（`hook_manager.py:30`）。`mcp` 和 `skill` 插件实际注册 `BEFORE_AGENT_RUN`，通过 `append_to_first_system()` 将提示词追加到第一条 system 消息末尾（非 `ctx.system_prompt`）。删除文档中虚构的 `before_agent_build` hook 章节，修正所有相关引用。
- **2026-07-18**：修正 `MessagesBuildContext` 行号引用。原记录标注 `plugin/hook_manager.py:33-57`，但该范围内 33-48 为 `append_to_first_system` 函数，`MessagesBuildContext` 类定义实际起始行为 `hook_manager.py:52`。修正为 `plugin/hook_manager.py:52-75`。字段内容本身与源码一致，仅行号因代码重构偏移。
- **2026-07-03**：复验校对记录中 `loop.py` 行号。代码持续演进后偏移，以下为当前正确行号：`MessagesBuildContext` 构造在 `loop.py:714-722`（原记录标注 `695-702`），该字段确实未传入 `event_loop`；`before_agent_run` hook 触发在 `loop.py:564-574`（原记录标注 `546-556`）；`before_messages_build` hook 触发在 `loop.py:710-725`（原记录标注 `691-705`）。正文描述的所有行为仍准确。
- **2026-07-04**：新增「AgentConfig 字段说明」章节。用户反馈 hook 上下文中引用的 `AgentConfig` 从未列出完整字段。与 `config.py:62-128` 核对，补充 `AgentConfig`（7 字段）、`LLMConfig`（9 字段）、`ContextConfig`（6 字段）的完整表格，并在两处 hook 上下文表格中添加交叉引用。同日新增 `AgentRunContext.agent_profile` 字段（`hook_manager.py:100`）及「AgentProfile 字段说明」章节（12 字段，与 `agent_manager.py:33-47` 核对），插件可在 `before_agent_run` hook 中读取当前 agent 的 `agent_id` / `name` / `tools_config` / `mcp_config` / `soul_prompt` 等完整配置。
- **2026-07-19**：行号复验。代码持续演进后偏移，以下为当前正确行号：`MessagesBuildContext` 构造在 `loop.py:743-754`（原记录标注 `714-722`），该字段确实未传入 `event_loop`；`before_agent_run` hook 触发在 `loop.py:585-594`（原记录标注 `564-574`）；`before_messages_build` hook 触发在 `loop.py:740-754`（原记录标注 `710-725`）。`hook_manager.py` 常量定义仍准确（`BEFORE_MESSAGES_BUILD = "before_messages_build"`：`hook_manager.py:32`、`BEFORE_AGENT_RUN = "before_agent_run"`：`hook_manager.py:33`；`append_to_first_system` 函数定义在 `hook_manager.py:36`；`MessagesBuildContext` 类定义在 `hook_manager.py:54-79`；`AgentRunContext` 类定义在 `hook_manager.py:82-104`，其中 `agent_tool_registry` 字段在 `:104`）。正文描述的所有行为仍准确。
- **2026-08-08**：复验 `FtrePluginApi` 当前实现。
  - 实际类定义在 `ftre/src/ftre/plugin/plugin.py:39-96`，`__init__` 接收 `event_loop: Callable | None` 和 `command_manager: object | None` 参数，`event_loop` 通过 `@property` 动态解析（`plugin.py:64-69`，可调用时惰性求值，否则直接返回），与文档"`@property` 动态解析"描述一致。
  - `PluginManager.__init__`（`plugin.py:115-133`）接受 `command_manager: object | None` 参数并在 `_load`（`plugin.py:206-216`）时透传给 `FtrePluginApi`，与文档"PluginManager 接受 command_manager 参数并在 _load 时将其透传给 FtrePluginApi"一致。
  - `load_all`（`plugin.py:135-199`）先用 `BUILTIN_DIR.glob("*.py")` 加载内置插件，再扫描 `PLUGINS_DIR`（`plugin.py:152, 178`），与文档"先加载内置插件，再扫描外部目录"一致。
  - `ToolRegistry.register()` 在 `ftre-agent-core/tool/registry.py` 实现为直接覆盖（`self._tools[name] = tool`），同名工具（含内置与插件之间、插件之间）按名称覆盖，不抛 `ValueError`；与文档"同名工具按名称直接覆盖"一致。
  - `FtrePluginApi.command_manager` 在 `main.py:141` 中以 `command_manager=cmd` 传入 `PluginManager`，运行时为 `CommandManager` 实例（`plugin.py:72-74` 通过 `@property` 暴露），与文档"`main.py` 已将 `CommandManager` 实例传入 `PluginManager`"一致。
  - `register_router` 实际签名为 `register_router(self, router: APIRouter)`（`plugin.py:94-96`），将 router 追加到 `self._routers: list[APIRouter]`，`PluginManager.routers` 通过 `routers.copy()` 暴露（`plugin.py:247-250`），最终在 `ws_channel.py:298-299` 通过 `app.include_router(router, prefix="/api")` 挂载，与文档"`/api` 前缀下"一致。
