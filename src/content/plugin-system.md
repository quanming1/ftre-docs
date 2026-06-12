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

> 说明：本文描述的是插件框架能力。当前 `main.py` 创建 `PluginManager` 时未传入 `command_manager`，因此插件暂不能实际注册斜杠指令；内置指令仍在 `AgentLoop` 中注册。

---

## 运行位置

```
~/.ftre/
├── config.json          ← 在这里配置插件
└── plugins/
    └── my_plugin.py     ← 在这里写插件代码
```

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

注意：`plugins[]` 不是启用列表。Gateway 启动时会扫描并加载 `~/.ftre/plugins/` 下所有非 `_` 开头的 `.py` 插件；`plugins[]` 只用于给同名插件传入配置。

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
| `command_manager` | object \| None | 斜杠指令注册器（可能为 `None`），插件通过 `command_manager.register()` 注册指令。源码类型标注为 `object | None`，运行时实际为 `CommandManager` 实例或 `None`。当前 `main.py` 创建了 `CommandManager` 并传入 `AgentLoop` 和 API 路由，但未传入 `PluginManager`，因此此属性运行时始终为 `None`。注意：`/compact` 指令已在 `AgentLoop._register_commands()` 中直接注册，不依赖此属性 |
| `event_loop` | AbstractEventLoop \| None | 主 asyncio 事件循环引用；通过 `@property` 动态解析（内部存储为 `_event_loop: Callable | None`，若可调用则惰性求值，否则直接返回）。当前 `main.py` 在 `PluginManager(...)` 构造时未传入 `event_loop`，而是在 `agent_loop.start()` 后、`plugin_manager.load_all()` 前直接赋值 `plugin_manager._event_loop = agent_loop._event_loop`；因此随后加载的插件会在 `FtrePluginApi` 中拿到该事件循环实例。hook 的 `ctx.event_loop` 由 `AgentLoop._build_messages()` 单独传入，通常与 `self.api.event_loop` 指向同一个主事件循环 |
| `_hook_manager` | HookManager | 内部 hook 管理器，通常通过 `register_hook()` 使用 |
| `_tool_registry` | ToolRegistry | 内部工具注册表（`ftre.tools.ToolRegistry`），通常通过 `register_tool()` 使用；注意重复注册同名**插件工具**会抛出 `ValueError`，不会静默覆盖。若插件工具与内置工具同名，插件注册阶段不会报错；构建 Agent 工具表时由 `ftre-agent-core` 的 `ToolRegistry` 按名称覆盖，后注册的插件工具会覆盖同名内置工具 |

`FtrePluginApi` 还提供 `registerTool(tool)` 作为 `register_tool(tool)` 的 camelCase 别名。

### register_tool(tool)

注册一个 Tool 到 Agent 的默认工具集：

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
self.api.register_tool(tool)
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

### 注册斜杠指令（通过 command_manager.register，当前不可用）

> **注意：** `FtrePluginApi` 本身不提供 `register_command()` 方法，此段标题仅表示"注册指令"这一操作。理论上插件注册斜杠指令需要直接调用 `self.api.command_manager.register()`；但当前 `main.py` 创建 `PluginManager` 时未传入 `command_manager`，因此运行时 `self.api.command_manager` 为 `None`，下面示例代码在当前版本不能直接生效。

```python
def my_command(ctx):
    ctx.meta.update(result="处理完成")

if self.api.command_manager is not None:
    self.api.command_manager.register(
        "/my",
        my_command,
        description="执行我的插件指令",
    )
```

`command_manager.register()` 签名与 `CommandManager` 一致：`register(command, handler, *, description="", args_hint="")`。如果未来 `PluginManager` 注入了 `command_manager`，注册后指令会出现在 `GET /api/commands` 返回的列表中，并在 AgentLoop 指令 pipeline 中匹配；当前版本因该属性为 `None`，插件注册路径不会生效。

### register_hook(point, fn)

在生命周期挂点注册钩子。当前框架内置并自动触发的挂点只有 `before_messages_build`：

```python
from ftre.plugin import BEFORE_MESSAGES_BUILD

def my_hook(ctx):
    ctx.config.system_prompt += "\n\n额外提示词"
    return ctx

self.api.register_hook(BEFORE_MESSAGES_BUILD, my_hook)
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
| `config` | AgentConfig | 配置副本（可改 system_prompt / model / llm 等） |
| `inbound_data` | dict | 当前用户消息的原始 data |
| `event_loop` | Any | 主 asyncio 事件循环引用（插件用于 `run_coroutine_threadsafe`） |

`MessagesBuildContext` 包含上述所有字段。`ctx.event_loop` 由 `AgentLoop._build_messages()` 直接传入；当前启动顺序也会在插件加载前把 `agent_loop._event_loop` 赋给 `plugin_manager._event_loop`，因此插件的 `self.api.event_loop` 通常同样可用，并与 `ctx.event_loop` 指向同一个主事件循环。

**使用示例：**

```python
def my_hook(ctx):
    # 修改 system_prompt
    ctx.config.system_prompt += "\n\n## 额外规则\n- 始终使用中文回复"

    # 过滤事件流
    ctx.events = [e for e in ctx.events if e.get("type") != "some_noise"]

    return ctx
```

### 自定义 Hook

`HookManager` 只提供同步触发接口 `trigger_sync(point, ctx)`。框架当前只会自动触发 `before_messages_build`；如果你在扩展代码里手动触发自定义挂点，可复用同一个 HookManager：

```python
from ftre.plugin import HookManager

hook_manager.trigger_sync("my_custom_point", ctx)
```

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

标记为 `Injected` 的参数不暴露给 LLM，由框架自动注入。当前注入解析发生在 `ToolRegistry.execute(..., runtime_context=...)` 路径，因此主运行链路中仅同步工具会自动注入；异步工具在 `ToolHandler.run_one()` 中直接 `await tool._get_callable()(**ctx.arguments)`，不会自动解析 `Injected`：

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
- 同名插件工具之间会在 `ftre.tools.ToolRegistry.register()` 阶段抛出 `ValueError`；但插件工具与内置工具同名时，注册阶段不会报错，构建 Agent 时会由 `ftre-agent-core` 的工具注册表按名称覆盖内置工具
- `FtrePluginApi` 不提供 `register_command()` 方法；插件注册斜杠指令需直接调用 `self.api.command_manager.register(command, handler, *, description="", args_hint="")`。当前运行时 `command_manager` 始终为 `None`（`main.py` 未将其传入 `PluginManager`），因此此调用实际不会生效。内置指令（如 `/cancel`、`/compact`）已在 `AgentLoop._register_commands()` 中直接注册，不经过插件系统
