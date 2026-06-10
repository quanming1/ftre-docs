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

注意：`plugins[]` 不是启用列表。Gateway 启动时会扫描并加载 `~/.ftre/plugins/` 下所有 `.py` 插件；`plugins[]` 只用于给同名插件传入配置。

---

## Plugin 基类

```python
from ftre.plugin import Plugin

class MyPlugin(Plugin):
    name: str = ""            # 必填，用于配置匹配
    version: str = "0.0.0"    # 版本号
    api: FtrePluginApi        # 框架注入

    def setup(self) -> None:
        """插件入口，在此注册能力。"""
        ...

    def teardown(self) -> None:
        """卸载时清理资源。"""
        ...
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
| `command_manager` | CommandManager | 斜杠指令注册器，通常通过 `register_command()` 使用；如需 `ephemeral=True` 可直接调用 `command_manager.register()` |
| `event_loop` | AbstractEventLoop | 主 asyncio 事件循环引用（插件用于 `run_coroutine_threadsafe`） |
| `_hook_manager` | HookManager | 内部 hook 管理器，通常通过 `register_hook()` 使用 |
| `_tool_registry` | ToolRegistry | 内部工具注册表，通常通过 `register_tool()` 使用 |

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

### register_command(command, handler, *, description="", args_hint="")

注册一条普通斜杠指令，供命令面板和 AgentLoop 指令 pipeline 使用：

```python
def my_command(ctx):
    ctx.meta.update(result="处理完成")

self.api.register_command(
    "/my",
    my_command,
    description="执行我的插件指令",
)
```

`register_command()` 不暴露 `ephemeral` 参数；需要注册不入库、不 echo 的控制类指令时，可直接访问 `self.api.command_manager.register(..., ephemeral=True)`。

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

`MessagesBuildContext` 当前只包含上述字段；`hook_manager.py` 注释里提到的 `event_loop` 不在 `ctx` 上。插件如需访问 asyncio 事件循环（用于 `run_coroutine_threadsafe`），请通过 `self.api.event_loop` 获取。

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
| `enum` | list | 否 | 可选值列表 |

### Injected 依赖注入

标记为 `Injected` 的参数不暴露给 LLM，由框架自动注入：

```python
from ftre_agent_core.tool import Injected

class MyTool(Tool):
    async def _run(self, event_loop=Injected("event_loop"), **kwargs):
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
